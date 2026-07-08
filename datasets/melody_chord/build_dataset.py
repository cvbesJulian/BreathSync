"""Build a melody->chord dataset from POP909.

Reads each song's MIDI (MELODY track) and the MIDI-aligned annotations
(chord_midi.txt, beat_midi.txt), verifies the chord labels against the
accompaniment notes actually present in the MIDI, and renders a simple
lead-sheet-style dataset:

  bars.csv     one row per bar: melody note tokens + chord tokens
  phrases.csv  one row per prediction example: up to 8 bars of melody/chord
               context and the next chord as the target
  songs.csv    per-song metadata + verification scores + include/exclude flag
  verify_midi/ reconstructed melody+chord MIDI files for spot-check listening

Token formats (beat units, relative to the bar start, 16th-note quantized):
  melody bar   "60_0.00_1.50 62_1.50_0.50"   pitch_onset_duration; "-" = rest bar
  chord bar    "C:maj@0.0 G:7@2.0"           chord@onset-beat-in-bar
  multi-bar    bars joined with " | "
"""

import os
import glob
import json
import numpy as np
import pandas as pd
import pretty_midi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POP = os.path.join(ROOT, "POP909")
OUT = os.path.dirname(os.path.abspath(__file__))

PITCH_CLASSES = {
    "C": 0, "B#": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4,
    "Fb": 4, "F": 5, "E#": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8,
    "A": 9, "A#": 10, "Bb": 10, "B": 11, "Cb": 11,
}
CANON_ROOT = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]

QUALITY_INTERVALS = {
    "maj": (0, 4, 7), "min": (0, 3, 7), "dim": (0, 3, 6), "aug": (0, 4, 8),
    "sus2": (0, 2, 7), "sus4": (0, 5, 7),
    "maj7": (0, 4, 7, 11), "min7": (0, 3, 7, 10), "7": (0, 4, 7, 10),
    "dim7": (0, 3, 6, 9), "hdim7": (0, 3, 6, 10), "minmaj7": (0, 3, 7, 11),
    "maj6": (0, 4, 7, 9), "min6": (0, 3, 7, 9), "6": (0, 4, 7, 9),
    "9": (0, 4, 7, 10, 2), "maj9": (0, 4, 7, 11, 2), "min9": (0, 3, 7, 10, 2),
}
DEGREE_SEMITONES = {
    "1": 0, "2": 2, "3": 4, "4": 5, "5": 7, "6": 9, "7": 11,
    "9": 2, "11": 5, "13": 9,
}


def parse_chord(label):
    """Return (simple_label, pitch_class_set) or (None, None) for N/unparseable."""
    label = label.strip()
    if label in ("N", "X", ""):
        return None, None
    if ":" not in label:
        return None, None
    root_s, rest = label.split(":", 1)
    if root_s not in PITCH_CLASSES:
        return None, None
    root = PITCH_CLASSES[root_s]

    rest_nobass = rest.split("/")[0]
    base = rest_nobass.split("(")[0]
    if base == "":
        base = "maj"
    if base not in QUALITY_INTERVALS:
        return None, None
    pcs = {(root + iv) % 12 for iv in QUALITY_INTERVALS[base]}

    # parenthesised extra degrees, e.g. (b7), (9), (#5)
    if "(" in rest_nobass:
        ext = rest_nobass[rest_nobass.index("(") + 1:rest_nobass.rindex(")")]
        for deg in ext.split(","):
            deg = deg.strip()
            if not deg:
                continue
            alt = 0
            while deg and deg[0] in "b#":
                alt += -1 if deg[0] == "b" else 1
                deg = deg[1:]
            if deg in DEGREE_SEMITONES:
                pcs.add((root + DEGREE_SEMITONES[deg] + alt) % 12)

    simple = f"{CANON_ROOT[root]}:{base}"
    return simple, pcs


def load_beats(path):
    rows = [l.split() for l in open(path) if l.strip()]
    times = np.array([float(r[0]) for r in rows])
    downbeat = np.array([float(r[2]) for r in rows]) == 1.0
    return times, downbeat


def load_chords(path):
    out = []
    for line in open(path):
        parts = line.strip().split("\t")
        if len(parts) != 3:
            continue
        out.append((float(parts[0]), float(parts[1]), parts[2]))
    return out


def beat_position(times, beat_times, med_beat):
    """Map times (sec) to continuous beat positions, extrapolating at edges."""
    pos = np.interp(times, beat_times, np.arange(len(beat_times)))
    lo, hi = beat_times[0], beat_times[-1]
    below = times < lo
    above = times > hi
    pos = np.asarray(pos, dtype=float)
    pos[below] = (times[below] - lo) / med_beat
    pos[above] = (len(beat_times) - 1) + (times[above] - hi) / med_beat
    return pos


def q16(x):
    return round(x * 4) / 4


def process_song(song_dir, sid):
    midi_path = os.path.join(song_dir, f"{sid}.mid")
    pm = pretty_midi.PrettyMIDI(midi_path)
    tracks = {inst.name.strip().upper(): inst for inst in pm.instruments}
    issues = []
    if "MELODY" not in tracks or not tracks["MELODY"].notes:
        return None, {"song_id": sid, "included": False,
                      "reason": "missing/empty MELODY track"}

    beat_times, downbeat = load_beats(os.path.join(song_dir, "beat_midi.txt"))
    if len(beat_times) < 8 or np.any(np.diff(beat_times) <= 0):
        return None, {"song_id": sid, "included": False,
                      "reason": "bad beat grid"}
    med_beat = float(np.median(np.diff(beat_times)))

    bar_idx = np.where(downbeat)[0]
    if len(bar_idx) < 4:
        return None, {"song_id": sid, "included": False,
                      "reason": "too few downbeats"}
    spacings = np.diff(bar_idx)
    beats_per_bar = int(np.bincount(spacings).argmax())
    irregular_bars = int(np.sum(spacings != beats_per_bar))
    # bar start positions in beat units; append a final synthetic bar end
    bar_starts = list(bar_idx.astype(float))
    bar_starts.append(bar_starts[-1] + beats_per_bar)

    chords_raw = load_chords(os.path.join(song_dir, "chord_midi.txt"))
    chord_segs = []  # (start_beat, end_beat, simple, raw, pcs)
    n_unparsed = 0
    for (s, e, lab) in chords_raw:
        simple, pcs = parse_chord(lab)
        if simple is None:
            if lab != "N":
                n_unparsed += 1
            continue
        sb, eb = beat_position(np.array([s, e]), beat_times, med_beat)
        chord_segs.append((float(sb), float(eb), simple, lab, pcs))

    if not chord_segs:
        return None, {"song_id": sid, "included": False, "reason": "no chords"}

    # ---- verification: chord labels vs accompaniment notes in the MIDI ----
    acc_notes = []
    for name in ("PIANO", "BRIDGE"):
        if name in tracks:
            acc_notes.extend(tracks[name].notes)
    match_dur = total_dur = 0.0
    for (s, e, lab) in chords_raw:
        simple, pcs = parse_chord(lab)
        if pcs is None:
            continue
        for n in acc_notes:
            ov = min(n.end, e) - max(n.start, s)
            if ov <= 0:
                continue
            total_dur += ov
            if n.pitch % 12 in pcs:
                match_dur += ov
    consonance = match_dur / total_dur if total_dur > 0 else 0.0

    melody = sorted(tracks["MELODY"].notes, key=lambda n: n.start)
    mel_on = beat_position(np.array([n.start for n in melody]), beat_times, med_beat)
    mel_off = beat_position(np.array([n.end for n in melody]), beat_times, med_beat)

    # fraction of melody time covered by a chord label
    cov = 0.0
    mel_total = sum(n.end - n.start for n in melody)
    for n in melody:
        for (s, e, lab) in chords_raw:
            if lab == "N":
                continue
            ov = min(n.end, e) - max(n.start, s)
            if ov > 0:
                cov += ov
    coverage = min(cov / mel_total, 1.0) if mel_total > 0 else 0.0

    # ---- per-bar tokens ----
    n_bars = len(bar_starts) - 1
    bar_mel = [[] for _ in range(n_bars)]
    bar_ch = [[] for _ in range(n_bars)]
    bar_ch_raw = [[] for _ in range(n_bars)]

    for i, note in enumerate(melody):
        on = mel_on[i]
        b = int(np.searchsorted(bar_starts, on, side="right")) - 1
        if b < 0 or b >= n_bars:
            continue
        rel = q16(on - bar_starts[b])
        dur = max(q16(mel_off[i] - on), 0.25)
        bar_mel[b].append((rel, note.pitch, dur))

    for (sb, eb, simple, raw, pcs) in chord_segs:
        b0 = max(int(np.searchsorted(bar_starts, sb, side="right")) - 1, 0)
        for b in range(b0, n_bars):
            bs, be = bar_starts[b], bar_starts[b + 1]
            if sb >= be:
                continue
            if eb <= bs:
                break
            rel = q16(max(sb - bs, 0.0))
            if rel >= beats_per_bar:
                continue
            bar_ch[b].append((rel, simple))
            bar_ch_raw[b].append((rel, raw))

    bars = []
    for b in range(n_bars):
        mel_s = " ".join(f"{p}_{on:g}_{d:g}" for on, p, d in sorted(bar_mel[b])) or "-"
        ch_s = " ".join(f"{c}@{on:g}" for on, c in sorted(bar_ch[b], key=lambda x: x[0])) or "-"
        chr_s = " ".join(f"{c}@{on:g}" for on, c in sorted(bar_ch_raw[b], key=lambda x: x[0])) or "-"
        bars.append({"bar": b, "midi": mel_s, "chords": ch_s, "chords_raw": chr_s})

    # main key (duration-weighted) from key_audio.txt if present
    key = ""
    kp = os.path.join(song_dir, "key_audio.txt")
    if os.path.exists(kp):
        best = 0.0
        for line in open(kp):
            parts = line.strip().split("\t")
            if len(parts) == 3 and float(parts[1]) - float(parts[0]) > best:
                best = float(parts[1]) - float(parts[0])
                key = parts[2]

    bpm = 60.0 / med_beat
    meta = {
        "song_id": sid, "n_bars": n_bars, "beats_per_bar": beats_per_bar,
        "bpm": round(bpm, 1), "key": key, "n_melody_notes": len(melody),
        "chord_consonance": round(consonance, 4),
        "melody_chord_coverage": round(coverage, 4),
        "irregular_bars": irregular_bars, "unparsed_chords": n_unparsed,
    }
    song = {"meta": meta, "bars": bars, "beat_times": beat_times,
            "bar_starts": bar_starts, "beats_per_bar": beats_per_bar,
            "chord_segs": chord_segs}
    return song, meta


def first_chord_of_bar(chords_str):
    if chords_str in ("-", ""):
        return None
    return chords_str.split(" ")[0].split("@")[0]


def render_verify_midi(song, sid, path):
    """Reconstruct melody + block chords from dataset tokens, on the real beat grid."""
    beat_times = song["beat_times"]
    med = float(np.median(np.diff(beat_times)))

    def beat_to_time(b):
        n = len(beat_times)
        if b <= 0:
            return float(beat_times[0] + b * med)
        if b >= n - 1:
            return float(beat_times[-1] + (b - (n - 1)) * med)
        i = int(b)
        return float(beat_times[i] + (b - i) * (beat_times[i + 1] - beat_times[i]))

    pm = pretty_midi.PrettyMIDI()
    mel = pretty_midi.Instrument(program=73, name="MELODY")   # flute
    chd = pretty_midi.Instrument(program=0, name="CHORDS")    # piano
    starts = song["bar_starts"]
    for bar in song["bars"]:
        bs = starts[bar["bar"]]
        be = starts[bar["bar"] + 1]
        if bar["midi"] != "-":
            for tok in bar["midi"].split(" "):
                p, on, d = tok.split("_")
                t0 = beat_to_time(bs + float(on))
                t1 = beat_to_time(bs + float(on) + float(d))
                mel.notes.append(pretty_midi.Note(90, int(p), t0, t1))
        if bar["chords"] != "-":
            toks = bar["chords"].split(" ")
            for j, tok in enumerate(toks):
                lab, on = tok.rsplit("@", 1)
                nxt = float(toks[j + 1].rsplit("@", 1)[1]) if j + 1 < len(toks) \
                    else (be - bs)
                _, pcs = parse_chord(lab)
                if pcs is None:
                    continue
                root = PITCH_CLASSES[lab.split(":")[0]]
                t0 = beat_to_time(bs + float(on))
                t1 = beat_to_time(bs + nxt)
                chd.notes.append(pretty_midi.Note(60, 36 + root, t0, t1))
                for pc in sorted(pcs):
                    chd.notes.append(pretty_midi.Note(55, 48 + (pc - root) % 12 + root, t0, t1))
    pm.instruments = [mel, chd]
    pm.write(path)


def main():
    consonance_threshold = 0.80
    coverage_threshold = 0.90

    song_dirs = sorted(glob.glob(os.path.join(POP, "[0-9][0-9][0-9]")))
    all_meta, songs = [], {}
    for d in song_dirs:
        sid = os.path.basename(d)
        try:
            song, meta = process_song(d, sid)
        except Exception as ex:
            song, meta = None, {"song_id": sid, "included": False,
                                "reason": f"error: {ex}"}
        if song is not None:
            ok = (meta["chord_consonance"] >= consonance_threshold
                  and meta["melody_chord_coverage"] >= coverage_threshold)
            meta["included"] = ok
            meta["reason"] = "" if ok else "failed MIDI-vs-chord verification"
            if ok:
                songs[sid] = song
        all_meta.append(meta)
        if len(all_meta) % 100 == 0:
            print(f"processed {len(all_meta)}/{len(song_dirs)}")

    songs_df = pd.DataFrame(all_meta)
    songs_df.to_csv(os.path.join(OUT, "songs.csv"), index=False)

    bar_rows = []
    for sid, song in sorted(songs.items()):
        for bar in song["bars"]:
            bar_rows.append({"song_id": sid, "bar": bar["bar"],
                             "beats_per_bar": song["beats_per_bar"],
                             "midi": bar["midi"], "chords": bar["chords"],
                             "chords_raw": bar["chords_raw"]})
    bars_df = pd.DataFrame(bar_rows)
    bars_df.to_csv(os.path.join(OUT, "bars.csv"), index=False)

    # chord event sequences: ordered chords per song, consecutive duplicates
    # merged — the natural input for a chord Markov chain / n-gram model
    seq_rows = []
    for sid, song in sorted(songs.items()):
        bar_starts = song["bar_starts"]
        merged = []  # (start_beat, end_beat, simple, raw)
        for (sb, eb, simple, raw, _pcs) in song["chord_segs"]:
            if merged and merged[-1][2] == simple:
                merged[-1] = (merged[-1][0], eb, simple, merged[-1][3])
            else:
                merged.append((sb, eb, simple, raw))
        for i, (sb, eb, simple, raw) in enumerate(merged):
            sbq, ebq = q16(sb), q16(eb)  # snap to the 16th grid so onsets a
            # few ms before a downbeat land in the bar they musically belong to
            b = max(int(np.searchsorted(bar_starts, sbq, side="right")) - 1, 0)
            seq_rows.append({
                "song_id": sid, "idx": i, "chord": simple, "chord_raw": raw,
                "bar": b, "beat_in_bar": max(sbq - bar_starts[b], 0.0),
                "duration_beats": max(ebq - sbq, 0.25),
            })
    seq_df = pd.DataFrame(seq_rows)
    seq_df.to_csv(os.path.join(OUT, "chord_sequences.csv"), index=False)

    # phrases: up to 8 bars of context, target = first chord of the next bar
    phrase_rows = []
    for sid, song in sorted(songs.items()):
        bars = song["bars"]
        for t in range(1, len(bars)):
            target = first_chord_of_bar(bars[t]["chords"])
            if target is None:
                continue
            ctx = bars[max(0, t - 8):t]
            if all(b["midi"] == "-" for b in ctx):
                continue
            phrase_rows.append({
                "song_id": sid, "start_bar": ctx[0]["bar"], "end_bar": t - 1,
                "n_bars": len(ctx),
                "midi": " | ".join(b["midi"] for b in ctx),
                "chords": " | ".join(b["chords"] for b in ctx),
                "next_chord": target,
            })
    phrases_df = pd.DataFrame(phrase_rows)
    phrases_df.to_csv(os.path.join(OUT, "phrases.csv"), index=False)

    # verification renders: spread across the consonance range of included songs
    os.makedirs(os.path.join(OUT, "verify_midi"), exist_ok=True)
    inc = songs_df[songs_df.included == True].sort_values("chord_consonance")
    picks = [inc.iloc[int(f * (len(inc) - 1))]["song_id"]
             for f in (0.0, 0.25, 0.5, 0.75, 1.0)]
    for sid in dict.fromkeys(picks):
        render_verify_midi(songs[sid], sid,
                           os.path.join(OUT, "verify_midi", f"{sid}_check.mid"))

    n_inc = int(songs_df.included.sum())
    stats = {
        "songs_total": len(songs_df), "songs_included": n_inc,
        "songs_excluded": len(songs_df) - n_inc,
        "bars": len(bars_df), "phrases": len(phrases_df),
        "chord_events": len(seq_df),
        "chord_vocab": int(phrases_df.next_chord.nunique()),
        "consonance_threshold": consonance_threshold,
        "coverage_threshold": coverage_threshold,
        "median_consonance": float(songs_df.chord_consonance.median()),
        "verify_midi_samples": list(dict.fromkeys(picks)),
    }
    with open(os.path.join(OUT, "build_stats.json"), "w") as f:
        json.dump(stats, f, indent=2)
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
