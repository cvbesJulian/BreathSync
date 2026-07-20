"""Grid-search reranker weights for the COMBINED model on its val split;
freeze the best to artifacts/reranker_config.json (the deployed config).

Differences vs tune_reranker.py (v1):
  - gamma is pinned to 0.0: the device sends no Markov table at runtime
    (ctx.markovLogdist = null), so tuning with one would optimize a policy
    the deployment can't execute.
  - the grid includes 0.0 for alpha/beta/delta — with 50x the training data
    the model may already encode what the theory nudges used to add.
Objective unchanged: maximize change_top1 with overall top1 within 0.003 of
the raw model. Reports the per-corpus effect of the chosen setting.
"""
import itertools
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

import numpy as np  # noqa: E402

from nextchord import combined, infer, rerank as rr, vocab, windows  # noqa: E402


def main():
    cfg, songs, spec, splits = combined.load_everything()
    device = combined.pick_device()
    h = combined.load_checkpoint(
        os.path.join(combined.checkpoint_dir(cfg), "transformer.pt"), device)
    val_ds = combined.EvalDataset(songs, splits["val"], spec, cfg, fixed_wlen=2.0)
    logp, tgt, metas = combined.logprobs_over(h["net"], val_ds, spec, device, T=h["T"])
    logp = logp.numpy(); tgt = tgt.numpy()
    refs = val_ds.refs
    zero_markov = [0.0] * vocab.n_classes()

    raw_pred = logp.argmax(1)
    change = tgt != vocab.HOLD
    raw_top1 = (raw_pred == tgt).mean()
    raw_ch = (raw_pred[change] == tgt[change]).mean()
    print(f"raw: top1 {raw_top1:.4f}  change_top1 {raw_ch:.4f}  "
          f"(val n={len(tgt)}, changes={int(change.sum())})", flush=True)

    # precompute per-decision context once (the loop dominates runtime)
    ctxs = []
    for song, dp in refs:
        c = infer.rerank_context(song, dp)
        pf = vocab.function_of(dp.prev_class, song.mode) \
            if dp.prev_class != windows.bos_id() else len(vocab.FUNCTIONS)
        ctxs.append((song, dp, c, pf))

    def run(c):
        preds = np.empty(len(refs), dtype=np.int64)
        for i, (song, dp, ctx, pf) in enumerate(ctxs):
            res = rr.rerank(logp[i].tolist(), dp.prev_class, pf, dp.sounding_class,
                            song.mode, ctx["window_pcs"], ctx["strong_pcs"],
                            zero_markov, cfg=c)
            preds[i] = res[0]["class"]
        return preds

    base = rr.load_config()
    best = None
    grid = list(itertools.product([0.0, 0.4, 0.8], [0.0, 0.2, 0.4], [0.0, 0.5, 1.0]))
    for alpha, beta, delta in grid:
        c = dict(base); c.update(alpha=alpha, beta=beta, gamma=0.0, delta=delta)
        preds = run(c)
        top1 = (preds == tgt).mean()
        ch = (preds[change] == tgt[change]).mean()
        ok = top1 >= raw_top1 - 0.003
        key = ch + 0.5 * top1
        mark = "*" if ok and (best is None or key > best[0]) else " "
        print(f"  a={alpha:.1f} b={beta:.1f} d={delta:.1f} -> "
              f"top1 {top1:.4f}  change_top1 {ch:.4f} {mark}", flush=True)
        if ok and (best is None or key > best[0]):
            best = (key, dict(c), top1, ch, preds.copy())

    if best is None:
        print("no setting beat the no-regression bar; keeping current config")
        return
    _, cbest, top1, ch, preds = best
    print(f"\nbest: alpha {cbest['alpha']} beta {cbest['beta']} gamma 0.0 "
          f"delta {cbest['delta']} -> top1 {top1:.4f} change_top1 {ch:.4f} "
          f"(raw {raw_top1:.4f}/{raw_ch:.4f})")

    src = np.array([mm["source"] for mm in metas])
    for s in cfg["data"]["sources"]:
        idx = src == s
        chs = change & idx
        print(f"  {s:11s} change_top1 raw {(raw_pred[chs] == tgt[chs]).mean():.4f} "
              f"-> reranked {(preds[chs] == tgt[chs]).mean():.4f}")

    path = os.path.join(ROOT, "artifacts", "reranker_config.json")
    json.dump(cbest, open(path, "w"), indent=1)
    print("wrote", path)


if __name__ == "__main__":
    main()
