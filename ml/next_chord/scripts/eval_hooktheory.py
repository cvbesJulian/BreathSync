"""Evaluate the Hooktheory next-chord Transformer on the test split.

Focused, self-contained (no Markov/BiGRU/reranker/sklearn): reports top-1/top-3,
NLL, change-only top-1 and HOLD-F1, a window-length slice, and the key go/no-go
melody-masked ablation. Also computes a prev-chord-only floor (predict the most
likely next class given only the previous chord, fit on TRAIN) so the melody
model's lift over "just repeat/transition from the last chord" is explicit.
"""
import argparse
import json
import os
import sys
from collections import Counter, defaultdict

import numpy as np
import torch

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

from nextchord import pipeline, infer, dataset as ds, vocab  # noqa: E402


def basic_metrics(logp, tgt):
    logp, tgt = np.asarray(logp), np.asarray(tgt)
    pred = logp.argmax(1)
    top3 = np.argsort(-logp, axis=1)[:, :3]
    change = tgt != vocab.HOLD
    ph, ah = pred == vocab.HOLD, tgt == vocab.HOLD
    tp = int((ph & ah).sum())
    prec = tp / max(1, ph.sum())
    rec = tp / max(1, ah.sum())
    return {
        "top1": float((pred == tgt).mean()),
        "top3": float(np.mean([t in r for t, r in zip(tgt, top3)])),
        "nll": float(-np.mean(logp[np.arange(len(tgt)), tgt])),
        "change_top1": float((pred[change] == tgt[change]).mean()) if change.any() else float("nan"),
        "hold_f1": float(2 * prec * rec / max(1e-9, prec + rec)),
        "n": int(len(tgt)),
        "n_change": int(change.sum()),
    }


def prevchord_floor(songs, splits, n_classes, metas, tgt):
    """P(next | prev_class) fit on TRAIN decisions -> log-probs for the test metas."""
    table = defaultdict(lambda: np.zeros(n_classes))
    for sid in splits["train"]:
        s = songs.get(sid)
        if not s:
            continue
        for dp in s.decisions:
            table[dp.prev_class][dp.target] += 1.0
    logp = np.full((len(metas), n_classes), -1e9, dtype=np.float64)
    uniform = np.log(np.ones(n_classes) / n_classes)
    for i, mm in enumerate(metas):
        row = table.get(mm["prev_class"])
        if row is None or row.sum() == 0:
            logp[i] = uniform
        else:
            p = (row + 1e-6) / (row.sum() + 1e-6 * n_classes)
            logp[i] = np.log(p)
    return basic_metrics(logp, tgt)


def fmt(m):
    return (f"top1 {m['top1']:.3f} | top3 {m['top3']:.3f} | nll {m['nll']:.3f} | "
            f"change_top1 {m['change_top1']:.3f} | hold_f1 {m['hold_f1']:.3f}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=os.path.join(ROOT, "configs", "hooktheory.json"))
    ap.add_argument("--split", default="test")
    ap.add_argument("--model", default="transformer")
    args = ap.parse_args()

    cfg = pipeline.load_cfg(args.config)
    cfg, songs, spec, splits = pipeline.load_everything(cfg)
    device = pipeline.pick_device()
    n_classes = vocab.n_classes()

    ckpt = os.path.join(pipeline.checkpoint_dir(cfg), f"{args.model}.pt")
    h = infer.load_checkpoint(ckpt, device)

    eval_ds = ds.EvalDataset(songs, splits[args.split], spec, cfg, fixed_wlen=2.0)
    logp, tgt, metas = infer.logprobs_over(h["net"], eval_ds, spec, device, T=h["T"])
    tgt_np = tgt.numpy()
    logp_np = logp.numpy()

    masked_ds = ds.EvalDataset(songs, splits[args.split], spec, cfg,
                               fixed_wlen=2.0, mask_notes=True)
    logpM, _, _ = infer.logprobs_over(h["net"], masked_ds, spec, device, T=h["T"])

    rows = {
        "PrevChord-floor": prevchord_floor(songs, splits, n_classes, metas, tgt_np),
        "Transformer(melody-masked)": basic_metrics(logpM.numpy(), tgt_np),
        "Transformer(melody)": basic_metrics(logp_np, tgt_np),
    }

    lines = [f"# Hooktheory next-chord eval — {args.split} split", ""]
    lines.append(f"- examples: {len(tgt_np)} | change decisions: "
                 f"{int((tgt_np != vocab.HOLD).sum())} "
                 f"({(tgt_np != vocab.HOLD).mean():.1%}) | classes: {n_classes}")
    lines.append(f"- params: {sum(p.numel() for p in h['net'].parameters()):,} "
                 f"| checkpoint: artifacts{ckpt.split('artifacts')[-1]}")
    lines += ["", "## Models", "",
              "| model | top1 | top3 | nll | change_top1 | hold_f1 |",
              "|---|---|---|---|---|---|"]
    for name in ["PrevChord-floor", "Transformer(melody-masked)", "Transformer(melody)"]:
        m = rows[name]
        lines.append(f"| {name} | {m['top1']:.3f} | {m['top3']:.3f} | {m['nll']:.3f} "
                     f"| {m['change_top1']:.3f} | {m['hold_f1']:.3f} |")

    # window-length slice (melody model)
    lines += ["", "## Accuracy vs melody-context length (bars)", "",
              "| bars | top1 | top3 | change_top1 |", "|---|---|---|---|"]
    for L in cfg["windows"]["lengths_bars"]:
        dsl = ds.EvalDataset(songs, splits[args.split], spec, cfg, fixed_wlen=L)
        lp, tg, _ = infer.logprobs_over(h["net"], dsl, spec, device, T=h["T"])
        m = basic_metrics(lp.numpy(), tg.numpy())
        lines.append(f"| {L} | {m['top1']:.3f} | {m['top3']:.3f} | {m['change_top1']:.3f} |")

    # mode slice
    groups = defaultdict(list)
    for i, mm in enumerate(metas):
        groups[mm["mode"]].append(i)
    lines += ["", "## By mode (melody model)", "",
              "| mode | n | top1 | change_top1 |", "|---|---|---|---|"]
    for g, idx in sorted(groups.items()):
        idx = np.array(idx)
        m = basic_metrics(logp_np[idx], tgt_np[idx])
        lines.append(f"| {g} | {m['n']} | {m['top1']:.3f} | {m['change_top1']:.3f} |")

    dmask = rows["Transformer(melody)"]["change_top1"] - rows["Transformer(melody-masked)"]["change_top1"]
    dfloor = rows["Transformer(melody)"]["change_top1"] - rows["PrevChord-floor"]["change_top1"]
    lines += ["", "## Go/no-go (does melody help?)", "",
              f"- melody change_top1 − melody-masked: **{dmask:+.3f}**",
              f"- melody change_top1 − prev-chord floor: **{dfloor:+.3f}**",
              f"- verdict: {'PASS — melody adds signal' if dmask > 0.02 else 'WEAK — melody signal thin'}"]

    report = "\n".join(lines) + "\n"
    out_dir = os.path.join(ROOT, "artifacts", "hooktheory", "reports")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, f"eval_{args.split}.md")
    open(out, "w").write(report)
    print(report)
    print("wrote", out)


if __name__ == "__main__":
    main()
