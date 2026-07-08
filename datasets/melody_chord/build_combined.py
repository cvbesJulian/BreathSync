"""Combine POP909 (this folder), OpenBook and Nottingham into one dataset.

Run AFTER build_dataset.py. Reads the POP909-only tables this folder's
build_dataset.py produced, converts the other two corpora into the identical
schema, and overwrites bars.csv / phrases.csv / chord_sequences.csv /
songs.csv with the combined versions. Every row gets a `source` column
(pop909 | openbook | nottingham), and chord_sequences.csv gains `chord_t`:
the chord transposed so the song's tonic is C (major keys) or A (minor keys).

Source locations are the sibling repos/folders:
  OpenBook:   /Users/zacharyscheffler/Desktop/OpenBookDataset
  Nottingham: /Volumes/Mac-Storage/GitHub/nottingham-dataset
"""

import os
import re
import json
import numpy as np
import pandas as pd

from build_dataset import PITCH_CLASSES, CANON_ROOT, first_chord_of_bar

OUT = os.path.dirname(os.path.abspath(__file__))
OPENBOOK = "/Users/zacharyscheffler/Desktop/OpenBookDataset"
NOTTINGHAM = "/Volumes/Mac-Storage/GitHub/nottingham-dataset"

# leadsheet-style suffixes (OpenBook) and Nottingham's compact suffixes,
# collapsed to the same base-quality vocabulary as the POP909 tables
LEADSHEET_QUALITY = {
    "": "maj", "m": "min", "7": "7", "maj7": "maj7", "m7": "min7",
    "m7b5": "hdim7", "dim": "dim", "dim7": "dim7", "aug": "aug",
    "sus": "sus4", "sus4": "sus4", "sus2": "sus2", "6": "maj6",
    "m6": "min6", "9": "9", "maj9": "maj9", "m9": "min9",
}
NOTTINGHAM_QUALITY = {
    "": "maj", "m": "min", "7": "7", "m7": "min7", "m6": "min6",
    "6": "maj6", "d": "dim", "a": "aug", "a7": "aug", "7b9": "7",
    "maj7": "maj7",
}
SYM_RE = re.compile(r"^([A-G][b#]?)(.*)$")


def convert_symbol(sym, quality_map):
    """'Bbmaj7' -> ('Bb:maj7', raw) in the POP909 Root:quality convention."""
    m = SYM_RE.match(sym)
    if not m or m.group(1) not in PITCH_CLASSES:
        return None
    qual = quality_map.get(m.group(2))
    if qual is None:
        return None
    return f"{CANON_ROOT[PITCH_CLASSES[m.group(1)]]}:{qual}"


def parse_key(source, key_str):
    """Return (tonic_pc, mode) from each source's key spelling."""
    if not isinstance(key_str, str) or not key_str.strip():
        return None, None
    key_str = key_str.strip()
    if source == "pop909":                      # 'Gb:maj'
        root, mode = key_str.split(":")
        return PITCH_CLASSES.get(root), ("min" if mode == "min" else "maj")
    if source == "openbook":                    # 'Eb major'
        root, mode = key_str.split()
        return PITCH_CLASSES.get(root), ("min" if mode == "minor" else "maj")
    # nottingham: 'G' / 'Gm'
    if key_str.endswith("m"):
        return PITCH_CLASSES.get(key_str[:-1]), "min"
    return PITCH_CLASSES.get(key_str), "maj"


def transpose_offset(tonic_pc, mode):
    """Semitone shift putting the tonic at C (major) / A (minor), in -5..+6."""
    if tonic_pc is None:
        return None
    target = 0 if mode == "maj" else 9
    off = (target - tonic_pc) % 12
    return off - 12 if off > 6 else off


def transpose_chord(simple, offset):
    if offset is None or simple in (None, "", "-"):
        return ""
    root, qual = simple.split(":")
    return f"{CANON_ROOT[(PITCH_CLASSES[root] + offset) % 12]}:{qual}"


def fmt(x):
    return f"{round(float(x), 4):g}"


def carry_fill(bars):
    """Ensure every bar after the first chord has a token at beat 0
    (the chord still sounding), matching the POP909 bar convention."""
    current = None
    for b in bars:
        ch = b["chords"]  # list of (onset, simple, raw)
        if current is not None and (not ch or ch[0][0] > 0):
            ch.insert(0, (0.0, current[0], current[1]))
        if ch:
            current = (ch[-1][1], ch[-1][2])


def chords_str(ch, raw=False):
    if not ch:
        return "-"
    i = 2 if raw else 1
    return " ".join(f"{t[i]}@{fmt(t[0])}" for t in ch)


# ---------------------------------------------------------------- loaders

def load_pop909():
    bars_df = pd.read_csv(os.path.join(OUT, "bars.csv"), dtype={"song_id": str})
    songs_df = pd.read_csv(os.path.join(OUT, "songs.csv"), dtype={"song_id": str})
    if "source" in bars_df.columns:
        raise SystemExit("bars.csv already combined — re-run build_dataset.py "
                         "first to regenerate the POP909-only tables.")
    keys = dict(zip(songs_df.song_id, songs_df.key))
    songs = []
    for sid, g in bars_df.groupby("song_id"):
        bars = []
        for _, r in g.sort_values("bar").iterrows():
            ch = []
            if r.chords != "-":
                for tok, rtok in zip(r.chords.split(), r.chords_raw.split()):
                    lab, on = tok.rsplit("@", 1)
                    ch.append((float(on), lab, rtok.rsplit("@", 1)[0]))
            bars.append({"bar": int(r.bar), "beats_per_bar": int(r.beats_per_bar),
                         "midi": r.midi, "chords": ch})
        tonic, mode = parse_key("pop909", keys.get(sid, ""))
        songs.append({"source": "pop909", "song_id": sid, "key": keys.get(sid, ""),
                      "mode": mode, "offset": transpose_offset(tonic, mode),
                      "bars": bars})
    return songs, songs_df


def load_openbook():
    df = pd.read_csv(os.path.join(OPENBOOK, "openbook_dataset.csv"))
    df = df[(df.is_default == True) & (df.duration_match == True)]
    songs = []
    for _, row in df.iterrows():
        sid = row.file.replace(".ly.mako", "")
        num, den = (int(x) for x in row.time_signature.split("/"))
        bpb = int(num * 4 / den)  # quarter-note beats per bar
        n_bars = int(row.num_bars) + (1 if row.pickup_quarters > 0 else 0)
        bars = [{"bar": b, "beats_per_bar": bpb, "midi_ev": [], "chords": []}
                for b in range(n_bars)]
        for bar, beat, pitch, dur in json.loads(row.MIDI):
            if bar < n_bars:
                bars[bar]["midi_ev"].append((float(beat), int(pitch), float(dur)))
        skipped = 0
        for bar, beat, sym, dur in json.loads(row.Chords_simple):
            simple = convert_symbol(sym, LEADSHEET_QUALITY)
            if simple is None:
                skipped += 1
                continue
            if bar < n_bars:
                bars[bar]["chords"].append((float(beat), simple, sym))
        for b in bars:
            b["midi"] = " ".join(f"{p}_{fmt(on)}_{fmt(d)}"
                                 for on, p, d in sorted(b.pop("midi_ev"))) or "-"
            b["chords"].sort(key=lambda t: t[0])
        carry_fill(bars)
        tonic, mode = parse_key("openbook", row.key)
        songs.append({"source": "openbook", "song_id": sid, "key": row.key,
                      "mode": mode, "offset": transpose_offset(tonic, mode),
                      "bars": bars, "skipped_chords": skipped})
    return songs


def load_nottingham():
    bars_df = pd.read_csv(os.path.join(NOTTINGHAM, "dataset", "bars.csv"))
    tunes = pd.read_csv(os.path.join(NOTTINGHAM, "dataset", "tunes.csv"))
    keys = dict(zip(tunes.tune_id, tunes.key))
    songs = []
    for tid, g in bars_df.groupby("tune_id"):
        bars = []
        skipped = 0
        for _, r in g.sort_values("bar").iterrows():
            midi = "-"
            if isinstance(r.midi, str) and r.midi.strip():
                midi = " ".join(t.replace("@", "_").replace(":", "_")
                                for t in r.midi.split())
            ch = []
            if isinstance(r.chords, str) and r.chords.strip():
                for tok in r.chords.split():
                    sym, on = tok.rsplit("@", 1)
                    simple = convert_symbol(sym, NOTTINGHAM_QUALITY)
                    if simple is None:
                        skipped += 1
                        continue
                    ch.append((float(on), simple, sym))
            bars.append({"bar": int(r.bar),
                         "beats_per_bar": int(r.meter.split("/")[0]),
                         "midi": midi, "chords": ch})
        carry_fill(bars)
        tonic, mode = parse_key("nottingham", keys.get(tid, ""))
        songs.append({"source": "nottingham", "song_id": tid,
                      "key": keys.get(tid, ""), "mode": mode,
                      "offset": transpose_offset(tonic, mode),
                      "bars": bars, "skipped_chords": skipped})
    return songs


# ---------------------------------------------------------------- emitters

def emit_bars(songs):
    rows = []
    for s in songs:
        for b in s["bars"]:
            rows.append({"source": s["source"], "song_id": s["song_id"],
                         "bar": b["bar"], "beats_per_bar": b["beats_per_bar"],
                         "midi": b["midi"], "chords": chords_str(b["chords"]),
                         "chords_raw": chords_str(b["chords"], raw=True)})
    return pd.DataFrame(rows)


def emit_phrases(songs):
    rows = []
    for s in songs:
        bars = s["bars"]
        for t in range(1, len(bars)):
            if not bars[t]["chords"]:
                continue
            target = bars[t]["chords"][0][1]
            ctx = bars[max(0, t - 8):t]
            if all(b["midi"] == "-" for b in ctx):
                continue
            rows.append({
                "source": s["source"], "song_id": s["song_id"],
                "start_bar": ctx[0]["bar"], "end_bar": t - 1, "n_bars": len(ctx),
                "midi": " | ".join(b["midi"] for b in ctx),
                "chords": " | ".join(chords_str(b["chords"]) for b in ctx),
                "next_chord": target,
                "next_chord_t": transpose_chord(target, s["offset"]),
            })
    return pd.DataFrame(rows)


def emit_sequences(songs, pop909_seq_df):
    """Merged chord-event sequences. POP909 rows are reused from the exact
    per-segment table build_dataset.py produced; the other sources are walked
    from their (carry-filled) bars, a chord lasting until the next change."""
    rows = []
    for s in songs:
        if s["source"] == "pop909":
            continue
        events = []  # (abs_beat, bar, beat_in_bar, simple, raw)
        pos = 0.0
        for b in s["bars"]:
            for on, simple, raw in b["chords"]:
                events.append((pos + on, b["bar"], on, simple, raw))
            pos += b["beats_per_bar"]
        total = pos
        merged = []
        for ev in events:
            if merged and merged[-1][3] == ev[3]:
                continue
            merged.append(ev)
        for i, (ab, bar, bib, simple, raw) in enumerate(merged):
            end = merged[i + 1][0] if i + 1 < len(merged) else total
            rows.append({"source": s["source"], "song_id": s["song_id"],
                         "idx": i, "chord": simple, "chord_raw": raw,
                         "bar": bar, "beat_in_bar": round(bib, 2),
                         "duration_beats": round(end - ab, 2),
                         "chord_t": transpose_chord(simple, s["offset"])})
    df = pd.DataFrame(rows)
    pop = pop909_seq_df.copy()
    pop.insert(0, "source", "pop909")
    return pd.concat([pop, df], ignore_index=True)[
        ["source", "song_id", "idx", "chord", "chord_raw", "bar",
         "beat_in_bar", "duration_beats", "chord_t"]]


def emit_songs(songs, pop909_songs_df):
    pop = pop909_songs_df.copy()
    pop.insert(0, "source", "pop909")
    off = {s["song_id"]: s for s in songs if s["source"] == "pop909"}
    pop["mode"] = pop.song_id.map(lambda x: off[x]["mode"] if x in off else "")
    pop["transpose_offset"] = pop.song_id.map(
        lambda x: off[x]["offset"] if x in off else np.nan)
    rows = []
    for s in songs:
        if s["source"] == "pop909":
            continue
        n_notes = sum(len(b["midi"].split()) for b in s["bars"] if b["midi"] != "-")
        rows.append({
            "source": s["source"], "song_id": s["song_id"],
            "n_bars": len(s["bars"]),
            "beats_per_bar": int(pd.Series(
                [b["beats_per_bar"] for b in s["bars"]]).mode()[0]),
            "bpm": np.nan, "key": s["key"], "mode": s["mode"],
            "transpose_offset": s["offset"], "n_melody_notes": n_notes,
            "chord_consonance": np.nan, "melody_chord_coverage": np.nan,
            "irregular_bars": np.nan,
            "unparsed_chords": s.get("skipped_chords", 0),
            "included": True, "reason": "",
        })
    df = pd.concat([pop, pd.DataFrame(rows)], ignore_index=True)
    cols = ["source", "song_id", "n_bars", "beats_per_bar", "bpm", "key",
            "mode", "transpose_offset", "n_melody_notes", "chord_consonance",
            "melody_chord_coverage", "irregular_bars", "unparsed_chords",
            "included", "reason"]
    return df[cols]


def main():
    pop_songs, pop_songs_df = load_pop909()
    pop_seq = pd.read_csv(os.path.join(OUT, "chord_sequences.csv"),
                          dtype={"song_id": str})
    off = {s["song_id"]: s["offset"] for s in pop_songs}
    pop_seq["chord_t"] = [transpose_chord(c, off.get(sid))
                          for c, sid in zip(pop_seq.chord, pop_seq.song_id)]

    ob_songs = load_openbook()
    nt_songs = load_nottingham()
    songs = pop_songs + ob_songs + nt_songs
    print(f"songs: pop909={len(pop_songs)} openbook={len(ob_songs)} "
          f"nottingham={len(nt_songs)}")

    bars = emit_bars(songs)
    phrases = emit_phrases(songs)
    seqs = emit_sequences(songs, pop_seq)
    songs_df = emit_songs(songs, pop_songs_df)

    bars.to_csv(os.path.join(OUT, "bars.csv"), index=False)
    phrases.to_csv(os.path.join(OUT, "phrases.csv"), index=False)
    seqs.to_csv(os.path.join(OUT, "chord_sequences.csv"), index=False)
    songs_df.to_csv(os.path.join(OUT, "songs.csv"), index=False)

    stats = {
        "songs": {k: int(v) for k, v in
                  songs_df[songs_df.included == True].source.value_counts().items()},
        "bars": {k: int(v) for k, v in bars.source.value_counts().items()},
        "phrases": {k: int(v) for k, v in phrases.source.value_counts().items()},
        "chord_events": {k: int(v) for k, v in seqs.source.value_counts().items()},
        "chord_vocab": int(seqs.chord.nunique()),
        "chord_vocab_transposed": int(seqs[seqs.chord_t != ""].chord_t.nunique()),
        "skipped_unparseable_chords": int(sum(s.get("skipped_chords", 0)
                                              for s in songs)),
    }
    with open(os.path.join(OUT, "build_stats_combined.json"), "w") as f:
        json.dump(stats, f, indent=2)
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
