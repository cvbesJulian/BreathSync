"""Torch Dataset + collate for next-chord examples."""

import random

import torch
from torch.utils.data import Dataset

from . import features, windows, vocab


class TrainDataset(Dataset):
    """Resampled each epoch: all changes/restates + balanced HOLD pool, with
    random window length per item and augmentation. Minor tunes oversampled."""

    def __init__(self, songs, split_ids, spec, cfg, base_seed=0):
        self.spec = spec
        self.cfg = cfg
        self.aug = cfg["augment"]
        self.weights = cfg["windows"]["length_weights"]
        self.frac = cfg["windows"]["hold_target_frac"]
        self.base_seed = base_seed

        fixed, hold_pool = windows.split_decisions(songs, split_ids)
        # oversample minor-mode decisions
        k = cfg["augment"]["minor_oversample"]
        if k > 1:
            fixed = fixed + [r for r in fixed if r[0].mode == "min"] * (k - 1)
            hold_pool = hold_pool + [r for r in hold_pool if r[0].mode == "min"] * (k - 1)
        self.fixed, self.hold_pool = fixed, hold_pool
        self.resample(0)

    def resample(self, epoch):
        rng = random.Random(self.base_seed + epoch)
        self.refs, self.stats = windows.epoch_example_refs(
            self.fixed, self.hold_pool, self.frac, rng)
        self._rng = random.Random(self.base_seed * 7919 + epoch + 1)

    def __len__(self):
        return len(self.refs)

    def __getitem__(self, i):
        song, dp = self.refs[i]
        wlen = windows.sample_window_bars(self._rng, self.spec, self.weights)
        return windows.build_example(song, dp, self.spec, wlen, self._rng, self.aug)


class EvalDataset(Dataset):
    """Deterministic: one example per decision point at a fixed window length,
    no augmentation. Optionally masks melody notes (ablation)."""

    def __init__(self, songs, split_ids, spec, cfg, fixed_wlen=2.0,
                 mask_notes=False, include_holds=True):
        self.spec = spec
        self.fixed_wlen = fixed_wlen
        self.mask_notes = mask_notes
        fixed, hold_pool = windows.split_decisions(songs, split_ids)
        refs = list(fixed) + (list(hold_pool) if include_holds else [])
        refs.sort(key=lambda r: (r[0].song_id, r[1].t, r[1].is_hold_candidate))
        self.refs = refs

    def __len__(self):
        return len(self.refs)

    def __getitem__(self, i):
        song, dp = self.refs[i]
        return windows.build_example(song, dp, self.spec, self.fixed_wlen,
                                     mask_notes=self.mask_notes)


def collate(batch, spec):
    B = len(batch)
    M = spec.max_notes
    global_ids = torch.zeros(B, features.N_GLOBALS, dtype=torch.long)
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
