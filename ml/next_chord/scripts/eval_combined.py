"""Evaluate the combined-corpus model on the test split, sliced per corpus.

Rows: per-source Markov floors (melody-blind), the SOURCE-conditioned
transformer, its melody-masked ablation (same checkpoint, notes hidden at
eval time), and transformer+reranker. The reranker's Markov prior is fit
per source — matching how the device consumes markov_chord_t.json.

The openbook slice uses the exact 15 held-out songs of the OpenBook-only
run (splits are pinned), so the "did 25x more data help the jazz case?"
comparison against artifacts/reports/eval_test.md is like-for-like modulo
vocab granularity (42 -> 68 classes; the combined vocab is a superset task,
which biases AGAINST the combined model).

Writes artifacts/combined/reports/eval_test.md.
"""
import argparse
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

import numpy as np  # noqa: E402

from nextchord import combined, infer, markov as mk, rerank as rr, vocab, windows  # noqa: E402
from nextchord.evaluate import metrics_from_logprobs, metrics_from_pred, fmt  # noqa: E402


def per_source_markov(songs, train_ids):
    """source -> MarkovBaseline fit on that source's train decisions only."""
    by_source = defaultdict(list)
    for sid in train_ids:
        s = songs.get(sid)
        if s is None:
            continue
        for dp in s.decisions:
            by_source[s.collection].append((s, dp))
    return {src: mk.MarkovBaseline().fit(refs) for src, refs in by_source.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", default="test")
    args = ap.parse_args()

    cfg, songs, spec, splits = combined.load_everything()
    device = combined.pick_device()
    ck = os.path.join(combined.checkpoint_dir(cfg), "transformer.pt")
    h = combined.load_checkpoint(ck, device)

    eval_ds = combined.EvalDataset(songs, splits[args.split], spec, cfg, fixed_wlen=2.0)
    refs = eval_ds.refs

    logpT, tgt, metas = combined.logprobs_over(h["net"], eval_ds, spec, device, T=h["T"])
    logpT_np, tgt_np = logpT.numpy(), tgt.numpy()

    masked_ds = combined.EvalDataset(songs, splits[args.split], spec, cfg,
                                     fixed_wlen=2.0, mask_notes=True)
    logpM, _, _ = combined.logprobs_over(h["net"], masked_ds, spec, device, T=h["T"])
    logpM_np = logpM.numpy()

    # Auto-genre: SOURCE id forced to 0 (the device's default, trained via
    # source-dropout) — measures the cost of not telling the model the genre.
    auto_ds = combined.EvalDataset(songs, splits[args.split], spec, cfg,
                                   fixed_wlen=2.0, source_override=0)
    logpA, _, _ = combined.logprobs_over(h["net"], auto_ds, spec, device, T=h["T"])
    logpA_np = logpA.numpy()

    # per-source markov floor + row-matched markov log-dists for the reranker
    markovs = per_source_markov(songs, splits["train"])
    src_of = np.array([mm["source"] for mm in metas])
    mlp = np.zeros_like(logpT_np)
    for src, model in markovs.items():
        idx = np.where(src_of == src)[0]
        if len(idx):
            prevs = [metas[i]["prev_class"] for i in idx]
            mlp[idx] = model.log_dist_batch(prevs)

    rcfg = rr.load_config()
    rpred = np.zeros(len(refs), dtype=np.int64)
    for i, (song, dp) in enumerate(refs):
        ctx = infer.rerank_context(song, dp)
        prev_func = vocab.function_of(dp.prev_class, song.mode) \
            if dp.prev_class != windows.bos_id() else len(vocab.FUNCTIONS)
        res = rr.rerank(logpT_np[i].tolist(), dp.prev_class, prev_func,
                        dp.sounding_class, song.mode, ctx["window_pcs"],
                        ctx["strong_pcs"], mlp[i], cfg=rcfg)
        rpred[i] = res[0]["class"]

    def rows_for(idx):
        rows = {}
        rows["Markov (per-corpus)"] = metrics_from_logprobs(mlp[idx], tgt_np[idx])
        rows["Transformer(melody-masked)"] = metrics_from_logprobs(logpM_np[idx], tgt_np[idx])
        rows["Transformer(auto-genre)"] = metrics_from_logprobs(logpA_np[idx], tgt_np[idx])
        rows["Transformer"] = metrics_from_logprobs(logpT_np[idx], tgt_np[idx])
        rows["Transformer+reranker"] = metrics_from_pred(rpred[idx], tgt_np[idx],
                                                         vocab.n_classes())
        return rows

    keys = ["top1", "top3", "nll", "macro_f1", "change_top1", "hold_f1"]
    order = ["Markov (per-corpus)", "Transformer(melody-masked)",
             "Transformer(auto-genre)", "Transformer", "Transformer+reranker"]

    def table(rows):
        out = ["| model | top1 | top3 | nll | macroF1 | change_top1 | hold_f1 |",
               "|---|---|---|---|---|---|---|"]
        for name in order:
            out.append(f"| {name} | " + fmt(rows[name], keys) + " |")
        return out

    all_idx = np.arange(len(tgt_np))
    lines = [f"# Next-Chord Evaluation — Combined corpus ({args.split} split)", ""]
    lines.append(f"- test examples: {len(tgt_np)} | change decisions: "
                 f"{int((tgt_np != vocab.HOLD).sum())} "
                 f"({(tgt_np != vocab.HOLD).mean():.1%}) | classes: {vocab.n_classes()}")
    lines.append(f"- transformer params: "
                 f"{sum(p.numel() for p in h['net'].parameters()):,} "
                 f"| calibration T: {h['T']:.3f} | SOURCE-conditioned (+1 global slot)")
    lines += ["", "## Overall", ""] + table(rows_for(all_idx))

    for src in cfg["data"]["sources"]:
        idx = np.where(src_of == src)[0]
        n_songs = len([s for s in splits[args.split] if s.startswith(src + "/")])
        lines += ["", f"## {src} ({n_songs} held-out songs, {len(idx)} decisions)", ""]
        lines += table(rows_for(idx))

    # mode / grid slices for the transformer
    def slice_block(key, title):
        groups = defaultdict(list)
        for i, mm in enumerate(metas):
            groups[mm[key]].append(i)
        b = ["", f"## {title}", "", "| group | n_change | top1 | change_top1 | hold_f1 |",
             "|---|---|---|---|---|"]
        for g, gidx in sorted(groups.items(), key=lambda kv: str(kv[0])):
            m = metrics_from_logprobs(logpT_np[np.array(gidx)], tgt_np[np.array(gidx)])
            b.append(f"| {g} | {m['n_change']} | {m['top1']:.3f} | "
                     f"{m['change_top1']:.3f} | {m['hold_f1']:.3f} |")
        return b
    lines += slice_block("mode", "By mode (transformer)")
    lines += slice_block("grid", "By grid (transformer; 0=downbeat, 1=midbar)")

    # go/no-go per source
    lines += ["", "## Go/no-go (does melody help?)", "",
              "| corpus | change_top1 full | melody-masked | Δ |", "|---|---|---|---|"]
    for src in ["all"] + cfg["data"]["sources"]:
        idx = all_idx if src == "all" else np.where(src_of == src)[0]
        full = metrics_from_logprobs(logpT_np[idx], tgt_np[idx])["change_top1"]
        mask = metrics_from_logprobs(logpM_np[idx], tgt_np[idx])["change_top1"]
        lines.append(f"| {src} | {full:.3f} | {mask:.3f} | {full - mask:+.3f} |")

    lines += ["", "## vs OpenBook-only model (same 15 jazz test songs)", "",
              "The OpenBook-only transformer+reranker scored top1 0.740 / "
              "change_top1 0.382 on this slice with 42 classes "
              "(artifacts/reports/eval_test.md). The combined model's openbook "
              "rows above are computed over 68 classes — a strictly harder "
              "label space.", ""]

    report = "\n".join(lines) + "\n"
    out_dir = os.path.join(ROOT, "artifacts", "combined", "reports")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, f"eval_{args.split}.md")
    open(out, "w").write(report)
    print(report)
    print("wrote", out)


if __name__ == "__main__":
    main()
