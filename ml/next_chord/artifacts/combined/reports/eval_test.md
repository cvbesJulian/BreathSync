# Next-Chord Evaluation — Combined corpus (test split)

- test examples: 52904 | change decisions: 15368 (29.0%) | classes: 68
- transformer params: 430,279 | calibration T: 0.805 | SOURCE-conditioned (+1 global slot)

## Overall

| model | top1 | top3 | nll | macroF1 | change_top1 | hold_f1 |
|---|---|---|---|---|---|---|
| Markov (per-corpus) | 0.712 | 0.877 | 1.168 | 0.013 | 0.008 | 0.832 |
| Transformer(melody-masked) | 0.733 | 0.877 | 1.110 | 0.057 | 0.102 | 0.847 |
| Transformer(auto-genre) | 0.726 | 0.884 | 1.003 | 0.076 | 0.233 | 0.854 |
| Transformer | 0.728 | 0.886 | 0.982 | 0.092 | 0.252 | 0.858 |
| Transformer+reranker | 0.726 |  |  | 0.092 | 0.269 | 0.858 |

## pop909 (91 held-out songs, 33227 decisions)

| model | top1 | top3 | nll | macroF1 | change_top1 | hold_f1 |
|---|---|---|---|---|---|---|
| Markov (per-corpus) | 0.689 | 0.853 | 1.284 | 0.013 | 0.003 | 0.817 |
| Transformer(melody-masked) | 0.689 | 0.854 | 1.268 | 0.020 | 0.010 | 0.816 |
| Transformer(auto-genre) | 0.672 | 0.866 | 1.177 | 0.043 | 0.146 | 0.817 |
| Transformer | 0.672 | 0.864 | 1.170 | 0.045 | 0.151 | 0.818 |
| Transformer+reranker | 0.669 |  |  | 0.046 | 0.175 | 0.819 |

## nottingham (102 held-out songs, 17161 decisions)

| model | top1 | top3 | nll | macroF1 | change_top1 | hold_f1 |
|---|---|---|---|---|---|---|
| Markov (per-corpus) | 0.769 | 0.927 | 0.892 | 0.014 | 0.020 | 0.869 |
| Transformer(melody-masked) | 0.821 | 0.929 | 0.762 | 0.042 | 0.291 | 0.907 |
| Transformer(auto-genre) | 0.833 | 0.930 | 0.601 | 0.058 | 0.444 | 0.924 |
| Transformer | 0.834 | 0.933 | 0.584 | 0.059 | 0.469 | 0.928 |
| Transformer+reranker | 0.835 |  |  | 0.059 | 0.473 | 0.930 |

## openbook (15 held-out songs, 2516 decisions)

| model | top1 | top3 | nll | macroF1 | change_top1 | hold_f1 |
|---|---|---|---|---|---|---|
| Markov (per-corpus) | 0.620 | 0.847 | 1.508 | 0.013 | 0.009 | 0.766 |
| Transformer(melody-masked) | 0.707 | 0.832 | 1.393 | 0.097 | 0.305 | 0.842 |
| Transformer(auto-genre) | 0.702 | 0.816 | 1.455 | 0.093 | 0.283 | 0.843 |
| Transformer | 0.738 | 0.845 | 1.213 | 0.118 | 0.419 | 0.886 |
| Transformer+reranker | 0.734 |  |  | 0.116 | 0.414 | 0.884 |

## By mode (transformer)

| group | n_change | top1 | change_top1 | hold_f1 |
|---|---|---|---|---|
| maj | 10273 | 0.743 | 0.298 | 0.868 |
| min | 5095 | 0.696 | 0.159 | 0.837 |

## By grid (transformer; 0=downbeat, 1=midbar)

| group | n_change | top1 | change_top1 | hold_f1 |
|---|---|---|---|---|
| 0 | 9438 | 0.464 | 0.257 | 0.581 |
| 1 | 5930 | 0.833 | 0.244 | 0.924 |

## Go/no-go (does melody help?)

| corpus | change_top1 full | melody-masked | Δ |
|---|---|---|---|
| all | 0.252 | 0.102 | +0.149 |
| pop909 | 0.151 | 0.010 | +0.142 |
| nottingham | 0.469 | 0.291 | +0.178 |
| openbook | 0.419 | 0.305 | +0.114 |

## vs OpenBook-only model (same 15 jazz test songs)

The OpenBook-only transformer+reranker scored top1 0.740 / change_top1 0.382 on this slice with 42 classes (artifacts/reports/eval_test.md). The combined model's openbook rows above are computed over 68 classes — a strictly harder label space.

