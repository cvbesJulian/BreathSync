#!/usr/bin/env python3
"""
Build a melody -> chord dataset from the Hooktheory data released with
SheetSage (https://github.com/chrisdonahue/sheetsage).

Input (the "clean" release, not Hooktheory_Raw):
  Hooktheory.json.gz           26k human-annotated lead sheets (beat domain)
  Hooktheory_Test_MIDI.tar.gz  reference melody MIDIs (TEST split) used to
                               verify our pitch/timing extraction

Output (this directory) — same schema as ../melody_chord, source='hooktheory':
  songs.csv, bars.csv, phrases.csv, chord_sequences.csv
  verify_report.json  (extraction verified against the reference MIDIs)
  verify_midi/        (reconstructed melody+chord MIDIs to listen to)
  build_stats.json

Usage: python3 build_hooktheory.py [Hooktheory.json.gz] [Test_MIDI.tar.gz]
"""

import gzip
import json
import math
import os
import sys
import tarfile
import tempfile
from collections import Counter

import numpy as np
import pandas as pd
import pretty_midi

OUT = os.path.dirname(os.path.abspath(__file__))
HOOKTHEORY_JSON = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser(
    "~/Downloads/Hooktheory.json.gz")
TEST_MIDI_TAR = sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser(
    "~/Downloads/Hooktheory_Test_MIDI.tar.gz")

PC_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]

SCALE_MODES = {
    (2, 2, 1, 2, 2, 2): "maj",
    (2, 1, 2, 2, 1, 2): "min",
    (2, 2, 1, 2, 2, 1): "mixolydian",
    (2, 1, 2, 2, 2, 1): "dorian",
    (2, 2, 2, 1, 2, 2): "lydian",
    (1, 2, 2, 2, 1, 2): "phrygian",
    (1, 2, 2, 1, 2, 2): "locrian",
    (2, 1, 2, 2, 1, 3): "harmonicMinor",
}

# SheetSage melody convention: MIDI pitch = 60 + 12*octave + pitch_class
MELODY_BASE = 60


def fmt(x):
    """Compact number formatting: 2.0 -> '2', 0.25 -> '0.25'."""
    x = round(float(x), 4)
    return str(int(x)) if x == int(x) else f"{x:g}"


def chord_pcs(root, intervals):
    """Absolute pitch classes of a chord from root + root-position intervals."""
    pcs, cur = [root % 12], root
    for iv in intervals:
        cur += iv
        pcs.append(cur % 12)
    return pcs


def classify_quality(intervals):
    """Collapse a root-position interval stack to the base quality vocab
    used by ../melody_chord (extensions beyond the 7th are dropped)."""
    rel, cur = {0}, 0
    for iv in intervals:
        cur += iv
        rel.add(cur % 12)
    if 4 in rel and (7 in rel or 6 not in rel and 8 not in rel):
        if 10 in rel:
            return "7"
        if 11 in rel:
            return "maj7"
        if 9 in rel:
            return "maj6"
        return "maj"
    if 3 in rel and 7 in rel:
        if 10 in rel:
            return "min7"
        if 11 in rel:
            return "minmaj7"
        if 9 in rel:
            return "min6"
        return "min"
    if 3 in rel and 6 in rel:
        if 9 in rel:
            return "dim7"
        if 10 in rel:
            return "hdim7"
        return "dim"
    if 4 in rel and 8 in rel:
        return "aug"
    if 5 in rel and 7 in rel:
        return "sus4"
    if 2 in rel and 7 in rel:
        return "sus2"
    if rel == {0, 7}:
        return "5"
    if rel == {0}:
        return "1"
    return "unk"


def chord_name(root, quality):
    return f"{PC_NAMES[root % 12]}:{quality}"


def load_songs(path):
    with gzip.open(path, "rt") as f:
        return json.load(f)


def extract_song(uid, attrs):
    """Return (meta_row, song_dict_or_None). song_dict has bars/chord segs."""
    tags = set(attrs["tags"])
    ann = attrs["annotations"]
    meta = {
        "source": "hooktheory", "song_id": uid, "n_bars": 0,
        "beats_per_bar": "", "bpm": "", "key": "", "mode": "",
        "transpose_offset": "", "n_melody_notes": 0,
        "chord_consonance": "", "melody_chord_coverage": "",
        "irregular_bars": 0.0, "unparsed_chords": 0,
        "included": False, "reason": "", "split": attrs["split"],
    }

    def excl(reason):
        meta["reason"] = reason
        return meta, None

    if "MELODY" not in tags or not ann.get("melody"):
        return excl("no_melody")
    if "HARMONY" not in tags or not ann.get("harmony"):
        return excl("no_harmony")
    meters = ann.get("meters") or []
    if len(meters) != 1 or meters[0]["beat"] != 0:
        return excl("meter_change")
    keys = ann.get("keys") or []
    if len(keys) != 1 or keys[0]["beat"] != 0:
        return excl("key_change")

    bpb = meters[0]["beats_per_bar"]
    num_beats = ann["num_beats"]
    if bpb < 1 or num_beats < bpb:
        return excl("too_short")
    n_bars = math.ceil(num_beats / bpb)

    tonic = keys[0]["tonic_pitch_class"] % 12
    mode = SCALE_MODES.get(tuple(keys[0]["scale_degree_intervals"]), "other")
    transpose = (12 - tonic) % 12

    # bpm estimated from the beat->time alignment (refined if available)
    align = attrs.get("alignment") or {}
    for tier in ("refined", "user"):
        al = align.get(tier)
        if al and al.get("beats") and len(al["beats"]) >= 2:
            spb = (al["times"][-1] - al["times"][0]) / (
                al["beats"][-1] - al["beats"][0])
            if spb > 0:
                meta["bpm"] = round(60.0 / spb, 1)
            break

    notes = []  # (onset_beats, dur_beats, midi_pitch)
    for n in ann["melody"]:
        on, off = float(n["onset"]), float(n["offset"])
        if off <= on or on < 0 or on >= num_beats:
            continue
        pitch = MELODY_BASE + 12 * n["octave"] + n["pitch_class"]
        if 0 <= pitch < 128:
            notes.append((on, off - on, pitch))
    notes.sort(key=lambda n: (n[0], n[2]))

    harmony = sorted(ann["harmony"], key=lambda h: h["onset"])
    segs = []  # (start, end, simple, raw, pcs)
    unparsed = 0
    for h in harmony:
        on, off = float(h["onset"]), float(h["offset"])
        if off <= on or on < 0 or on >= num_beats:
            continue
        root = h["root_pitch_class"] % 12
        ivs = h["root_position_intervals"]
        qual = classify_quality(ivs)
        raw = chord_name(root, qual if qual != "unk" else ",".join(map(str, ivs)))
        if h.get("inversion"):
            raw += f"/{h['inversion']}"
        if qual == "unk":
            unparsed += 1
            continue
        segs.append((on, min(off, num_beats), chord_name(root, qual), raw,
                     chord_pcs(root, ivs)))

    if not notes:
        return excl("no_melody")
    if not segs:
        return excl("no_parsable_chords")

    # per-bar tokens
    bars = []
    for b in range(n_bars):
        bs, be = b * bpb, (b + 1) * bpb
        mtoks = [f"{p}_{fmt(on - bs)}_{fmt(dur)}"
                 for (on, dur, p) in notes if bs <= on < be]
        ctoks, rtoks = [], []
        for (son, soff, simple, raw, _pcs) in segs:
            if bs <= son < be:
                ctoks.append(f"{simple}@{fmt(son - bs)}")
                rtoks.append(f"{raw}@{fmt(son - bs)}")
            elif son < bs < soff and not any(t.endswith("@0") for t in ctoks):
                ctoks.insert(0, f"{simple}@0")  # carry-over from earlier bar
                rtoks.insert(0, f"{raw}@0")
        bars.append({"bar": b,
                     "midi": " ".join(mtoks) if mtoks else "-",
                     "chords": " ".join(ctoks) if ctoks else "-",
                     "chords_raw": " ".join(rtoks) if rtoks else "-"})

    # verification metrics: melody coverage by chords + chord-tone consonance
    tot = cov = cons = 0.0
    for (on, dur, p) in notes:
        off = on + dur
        tot += dur
        for (son, soff, _s, _r, pcs) in segs:
            ov = min(off, soff) - max(on, son)
            if ov > 0:
                cov += ov
                if p % 12 in [pc % 12 for pc in pcs]:
                    cons += ov
    meta.update({
        "n_bars": n_bars, "beats_per_bar": bpb,
        "key": f"{PC_NAMES[tonic]}:{mode}", "mode": mode,
        "transpose_offset": float(transpose),
        "n_melody_notes": len(notes),
        "melody_chord_coverage": round(cov / tot, 4) if tot else 0.0,
        "chord_consonance": round(cons / cov, 4) if cov else 0.0,
        "unparsed_chords": unparsed, "included": True,
    })
    song = {"uid": uid, "bpb": bpb, "n_bars": n_bars, "bars": bars,
            "segs": segs, "transpose": transpose, "notes": notes,
            "bpm": meta["bpm"], "split": attrs["split"],
            "consonance": meta["chord_consonance"]}
    return meta, song


def transpose_chord(simple, offset):
    root, qual = simple.split(":")
    return chord_name((PC_NAMES.index(root) + offset) % 12, qual)


def first_chord_of_bar(chords):
    if chords == "-":
        return None
    tok = chords.split()[0]
    name, at = tok.rsplit("@", 1)
    return name if float(at) == 0.0 else None


# ---------------------------------------------------------------- verification

def beat_to_time_fn(beats, times):
    """Linear interpolation with linear extrapolation at the edges —
    matches sheetsage.align.create_beat_to_time_fn."""
    b, t = np.asarray(beats, float), np.asarray(times, float)

    def f(x):
        x = float(x)
        if x <= b[0]:
            return float(t[0] + (x - b[0]) * (t[1] - t[0]) / (b[1] - b[0]))
        if x >= b[-1]:
            return float(t[-1] + (x - b[-1]) * (t[-1] - t[-2]) / (b[-1] - b[-2]))
        return float(np.interp(x, b, t))

    return f


def verify_against_reference_midi(data, songs, tar_path):
    """Compare our beat-domain melody extraction against SheetSage's
    reference melody MIDIs (time domain, via the refined beat->time map)."""
    report = {"n_reference_midis": 0, "n_compared": 0, "n_pitch_exact": 0,
              "n_timing_ok": 0, "max_onset_err_ms": 0.0, "mismatches": []}
    with tempfile.TemporaryDirectory() as td:
        with tarfile.open(tar_path) as tf:
            tf.extractall(td, filter="data")
        mids = sorted(p for p in os.listdir(td) if p.endswith(".mid"))
        report["n_reference_midis"] = len(mids)
        for name in mids:
            uid = name[:-4]
            if uid not in songs or uid not in data:
                continue
            al = (data[uid].get("alignment") or {}).get("refined")
            if not al:
                continue
            btt = beat_to_time_fn(al["beats"], al["times"])
            ours = sorted(songs[uid]["notes"], key=lambda n: (n[0], n[2]))
            exp_on = [btt(on) for (on, dur, p) in ours]
            exp_pitch = [p for (_on, _dur, p) in ours]

            pm = pretty_midi.PrettyMIDI(os.path.join(td, name))
            mel = [i for i in pm.instruments if not i.is_drum]
            if not mel:
                continue
            ref = sorted(mel[0].notes, key=lambda n: (n.start, n.pitch))
            report["n_compared"] += 1
            if [n.pitch for n in ref] != exp_pitch:
                report["mismatches"].append({"uid": uid, "kind": "pitch",
                                             "ref": len(ref), "ours": len(exp_pitch)})
                continue
            report["n_pitch_exact"] += 1
            delta = ref[0].start - exp_on[0]  # constant segment offset
            err = max(abs((n.start - delta) - e) for n, e in zip(ref, exp_on))
            report["max_onset_err_ms"] = max(report["max_onset_err_ms"],
                                             round(err * 1000, 3))
            if err < 0.010:
                report["n_timing_ok"] += 1
            else:
                report["mismatches"].append({"uid": uid, "kind": "timing",
                                             "err_ms": round(err * 1000, 2)})
    return report


def render_verify_midi(song, path):
    """Reconstruct melody + block chords from the beat-domain data."""
    bpm = float(song["bpm"]) if song["bpm"] else 120.0
    spb = 60.0 / bpm
    pm = pretty_midi.PrettyMIDI(initial_tempo=bpm)
    mel = pretty_midi.Instrument(73, name="MELODY")  # flute
    for (on, dur, p) in song["notes"]:
        mel.notes.append(pretty_midi.Note(90, int(p), on * spb, (on + dur) * spb))
    ch = pretty_midi.Instrument(0, name="CHORDS")  # piano
    for (son, soff, _s, _r, pcs) in song["segs"]:
        seen = set()
        for i, pc in enumerate(pcs):
            pitch = 48 + (pc % 12) if i == 0 else 60 + (pc % 12)
            if pitch not in seen:
                seen.add(pitch)
                ch.notes.append(pretty_midi.Note(70, pitch, son * spb, soff * spb))
    pm.instruments = [mel, ch]
    pm.write(path)


# ------------------------------------------------------------------------ main

def main():
    print(f"loading {HOOKTHEORY_JSON} ...")
    data = load_songs(HOOKTHEORY_JSON)
    print(f"{len(data)} annotations")

    all_meta, songs = [], {}
    for uid, attrs in sorted(data.items()):
        meta, song = extract_song(uid, attrs)
        all_meta.append(meta)
        if song is not None:
            songs[uid] = song
        if len(all_meta) % 2000 == 0:
            print(f"processed {len(all_meta)}/{len(data)}")

    songs_df = pd.DataFrame(all_meta)
    songs_df.to_csv(os.path.join(OUT, "songs.csv"), index=False)

    bar_rows = []
    for uid, song in sorted(songs.items()):
        for bar in song["bars"]:
            bar_rows.append({"source": "hooktheory", "song_id": uid,
                             "bar": bar["bar"], "beats_per_bar": song["bpb"],
                             "midi": bar["midi"], "chords": bar["chords"],
                             "chords_raw": bar["chords_raw"]})
    bars_df = pd.DataFrame(bar_rows)
    bars_df.to_csv(os.path.join(OUT, "bars.csv"), index=False)

    # chord event sequence, consecutive duplicates merged (Markov input)
    seq_rows = []
    for uid, song in sorted(songs.items()):
        bpb, tr = song["bpb"], song["transpose"]
        merged = []
        for (son, soff, simple, raw, _pcs) in song["segs"]:
            if merged and merged[-1][2] == simple:
                merged[-1] = (merged[-1][0], soff, simple, merged[-1][3])
            else:
                merged.append((son, soff, simple, raw))
        for i, (son, soff, simple, raw) in enumerate(merged):
            b = int(son // bpb)
            seq_rows.append({
                "source": "hooktheory", "song_id": uid, "idx": i,
                "chord": simple, "chord_raw": raw, "bar": b,
                "beat_in_bar": round(son - b * bpb, 4),
                "duration_beats": round(soff - son, 4),
                "chord_t": transpose_chord(simple, tr)})
    seq_df = pd.DataFrame(seq_rows)
    seq_df.to_csv(os.path.join(OUT, "chord_sequences.csv"), index=False)

    # phrases: up to 8 bars of context, target = chord at next bar's downbeat
    phrase_rows = []
    for uid, song in sorted(songs.items()):
        bars, tr = song["bars"], song["transpose"]
        for t in range(1, len(bars)):
            target = first_chord_of_bar(bars[t]["chords"])
            if target is None:
                continue
            ctx = bars[max(0, t - 8):t]
            if all(b["midi"] == "-" for b in ctx):
                continue
            phrase_rows.append({
                "source": "hooktheory", "song_id": uid,
                "start_bar": ctx[0]["bar"], "end_bar": t - 1,
                "n_bars": len(ctx),
                "midi": " | ".join(b["midi"] for b in ctx),
                "chords": " | ".join(b["chords"] for b in ctx),
                "next_chord": target,
                "next_chord_t": transpose_chord(target, tr)})
    phrases_df = pd.DataFrame(phrase_rows)
    # gzip: this is the largest table (~80MB raw) and highly compressible;
    # keep the repo under GitHub's 50MB soft limit. pandas reads it back
    # transparently via read_csv("phrases.csv.gz").
    phrases_df.to_csv(os.path.join(OUT, "phrases.csv.gz"), index=False,
                      compression="gzip")

    # verify our extraction against the reference TEST MIDIs
    print("verifying against reference MIDI ...")
    report = verify_against_reference_midi(data, songs, TEST_MIDI_TAR)
    with open(os.path.join(OUT, "verify_report.json"), "w") as f:
        json.dump(report, f, indent=2)
    print(json.dumps({k: v for k, v in report.items() if k != "mismatches"},
                     indent=2))

    # listenable spot-checks spread across the consonance range
    os.makedirs(os.path.join(OUT, "verify_midi"), exist_ok=True)
    inc = songs_df[songs_df.included].sort_values("chord_consonance")
    picks = [inc.iloc[int(f * (len(inc) - 1))]["song_id"]
             for f in (0.0, 0.25, 0.5, 0.75, 1.0)]
    for uid in dict.fromkeys(picks):
        render_verify_midi(songs[uid],
                           os.path.join(OUT, "verify_midi", f"{uid}_check.mid"))

    n_inc = int(songs_df.included.sum())
    stats = {
        "songs_total": len(songs_df), "songs_included": n_inc,
        "songs_excluded": len(songs_df) - n_inc,
        "excluded_reasons": Counter(
            songs_df[~songs_df.included].reason).most_common(),
        "split_counts": Counter(
            songs_df[songs_df.included].split).most_common(),
        "bars": len(bars_df), "phrases": len(phrases_df),
        "chord_events": len(seq_df),
        "chord_vocab": int(seq_df.chord.nunique()),
        "quality_counts": Counter(
            c.split(":")[1] for c in seq_df.chord).most_common(),
        "median_consonance": float(
            songs_df[songs_df.included].chord_consonance.median()),
        "verification": {k: v for k, v in report.items() if k != "mismatches"},
        "verify_midi_samples": list(dict.fromkeys(picks)),
    }
    with open(os.path.join(OUT, "build_stats.json"), "w") as f:
        json.dump(stats, f, indent=2)
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
