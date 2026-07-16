# next_chord — melody → next-chord prediction (OpenBook / jazz)

Given the melody a performer just played (half-bar to 4 bars), predict **what
chord should happen next** — one-step symbolic prediction, not full
harmonization. A small theory-constrained Transformer outputs a distribution
over **key-relative jazz chord classes** (+ HOLD); a rule-based reranker then
picks the move that fits the melody and the harmonic context. Realization
(which 7th/9th/tension) and voicing are left to later layers, exactly like the
Improspira Complexity knob.

The original (v1) model was trained **only on the OpenBook** jazz lead-sheet
corpus (152 standards) — chosen because jazz harmony (ii–V–I, secondary
dominants, tritone subs, half-diminished ii-of-minor) is the interesting
problem. The **deployed model is now the combined POP909 + Nottingham +
OpenBook model** (see the Combined-corpus section below), which beats v1 on
the same held-out jazz songs and adds a genre knob.

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

## Combined corpus — POP909 + Nottingham + OpenBook (the deployed model)

One SOURCE-conditioned model trained on all three corpora of
[datasets/melody_chord](../../datasets/melody_chord): **2,076 songs**, 171,374
train decisions (**124,578 real chord changes** — ~50× OpenBook alone). A 9th
global token carries the corpus; **10% source-dropout** during training makes
id 0 a genuine "genre unknown" input, exposed on the device as the **Genre
menu (Auto / Pop / Folk / Jazz)**. The vocab is refit on the combined train
split — **68 classes** (≥20 occurrences), ≥99.6% coverage per corpus, all the
jazz HDIM/DOM/DIM classes intact. Glue lives in
[combined.py](nextchord/combined.py) (spec/datasets/model/inference wrappers,
strictly additive — the OpenBook and Hooktheory paths are untouched);
artifacts under `artifacts/combined/`. OpenBook songs keep their v1 split
assignment, so the jazz test slice is the **same 15 songs** as v1.

### Results (test split, 208 held-out songs, 52,904 decisions, 29.0% changes)

`change_top1` per corpus (the honest metric — top1 is inflated by HOLD):

| slice | Markov floor | melody-masked | auto-genre | **Transformer** | +reranker |
|---|---|---|---|---|---|
| all | 0.008 | 0.102 | 0.233 | **0.252** | 0.246 |
| pop909 | 0.003 | 0.010 | 0.146 | **0.151** | 0.156 |
| nottingham | 0.020 | 0.291 | 0.444 | **0.469** | 0.434 |
| openbook (jazz) | 0.009 | 0.305 | 0.283 | **0.419** | 0.421 |

- **Beats v1 on jazz**: 0.421 (reranked) vs 0.382 on the identical 15 test
  songs, over a strictly harder label space (68 vs 42 classes); overall top1
  ties (0.740). More data — even pop/folk data — helps the jazz case.
- **Melody helps everywhere**: masking it costs −0.114 (jazz) to −0.178
  (folk) change-accuracy.
- **The genre knob is load-bearing for jazz**: Auto-genre drops jazz
  change_top1 to 0.283 (−0.136), while pop/folk barely care (−0.005/−0.025).
  Set the device to Jazz when comping standards.

Full report: [artifacts/combined/reports/eval_test.md](artifacts/combined/reports/eval_test.md).

### Reproduce

```bash
cd ml/next_chord
.venv/bin/python scripts/build_combined_splits.py    # openbook split pinned to v1
.venv/bin/python scripts/build_combined_vocab.py     # 68 classes, per-corpus coverage gate
.venv/bin/python scripts/train_combined.py           # ~16 epochs, early-stopped
.venv/bin/python scripts/calibrate_combined.py       # T=0.805
.venv/bin/python scripts/eval_combined.py --split test
.venv/bin/python scripts/export_combined_onnx.py     # -> artifacts/combined/onnx (PARITY OK)
cp artifacts/combined/onnx/model.onnx* artifacts/combined/onnx/model_config.json artifacts/onnx/
.venv/bin/python scripts/make_combined_deploy_fixtures.py   # refreeze JS parity fixtures
(cd deploy && node test_parity.mjs)                  # 245 checks vs the deployed model
node ../../max4live/test/chord.harness.mjs           # 26 device checks incl. Genre
```

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
  combined.py   combined-corpus glue: SOURCE-conditioned spec/datasets/model
  train.py evaluate.py export_onnx.py demo.py   (CLIs, run via -m)
scripts/  make_splits.py  build_vocab.py  tune_reranker.py  make_test_vectors.py
          build_combined_{splits,vocab}.py  train/calibrate/eval/export_combined*.py
          make_combined_deploy_fixtures.py
artifacts/ splits.json vocab.json reranker_config.json test_vectors.json
           reports/  onnx/{model.onnx, model_config.json}   <- DEPLOY SLOT (combined model)
           combined/{splits,vocab,test_vectors}.json  combined/reports/
           (checkpoints/ + combined/{checkpoints,onnx}/ gitignored)
tests/    test_vocab / test_windows / test_no_leakage / test_rerank_vectors
          test_rerank_combined_vectors
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
logits within 1e-3, reranker, and live melody-context derivation). The deploy
slot `artifacts/onnx/` (model.onnx + model_config.json) holds whatever model
the device runs — **currently the combined SOURCE-conditioned model** (68
classes, 9 global slots). The JS side is driven entirely by model_config.json
(`features.sources` present ⇒ the encoder appends the SOURCE id; absent ⇒
legacy 8-slot layout), so retrain → re-export → re-freeze fixtures updates the
device with no code changes, and rolling back to an OpenBook-only export also
just works.

```bash
cd deploy && npm install && node test_parity.mjs   # PASS: 245 checks
```

`deploy/nextchord.node.js` is the `node.script` entry (Max owns beat timing and
Ableton sync; the node answers `predict` requests). See
[deploy/README.md](deploy/README.md) for the message protocol and patch wiring.
Only the in-Max patcher/Ableton wiring remains unverifiable outside Max.
