"""Grid-search reranker weights on the VAL split; freeze the best to
artifacts/reranker_config.json. Objective: maximize change_top1 without
regressing overall top1 below the raw model (theory must help, not hurt)."""
import argparse
import itertools
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

from nextchord import pipeline, infer, dataset as ds, rerank as rr, vocab, windows  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=None,
                    help="config json; checkpoint/output dirs resolve from it "
                         "(default: OpenBook top-level artifacts)")
    args = ap.parse_args()

    cfg0 = pipeline.load_cfg(args.config) if args.config else None
    cfg, songs, spec, splits = pipeline.load_everything(cfg0)
    art_base = os.path.dirname(pipeline.checkpoint_dir(cfg0))
    device = pipeline.pick_device()
    h = infer.load_checkpoint(os.path.join(pipeline.checkpoint_dir(cfg0), "transformer.pt"), device)
    val_ds = ds.EvalDataset(songs, splits["val"], spec, cfg, fixed_wlen=2.0)
    logp, tgt, metas = infer.logprobs_over(h["net"], val_ds, spec, device, T=h["T"])
    logp = logp.numpy(); tgt = tgt.numpy()
    refs = val_ds.refs

    raw_pred = logp.argmax(1)
    change = tgt != vocab.HOLD
    raw_top1 = (raw_pred == tgt).mean()
    raw_ch = (raw_pred[change] == tgt[change]).mean()
    print(f"raw: top1 {raw_top1:.3f}  change_top1 {raw_ch:.3f}")

    # Deploy-faithful search. gamma is fixed at 0: the Node/Max deploy
    # (predict.js) supplies NO Markov distribution, so a gamma>0 config would
    # rank differently in Python than on the device — only gamma=0 is
    # deploy-consistent (and the Markov prior just duplicates the model anyway,
    # biasing toward HOLD). alpha spans 0 because melody_fit is causally
    # backward — it scores the NEXT chord against the PAST half-bar of melody,
    # which belonged to the previous chord — so it often hurts change_top1.
    base = rr.load_config()
    best = None
    ranked = []
    grid = itertools.product([0.0, 0.15, 0.3], [0.0, 0.25, 0.4, 0.6],
                             [0.0], [0.0, 0.5, 1.0])
    for alpha, beta, gamma, delta in grid:
        c = dict(base); c.update(alpha=alpha, beta=beta, gamma=gamma, delta=delta)
        preds = []
        for i, (song, dp) in enumerate(refs):
            ctx = infer.rerank_context(song, dp)
            pf = vocab.function_of(dp.prev_class, song.mode) \
                if dp.prev_class != windows.bos_id() else len(vocab.FUNCTIONS)
            res = rr.rerank(logp[i].tolist(), dp.prev_class, pf, dp.sounding_class,
                            song.mode, ctx["window_pcs"], ctx["strong_pcs"], None, cfg=c)
            preds.append(res[0]["class"])
        preds = np.array(preds)
        top1 = (preds == tgt).mean()
        ch = (preds[change] == tgt[change]).mean()
        # require no top1 regression vs raw; maximize change_top1
        ok = top1 >= raw_top1 - 0.003
        key = (ch + 0.5 * top1)
        ranked.append((key, alpha, beta, delta, top1, ch, ok))
        if ok and (best is None or key > best[0]):
            best = (key, dict(c), top1, ch)

    ranked.sort(reverse=True)
    print("top configs (a=alpha b=beta d=delta):")
    for key, a, b, d, top1, ch, ok in ranked[:5]:
        print(f"  a={a} b={b} d={d} -> top1 {top1:.3f} change_top1 {ch:.3f}"
              f"{'' if ok else '  [top1 regressed]'}")

    if best is None:
        print("no setting beat the no-regression bar; keeping defaults")
        return
    _, cbest, top1, ch = best
    print(f"best: alpha {cbest['alpha']} beta {cbest['beta']} gamma {cbest['gamma']} "
          f"delta {cbest['delta']} -> top1 {top1:.3f} change_top1 {ch:.3f}")
    path = os.path.join(art_base, "reranker_config.json")
    json.dump(cbest, open(path, "w"), indent=1)
    print("wrote", path)


if __name__ == "__main__":
    main()
