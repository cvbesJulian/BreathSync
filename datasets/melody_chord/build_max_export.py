"""Full-fidelity export of the combined dataset for Max/MSP ([dict] / Max for Live).

Run AFTER build_dataset.py + build_combined.py. Produces improspira_max/:

  songs/<source>.<song_id>.json   one dict per song, loadable with [dict]
  index.json                      song catalogue for umenu/browse
  markov_chord_t.json             first-order transition counts, key-transposed
  markov_chord.json               same, absolute roots
  README.md                       schema + Max usage notes

Same token semantics as the CSVs (beats relative to the bar start), but with
the features the flat CSVs drop restored:
  - note velocities (POP909 MIDI; 100 elsewhere, where no velocity exists)
  - full unsimplified chord symbols (OpenBook tensions/slash chords)
  - titles / artists / styles / collections
  - per-bar next_chord targets and key-transposed labels inline
"""

import os
import io
import json
import zipfile
import numpy as np
import pandas as pd
import pretty_midi

import build_dataset as bd
from build_combined import (OPENBOOK, NOTTINGHAM, transpose_chord)

OUT = os.path.dirname(os.path.abspath(__file__))
EXPORT = os.path.join(OUT, "improspira_max")


def pop909_velocities():
    """(song_id, bar) -> ordered [vel, ...] matching the bars.csv note order.
    Re-runs the builder's exact quantization, keeping velocity this time."""
    vels, tokens = {}, {}
    dirs = sorted(d for d in os.listdir(bd.POP) if d.isdigit())
    for sid in dirs:
        song_dir = os.path.join(bd.POP, sid)
        try:
            pm = pretty_midi.PrettyMIDI(os.path.join(song_dir, f"{sid}.mid"))
        except Exception:
            continue
        tracks = {i.name.strip().upper(): i for i in pm.instruments}
        if "MELODY" not in tracks or not tracks["MELODY"].notes:
            continue
        beat_times, downbeat = bd.load_beats(
            os.path.join(song_dir, "beat_midi.txt"))
        med = float(np.median(np.diff(beat_times)))
        bar_idx = np.where(downbeat)[0]
        if len(bar_idx) < 4:
            continue
        beats_per_bar = int(np.bincount(np.diff(bar_idx)).argmax())
        bar_starts = list(bar_idx.astype(float))
        bar_starts.append(bar_starts[-1] + beats_per_bar)
        melody = sorted(tracks["MELODY"].notes, key=lambda n: n.start)
        on = bd.beat_position(np.array([n.start for n in melody]), beat_times, med)
        off = bd.beat_position(np.array([n.end for n in melody]), beat_times, med)
        per_bar = {}
        for i, note in enumerate(melody):
            b = int(np.searchsorted(bar_starts, on[i], side="right")) - 1
            if b < 0 or b >= len(bar_starts) - 1:
                continue
            rel = bd.q16(on[i] - bar_starts[b])
            dur = max(bd.q16(off[i] - on[i]), 0.25)
            per_bar.setdefault(b, []).append((rel, note.pitch, dur, note.velocity))
        for b, notes in per_bar.items():
            notes.sort(key=lambda t: t[:3])
            vels[(sid, b)] = [n[3] for n in notes]
            tokens[(sid, b)] = " ".join(
                f"{p}_{r:g}_{d:g}" for r, p, d, _ in notes)
    return vels, tokens


def openbook_full_raw():
    """(song_id, bar, beat4, simple_sym) -> full symbol (tensions kept)."""
    df = pd.read_csv(os.path.join(OPENBOOK, "openbook_dataset.csv"))
    df = df[(df.is_default == True) & (df.duration_match == True)]
    out, meta = {}, {}
    for _, r in df.iterrows():
        sid = r.file.replace(".ly.mako", "")
        meta[sid] = {"title": r.title,
                     "artist": r.composer if isinstance(r.composer, str) else "",
                     "style": r.style if isinstance(r.style, str) else ""}
        for f, s in zip(json.loads(r.Chords), json.loads(r.Chords_simple)):
            out[(sid, int(s[0]), round(float(s[1]), 4), s[2])] = f[2]
    return out, meta


def load_titles():
    titles = {}
    with zipfile.ZipFile(os.path.join(
            os.path.dirname(OUT), "POP909.zip")) as z:
        idx = pd.read_excel(io.BytesIO(z.read("POP909/index.xlsx")))
    for _, r in idx.iterrows():
        titles[("pop909", f"{int(r.song_id):03d}")] = {
            "title": str(r["name"]), "artist": str(r["artist"]), "style": "pop"}
    tunes = pd.read_csv(os.path.join(NOTTINGHAM, "dataset", "tunes.csv"))
    for _, r in tunes.iterrows():
        titles[("nottingham", r.tune_id)] = {
            "title": str(r.title), "artist": "",
            "style": f"folk/{r.collection}"}
    return titles


def main():
    os.makedirs(os.path.join(EXPORT, "songs"), exist_ok=True)
    bars = pd.read_csv(os.path.join(OUT, "bars.csv"), dtype={"song_id": str})
    songs = pd.read_csv(os.path.join(OUT, "songs.csv"), dtype={"song_id": str})
    seqs = pd.read_csv(os.path.join(OUT, "chord_sequences.csv"),
                       dtype={"song_id": str})
    if "source" not in bars.columns:
        raise SystemExit("run build_combined.py first")
    songs = songs[songs.included == True]

    print("re-extracting POP909 velocities...")
    vels, vel_tokens = pop909_velocities()
    ob_raw, ob_meta = openbook_full_raw()
    titles = load_titles()
    titles.update({("openbook", k): v for k, v in ob_meta.items()})

    seq_g = {k: g.sort_values("idx") for k, g in
             seqs.groupby(["source", "song_id"])}
    bar_g = {k: g.sort_values("bar") for k, g in
             bars.groupby(["source", "song_id"])}

    index, vel_mismatch = [], 0
    for _, s in songs.iterrows():
        key = (s.source, s.song_id)
        g = bar_g.get(key)
        if g is None:
            continue
        offset = None if pd.isna(s.transpose_offset) else int(s.transpose_offset)
        bar_list, bar_rows = [], list(g.itertuples())
        for i, r in enumerate(bar_rows):
            notes = []
            if r.midi != "-":
                toks = r.midi.split()
                vlist = vels.get((s.song_id, int(r.bar))) \
                    if s.source == "pop909" else None
                if vlist is not None and (
                        len(vlist) != len(toks)
                        or vel_tokens.get((s.song_id, int(r.bar))) != r.midi):
                    vel_mismatch += 1
                    vlist = None
                for j, t in enumerate(toks):
                    p, on, du = t.split("_")
                    notes.append([int(p), float(on), float(du),
                                  int(vlist[j]) if vlist else 100])
            chords = []
            if r.chords != "-":
                for ct, rt in zip(r.chords.split(), r.chords_raw.split()):
                    lab, on = ct.rsplit("@", 1)
                    raw = rt.rsplit("@", 1)[0]
                    if s.source == "openbook":
                        raw = ob_raw.get((s.song_id, int(r.bar),
                                          round(float(on), 4), raw), raw)
                    chords.append({"label": lab, "raw": raw,
                                   "t": transpose_chord(lab, offset),
                                   "onset": float(on)})
            nxt = nxt_t = None
            if i + 1 < len(bar_rows) and bar_rows[i + 1].chords != "-":
                nxt = bar_rows[i + 1].chords.split()[0].rsplit("@", 1)[0]
                nxt_t = transpose_chord(nxt, offset)
            bar_list.append({"bar": int(r.bar),
                             "beats_per_bar": int(r.beats_per_bar),
                             "notes": notes, "chords": chords,
                             "next_chord": nxt, "next_chord_t": nxt_t})

        seq = []
        sg = seq_g.get(key)
        if sg is not None:
            for r in sg.itertuples():
                seq.append({"chord": r.chord, "raw": r.chord_raw,
                            "t": r.chord_t if isinstance(r.chord_t, str) else "",
                            "bar": int(r.bar), "beat": float(r.beat_in_bar),
                            "dur": float(r.duration_beats)})

        t = titles.get(key, {"title": s.song_id, "artist": "", "style": ""})
        doc = {
            "source": s.source, "song_id": s.song_id,
            "title": t["title"], "artist": t["artist"], "style": t["style"],
            "key": s.key if isinstance(s.key, str) else "",
            "mode": s.mode if isinstance(s.mode, str) else "",
            "transpose_offset": offset,
            "bpm": None if pd.isna(s.bpm) else float(s.bpm),
            "beats_per_bar": int(s.beats_per_bar),
            "n_bars": int(s.n_bars),
            "bars": bar_list, "chord_sequence": seq,
        }
        fname = f"{s.source}.{s.song_id}.json"
        with open(os.path.join(EXPORT, "songs", fname), "w") as f:
            json.dump(doc, f, ensure_ascii=False)
        index.append({"file": f"songs/{fname}", "source": s.source,
                      "song_id": s.song_id, "title": t["title"],
                      "artist": t["artist"], "style": t["style"],
                      "key": doc["key"], "mode": doc["mode"],
                      "transpose_offset": offset, "bpm": doc["bpm"],
                      "beats_per_bar": doc["beats_per_bar"],
                      "n_bars": doc["n_bars"]})

    with open(os.path.join(EXPORT, "index.json"), "w") as f:
        json.dump({"songs": index}, f, ensure_ascii=False, indent=1)

    # transition counts nested per source corpus, plus a pooled "all"
    for col, name in [("chord_t", "markov_chord_t.json"),
                      ("chord", "markov_chord.json")]:
        nested = {"pop909": {}, "openbook": {}, "nottingham": {}, "all": {}}
        for (source, _sid), g in seq_g.items():
            vals = [v for v in g[col].tolist() if isinstance(v, str) and v]
            for a, b in zip(vals, vals[1:]):
                for t in (nested[source], nested["all"]):
                    t.setdefault(a, {})
                    t[a][b] = t[a].get(b, 0) + 1
        for t in nested.values():
            for a in t:
                t[a] = dict(sorted(t[a].items(), key=lambda kv: -kv[1]))
        with open(os.path.join(EXPORT, name), "w") as f:
            json.dump(nested, f, indent=1)

    print(f"wrote {len(index)} song dicts, velocity mismatches: {vel_mismatch}")


if __name__ == "__main__":
    main()
