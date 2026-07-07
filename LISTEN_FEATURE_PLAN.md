# BreathSync — Instrument Listening Feature Plan

Branch: `midi-input`

## Goal

Today BreathSync is **output-only**: it generates chords/melody from a fixed scale
(`MIDI_CONSONANT_SCALE`) colored by "temperature", then renders them to Web Audio
synthesis and to MIDI-out (IAC → Ableton). This feature adds an **input feedback loop**:
capture another instrument's signal, analyze it in real time, and get a sense of the
**harmony (key/chord)** and **melody (contour/lead note)** coming from that instrument.

## Locked decisions

- **Input source: audio in** (`getUserMedia` + Web Audio DSP), not MIDI in.
  - Works with any acoustic/line instrument via mic or an audio-interface input.
- **Scope for now: analyze & display only.** Do NOT change BreathSync's own generation
  (audio synth, MIDI-out, breath scheduling) yet. This phase is about reading and
  visualizing what the external instrument is playing.
- **No dependencies.** Vanilla JS + Web Audio only, matching the rest of the project
  (no React/npm/bundlers), per `AGENT_HANDOFF.md`.

## Architecture

- **Dedicated page** `listen.html` / `listen.css` / `listen.js`, mirroring the
  `midi-permission.*` pattern (self-contained, vanilla, Aesop styling, dark-mode aware).
- **Popup entry point**: a `Listen / analyze instrument` button opens `listen.html`
  in a tab via `chrome.runtime.getURL` + `chrome.tabs.create` (`openListenPage()` in
  `popup.js`).
- **Capture chain**: `getUserMedia({audio})` → `MediaStreamAudioSourceNode` →
  `AnalyserNode` → analysis loop.
- **MV3 notes**:
  - Extension pages are secure contexts, so mic `getUserMedia` uses Chrome's standard
    permission prompt — no new `manifest.json` permission key required.
  - AGC / noise-suppression / echo-cancellation are disabled so the instrument signal
    is not mangled.

## Shared data contract (forward-looking)

A future generation phase would consume a compact `harmonyState` object:

```json
{
  "key": "D", "mode": "minor",
  "scalePitchClasses": [2,4,5,7,9,10,0],
  "chordRoot": "A", "chordQuality": "min", "chordPitchClasses": [9,0,4],
  "leadNote": 74, "density": 2.3,
  "confidence": 0.81, "updatedAt": 1720000000000
}
```

As of Phase 3 this object is assembled live and written **throttled (min 250 ms
between writes, on-change plus a ~1 s refresh)** to `chrome.storage.local` under
`breathsyncHarmonyState` (never per-frame — respects the anti-flooding warnings in
`AGENT_HANDOFF.md`). Nothing reads it to change sound yet; it is the inert hook for a
future generation phase.

## Feedback-loop safety (relevant once generation reacts)

If BreathSync ever both sends to and listens from the same rig, guard against runaway:
- Separate bus/channel for the return path.
- Self-note rejection (ignore what BreathSync itself produced).
- Confidence hysteresis + rate-limited adaptation.

## Phases

### Phase 0 — Capture (DONE)

- `listen.html` / `listen.css` / `listen.js` created.
- Start / Stop listening via `getUserMedia`.
- Audio input device picker (`enumerateDevices`), persisted to
  `breathsyncListenInputDevice`; live re-acquire on device change; Rescan inputs.
- Live input-level meter (RMS via `AnalyserNode.getFloatTimeDomainData`, rAF loop).
- Clean teardown (stop tracks, disconnect nodes, close context, cancel rAF, unload).
- Popup `Listen / analyze instrument` button + `openListenPage()`.

### Phase 1 — Melody / monophonic pitch (DONE)

- `autoCorrelate()` time-domain pitch detector: RMS gate, edge-trimming, correlation
  scan, first-dip skip, parabolic interpolation; frequency clamp 40–4200 Hz.
- `describePitch()` → note name + octave + cents.
- 2048-sample window; pitch detection throttled to ~60 ms; meter still per-frame.
- Median-of-5 smoothing + silence counter to avoid flicker / hallucinated notes.
- UI: large note + octave, frequency in Hz, tuning needle (green within ±5 cents),
  cents text readout.

### Phase 2 — Harmony (chord + key) (DONE)

- FFT window bumped to 8192 (`getFloatFrequencyData`) for ~5.4 Hz bin resolution;
  monophonic autocorrelation still runs on the first 2048 samples to stay cheap.
- FFT magnitude (dB→linear) folded into a **12-bin chroma vector** across ~55–5000 Hz,
  with two EMAs: a fast copy (chords) and a slow copy (key).
- **Chord**: cosine-similarity match of the fast chroma against templates
  (maj/min/dim/aug/sus2/sus4/maj7/min7/dom7) at all 12 roots → root + quality +
  confidence, with a 2-frame commit hysteresis and a min-confidence threshold.
- **Key + mode**: **Krumhansl–Schmuckler** — Pearson-correlate the slow chroma against
  the 24 major/minor key profiles; updated on a slower (~550 ms) cadence.
- RMS noise gate clears chord/key on silence.
- 12-bar chroma visualization with peak highlighting.

### Phase 3 — Polish / contract (DONE)

- Confidence gating: chord and key render as **tentative** (dimmed/italic + "· tentative"
  label) when below a strong-confidence threshold instead of asserting them.
- Lead-note tracking + note-onset **density** (notes/sec over a 4 s window).
- Assembles the `harmonyState` object (key/mode, scale pitch-classes, chord root/quality,
  chord pitch-classes, lead note, density, confidence, timestamp) and writes it throttled
  to `chrome.storage.local` under `breathsyncHarmonyState` (min 250 ms, on-change + ~1 s
  refresh). Writes an idle/zeroed state on silence/stop. Still inert — no consumers yet.

### Future — Follow external harmony (not scheduled)

- Make BreathSync's scale/chord/lead helpers key-aware and consume `breathsyncHarmonyState`
  so generation harmonizes with the external instrument, gated by a toggle + strength
  slider, with feedback-loop safety. Explicitly out of scope for the analyze-only track.
- Full design lives in `FOLLOW_HARMONY_PLAN.md`.

## Files

- New: `listen.html`, `listen.css`, `listen.js`, `LISTEN_FEATURE_PLAN.md`.
- Edited: `popup.html` (button), `popup.js` (ref + `openListenPage()` + listener).
- `manifest.json`: unchanged (no permission needed for `getUserMedia` from an
  extension page); revisit only if verification proves otherwise.

## Verification

```sh
node --check listen.js
node --check popup.js
python3 -m json.tool manifest.json
```

Manual: reload unpacked extension → popup → Listen / analyze instrument → Start
listening → approve mic → play instrument. Confirm meter reacts (Phase 0) and single
notes show name/octave/Hz/cents (Phase 1).
