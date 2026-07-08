# Improspira Max export — full-fidelity melody/chord dicts

The complete combined dataset (POP909 + OpenBook + Nottingham, 2,076 songs)
as one JSON dict per song, designed for Max/MSP `[dict]` and Max for Live
devices. Same bar/beat semantics as the parent CSVs, with the features the
flat CSVs drop restored:

- **note velocities** — real MIDI velocities for `pop909`; constant `100`
  for `openbook`/`nottingham` (lead sheets and ABC have no velocity)
- **full chord symbols** — OpenBook tensions/alterations/slash chords kept
  in `raw` (`A7b9`, `Cm11`, `B7alt`, `Dm/C`, ...) instead of the simplified CSV forms
- **titles / artists / styles** and per-song key, mode, bpm
- **per-bar `next_chord` targets** and key-transposed labels inline

Rebuild with `python3 ../build_max_export.py` (after the two parent builds).

## Files

| File | What it is |
|---|---|
| `songs/<source>.<song_id>.json` | One dict per song (2,076 files) |
| `index.json` | Catalogue: `{songs: [{file, source, title, artist, style, key, mode, transpose_offset, bpm, beats_per_bar, n_bars}]}` — feed a `umenu`/browser |
| `markov_chord_t.json` | First-order transition **counts**, key-transposed (tonic → C/Am), **nested per corpus**: `{ "pop909": {...}, "openbook": {...}, "nottingham": {...}, "all": { "G:7": { "C:maj": 7925, ... } } }` — pick a genre's chain or the pooled one, renormalize or temper in Max |
| `markov_chord.json` | Same with absolute roots |

## Song dict schema

```json
{
  "source": "pop909", "song_id": "029",
  "title": "一直很安静", "artist": "阿桑", "style": "pop",
  "key": "Bb:maj", "mode": "maj", "transpose_offset": 2, "bpm": 110.0,
  "beats_per_bar": 4, "n_bars": 110,
  "bars": [
    { "bar": 13, "beats_per_bar": 4,
      "notes":  [[74, 1.0, 0.75, 79], ...],
      "chords": [{"label": "F:sus4", "raw": "F:sus4", "t": "G:sus4", "onset": 0.0}, ...],
      "next_chord": "F:maj", "next_chord_t": "G:maj" },
    ...
  ],
  "chord_sequence": [
    {"chord": "F:maj", "raw": "F:maj", "t": "G:maj", "bar": 2, "beat": 0.0, "dur": 4.0},
    ...
  ]
}
```

- `notes`: `[pitch, onset, duration, velocity]` — onset/duration in **beats
  from the bar start** (a beat = annotated beat for pop909, quarter note for
  openbook, meter denominator for nottingham; a 6/8 bar has 6 beats).
- `chords[].label`: canonical `Root:quality` (shared 163-symbol vocabulary);
  `raw`: as annotated in the source; `t`: transposed so the tonic is C
  (major) or A (minor) — add `transpose_offset` semitones to any pitch to
  move the melody into the same normalized key.
- `chord_sequence`: the song's chords in order with repeats merged —
  drive a Markov walk or display a chord timeline without touching `bars`.
- `next_chord` is `null` on a bar when the following bar has no chord
  (or it's the last bar).

## Using it in Max

- Load a song: `[dict improspira]` + message `read songs/pop909.029.json`,
  or `dict.deserialize` from `[js]`.
- Browse: read `index.json` once, fill a `umenu` from `songs[i].title`,
  and `read` the chosen `file`.
- Iterate bars/notes in `[js]`:

```js
var d = new Dict("improspira");
var song = JSON.parse(d.stringify());
song.bars.forEach(function (bar) {
  bar.notes.forEach(function (n) {   // [pitch, onset, dur, vel]
    // schedule: makenote n[0] n[3], at bar.bar * bar.beats_per_bar + n[1]
  });
});
```

- Markov next-chord: load `markov_chord_t.json` into a `[dict]`, descend
  into the corpus you want (`pop909`, `openbook`, `nottingham`, or `all`),
  get the sub-dict for the current chord, and sample proportionally to the
  counts (or take the max for the "most likely" continuation). Symbols are
  key-normalized, so transpose your output by `-transpose_offset` to get
  back to the song's key. Blending genres is just a weighted sum of the
  corpus sub-dicts before sampling.
