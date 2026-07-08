# Melody → Chord Dataset (POP909 + OpenBook + Nottingham)

A simple lead-sheet-style dataset built for training models that **predict
the next chord from a preceding melody phrase (1–8 bars)**, and for chord
Markov chains / n-gram models. Three corpora share one identical schema,
distinguished by the `source` column:

| source | corpus | songs | bars | phrases | chord events |
|---|---|---|---|---|---|
| `pop909` | POP909 (Chinese pop, MIDI performances) | 906 | 74,661 | 65,612 | 107,296 |
| `nottingham` | Nottingham Music Database (British/Irish folk) | 1,018 | 39,503 | 38,482 | 41,890 |
| `openbook` | OpenBook jazz lead sheets | 152 | 6,738 | 6,586 | 9,029 |
| **total** | | **2,076** | **120,902** | **110,680** | **158,215** |

## Files

| File | What it is |
|---|---|
| `bars.csv` | One row per bar — the core melody/chord data |
| `chord_sequences.csv` | One row per **chord event**, in song order, consecutive duplicates merged — the input for chord Markov chains. Includes `chord_t`, the key-transposed chord |
| `phrases.csv` | Ready-made training examples: up to 8 bars of context + `next_chord` / `next_chord_t` targets |
| `songs.csv` | Per-song metadata (key, mode, transpose offset) and POP909 verification scores |
| `build_stats.json` / `build_stats_combined.json` | Build summaries |
| `browser.html` | Self-contained interactive browser (open in any browser): piano-roll playback, training-example framing, chord-transition tables; 46 representative songs embedded |
| `verify_midi/` | Reconstructed melody+chord MIDIs for 5 POP909 songs — listen to spot-check alignment |
| `improspira_max/` | Full-fidelity per-song JSON dicts for Max/MSP (velocities, full chord symbols, titles) + Markov transition dicts — see its README |
| `build_dataset.py` | Step 1: builds the POP909-only tables from `../POP909` |
| `build_combined.py` | Step 2: converts OpenBook + Nottingham and merges (overwrites the CSVs with combined versions) |
| `build_max_export.py` | Step 3: renders `improspira_max/` from the combined tables |

To rebuild: `python3 build_dataset.py && python3 build_combined.py && python3 build_max_export.py`.

## Token format

All positions/durations are in **beats relative to the bar start**.
A "beat" is: the annotated beat for `pop909` (16th-note quantized), a quarter
note for `openbook`, and the meter's denominator unit for `nottingham`
(e.g. an eighth note in 6/8 — so a 6/8 bar has `beats_per_bar = 6`).

**Melody** (`midi` column): space-separated `pitch_onset_duration` tokens,
`-` for an empty bar.

```
60_0_0.5 62_0.5_0.5 64_1_2        # C4 on beat 1, D4 on the &, E4 held 2 beats
```

**Chords** (`chords` column): space-separated `Root:quality@onset` tokens.
A chord carried over from a previous bar appears at `@0` (this convention is
applied uniformly: OpenBook multi-bar chords and Nottingham chordless bars
are carry-filled). Roots use 12 canonical spellings
(C, Db, D, Eb, E, F, F#, G, Ab, A, Bb, B); qualities are collapsed to a base
vocabulary (maj, min, 7, maj7, min7, dim, dim7, hdim7, aug, sus2, sus4,
maj6, min6, 9, ...). The as-annotated label is kept in `chords_raw`
(e.g. `Bbmaj7`, `Gd`, `C#:maj/5`).

In multi-bar strings (`phrases.csv`), bars are joined with `" | "`, so
truncating to a k-bar context is just splitting on `|` and keeping the last k.

## Key-transposed chords (`chord_t`, `next_chord_t`)

Every song has a key (POP909: `key_audio.txt`; OpenBook: lead-sheet key;
Nottingham: ABC `K:` field). `songs.csv` records `mode` and
`transpose_offset` — the semitone shift (−5…+6) that moves the tonic to
**C for major keys and A for minor keys** (i.e. everything lands on the
C-major/A-minor pitch set). `chord_t` in `chord_sequences.csv` and
`next_chord_t` in `phrases.csv` are the chords with that shift applied,
giving a key-independent vocabulary (158 symbols vs 163 raw).

Corpus-wide sanity check in transposed space: the top chords are C:maj,
G:maj, F:maj, A:min (I, V, IV, vi) and `G:7 → C:maj` accounts for 86% of
G:7 transitions (the V7–I cadence).

## chord_sequences.csv — building a chord Markov chain

Columns: `source, song_id, idx, chord, chord_raw, bar, beat_in_bar,
duration_beats, chord_t`. Chords are in temporal order (`idx`) with
consecutive repeats already merged:

```python
import pandas as pd, collections
df = pd.read_csv("chord_sequences.csv", dtype={"song_id": str})
trans = collections.defaultdict(collections.Counter)
for _, g in df.groupby(["source", "song_id"]):
    seq = g.sort_values("idx").chord_t.tolist()   # or .chord for absolute keys
    for a, b in zip(seq, seq[1:]):
        trans[a][b] += 1
```

Filter on `source` to model one corpus, or mix for a genre-blended chain.

## phrases.csv

One row per bar-position `t` in each song: the context is bars
`[max(0, t-8), t)` and the target is the chord sounding at the downbeat of
bar `t`.

| column | meaning |
|---|---|
| `source`, `song_id` | corpus + song identifier |
| `start_bar`, `end_bar`, `n_bars` | context span (n_bars ≤ 8) |
| `midi` | melody tokens for the context, bar-separated by `\|` |
| `chords` | chord tokens for the context, bar-separated by `\|` |
| `next_chord` | **target**: first chord of bar `t` |
| `next_chord_t` | the same, key-transposed |

For shorter conditioning (1–8 bars) at train time, slice off the trailing k
bars of `midi` (and optionally `chords`) — no reprocessing needed.

## Provenance & verification

- **pop909** — extracted from the MELODY track + MIDI-aligned annotations
  (`chord_midi.txt`, `beat_midi.txt`) of `../POP909`. Every song verified
  against its MIDI: median duration-weighted chord/accompaniment
  pitch-class agreement is 0.948; songs below 0.80 (or with <0.90 melody
  chord-coverage) are excluded — 3 of 909 failed (`278`, `506`, `605`; see
  `songs.csv`, `included` column). Melody round-trips from the tokens with
  100% pitch accuracy and ≈0 ms median onset error.
- **nottingham** — from the pre-verified dataset in
  `/Volumes/Mac-Storage/GitHub/nottingham-dataset/dataset` (chords named
  from rendered MIDI pitches and cross-checked against the ABC symbols:
  49,335/49,337 match; 16 of 1,034 tunes excluded upstream).
- **openbook** — from the parsed lead sheets in
  `/Users/zacharyscheffler/Desktop/OpenBookDataset` (repeats expanded,
  ties merged; canonical version per song, the 2 songs with
  melody/chord duration mismatches excluded: 152 of 154).
- Zero chord symbols were dropped in conversion to the shared vocabulary
  (`build_stats_combined.json`).

## Credit

POP909: Wang et al., ISMIR 2020 (arXiv:2008.07142) · OpenBook lead sheets
(veltzer/openbook, LilyPond) · Nottingham Music Database (ABC, cleaned
fork). Cite the original sources if you publish results on this data.
