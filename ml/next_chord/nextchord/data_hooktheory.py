"""Load the Hooktheory / SheetSage melody+chord dataset (CSV) into the same
``Song`` structures the OpenBook loader (``data.py``) produces, so the exact
same melody-conditioned next-chord pipeline trains on it unchanged.

Bridging notes (kept faithful to ``data.py`` conventions):
- Source rows live in ``datasets/hooktheory/bars.csv`` (one row per bar) with
  melody as ``pitch_onset_duration`` tokens and chords as ``Root:quality@onset``
  tokens, both in beat units relative to the bar. See that dataset's README.
- Transposition matches OpenBook's shared space: **major tonic -> C (pc 0),
  minor tonic -> A (pc 9)** (``vocab.TONIC_PC``). The dataset's own
  ``transpose_offset`` sends every tonic to C; we recompute a per-song offset so
  minor songs land on A, then apply ``pitch + offset`` to the (untransposed)
  melody pitches and shift chord roots by the same offset before labelling.
- Hooktheory's finer scale modes are collapsed to maj/min by third quality
  (the only distinction the model + vocab understand).
- Decision-point extraction is delegated to ``data._extract_decisions`` so the
  beat-grid / HOLD-restate semantics are byte-for-byte identical to OpenBook.
"""

import csv
import os
from collections import OrderedDict

from . import vocab
from .data import Note, Song, _extract_decisions

csv.field_size_limit(10 ** 7)

# names vocab.ROOT_PC recognises (used to re-emit transposed chord labels)
_PC_NAME = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]

# collapse Hooktheory scale modes -> maj/min (major-third vs minor-third)
_MAJ_MODES = {"maj", "lydian", "mixolydian", "other"}
_MIN_MODES = {"min", "dorian", "phrygian", "locrian", "harmonicMinor", "aeolian"}


def _collapse_mode(mode):
    return "maj" if mode in _MAJ_MODES else "min"


def _song_offset(key, mode):
    """Per-song transpose so the tonic lands on C (maj) / A (min)."""
    root = key.split(":", 1)[0]
    tonic = vocab.ROOT_PC.get(root)
    if tonic is None:
        return None
    return (vocab.TONIC_PC[mode] - tonic) % 12


def _parse_melody(tok_field, bar_start, bpb, bar_idx, offset):
    """`'70_0_2 71_2_2'` -> list[Note] (transposed, absolute onset)."""
    notes = []
    if not tok_field or tok_field == "-":
        return notes
    for tok in tok_field.split():
        p, on, dur = tok.split("_")
        onset = float(on)
        notes.append(Note(
            pitch=int(p) + offset,
            onset=bar_start + onset,
            dur=float(dur),
            bar_idx=bar_idx,
            onset_in_bar=onset,
            beats_per_bar=bpb,
        ))
    return notes


def _parse_chords(tok_field, offset):
    """`'Eb:min@0 Ab:min@2'` -> list[{onset, t}] with transposed root labels.

    Carried-over chords are emitted at ``@0`` by the dataset; we keep them so
    every bar downbeat is a chord event, exactly like OpenBook's beat grid
    (first sounding = change, repeats = HOLD restates in ``_extract_decisions``).
    """
    out = []
    if not tok_field or tok_field == "-":
        return out
    for tok in tok_field.split():
        label, _, onset = tok.partition("@")
        root, _, quality = label.partition(":")
        pc = vocab.ROOT_PC.get(root)
        if pc is None:
            continue
        t_root = _PC_NAME[(pc + offset) % 12]
        out.append({"onset": float(onset or 0.0), "t": f"{t_root}:{quality}"})
    return out


def load_song_meta(dataset_dir, songs_csv="songs.csv"):
    meta = {}
    with open(os.path.join(dataset_dir, songs_csv), newline="") as f:
        for row in csv.DictReader(f):
            if row.get("included") != "True":
                continue
            mode = _collapse_mode(row["mode"])
            offset = _song_offset(row["key"], mode)
            if offset is None:
                continue
            meta[row["song_id"]] = {
                "mode": mode,
                "key": row["key"],
                "transpose_offset": offset,
                "beats_per_bar": float(row["beats_per_bar"]),
                "n_bars": int(row["n_bars"]),
                "split": row.get("split", ""),
            }
    return meta


def _read_bars(dataset_dir, bars_csv, keep_ids):
    """song_id -> ordered list of bar rows (only songs in keep_ids)."""
    by_song = OrderedDict()
    with open(os.path.join(dataset_dir, bars_csv), newline="") as f:
        for row in csv.DictReader(f):
            sid = row["song_id"]
            if sid not in keep_ids:
                continue
            by_song.setdefault(sid, []).append(row)
    return by_song


def load_all_songs(dataset_dir, songs_glob=None, songs_csv="songs.csv",
                   source="hooktheory", bars_csv="bars.csv"):
    """Return {song_id: Song}. Signature mirrors ``data.load_all_songs`` so
    ``pipeline`` can dispatch on ``cfg['data']['source']``. ``songs_glob`` is
    unused (kept for call-site compatibility)."""
    meta = load_song_meta(dataset_dir, songs_csv)
    bars_by_song = _read_bars(dataset_dir, bars_csv, set(meta))

    songs = {}
    for sid, rows in bars_by_song.items():
        m = meta[sid]
        offset = m["transpose_offset"]
        rows.sort(key=lambda r: int(r["bar"]))
        song = Song(
            song_id=sid, mode=m["mode"], key=m["key"],
            transpose_offset=offset, collection=m["mode"],
            beats_per_bar=m["beats_per_bar"], n_bars=len(rows),
        )
        bars = []
        t = 0.0
        for i, r in enumerate(rows):
            bpb = float(r["beats_per_bar"])
            song.bar_starts.append(t)
            song.bar_beats.append(bpb)
            song.notes.extend(_parse_melody(r["midi"], t, bpb, i, offset))
            bars.append({"chords": _parse_chords(r["chords"], offset)})
            t += bpb
        song_end = t
        song.notes.sort(key=lambda n: n.onset)
        _extract_decisions(song, bars, song_end)
        songs[sid] = song
    return songs
