# Melody → chord dataset — analysis & findings

Companion to [README.md](README.md) (schema) and
[improspira_max/README.md](improspira_max/README.md) (Max/MSP usage).
Built 2026-07-07/08 in the POP909-Dataset repo; full session log in
[SESSION_TRANSCRIPT.md](SESSION_TRANSCRIPT.md).

## What this is

A combined melody/chord corpus for (a) next-chord prediction from 1–8 bar
melody phrases and (b) chord Markov chains, targeted at BreathSync/Improspira
Max for Live devices. Three sources, one schema, `source` column throughout:

| source | corpus | songs | bars | phrases | chord events |
|---|---|---|---|---|---|
| pop909 | POP909 (Chinese pop, MIDI performances) | 906 | 74,661 | 65,612 | 107,296 |
| nottingham | Nottingham Music Database (folk) | 1,018 | 39,503 | 38,482 | 41,890 |
| openbook | OpenBook jazz lead sheets | 152 | 6,738 | 6,586 | 9,029 |
| **total** | | **2,076** | **120,902** | **110,680** | **158,215** |

## Verification results

- **POP909 vs its own MIDI**: for every chord annotation, the
  duration-weighted fraction of accompaniment (PIANO+BRIDGE) note-time on
  chord tones was computed. Median **0.948**; 3/909 songs excluded
  (278, 506: melody passages without chord labels; 605: 0.79 consonance).
- **Melody round-trip**: reconstructing melody from the bar tokens matches
  the source MIDI with 100% pitch accuracy, ≈0 ms median onset error
  (bounded by intentional 16th-note quantization). `verify_midi/` holds
  audible spot-check renders.
- **Nottingham**: chords were verified upstream against ABC symbols
  (49,335/49,337 match); 16/1,034 tunes excluded upstream.
- **OpenBook**: 2/154 canonical lead sheets excluded for melody/chord
  duration mismatches.
- **Symbol conversion**: 0 chord symbols dropped when mapping all three
  vocabularies into the shared `Root:quality` form.

## Key findings — the three corpora have distinct harmonic personalities

All in key-transposed space (tonic → C major / A minor; `chord_t`):

- **nottingham** is nearly deterministic functional harmony:
  `G7 → C` **95.6%**, `E7 → Am` **87.5%**, vocabulary of only 50 symbols.
  A first-order walk already sounds like a folk tune.
- **openbook** is ii–V–I machinery: `Dm7 → G7` **76.6%**,
  `G7 → C/Cmaj7` **67%**, secondary-dominant chains (`D7 → G7`,
  `A7 → Dm7` 58%). Top chords are mostly 7ths; 89-symbol vocabulary.
- **pop909** is diffuse diatonic motion: no transition above 57%
  (`E → Am`, i.e. V-of-vi → vi), probability spread across I/IV/V/vi loops,
  sus2/sus4 color, 157-symbol vocabulary.

Pooled (all sources): `G:7 → C:maj` = 86% of G:7 transitions; top chords
C:maj, G:maj, F:maj, A:min — I, V, IV, vi. This motivated keeping the Markov
tables **nested per corpus** (`markov_chord_t.json` keys: `pop909`,
`openbook`, `nottingham`, `all`) rather than blended: pick a genre's chain,
or weight-blend the sub-dicts in Max.

## Design decisions worth remembering

- **Beat units differ by source** (annotated beat / quarter / meter
  denominator) — consistent within a source; `beats_per_bar` is on every row.
- **Carry-over convention**: a chord sustained across a barline appears at
  `@0` of each bar it covers, in all sources.
- Chord labels are collapsed to base quality in `chords`/`chord`;
  the untouched source spelling lives in `chords_raw`/`raw` (OpenBook
  tensions like `A7b9`, `Cm11`, `B7alt`, slash chords are preserved there —
  2,381 events richer than the simplified forms).
- `transpose_offset` (−5…+6 semitones, in `songs.csv` and each song dict)
  moves the tonic to C/Am; apply to melody pitches to co-normalize, negate
  to return generated chords to the song's key.
- POP909 note velocities are real (re-extracted, verified 0 mismatches);
  openbook/nottingham have no velocity in their sources — constant 100.

## Rebuilding

The build scripts are included here for reference, but they read the source
corpora at their original locations and must be run from
`/Volumes/Mac-Storage/GitHub/POP909-Dataset/melody_chord_dataset/`:

```
python3 build_dataset.py      # POP909 extraction + MIDI verification
python3 build_combined.py     # + OpenBook, Nottingham, transposition
python3 build_max_export.py   # improspira_max/ JSON dicts + Markov tables
```

Source corpora: `/Volumes/Mac-Storage/GitHub/POP909-Dataset`,
`/Users/zacharyscheffler/Desktop/OpenBookDataset`,
`/Volumes/Mac-Storage/GitHub/nottingham-dataset`.
