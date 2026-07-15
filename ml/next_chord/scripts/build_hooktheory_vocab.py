"""Freeze the (root, quality-family) chord vocabulary from the Hooktheory TRAIN
split and write artifacts/hooktheory/vocab.json.

Same family collapse and format as scripts/build_vocab.py (OpenBook), but it
counts over transposed chord *events* reconstructed by the Hooktheory loader,
so the vocab reflects this dataset's own distribution rather than jazz.
"""
import json
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

from nextchord import vocab, data_hooktheory as dh  # noqa: E402


def main():
    cfg = json.load(open(os.path.join(ROOT, "configs", "hooktheory.json")))
    dsdir = os.path.normpath(os.path.join(ROOT, cfg["data"]["dataset_dir"]))
    min_count = cfg["vocab"]["min_count"]
    splits = json.load(open(os.path.join(ROOT, cfg["data"]["splits_path"])))
    train = set(splits["train"])

    songs = dh.load_all_songs(dsdir, songs_csv=cfg["data"]["songs_csv"],
                              bars_csv=cfg["data"]["bars_csv"])

    counts, unparsed = Counter(), Counter()
    for sid in train:
        s = songs.get(sid)
        if s is None:
            continue
        for dp in s.decisions:
            if dp.target_label == "":
                continue
            k = vocab.class_key(dp.target_label)
            if k is None:
                unparsed[dp.target_label] += 1
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
    path = os.path.join(ROOT, cfg["data"]["vocab_path"])
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(out, open(path, "w"), indent=1)

    print(f"train songs: {len(train)}  chord events: {total}")
    print(f"kept classes (count>={min_count}): {len(classes)} + HOLD + OTHER "
          f"= {len(classes)+2}")
    print(f"coverage: {kept_cov:.4f}  OTHER rate: {1-kept_cov:.4f}")
    if unparsed:
        print("unparsed qualities:", dict(unparsed.most_common(10)))
    print("wrote", path)
    assert kept_cov >= 0.95, f"coverage {kept_cov:.4f} below 0.95 — lower min_count"


if __name__ == "__main__":
    main()
