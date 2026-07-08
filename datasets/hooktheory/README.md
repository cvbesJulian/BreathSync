# Melody → Chord Dataset (Hooktheory / SheetSage)

A melody-and-chord dataset built from the **clean Hooktheory release**
(`Hooktheory.json.gz`) that ships with
[SheetSage](https://github.com/chrisdonahue/sheetsage) — ~26k human-made
TheoryTab lead-sheet annotations of real pop songs. Built for training models
that **predict the next chord from a preceding melody phrase (1–8 bars)**.

It complements [`../melody_chord`](../melody_chord) (POP909 + OpenBook +
Nottingham) — **same schema, same token format**, `source = hooktheory` —
but is simpler at the source: the data is already beat-quantized,
hand-annotated melody + chords, so there is no transcription noise, no
consonance-threshold filtering, and no chord inference.

| | |
|---|---|
| songs included | **22,866** (of 26,175; excluded: 2,342 no melody, 473 key change, 269 meter change, 221 no harmony, 4 other) |
| bars | **261,844** |
| phrases (training examples) | **229,229** |
| chord events | **299,991** |
| chord vocab (root × quality) | 192 |
| splits (from SheetSage) | TRAIN 18,583 · TEST 2,410 · VALID 1,873 |

## Files

| File | What it is |
|---|---|
| `bars.csv` | One row per bar — the core melody/chord data |
| `chord_sequences.csv` | One row per chord event in song order, consecutive duplicates merged; includes key-transposed `chord_t` |
| `phrases.csv` | Ready-made training examples: up to 8 bars of context + `next_chord` / `next_chord_t` targets |
| `songs.csv` | Per-song metadata (key, mode, bpm, transpose offset, split, consonance/coverage scores, inclusion + reason) |
| `verify_report.json` | Results of verifying our extraction against SheetSage's reference MIDIs |
| `verify_midi/` | Reconstructed melody+chord MIDIs for 5 songs (spread across the consonance range) — listen to spot-check |
| `build_stats.json` | Build summary |
| `build_hooktheory.py` | The build script |

To rebuild: `python3 build_hooktheory.py [Hooktheory.json.gz] [Hooktheory_Test_MIDI.tar.gz]`
(defaults to `~/Downloads/`; both files come from the
[sheetsage-data](https://github.com/chrisdonahue/sheetsage-data) release).

## Token format (identical to ../melody_chord)

All positions/durations are in **beats relative to the bar start**; a beat is
the meter's beat unit (`beats_per_bar` = 4 for 4/4, 6 for 6/8, …).

**Melody** (`midi` column): space-separated `pitch_onset_duration` tokens,
`-` for an empty bar. Pitch follows the SheetSage convention
`60 + 12·octave + pitch_class` (octave 0 ⇒ C4=60).

```
71_1_1 69_2_1 64_3_0.5 66_3.5_1.5     # B4 on beat 2, A4, E4, F#4
```

**Chords** (`chords` column): space-separated `Root:quality@onset` tokens;
a chord carried over from a previous bar appears at `@0`. Roots use the 12
canonical spellings (C, Db, D, Eb, E, F, F#, G, Ab, A, Bb, B). Qualities are
collapsed from Hooktheory's interval stacks to the shared base vocabulary:
maj, min, 7, min7, maj7, sus4, sus2, dim, hdim7, dim7, aug, maj6, min6,
minmaj7, 5, 1 (extensions beyond the 7th are dropped — a 9th/11th chord
becomes its base 7th chord). `chords_raw` keeps the uncollapsed label,
including inversions (`.../1`) and unmapped interval stacks.

In multi-bar strings (`phrases.csv`), bars are joined with `" | "`.

**Key transposition** (`chord_t`, `next_chord_t`): chord roots shifted by
`transpose_offset` so the song's tonic becomes C (mode preserved — D:maj
key ⇒ G:maj → F:maj).

## Clean-data filtering

Starting from the clean release (`Hooktheory.json.gz`, *not*
`Hooktheory_Raw`), a song is included iff it has both `MELODY` and `HARMONY`
annotations, a single meter starting at beat 0, and a single key starting at
beat 0. Songs with key/meter changes are excluded (see `songs.csv` →
`included`, `reason`) to keep every song a fixed `beats_per_bar` grid with
one global transposition. Swing songs are kept (beat-domain positions are
unaffected). `chord_consonance` (fraction of chord-covered melody time on a
chord tone) and `melody_chord_coverage` are reported for reference but not
used to filter — the annotations are human-made.

## Verification against the reference MIDI

`build_hooktheory.py` verifies our beat-domain melody extraction against the
1,479 reference melody MIDIs in `Hooktheory_Test_MIDI.tar.gz` (rendered by
SheetSage in the *time* domain via each song's refined beat→time alignment).
For every TEST song present in both (1,443):

- **1,442 / 1,443 songs: exact pitch-sequence match**
- **1,442 / 1,442 of those: onset timing matches within 0.234 ms** (after
  mapping our beat onsets through the refined alignment with linear
  extrapolation, exactly as SheetSage does)
- The single mismatch (`nLgaXYn_mYp`) is a **stale file in the upstream
  archive**: its reference MIDI contains a different, older melody (22 notes)
  than the current JSON annotation (33 notes). Our extraction matches the
  JSON, which is the source of truth.

`verify_midi/` additionally contains listenable melody+chord reconstructions
built purely from the dataset rows.
