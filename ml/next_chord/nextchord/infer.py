"""Load a checkpoint and run inference over decision points.

Central place that turns (song, decision) refs into calibrated model log-probs
plus everything the reranker needs (prev class/func, sounding class, melody
context). Reused by evaluate.py, calibrate.py, and demo.py.
"""

import torch
import torch.nn.functional as F

from . import pipeline, features, model as models, dataset as ds, vocab, windows


def load_checkpoint(path, device=None):
    ckpt = torch.load(path, map_location="cpu", weights_only=False)
    cfg = ckpt["cfg"]
    vocab.load(pipeline.vocab_path(cfg))
    spec = features.FeatureSpec(cfg)
    n_classes = ckpt["n_classes"]
    net = models.build_model(ckpt["model"], spec, n_classes, cfg)
    net.load_state_dict(ckpt["state_dict"])
    device = device or pipeline.pick_device()
    net.to(device).eval()
    return {"net": net, "cfg": cfg, "spec": spec, "n_classes": n_classes,
            "device": device, "T": ckpt.get("calibration_T", 1.0), "model": ckpt["model"]}


@torch.no_grad()
def logits_over(net, refs_dataset, spec, device, T=1.0, batch_size=256):
    """Return (logits [N,C] tensor on cpu, targets, metas) for an EvalDataset."""
    from torch.utils.data import DataLoader
    loader = DataLoader(refs_dataset, batch_size=batch_size, shuffle=False,
                        collate_fn=ds.make_collate(spec))
    all_logits, all_tgt, metas = [], [], []
    for batch in loader:
        b = pipeline.move_batch(batch, device)
        logits, _ = net(b["global_ids"], b["note_feats"], b["note_mask"])
        all_logits.append((logits / T).cpu())
        all_tgt.append(b["target"].cpu())
        metas.extend(batch["meta"])
    return torch.cat(all_logits), torch.cat(all_tgt), metas


def logprobs_over(net, refs_dataset, spec, device, T=1.0):
    logits, tgt, metas = logits_over(net, refs_dataset, spec, device, T)
    return F.log_softmax(logits, dim=1), tgt, metas


def rerank_context(song, dp):
    """Everything the reranker needs for a single decision point."""
    hb = 0.5 * song.beats_per_bar
    return {
        "prev_class": dp.prev_class,
        "sounding_class": dp.sounding_class,
        "mode": song.mode,
        "window_pcs": windows.window_pcs(song, dp.t, hb),
        "strong_pcs": windows.strong_pcs(song, dp.t, song.beats_per_bar),
    }
