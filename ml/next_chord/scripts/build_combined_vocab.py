"""Freeze the combined (root, quality-family) vocabulary from the TRAIN split.

Same procedure as build_vocab.py but over all three corpora, with a
per-corpus coverage report — pop909 dominates the counts, so the gate that
matters is that each corpus individually keeps >=95% of its chord events in
kept classes (jazz HDIM/DOM classes must survive the pop flood).

Writes artifacts/combined/vocab.json.
"""
import glob
import json
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

from nextchord import combined, vocab  # noqa: E402


def main():
    cfg = combined.load_cfg()
    dsdir = combined.dataset_dir(cfg)
    min_count = cfg["vocab"]["min_count"]
    splits = json.load(open(combined.splits_path(cfg)))
    train = set(splits["train"])

    counts = Counter()               # (root, family) -> total
    per_source = {}                  # source -> Counter
    unparsed = Counter()
    for source in cfg["data"]["sources"]:
        sc = per_source.setdefault(source, Counter())
        pat = os.path.join(dsdir, "improspira_max", "songs", f"{source}.*.json")
        for path in sorted(glob.glob(pat)):
            sid = os.path.basename(path).split(".", 1)[1].rsplit(".", 1)[0]
            if f"{source}/{sid}" not in train:
                continue
            d = json.load(open(path))
            for bar in d["bars"]:
                for c in bar["chords"]:
                    k = vocab.class_key(c["t"])
                    if k is None:
                        unparsed[c["t"]] += 1
                    else:
                        counts[k] += 1
                        sc[k] += 1

    total = sum(counts.values()) + sum(unparsed.values())
    kept = [(k, c) for k, c in counts.most_common() if c >= min_count]
    kept_keys = {k for k, _ in kept}
    kept_cov = sum(c for _, c in kept) / total

    classes = [{"root": r, "family": f, "count": c} for (r, f), c in kept]
    out = {
        "min_count": min_count,
        "sources": cfg["data"]["sources"],
        "families": vocab.FAMILIES,
        "n_classes_total": len(classes) + 2,  # + HOLD + OTHER
        "coverage": round(kept_cov, 4),
        "classes": classes,
    }
    path = combined.vocab_path(cfg)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(out, open(path, "w"), indent=1)

    print(f"train songs: {len(train)}  chord events: {total}")
    print(f"kept classes (count>={min_count}): {len(classes)}  "
          f"+ HOLD + OTHER = {len(classes)+2}")
    print(f"overall coverage: {kept_cov:.4f}")
    for source, sc in per_source.items():
        stot = sum(sc.values())
        scov = sum(c for k, c in sc.items() if k in kept_keys) / max(1, stot)
        print(f"  {source:11s} events {stot:7d}  coverage {scov:.4f}")
        assert scov >= 0.95, f"{source} coverage {scov:.4f} below 0.95"
    if unparsed:
        print("unparsed qualities:", dict(unparsed.most_common(10)))
    print("\nid  root family  count")
    for i, ((r, f), c) in enumerate(kept):
        print(f"{i+1:2d}  {vocab.PC_NAME[r]:3s} {f:5s}  {c:6d}")
    print("wrote", path)
    assert kept_cov >= 0.97, f"coverage {kept_cov:.4f} below 0.97 — lower min_count"


if __name__ == "__main__":
    main()
