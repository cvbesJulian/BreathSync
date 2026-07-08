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
| `BreathSync Chord.amxd` | the built Max for Live device (MIDI effect; `bs.chord.js` embedded). |
| `bs.chord.maxpat` | the patcher source (JSON) — open/edit in Max, re-save as usual. |
| `bs.chord.js` | the `v8` device script. |
| `build_chord_maxpat.py` | regenerates `bs.chord.maxpat` from scratch. |
| `../../ml/next_chord/deploy/nextchord.node.js` | the `node.script` model server. |
| `../test/chord.harness.mjs` | headless test: drives `bs.chord.js` against the **real** ONNX model (23 checks). |

The model + configs live in `ml/next_chord/artifacts/` and are loaded by the
node at runtime; retrain → re-export updates the device with no code changes.

## Rebuild the device

```bash
cd max4live
python3 "BreathSync Chord/build_chord_maxpat.py"          # -> bs.chord.maxpat
python3 build_amxd.py "BreathSync Chord/bs.chord.maxpat" \
        "BreathSync Chord/BreathSync Chord.amxd" \
        --type midi --embed "BreathSync Chord/bs.chord.js"
```

`build_amxd.py` embeds the v8 script and validates the patch graph
(inlet/outlet bounds, unique parameter names, presentation rects). The `.amxd`
is a 32-byte chunk header + the patcher JSON, so it round-trips cleanly.

## Patch topology (already wired in `bs.chord.maxpat`)

- `v8 bs.chord.js @autowatch 0 @embed 1` — inlet 0, three outlets (MIDI /
  displays / predict).
- `node.script nextchord.node.js @autostart 1` — output wired back to the v8
  inlet (`modelchord` reply).
- `[receive bs.harmony.bus1]` → `[route state lead chord hello]` →
  `[prepend state]`/`[prepend lead]` → v8 (`chord`/`hello` ignored by design).
- v8 **outlet 2** (`predict …`) → `node.script` inlet.
- v8 **outlet 0** (MIDI list) → `[iter]` → `[midiflush]` → `[midiout]`;
  `[midiin]` → `[midiout]` passthrough.
- v8 **outlet 1** (displays) → `[route status chord key]` → UI message boxes.
- `[live.thisdevice]` → `[t b b]` → `init` (before) + `[1]`→`[metro 20]`→
  `watchdog` (beat detection). `live.thisdevice` outlet 1 → `enabled $1`.
- Presentation controls send named messages: `active/complexity/freedom/`
  `wlenbars/vel/chordoct/waitbars/channel $1`, `panic`.

## Install in Live (Live 12.2+ / Max 9)

1. Drop `BreathSync Chord.amxd` on a **MIDI track**, after a **BreathSync
   Listen** device feeding the same harmony bus.
2. `node.script` loads `nextchord.node.js` from `ml/next_chord/deploy/`. Run
   `npm install` there once (for `onnxruntime-node`), then add that folder to
   **Options → File Preferences → (Max) search path** so Max resolves the
   script + its `node_modules` — or copy the `deploy/` contents beside the device.

## Verify (headless, no Max needed)

```bash
cd ml/next_chord/deploy && npm install
node ../../../max4live/test/chord.harness.mjs   # ALL 23 CHECKS PASSED
```

This drives `bs.chord.js` (compiled with Max stubs) through the real
`chord_service.respond()` + `onnxruntime-node`, i.e. the whole Max-side → model
→ MIDI path. The `.amxd` builds and validates via `build_amxd.py`; the one thing
not exercisable outside Ableton is opening the device in Live itself.
