"""Song-level train/val/test splits, stratified by mode (maj/min).

OpenBook has no sub-collections, and minor tunes are scarce (19/152), so mode
is the stratification axis. Writes artifacts/splits.json (committed).
"""
import csv
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

from nextchord import data  # noqa: E402


def main():
    cfg = json.load(open(os.path.join(ROOT, "configs", "default.json")))
    dsdir = os.path.normpath(os.path.join(ROOT, cfg["data"]["dataset_dir"]))
    ratios = cfg["splits"]["ratios"]
    seed = cfg["splits"]["seed"]

    meta = data.load_song_meta(dsdir, cfg["data"]["songs_csv"], cfg["data"]["source"])
    by_mode = {}
    for sid, m in meta.items():
        by_mode.setdefault(m["mode"], []).append(sid)

    rng = random.Random(seed)
    split = {"train": [], "val": [], "test": []}
    for mode, ids in sorted(by_mode.items()):
        ids = sorted(ids)
        rng.shuffle(ids)
        n = len(ids)
        n_val = max(1, round(n * ratios[1]))
        n_test = max(1, round(n * ratios[2]))
        n_val = min(n_val, n - 2) if n >= 3 else n_val
        val = ids[:n_val]
        test = ids[n_val:n_val + n_test]
        train = ids[n_val + n_test:]
        split["train"] += train
        split["val"] += val
        split["test"] += test
        print(f"mode {mode:3s}: total {n:3d} -> train {len(train)} val {len(val)} test {len(test)}")

    for k in split:
        split[k] = sorted(split[k])
    out = os.path.join(ROOT, "artifacts", "splits.json")
    json.dump({"seed": seed, "ratios": ratios, **split}, open(out, "w"), indent=1)
    print(f"\ntotal: train {len(split['train'])} val {len(split['val'])} test {len(split['test'])}")
    print("wrote", out)


if __name__ == "__main__":
    main()
