# Hooktheory next-chord eval — test split

- examples: 115949 | change decisions: 29812 (25.7%) | classes: 76
- params: 432,079 | checkpoint: artifacts/hooktheory/checkpoints/transformer.pt

## Models

| model | top1 | top3 | nll | change_top1 | hold_f1 |
|---|---|---|---|---|---|
| PrevChord-floor | 0.751 | 0.873 | 1.178 | 0.030 | 0.863 |
| Transformer(melody-masked) | 0.770 | 0.881 | 1.241 | 0.150 | 0.885 |
| Transformer(melody) | 0.748 | 0.884 | 1.206 | 0.233 | 0.884 |

## Accuracy vs melody-context length (bars)

| bars | top1 | top3 | change_top1 |
|---|---|---|---|
| 0.5 | 0.743 | 0.882 | 0.231 |
| 1.0 | 0.747 | 0.883 | 0.234 |
| 1.5 | 0.747 | 0.883 | 0.227 |
| 2.0 | 0.748 | 0.884 | 0.233 |
| 3.0 | 0.749 | 0.884 | 0.231 |
| 4.0 | 0.752 | 0.885 | 0.232 |

## By mode (melody model)

| mode | n | top1 | change_top1 |
|---|---|---|---|
| maj | 57843 | 0.741 | 0.243 |
| min | 58106 | 0.754 | 0.222 |

## Go/no-go (does melody help?)

- melody change_top1 − melody-masked: **+0.083**
- melody change_top1 − prev-chord floor: **+0.202**
- verdict: PASS — melody adds signal
