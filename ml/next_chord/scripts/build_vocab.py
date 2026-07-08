"""Freeze the (root, quality-family) chord vocabulary from the TRAIN split.

Counts class keys over training-song chord events, keeps those with count >=
min_count, orders by frequency, and writes artifacts/vocab.json. Reports
coverage and the OTHER-bucket rate so the threshold can be tuned.
"""
import glob
import json
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

from nextchord import vocab  # noqa: E402


def main():
    cfg = json.load(open(os.path.join(ROOT, "configs", "default.json")))
    dsdir = os.path.normpath(os.path.join(ROOT, cfg["data"]["dataset_dir"]))
    min_count = cfg["vocab"]["min_count"]
    splits = json.load(open(os.path.join(ROOT, "artifacts", "splits.json")))
    train = set(splits["train"])

    counts = Counter()
    unparsed = Counter()
    glob_pat = os.path.join(dsdir, cfg["data"]["songs_glob"])
    for path in sorted(glob.glob(glob_pat)):
        sid = os.path.basename(path).split(".", 1)[1].rsplit(".", 1)[0]
        if sid not in train:
            continue
        d = json.load(open(path))
        for bar in d["bars"]:
            for c in bar["chords"]:
                k = vocab.class_key(c["t"])
                if k is None:
                    unparsed[c["t"]] += 1
                else:
                    counts[k] += 1

    total = sum(counts.values()) + sum(unparsed.values())
    kept = [(k, c) for k, c in counts.most_common() if c >= min_count]
    kept_cov = sum(c for _, c in kept) / total

    classes = [{"root": r, "family": f, "count": c} for (r, f), c in kept]
    out = {
        "min_count": min_count,
        "families": vocab.FAMILIES,
        "n_classes_total": len(classes) + 2,  # + HOLD + OTHER
        "coverage": round(kept_cov, 4),
        "classes": classes,
    }
    path = os.path.join(ROOT, "artifacts", "vocab.json")
    json.dump(out, open(path, "w"), indent=1)

    print(f"train songs: {len(train)}  chord events: {total}")
    print(f"kept classes (count>={min_count}): {len(classes)}  "
          f"+ HOLD + OTHER = {len(classes)+2}")
    print(f"coverage of kept classes: {kept_cov:.4f}  "
          f"OTHER rate: {1-kept_cov:.4f}")
    if unparsed:
        print("unparsed qualities:", dict(unparsed.most_common(10)))
    print("\nid  root family  count")
    for i, ((r, f), c) in enumerate(kept):
        print(f"{i+1:2d}  {vocab.PC_NAME[r]:3s} {f:5s}  {c:5d}")
    print("wrote", path)
    assert kept_cov >= 0.95, f"coverage {kept_cov:.4f} below 0.95 — lower min_count"


if __name__ == "__main__":
    main()
