"""Combined-corpus (pop909 + nottingham + openbook) glue for next-chord.

Everything needed to train/evaluate/export on the full melody_chord dataset
with a SOURCE conditioning token, kept strictly additive: no OpenBook-path
module is modified. Songs are keyed "{source}/{song_id}" (pop909 ids are
numeric and could collide across corpora), Song.collection carries the source,
and each example's global_ids gets a trailing SOURCE id (0 = unknown, then
1..n_sources in config order) — that unknown slot is also the device's
"no genre selected" input.

Artifacts live under artifacts/combined/ (vocab, splits, checkpoints, onnx,
reports), path keys in configs/combined.json.
"""

import glob
import json
import os

import torch
import torch.nn as nn

from . import data, dataset as ds, features, model as models, vocab

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))


# ---- config / paths ---------------------------------------------------------

def load_cfg(path=None):
    p = path or os.path.join(ROOT, "configs", "combined.json")
    with open(p) as f:
        return json.load(f)


def dataset_dir(cfg):
    return os.path.normpath(os.path.join(ROOT, cfg["data"]["dataset_dir"]))


def vocab_path(cfg):
    return os.path.join(ROOT, cfg["data"]["vocab_path"])


def splits_path(cfg):
    return os.path.join(ROOT, cfg["data"]["splits_path"])


def checkpoint_dir(cfg):
    return os.path.join(ROOT, cfg["data"]["checkpoint_dir"])


# ---- data -------------------------------------------------------------------

def load_all_songs(cfg):
    """Load every included song of every configured source.

    Requires the combined vocab to be loaded first (decision extraction maps
    chord labels to class ids at load time).
    """
    dsdir = dataset_dir(cfg)
    songs = {}
    for source in cfg["data"]["sources"]:
        meta = data.load_song_meta(dsdir, cfg["data"]["songs_csv"], source)
        pat = os.path.join(dsdir, "improspira_max", "songs", f"{source}.*.json")
        for path in sorted(glob.glob(pat)):
            sid = os.path.basename(path).split(".", 1)[1].rsplit(".", 1)[0]
            if sid not in meta:
                continue
            song = data.load_song(path, meta)
            song.song_id = f"{source}/{sid}"
            song.collection = source
            songs[song.song_id] = song
    return songs


def load_splits(cfg):
    with open(splits_path(cfg)) as f:
        return json.load(f)


def load_everything(cfg=None):
    """Return (cfg, songs, CombinedSpec, splits) with the combined vocab loaded."""
    cfg = cfg or load_cfg()
    vocab.load(vocab_path(cfg))
    songs = load_all_songs(cfg)
    spec = CombinedSpec(cfg)
    splits = load_splits(cfg)
    return cfg, songs, spec, splits


# ---- features: base spec + one SOURCE global slot ---------------------------

class CombinedSpec(features.FeatureSpec):
    def __init__(self, cfg):
        super().__init__(cfg)
        self.sources = list(cfg["data"]["sources"])
        self.source_index = {s: i for i, s in enumerate(self.sources)}
        self.global_slots = features.GLOBAL_SLOTS + ["SOURCE"]
        self.n_globals = len(self.global_slots)
        self.global_card = dict(self.global_card)
        self.global_card["SOURCE"] = len(self.sources) + 1  # 0 = unknown

    def source_id(self, source):
        return self.source_index.get(source, -1) + 1

    def to_config(self):
        c = super().to_config()
        c["global_slots"] = self.global_slots
        c["sources"] = self.sources
        return c


def _tag_example(ex, spec, song):
    ex["global_ids"] = ex["global_ids"] + [spec.source_id(song.collection)]
    ex["meta"]["source"] = song.collection
    return ex


class TrainDataset(ds.TrainDataset):
    def __getitem__(self, i):
        ex = super().__getitem__(i)
        return _tag_example(ex, self.spec, self.refs[i][0])


class EvalDataset(ds.EvalDataset):
    def __getitem__(self, i):
        ex = super().__getitem__(i)
        return _tag_example(ex, self.spec, self.refs[i][0])


def collate(batch, spec):
    """ds.collate with a spec-driven global width (9 slots, not 8)."""
    B, M = len(batch), spec.max_notes
    global_ids = torch.zeros(B, spec.n_globals, dtype=torch.long)
    note_feats = {k: torch.zeros(B, M, dtype=torch.long) for k in features.NOTE_FEATS}
    note_mask = torch.zeros(B, M, dtype=torch.bool)
    target = torch.zeros(B, dtype=torch.long)
    func_target = torch.zeros(B, dtype=torch.long)
    metas = []
    for b, ex in enumerate(batch):
        global_ids[b] = torch.tensor(ex["global_ids"], dtype=torch.long)
        n = min(ex["n_notes"], M)
        for k in features.NOTE_FEATS:
            vals = ex["notes"][k][:n]
            if vals:
                note_feats[k][b, :n] = torch.tensor(vals, dtype=torch.long)
        note_mask[b, :n] = True
        target[b] = ex["target"]
        func_target[b] = ex["func_target"]
        metas.append(ex["meta"])
    return {
        "global_ids": global_ids, "note_feats": note_feats, "note_mask": note_mask,
        "target": target, "func_target": func_target, "meta": metas,
    }


def make_collate(spec):
    return lambda batch: collate(batch, spec)


# ---- model: Embedder with the extra SOURCE table ----------------------------

class CombinedEmbedder(models.Embedder):
    def __init__(self, spec, d_model):
        super().__init__(spec, d_model)
        self.global_emb.append(nn.Embedding(spec.global_card["SOURCE"], d_model))


class CombinedTransformer(models.NextChordTransformer):
    def __init__(self, spec, n_classes, cfg):
        super().__init__(spec, n_classes, cfg)
        self.embed = CombinedEmbedder(spec, cfg["model"]["d_model"])


def build_model(spec, n_classes, cfg):
    return CombinedTransformer(spec, n_classes, cfg)


# ---- inference helpers (spec-aware analogues of infer.py) --------------------

def pick_device():
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def move_batch(batch, device):
    batch["global_ids"] = batch["global_ids"].to(device)
    batch["note_feats"] = {k: v.to(device) for k, v in batch["note_feats"].items()}
    batch["note_mask"] = batch["note_mask"].to(device)
    batch["target"] = batch["target"].to(device)
    batch["func_target"] = batch["func_target"].to(device)
    return batch


def load_checkpoint(path, device=None):
    ckpt = torch.load(path, map_location="cpu", weights_only=False)
    cfg = ckpt["cfg"]
    vocab.load(vocab_path(cfg))
    spec = CombinedSpec(cfg)
    net = build_model(spec, ckpt["n_classes"], cfg)
    net.load_state_dict(ckpt["state_dict"])
    device = device or pick_device()
    net.to(device).eval()
    return {"net": net, "cfg": cfg, "spec": spec, "n_classes": ckpt["n_classes"],
            "device": device, "T": ckpt.get("calibration_T", 1.0)}


@torch.no_grad()
def logits_over(net, eval_dataset, spec, device, T=1.0, batch_size=512):
    from torch.utils.data import DataLoader
    loader = DataLoader(eval_dataset, batch_size=batch_size, shuffle=False,
                        collate_fn=make_collate(spec))
    all_logits, all_tgt, metas = [], [], []
    for batch in loader:
        b = move_batch(batch, device)
        logits, _ = net(b["global_ids"], b["note_feats"], b["note_mask"])
        all_logits.append((logits / T).cpu())
        all_tgt.append(b["target"].cpu())
        metas.extend(batch["meta"])
    return torch.cat(all_logits), torch.cat(all_tgt), metas


def logprobs_over(net, eval_dataset, spec, device, T=1.0, batch_size=512):
    import torch.nn.functional as F
    logits, tgt, metas = logits_over(net, eval_dataset, spec, device, T, batch_size)
    return F.log_softmax(logits, dim=1), tgt, metas
