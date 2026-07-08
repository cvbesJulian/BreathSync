# Next-Chord Evaluation — OpenBook (test split)

- test examples: 2516 | change decisions: 963 (38.3%) | classes: 42
- near-duplicate held-out songs (bar-set Jaccard>0.5 vs train): 0/30
- transformer params: 422,701 | calibration T: 0.919

## Model comparison

| model | top1 | top3 | nll | macroF1 | change_top1 | hold_f1 |
|---|---|---|---|---|---|---|
| Markov | 0.621 | 0.847 | 1.460 | 0.021 | 0.009 | 0.766 |
| Transformer(melody-masked) | 0.695 | 0.829 | 1.430 | 0.121 | 0.218 | 0.835 |
| BiGRU | 0.735 | 0.836 | 1.195 | 0.164 | 0.362 | 0.874 |
| Transformer | 0.735 | 0.840 | 1.197 | 0.174 | 0.377 | 0.881 |
| Transformer+reranker | 0.740 |  |  | 0.180 | 0.382 | 0.881 |

## Transformer accuracy vs window length (bars)

| bars | top1 | top3 | change_top1 |
|---|---|---|---|
| 0.5 | 0.733 | 0.837 | 0.371 |
| 1.0 | 0.733 | 0.836 | 0.370 |
| 1.5 | 0.738 | 0.835 | 0.384 |
| 2.0 | 0.735 | 0.840 | 0.377 |
| 3.0 | 0.736 | 0.837 | 0.379 |
| 4.0 | 0.733 | 0.838 | 0.375 |

## By mode

| group | n | top1 | change_top1 | hold_f1 |
|---|---|---|---|---|
| maj | 883 | 0.726 | 0.371 | 0.877 |
| min | 80 | 0.819 | 0.438 | 0.905 |

## By meter

| group | n | top1 | change_top1 | hold_f1 |
|---|---|---|---|---|
| 4 | 916 | 0.733 | 0.374 | 0.881 |
| 5 | 47 | 0.778 | 0.426 | 0.867 |

## By grid (0=downbeat,1=midbar)

| group | n | top1 | change_top1 | hold_f1 |
|---|---|---|---|---|
| 0 | 549 | 0.487 | 0.472 | 0.464 |
| 1 | 414 | 0.816 | 0.251 | 0.904 |

## Go/no-go (does melody help?)

- Transformer change_top1 − Markov: **+0.368**
- Transformer change_top1 − melody-masked: **+0.159**
- verdict: PASS — melody adds signal
