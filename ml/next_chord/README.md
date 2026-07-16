# next_chord — melody → next-chord prediction (OpenBook / jazz)

Given the melody a performer just played (half-bar to 4 bars), predict **what
chord should happen next** — one-step symbolic prediction, not full
harmonization. A small theory-constrained Transformer outputs a distribution
over **key-relative jazz chord classes** (+ HOLD); a rule-based reranker then
picks the move that fits the melody and the harmonic context. Realization
(which 7th/9th/tension) and voicing are left to later layers, exactly like the
Improspira Complexity knob.

Trained **only on the OpenBook** jazz lead-sheet corpus (152 standards) —
chosen over Nottingham because jazz harmony (ii–V–I, secondary dominants,
tritone subs, half-diminished ii-of-minor) is the interesting problem.

## Results (test split, 15 held-out songs, 2,516 decisions)

| model | top1 | top3 | nll | macroF1 | change_top1 | hold_f1 |
|---|---|---|---|---|---|---|
| Markov (melody-blind floor) | 0.621 | 0.847 | 1.460 | 0.021 | 0.009 | 0.766 |
| Transformer (melody-masked) | 0.695 | 0.829 | 1.430 | 0.121 | 0.218 | 0.835 |
| BiGRU baseline | 0.735 | 0.836 | 1.195 | 0.164 | 0.362 | 0.874 |
| **Transformer** | 0.735 | 0.840 | 1.197 | 0.174 | 0.377 | 0.881 |
| **Transformer + reranker** | 0.740 | — | — | 0.180 | 0.382 | 0.881 |

`change_top1` (accuracy on beats where the chord actually changes) is the
honest harmonic metric — overall `top1` is inflated by HOLD (≈62% of beats).
**Go/no-go: melody helps** — masking the melody drops change-accuracy from
0.377 → 0.218, so the melody accounts for ~40% of the model's correct chord
changes. The reranker emits a hard top-1 (no distribution), so its top3/nll
cells are blank. Full report:
[artifacts/reports/eval_test.md](artifacts/reports/eval_test.md).

## Pop corpus — Hooktheory (same pipeline, larger + simpler data)

The identical melody-conditioned pipeline also trains on the
[Hooktheory / SheetSage](../../datasets/hooktheory) corpus — **22,866**
hand-annotated pop lead sheets (18,583 / 1,873 / 2,410 train/val/test, the
upstream SheetSage split), ~150× more songs than OpenBook. A CSV loader
([data_hooktheory.py](nextchord/data_hooktheory.py)) parses that dataset's
per-bar melody/chord tokens into the same `Song`/`Note`/`DecisionPoint`
structures, transposing to the shared C-major / A-minor space (Hooktheory's
finer scale modes are collapsed to maj/min); everything downstream —
decision grid, windows, features, model — is unchanged. Vocab is rebuilt from
this corpus: **76 classes** (`(root × family)`, ≥40 in train → 99.8% coverage)
vs OpenBook's jazz 42.

### Results (test split, 2,410 songs, 115,949 decisions, 25.7% changes)

| model | top1 | top3 | nll | change_top1 | hold_f1 |
|---|---|---|---|---|---|
| Prev-chord floor (melody-blind) | 0.751 | 0.873 | 1.178 | 0.030 | 0.863 |
| Transformer (melody-masked) | 0.770 | 0.881 | 1.241 | 0.150 | 0.885 |
| **Transformer (melody)** | 0.748 | 0.884 | 1.206 | **0.233** | 0.884 |

**Go/no-go: melody helps** — on `change_top1` (the honest metric; overall
`top1` is inflated by HOLD, ~74% of pop beats) the melody model scores **0.233**
vs **0.150** masked (**+0.083**) and **0.030** for the prev-chord floor
(**+0.202**). Overall `top1` is a touch lower for the melody model than the
masked one because the masked model leans harder on HOLD — the same trade the
OpenBook jazz model shows. Absolute change-accuracy is below the jazz model
(0.377): pop harmony over a bigger vocab is more one-to-many from a short
melody, and this is a small (432K-param) untuned model. Report:
[artifacts/hooktheory/reports/eval_test.md](artifacts/hooktheory/reports/eval_test.md).

### Reproduce

```bash
cd ml/next_chord
.venv/bin/python scripts/build_hooktheory_splits.py   # -> artifacts/hooktheory/splits.json
.venv/bin/python scripts/build_hooktheory_vocab.py    # -> artifacts/hooktheory/vocab.json (99.8%)
.venv/bin/python -m nextchord.train --model transformer --config configs/hooktheory.json
.venv/bin/python scripts/eval_hooktheory.py --split test
.venv/bin/python scripts/export_hooktheory_onnx.py   # -> artifacts/hooktheory/onnx/ (+ parity, max|diff| < 1e-4)
```

The exporter writes `artifacts/hooktheory/onnx/{model.onnx, model_config.json}`
in the identical graph/sidecar contract as the OpenBook export, so the same
Node-for-Max deploy code reads it unchanged (bucketing stays outside the graph;
the sidecar carries the 76-class pop vocab + roman/function maps).

## Architecture

```
melody window + context  ->  Embedder  ->  3-layer Transformer encoder  ->  CLS
                                                                             |
                                          chord head (42 classes) + T/PD/D head
                                                                             |
                                     top-k  ->  theory reranker  ->  chosen chord
                                                                             |
                                     roman + absolute (via -transpose_offset)
```

- **Classes (42):** `(transposed root × quality-family)` where family ∈
  {MAJ, DOM, MIN, HDIM, DIM, AUG, SUS}, so `Cmaj7`=I, `C7`=V/IV, `Dm7`=ii and
  `Bø7`=viiø stay distinct. Data-driven (≥20 occurrences in train → 98% coverage),
  frozen to [artifacts/vocab.json](artifacts/vocab.json). Plus HOLD and OTHER.
- **Decision grid:** beat-level. Every real chord onset is a change decision;
  integer beats with no onset are HOLD. Jazz changes constantly (downbeat
  hold-rate ~14%), so this matches how the device will query.
- **Inputs:** per-note tokens (tonic-relative pitch class, octave, beats-before-t,
  duration, metric phase, downbeat flag, bar offset) + global tokens (mode,
  meter, previous chord class, previous T/PD/D function, window length,
  hypermeter position, grid position). No future-melody leakage: the window for
  a decision at beat `t` holds only notes with `onset < t`.
- **Reranker:** `score = logp_model + α·melody_fit + β·log T_func[f_prev→f] − δ·clash`
  (γ·Markov dropped by tuning — it duplicated the model and biased toward HOLD).
  Constants in [artifacts/reranker_config.json](artifacts/reranker_config.json);
  `freedom` knob wired (softmax temperature), tension/complexity/evolution stubbed.

## Layout

```
nextchord/
  vocab.py      data-driven class vocab, roman/function/pcs helpers
  data.py       OpenBook JSON + songs.csv loading; beat-grid decision extraction
  windows.py    window sampling, leakage-guarded note gathering, augmentation
  features.py   tokenization — single source of truth, exported to model_config.json
  dataset.py    torch Dataset + padded/masked collate
  model.py      NextChordTransformer + BiGRUBaseline (shared Embedder)
  markov.py     first-order melody-blind baseline (train-split only)
  rerank.py     theory reranker (pure, config-driven)
  calibrate.py  temperature scaling on val
  train.py evaluate.py export_onnx.py demo.py   (CLIs, run via -m)
scripts/  make_splits.py  build_vocab.py  tune_reranker.py  make_test_vectors.py
artifacts/ splits.json vocab.json reranker_config.json test_vectors.json
           reports/  onnx/{model.onnx, model_config.json}   (checkpoints/ gitignored)
tests/    test_vocab / test_windows / test_no_leakage / test_rerank_vectors
```

## Reproduce end-to-end

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cd ml/next_chord            # run from here
.venv/bin/python scripts/make_splits.py          # -> splits.json
.venv/bin/python scripts/build_vocab.py          # -> vocab.json (98% coverage)
.venv/bin/python -m nextchord.train --model transformer
.venv/bin/python -m nextchord.train --model bigru
.venv/bin/python -m nextchord.calibrate --model transformer
.venv/bin/python scripts/tune_reranker.py        # tunes on val, freezes reranker_config.json
.venv/bin/python scripts/make_test_vectors.py    # freezes JS-parity golden vectors
.venv/bin/python -m nextchord.evaluate --split test
.venv/bin/python -m nextchord.export_onnx        # + parity check (max|diff| < 1e-4)
.venv/bin/python -m pytest tests/ -q
```

Demo:

```bash
.venv/bin/python -m nextchord.demo replay --song afternoon_in_paris --bar 8
.venv/bin/python -m nextchord.demo adhoc --notes "E4@-2:1,G4@-1:0.5,A4@-0.5:0.5" \
    --mode maj --meter 4 --prev-chord D:min7
```

## Deployment — Node for Max (`deploy/`)

The inference core is ported to JS and **verified bit-for-bit against Python**
(`deploy/test_parity.mjs` — 245 checks: feature encoding, `onnxruntime-node`
logits within 1e-3, reranker, and live melody-context derivation). `export_onnx.py`
writes `artifacts/onnx/model.onnx` + `model_config.json` (full feature spec, vocab,
roman/function maps, query contract); the JS side reads those directly, so
retrain → re-export updates the device with no code changes.

```bash
cd deploy && npm install && node test_parity.mjs   # PASS: 245 checks
```

`deploy/nextchord.node.js` is the `node.script` entry (Max owns beat timing and
Ableton sync; the node answers `predict` requests). See
[deploy/README.md](deploy/README.md) for the message protocol and patch wiring.
Only the in-Max patcher/Ableton wiring remains unverifiable outside Max.
