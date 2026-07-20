"""Freeze end-to-end parity fixtures for the JS/Node deployment port.

For a sample of val decisions, capture the RAW window (notes + context), the
Python-encoded feature ids, the ONNX raw logits, the calibrated log-probs, and
the Python reranker output. deploy/test_parity.mjs replays all of it so the JS
feature encoder + onnxruntime-node + JS reranker must match Python bit-closely.
"""
import argparse
import json
import os
import sys

import numpy as np
import onnxruntime as ort
import torch
import torch.nn.functional as F

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

from nextchord import pipeline, infer, dataset as ds, features, windows, rerank as rr, vocab  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=None,
                    help="config json; checkpoint/onnx/output dirs resolve from "
                         "it (default: OpenBook top-level artifacts)")
    args = ap.parse_args()

    cfg0 = pipeline.load_cfg(args.config) if args.config else None
    cfg, songs, spec, splits = pipeline.load_everything(cfg0)
    # artifacts base for this corpus: parent of the checkpoint dir
    #   OpenBook -> artifacts/ ; hooktheory -> artifacts/hooktheory/
    art_base = os.path.dirname(pipeline.checkpoint_dir(cfg0))
    device = torch.device("cpu")
    h = infer.load_checkpoint(os.path.join(pipeline.checkpoint_dir(cfg0), "transformer.pt"), device)
    T = h["T"]
    onnx_path = os.path.join(art_base, "onnx", "model.onnx")
    sess = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
    order = json.load(open(os.path.join(art_base, "onnx", "model_config.json")))["input_order"]
    # corpus-specific reranker if present (tuned per corpus), else shared default
    rcfg_path = os.path.join(art_base, "reranker_config.json")
    rcfg = rr.load_config(rcfg_path if os.path.exists(rcfg_path) else None)

    val_ds = ds.EvalDataset(songs, splits["val"], spec, cfg, fixed_wlen=2.0)
    refs = val_ds.refs
    idxs = list(range(0, len(refs), max(1, len(refs) // 24)))[:24]

    fixtures = []
    for i in idxs:
        song, dp = refs[i]
        wlen = 2.0
        L = wlen * song.beats_per_bar
        notes = windows.notes_in_window(song, dp.t, L)
        if len(notes) > spec.max_notes:
            notes = notes[-spec.max_notes:]
        ex = windows.build_example(song, dp, spec, wlen)

        # ONNX forward (batch 1)
        batch = ds.collate([ex], spec)
        feed = {"global_ids": batch["global_ids"].numpy().astype(np.int64)}
        for k in features.NOTE_FEATS:
            feed[k] = batch["note_feats"][k].numpy().astype(np.int64)
        feed["note_mask"] = batch["note_mask"].numpy().astype(np.bool_)
        logits = sess.run(["chord_logits"], feed)[0][0]
        logp = F.log_softmax(torch.tensor(logits) / T, dim=0).numpy()

        ctx = infer.rerank_context(song, dp)
        pf = vocab.function_of(dp.prev_class, song.mode) \
            if dp.prev_class != windows.bos_id() else len(vocab.FUNCTIONS)
        # rerank from the SAME rounded logprobs the fixture stores — the JS
        # replay only sees 6dp values, and near-ties in the reranked tail can
        # flip order if the frozen expectation used full precision
        logp_r = [round(float(x), 6) for x in logp]
        res = rr.rerank(logp_r, dp.prev_class, pf, dp.sounding_class, song.mode,
                        ctx["window_pcs"], ctx["strong_pcs"], [0.0] * vocab.n_classes(), cfg=rcfg)

        fixtures.append({
            "song_id": song.song_id, "t": round(dp.t, 4),
            "raw_notes": [[n.pitch, round(n.onset, 4), round(n.dur, 4),
                           round(n.onset_in_bar, 4), n.beats_per_bar] for n in notes],
            "context": {
                "mode": song.mode, "meter": song.beats_per_bar,
                "prev_class": int(dp.prev_class), "prev_func": int(pf),
                "wlen_bars": wlen, "hyper": int(dp.hyper), "grid": int(dp.grid),
                "sounding_class": int(dp.sounding_class),
                "transpose_offset": int(song.transpose_offset),
                "window_pcs": [[int(p), round(float(w), 4)] for p, w in ctx["window_pcs"]],
                "strong_pcs": [int(p) for p in ctx["strong_pcs"]],
            },
            "expected_encoding": {
                "global_ids": [int(x) for x in ex["global_ids"]],
                "notes": {k: [int(x) for x in ex["notes"][k]] for k in features.NOTE_FEATS},
            },
            "expected_logits": [round(float(x), 5) for x in logits],
            "expected_logprobs": logp_r,
            "expected_reranked": [{"class": r["class"], "score": round(float(r["score"]), 6)} for r in res],
        })

    out = os.path.join(art_base, "parity_fixtures.json")
    json.dump({"calibration_T": T, "n": len(fixtures), "fixtures": fixtures}, open(out, "w"), indent=1)
    print(f"wrote {len(fixtures)} fixtures -> {out}")


if __name__ == "__main__":
    main()
