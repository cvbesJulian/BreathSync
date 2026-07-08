# BreathSync Chord

ML **next-chord comping** for the BreathSync Listen analyzer. Listens to the
melody you play, and at each beat asks the trained next-chord model (running in
a sibling `node.script`) what chord should happen next — then realizes and
voice-leads it to MIDI. Max owns beat timing; the model owns the harmonic move;
this device owns realization + voicing.

```
Listen (audio) ──bs.harmony.bus1──► bs.chord.js ──predict json──► node.script (ONNX)
                 lead / state                    ◄──modelchord───   nextchord.node.js
                                                       │
                                    realize (Complexity) + voice-lead ──► MIDI out
```

## What it does

- **Buffers melody** from the bus `lead <midi> <conf>` events, beat-stamped off
  the Live transport.
- **Maps the bus key → the model's `transposeOffset`** (tonic → C major /
  A minor, range −5..6; verified against all 152 training songs).
- **Predicts on the beat grid**: at each integer beat it sends the recent melody
  window (transposed to model space, only notes with `onset < t`) plus context
  (previous chord, hypermeter, grid position) to the node, which returns the
  chosen key-relative chord class.
- **Realizes + voices** the returned chord: the Complexity knob adds the 7th
  then the 9th; voicing diffs against the held chord so common tones sustain
  (refcounted, same engine as BreathSync Follow).
- **Engage gating**: listens N bars before it starts comping (like Follow).

## Files

| file | role |
|---|---|
| `bs.chord.js` | the `v8` device script (this folder). |
| `../../ml/next_chord/deploy/nextchord.node.js` | the `node.script` model server. |
| `../test/chord.harness.mjs` | headless test: drives `bs.chord.js` against the **real** ONNX model (23 checks). |

The model + configs live in `ml/next_chord/artifacts/` and are loaded by the
node at runtime; retrain → re-export updates the device with no code changes.

## Knobs (wire these widgets in the .maxpat)

`active` (toggle) · `complexity` 0–1 (triad → 7th → 9th) · `freedom` 0–1
(model softmax temperature) · `wlenbars` (melody window) · `vel` · `channel` ·
`chordoct` · `waitbars` (bars to listen before comping).

## Building the patcher (must be done in Max 9 / Live 12.2+)

The `.maxpat` and `.amxd` are authored in Max and are not checked in (binary).
Build a **MIDI-effect** device with:

- `v8 bs.chord.js @autowatch 0` — inlet 0, three outlets.
- `node.script nextchord.node.js @autostart 1` — its output routes back to the
  v8 inlet (the `modelchord` / `top` messages).
- `[receive bs.harmony.bus1]` → `route state lead chord hello` → v8 inlet
  (consumes `state` + `lead`; `chord`/`hello` are ignored by design).
- v8 **outlet 2** (`predict …`) → `node.script` inlet.
- v8 **outlet 0** (raw MIDI) → `[midiout]` (optionally `[iter]`→`[midiflush]`
  as in Follow, to avoid hung notes).
- v8 **outlet 1** (displays) → your UI `status` / `chord` / `key` fields.
- `[live.thisdevice]` → `[t b]` → `init` message into v8 (LiveAPI is only legal
  after device init).
- `[metro 20]` (gated by transport) → `watchdog` into v8 (beat detection +
  staleness). Param widgets send their named messages (`complexity $1`, etc.).

Requires Live 12.2+ (Max 9 `v8` + Node for Max). In `ml/next_chord/deploy/`,
run `npm install` once so `node.script` can load `onnxruntime-node`.

## Verify (headless, no Max needed)

```bash
cd ml/next_chord/deploy && npm install
node ../../../max4live/test/chord.harness.mjs   # ALL 23 CHECKS PASSED
```

This drives `bs.chord.js` (compiled with Max stubs) through the real
`chord_service.respond()` + `onnxruntime-node`, i.e. the whole Max-side → model
→ MIDI path. Only the in-Max patcher/Ableton wiring is unverifiable outside Max.
