# next_chord — Node for Max deployment

Runs the trained next-chord model **locally inside Ableton/Max** via Node for
Max + `onnxruntime-node`, with a JS reranker that is **bit-for-bit identical to
the Python reference** (`test_parity.mjs` verifies encoder, ONNX logits, and
reranker against frozen fixtures).

## Files

| file | role |
|---|---|
| `features.js` | JS port of `nextchord/features.py` — tokenization, driven by `model_config.json`. |
| `vocab.js` | class ↔ roman/function/pitch-classes/absolute-name (from `model_config.json`). |
| `rerank.js` | JS port of `nextchord/rerank.py` — theory reranker (from `reranker_config.json`). |
| `predict.js` | `encode → onnxruntime-node → calibrate → rerank → chord`; also `melodyContext()`. |
| `nextchord.node.js` | `node.script` entry — loads the model, answers `predict` requests. |
| `test_parity.mjs` | headless parity harness (245 checks). |

All model-specific numbers come from the selected corpus's `model_config.json`,
the shared `../artifacts/reranker_config.json`, and that corpus's `model.onnx` —
retrain in `ml/next_chord/` and re-export to update the device with no code changes.

### Selecting a corpus

The device loads OpenBook (jazz) by default. Set `NEXTCHORD_CORPUS` to load a
different exported model from `../artifacts/<corpus>/onnx/` instead — the code is
identical; only the frozen artifacts differ (the sidecar carries that corpus's
vocab, roman/function maps, and calibration T).

| `NEXTCHORD_CORPUS` | model | artifacts |
|---|---|---|
| _(unset)_ | OpenBook jazz | `../artifacts/onnx/` |
| `hooktheory` | Hooktheory pop (76-class) | `../artifacts/hooktheory/onnx/` |

Each corpus can carry its own tuned reranker at
`../artifacts/<corpus>/reranker_config.json` (loaded automatically when present,
else the shared `../artifacts/reranker_config.json`). Pop ships a tuned one
(`hooktheory`: α0 β0.25 γ0 δ0.25); note the reranker barely moves pop metrics
(change_top1 +0.002 on val — the model is already near the reranker's ceiling).
The accuracy-optimal δ is 0, but pop keeps a deliberate small **δ=0.25 clash
guard for musical safety** — it only nudges off strong-beat semitone clashes on
near-ties (never overriding a confident pick), at a change_top1 cost within noise.
γ is fixed at 0 for any deployed reranker: the device supplies no Markov
distribution, so only γ=0 configs rank identically in Python and on the device.

## Setup & verify (no Max needed)

```bash
cd ml/next_chord/deploy
npm install                 # onnxruntime-node
node test_parity.mjs                          # OpenBook -> "PASS: 245 checks ..."
NEXTCHORD_CORPUS=hooktheory node test_parity.mjs   # pop -> "PASS: 245 checks ..."
```

The harness proves the JS pipeline matches Python (paths below are relative to
the selected corpus dir — top-level for OpenBook, `artifacts/hooktheory/` for pop):
- **A** reranker golden vectors (`test_vectors.json`),
- **B** feature encoding, bit-exact (`parity_fixtures.json`),
- **C/melodyContext** window/strong pitch-class derivation,
- **D** full `onnxruntime-node` logits (max|Δ| < 1e-3) + end-to-end chosen chord.

Regenerate fixtures after retraining (add `--config configs/hooktheory.json` for
pop): `scripts/make_parity_fixtures.py` and `scripts/make_test_vectors.py` in
`ml/next_chord/`.

## Message protocol (Max ⇄ node.script)

Max collects notes and owns beat timing, then sends one `predict` message with a
JSON dict at each query point (downbeat / integer beat):

```
predict { "notes": [[pitch, onset, dur, onsetInBar, beatsPerBar], ...],
          "t": <decision beat>, "mode": "maj"|"min", "meter": 4,
          "prevClass": <id>, "prevFunc": <0..3|4=BOS>, "wlenBars": 2.0,
          "hyper": <bar#-of-t mod 8>, "grid": <0 downbeat|1 midbar>,
          "soundingClass": <id>, "transposeOffset": <semitones>,
          "freedom": 0.0 }
```

`onset` is in absolute beats (same clock as `t`); the node derives the reranker's
melody context itself. Reply on the outlet:

```
chord    <classId> <roman> <absName>      e.g.  chord 2 V7 G7
chordpcs <pc> <pc> <pc> ...               transposed-space pitch classes
top      <classId> <prob> ... (top 5)     for a UI / debugging
```

## Wiring into the device

`node.script nextchord.node.js` runs as a separate process (async). Suggested
graph, reusing the existing BreathSync harmony bus (see `../../max4live/PROTOCOL.md`):

```
BreathSync Listen  ── key/mode/leadNote on the harmony bus ─┐
                                                            │
Max (JS/gen):  buffer melody notes, detect beat boundary,   │
               map bus key -> transposeOffset, track prev   │
               chord + hypermeter  ──── predict {json} ────► node.script
                                                            │
               chord <id> <roman> ... ◄────────────────────┘
                                                            │
               realize (Complexity knob: add 7/9/tension)  │
               -> voice-lead -> schedule MIDI at next beat ─► midiout
```

- **Vocabulary is functional, not literal**: a class like `V7`/`G7` names the
  harmonic *move*; the Complexity layer decides `G` vs `G7` vs `G9`/`G13alt`,
  and voice-leading decides the actual notes (as in the Improspira design).
- **transposeOffset** converts the model's C-relative (maj) / A-relative (min)
  classes back to the sounding key: `absRoot = (classRoot − transposeOffset) mod 12`.
- **Query contract**: query only at beat gridpoints (the model was trained on
  downbeats + integer beats); off-grid HOLD behavior is uncalibrated.
- **Latency**: one forward pass of a 0.42M-param model over ≤64 tokens is well
  under a millisecond; still call it a beat ahead and schedule on the boundary,
  since `node.script` messaging is asynchronous.
- **Knobs**: `freedom` is live (softmax temperature). Tension/Complexity/
  Evolution act on the realization/voicing layers downstream, not on the model.
