"""Song-level splits for the combined corpus, stratified by (source, mode).

OpenBook songs KEEP their existing assignment from artifacts/splits.json
(prefixed with "openbook/") so the combined model is tested on the exact same
15 held-out jazz songs as the OpenBook-only model — the report's key
comparison. pop909/nottingham are split fresh with the config seed.

Writes artifacts/combined/splits.json (committed).
"""
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

from nextchord import combined, data  # noqa: E402


def main():
    cfg = combined.load_cfg()
    dsdir = combined.dataset_dir(cfg)
    ratios = cfg["splits"]["ratios"]
    seed = cfg["splits"]["seed"]
    rng = random.Random(seed)

    split = {"train": [], "val": [], "test": []}

    # openbook: reuse the frozen OpenBook splits verbatim
    ob = json.load(open(os.path.join(ROOT, "artifacts", "splits.json")))
    for part in split:
        split[part] += [f"openbook/{sid}" for sid in ob[part]]
    print(f"openbook (reused): train {len(ob['train'])} val {len(ob['val'])} "
          f"test {len(ob['test'])}")

    for source in cfg["data"]["sources"]:
        if source == "openbook":
            continue
        meta = data.load_song_meta(dsdir, cfg["data"]["songs_csv"], source)
        by_mode = {}
        for sid, m in meta.items():
            by_mode.setdefault(m["mode"], []).append(f"{source}/{sid}")
        for mode, ids in sorted(by_mode.items()):
            ids = sorted(ids)
            rng.shuffle(ids)
            n = len(ids)
            n_val = max(1, round(n * ratios[1]))
            n_test = max(1, round(n * ratios[2]))
            split["val"] += ids[:n_val]
            split["test"] += ids[n_val:n_val + n_test]
            split["train"] += ids[n_val + n_test:]
            print(f"{source} {mode}: total {n} -> train {n - n_val - n_test} "
                  f"val {n_val} test {n_test}")

    for k in split:
        split[k] = sorted(split[k])
    out = combined.splits_path(cfg)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump({"seed": seed, "ratios": ratios, **split}, open(out, "w"), indent=1)
    print(f"\ntotal: train {len(split['train'])} val {len(split['val'])} "
          f"test {len(split['test'])}")
    print("wrote", out)


if __name__ == "__main__":
    main()
