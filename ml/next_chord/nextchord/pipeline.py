"""Shared setup helpers used by train / evaluate / export / demo."""

import json
import os

import numpy as np
import torch

from . import vocab, data, features

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))


def load_cfg(path=None):
    return json.load(open(path or os.path.join(ROOT, "configs", "default.json")))


def dataset_dir(cfg):
    return os.path.normpath(os.path.join(ROOT, cfg["data"]["dataset_dir"]))


def load_splits():
    return json.load(open(os.path.join(ROOT, "artifacts", "splits.json")))


def load_everything(cfg=None):
    """Return (cfg, songs dict, FeatureSpec, splits). Ensures vocab is loaded."""
    cfg = cfg or load_cfg()
    vocab.load()
    songs = data.load_all_songs(dataset_dir(cfg), cfg["data"]["songs_glob"],
                                cfg["data"]["songs_csv"], cfg["data"]["source"])
    spec = features.FeatureSpec(cfg)
    splits = load_splits()
    return cfg, songs, spec, splits


def pick_device():
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def class_weights(songs, train_ids, cfg, n_classes):
    """Inverse-sqrt-frequency class weights over training targets, clamped."""
    counts = np.zeros(n_classes)
    for sid in train_ids:
        s = songs.get(sid)
        if s is None:
            continue
        for dp in s.decisions:
            counts[dp.target] += 1
    counts = np.maximum(counts, 1.0)
    w = 1.0 / np.sqrt(counts)
    w = w / w.mean()
    lo, hi = cfg["train"]["class_weight_clamp"]
    return np.clip(w, lo, hi).astype(np.float32)


def move_batch(batch, device):
    batch["global_ids"] = batch["global_ids"].to(device)
    batch["note_feats"] = {k: v.to(device) for k, v in batch["note_feats"].items()}
    batch["note_mask"] = batch["note_mask"].to(device)
    batch["target"] = batch["target"].to(device)
    batch["func_target"] = batch["func_target"].to(device)
    return batch
