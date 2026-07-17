"""Freeze 50 reranker input->output cases from the val split into
artifacts/test_vectors.json. tests/test_rerank_vectors.py replays them; the
future JS port must reproduce the same scores/order (bit-approximately)."""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

from nextchord import pipeline, infer, dataset as ds, markov as mk, rerank as rr, vocab, windows  # noqa: E402


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
    logp = logp.numpy()
    refs = val_ds.refs
    tr_fixed, tr_hold = windows.split_decisions(songs, splits["train"])
    markov = mk.MarkovBaseline().fit(list(tr_fixed) + list(tr_hold))
    mlp = markov.log_dist_batch([mm["prev_class"] for mm in metas])
    rcfg = rr.load_config()

    idxs = list(range(0, len(refs), max(1, len(refs) // 50)))[:50]
    vectors = []
    for i in idxs:
        song, dp = refs[i]
        ctx = infer.rerank_context(song, dp)
        pf = vocab.function_of(dp.prev_class, song.mode) \
            if dp.prev_class != windows.bos_id() else len(vocab.FUNCTIONS)
        inp = {
            "model_logprobs": [round(float(x), 6) for x in logp[i]],
            "prev_class": int(dp.prev_class), "prev_func": int(pf),
            "sounding_class": int(dp.sounding_class), "mode": song.mode,
            "window_pcs": [[int(p), round(float(w), 4)] for p, w in ctx["window_pcs"]],
            "strong_pcs": [int(p) for p in ctx["strong_pcs"]],
            "markov_logdist": [round(float(x), 6) for x in mlp[i]],
        }
        res = rr.rerank(inp["model_logprobs"], inp["prev_class"], inp["prev_func"],
                        inp["sounding_class"], inp["mode"], ctx["window_pcs"],
                        inp["strong_pcs"], inp["markov_logdist"], cfg=rcfg)
        out = [{"class": r["class"], "score": round(float(r["score"]), 6)} for r in res]
        vectors.append({"input": inp, "expected": out})

    path = os.path.join(art_base, "test_vectors.json")
    json.dump({"reranker_config": rcfg, "vectors": vectors}, open(path, "w"), indent=1)
    print(f"wrote {len(vectors)} vectors -> {path}")


if __name__ == "__main__":
    main()
