"""Write artifacts/hooktheory/splits.json from the SheetSage split column.

Uses Hooktheory's own TRAIN/VALID/TEST assignment (carried in songs.csv) so
our splits match the upstream benchmark. Only included songs that actually
produce >=1 decision point are kept.
"""
import csv
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

from nextchord import data_hooktheory as dh  # noqa: E402

csv.field_size_limit(10 ** 7)
_MAP = {"TRAIN": "train", "VALID": "val", "TEST": "test"}


def main():
    cfg = json.load(open(os.path.join(ROOT, "configs", "hooktheory.json")))
    dsdir = os.path.normpath(os.path.join(ROOT, cfg["data"]["dataset_dir"]))
    songs = dh.load_all_songs(dsdir, songs_csv=cfg["data"]["songs_csv"],
                              bars_csv=cfg["data"]["bars_csv"])
    has_decisions = {sid for sid, s in songs.items() if s.decisions}

    splits = {"train": [], "val": [], "test": []}
    with open(os.path.join(dsdir, cfg["data"]["songs_csv"]), newline="") as f:
        for row in csv.DictReader(f):
            if row.get("included") != "True":
                continue
            sid = row["song_id"]
            key = _MAP.get(row.get("split", ""))
            if key and sid in has_decisions:
                splits[key].append(sid)

    splits["source"] = "hooktheory-sheetsage"
    out = os.path.join(ROOT, cfg["data"]["splits_path"])
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump(splits, open(out, "w"), indent=1)
    print("songs with >=1 decision:", len(has_decisions))
    print("splits:", {k: len(v) for k, v in splits.items() if isinstance(v, list)})
    print("wrote", out)


if __name__ == "__main__":
    main()
