"""Evaluate all models on the test split and write a markdown report.

Compares Markov (melody-blind floor), BiGRU, Transformer, Transformer+reranker,
and a melody-masked Transformer ablation (the go/no-go that melody is used).
Reports top-1/top-3, NLL, macro-F1, the honest change-only top-1, HOLD
detection, and slices by window length / mode / meter / grid.
"""

import argparse
import os
from collections import defaultdict

import numpy as np
import torch
import torch.nn.functional as F
from sklearn.metrics import f1_score

from . import pipeline, infer, dataset as ds, markov as mk, rerank as rr, vocab, windows


def metrics_from_logprobs(logp, targets):
    logp = np.asarray(logp)
    tgt = np.asarray(targets)
    pred = logp.argmax(1)
    top1 = (pred == tgt).mean()
    top3idx = np.argsort(-logp, axis=1)[:, :3]
    top3 = np.mean([t in row for t, row in zip(tgt, top3idx)])
    nll = -np.mean(logp[np.arange(len(tgt)), tgt])
    macro_f1 = f1_score(tgt, pred, average="macro", labels=list(range(logp.shape[1])),
                        zero_division=0)
    return _augment_metrics(pred, tgt, {"top1": top1, "top3": top3, "nll": nll,
                                        "macro_f1": macro_f1})


def _augment_metrics(pred, tgt, m):
    change = tgt != vocab.HOLD
    m["change_top1"] = (pred[change] == tgt[change]).mean() if change.any() else float("nan")
    m["n_change"] = int(change.sum())
    pred_hold = pred == vocab.HOLD
    act_hold = tgt == vocab.HOLD
    tp = (pred_hold & act_hold).sum()
    m["hold_prec"] = tp / max(1, pred_hold.sum())
    m["hold_rec"] = tp / max(1, act_hold.sum())
    m["hold_f1"] = 2 * m["hold_prec"] * m["hold_rec"] / max(1e-9, m["hold_prec"] + m["hold_rec"])
    return m


def metrics_from_pred(pred, targets, n_classes):
    # macro-F1 over the SAME full label set as metrics_from_logprobs, so the
    # reranker row is comparable to the model rows (absent classes count as F1=0).
    pred = np.asarray(pred)
    tgt = np.asarray(targets)
    m = {"top1": (pred == tgt).mean(),
         "macro_f1": f1_score(tgt, pred, average="macro",
                              labels=list(range(n_classes)), zero_division=0)}
    # top3/nll intentionally omitted: the reranker emits a hard top-1, not a
    # normalized distribution, so those cells stay blank rather than silently
    # echoing the base model's numbers.
    return _augment_metrics(pred, tgt, m)


def markov_logp(model, metas):
    prevs = [mm["prev_class"] for mm in metas]
    return model.log_dist_batch(prevs)


def reranker_preds(logp, refs, markov_lp, cfg):
    rcfg = rr.load_config()
    preds = []
    for i, (song, dp) in enumerate(refs):
        ctx = infer.rerank_context(song, dp)
        prev_func = vocab.function_of(dp.prev_class, song.mode) \
            if dp.prev_class != windows.bos_id() else len(vocab.FUNCTIONS)
        res = rr.rerank(logp[i].tolist(), dp.prev_class, prev_func,
                        dp.sounding_class, song.mode, ctx["window_pcs"],
                        ctx["strong_pcs"], markov_lp[i], cfg=rcfg)
        preds.append(res[0]["class"])
    return np.array(preds)


def near_duplicate_rate(songs, splits):
    def bar_hashes(s):
        hs = set()
        # rebuild per-bar pc multiset from notes grouped by bar
        by_bar = defaultdict(list)
        for n in s.notes:
            by_bar[n.bar_idx].append(n.pitch % 12)
        for bi, pcs in by_bar.items():
            hs.add(tuple(sorted(pcs)))
        return hs
    train_hashes = [bar_hashes(songs[s]) for s in splits["train"]]
    dup = 0
    heldout = splits["val"] + splits["test"]
    for sid in heldout:
        h = bar_hashes(songs[sid])
        if not h:
            continue
        best = max((len(h & th) / len(h | th) for th in train_hashes if th), default=0)
        if best > 0.5:
            dup += 1
    return dup, len(heldout)


def fmt(m, keys):
    cells = []
    for k in keys:
        v = m.get(k)
        if isinstance(v, (int, float, np.floating, np.integer)):
            cells.append(f"{float(v):.3f}")
        else:
            cells.append(str(v if v is not None else ""))
    return " | ".join(cells)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", default="test")
    args = ap.parse_args()
    cfg, songs, spec, splits = pipeline.load_everything()
    device = pipeline.pick_device()
    ck = os.path.join(pipeline.ROOT, "artifacts", "checkpoints")

    eval_ds = ds.EvalDataset(songs, splits[args.split], spec, cfg, fixed_wlen=2.0)
    refs = eval_ds.refs

    # --- Markov floor (fit on all training decision points)
    tr_fixed, tr_hold = windows.split_decisions(songs, splits["train"])
    markov = mk.MarkovBaseline().fit(list(tr_fixed) + list(tr_hold))

    rows = {}
    # get targets/metas once
    hT = infer.load_checkpoint(os.path.join(ck, "transformer.pt"), device)
    logpT, tgt, metas = infer.logprobs_over(hT["net"], eval_ds, spec, device, T=hT["T"])
    tgt_np = tgt.numpy()

    mlp = markov_logp(markov, metas)
    rows["Markov"] = metrics_from_logprobs(mlp, tgt_np)
    rows["Transformer"] = metrics_from_logprobs(logpT.numpy(), tgt_np)

    # BiGRU (if present)
    bpath = os.path.join(ck, "bigru.pt")
    if os.path.exists(bpath):
        hB = infer.load_checkpoint(bpath, device)
        logpB, _, _ = infer.logprobs_over(hB["net"], eval_ds, spec, device, T=hB["T"])
        rows["BiGRU"] = metrics_from_logprobs(logpB.numpy(), tgt_np)

    # Transformer + reranker
    rpred = reranker_preds(logpT, refs, mlp, cfg)
    rows["Transformer+reranker"] = metrics_from_pred(rpred, tgt_np, vocab.n_classes())

    # Melody-masked ablation
    masked_ds = ds.EvalDataset(songs, splits[args.split], spec, cfg, fixed_wlen=2.0,
                               mask_notes=True)
    logpM, _, _ = infer.logprobs_over(hT["net"], masked_ds, spec, device, T=hT["T"])
    rows["Transformer(melody-masked)"] = metrics_from_logprobs(logpM.numpy(), tgt_np)

    # --- window-length slice for the transformer
    wl_rows = {}
    for L in cfg["windows"]["lengths_bars"]:
        dsl = ds.EvalDataset(songs, splits[args.split], spec, cfg, fixed_wlen=L)
        lp, tg, _ = infer.logprobs_over(hT["net"], dsl, spec, device, T=hT["T"])
        wl_rows[L] = metrics_from_logprobs(lp.numpy(), tg.numpy())

    # --- mode / meter / grid slices (transformer)
    def slice_metrics(key):
        groups = defaultdict(list)
        for i, mm in enumerate(metas):
            groups[mm[key]].append(i)
        out = {}
        for g, idx in groups.items():
            idx = np.array(idx)
            out[g] = metrics_from_logprobs(logpT.numpy()[idx], tgt_np[idx])
        return out
    mode_rows = slice_metrics("mode")
    meter_rows = slice_metrics("meter")
    grid_rows = slice_metrics("grid")

    dup, held = near_duplicate_rate(songs, splits)

    # --- write report
    keys = ["top1", "top3", "nll", "macro_f1", "change_top1", "hold_f1"]
    lines = [f"# Next-Chord Evaluation — OpenBook ({args.split} split)", ""]
    lines.append(f"- test examples: {len(tgt_np)} | change decisions: "
                 f"{int((tgt_np!=vocab.HOLD).sum())} "
                 f"({(tgt_np!=vocab.HOLD).mean():.1%}) | classes: {vocab.n_classes()}")
    lines.append(f"- near-duplicate held-out songs (bar-set Jaccard>0.5 vs train): {dup}/{held}")
    lines.append(f"- transformer params: {sum(p.numel() for p in hT['net'].parameters()):,} "
                 f"| calibration T: {hT['T']:.3f}")
    lines += ["", "## Model comparison", "",
              "| model | top1 | top3 | nll | macroF1 | change_top1 | hold_f1 |",
              "|---|---|---|---|---|---|---|"]
    order = ["Markov", "Transformer(melody-masked)", "BiGRU", "Transformer",
             "Transformer+reranker"]
    for name in order:
        if name in rows:
            lines.append(f"| {name} | " + fmt(rows[name], keys) + " |")

    lines += ["", "## Transformer accuracy vs window length (bars)", "",
              "| bars | top1 | top3 | change_top1 |", "|---|---|---|---|"]
    for L in cfg["windows"]["lengths_bars"]:
        m = wl_rows[L]
        lines.append(f"| {L} | {m['top1']:.3f} | {m['top3']:.3f} | {m['change_top1']:.3f} |")

    def slice_block(title, rowmap):
        b = ["", f"## {title}", "", "| group | n | top1 | change_top1 | hold_f1 |",
             "|---|---|---|---|---|"]
        for g, m in sorted(rowmap.items(), key=lambda kv: str(kv[0])):
            n = m.get("n_change", "")
            b.append(f"| {g} | {n} | {m['top1']:.3f} | {m['change_top1']:.3f} | {m['hold_f1']:.3f} |")
        return b
    lines += slice_block("By mode", mode_rows)
    lines += slice_block("By meter", meter_rows)
    lines += slice_block("By grid (0=downbeat,1=midbar)", grid_rows)

    # go/no-go verdict
    lines += ["", "## Go/no-go (does melody help?)", ""]
    dmelody = rows["Transformer"]["change_top1"] - rows["Markov"]["change_top1"]
    dmask = rows["Transformer"]["change_top1"] - rows["Transformer(melody-masked)"]["change_top1"]
    lines.append(f"- Transformer change_top1 − Markov: **{dmelody:+.3f}**")
    lines.append(f"- Transformer change_top1 − melody-masked: **{dmask:+.3f}**")
    lines.append(f"- verdict: {'PASS — melody adds signal' if dmask > 0.02 else 'WEAK — melody signal thin'}")

    report = "\n".join(lines) + "\n"
    out = os.path.join(pipeline.ROOT, "artifacts", "reports", f"eval_{args.split}.md")
    open(out, "w").write(report)
    print(report)
    print("wrote", out)


if __name__ == "__main__":
    main()
