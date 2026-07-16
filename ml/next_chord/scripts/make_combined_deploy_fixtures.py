"""Freeze JS-port fixtures for the DEPLOYED combined model.

Run AFTER export_combined_onnx.py and after copying the export into the
deploy slot (artifacts/onnx/). Writes:
  - artifacts/parity_fixtures.json          (end-to-end: encoding incl. SOURCE
    slot, ONNX logits, calibrated logprobs, reranked order)
  - artifacts/combined/test_vectors.json    (50 golden reranker vectors under
    the combined vocab; replayed by tests/test_rerank_combined_vectors.py and
    deploy/test_parity.mjs part A)
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

import numpy as np  # noqa: E402
import onnxruntime as ort  # noqa: E402
import torch  # noqa: E402
import torch.nn.functional as F  # noqa: E402

from nextchord import combined, features, infer, markov as mk, rerank as rr, vocab, windows  # noqa: E402


def main():
    cfg, songs, spec, splits = combined.load_everything()
    h = combined.load_checkpoint(
        os.path.join(combined.checkpoint_dir(cfg), "transformer.pt"),
        device=torch.device("cpu"))
    T = h["T"]
    onnx_path = os.path.join(ROOT, "artifacts", "onnx", "model.onnx")
    sess = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
    rcfg = rr.load_config()

    val_ds = combined.EvalDataset(songs, splits["val"], spec, cfg, fixed_wlen=2.0)
    refs = val_ds.refs

    # --- parity fixtures (24, spread over the val decisions of all corpora)
    idxs = list(range(0, len(refs), max(1, len(refs) // 24)))[:24]
    fixtures = []
    for i in idxs:
        song, dp = refs[i]
        wlen = 2.0
        L = wlen * song.beats_per_bar
        notes = windows.notes_in_window(song, dp.t, L)
        if len(notes) > spec.max_notes:
            notes = notes[-spec.max_notes:]
        ex = val_ds[i]

        batch = combined.collate([ex], spec)
        feed = {"global_ids": batch["global_ids"].numpy().astype(np.int64)}
        for k in features.NOTE_FEATS:
            feed[k] = batch["note_feats"][k].numpy().astype(np.int64)
        feed["note_mask"] = batch["note_mask"].numpy().astype(np.bool_)
        logits = sess.run(["chord_logits"], feed)[0][0]
        logp = F.log_softmax(torch.tensor(logits) / T, dim=0).numpy()

        ctx = infer.rerank_context(song, dp)
        pf = vocab.function_of(dp.prev_class, song.mode) \
            if dp.prev_class != windows.bos_id() else len(vocab.FUNCTIONS)
        res = rr.rerank(logp.tolist(), dp.prev_class, pf, dp.sounding_class, song.mode,
                        ctx["window_pcs"], ctx["strong_pcs"],
                        [0.0] * vocab.n_classes(), cfg=rcfg)

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
                "source": song.collection,
                "window_pcs": [[int(p), round(float(w), 4)] for p, w in ctx["window_pcs"]],
                "strong_pcs": [int(p) for p in ctx["strong_pcs"]],
            },
            "expected_encoding": {
                "global_ids": [int(x) for x in ex["global_ids"]],
                "notes": {k: [int(x) for x in ex["notes"][k]] for k in features.NOTE_FEATS},
            },
            "expected_logits": [round(float(x), 5) for x in logits],
            "expected_logprobs": [round(float(x), 6) for x in logp],
            "expected_reranked": [{"class": r["class"], "score": round(float(r["score"]), 6)}
                                  for r in res],
        })

    out = os.path.join(ROOT, "artifacts", "parity_fixtures.json")
    json.dump({"calibration_T": T, "model": "combined", "n": len(fixtures),
               "fixtures": fixtures}, open(out, "w"), indent=1)
    print(f"wrote {len(fixtures)} fixtures -> {out}")

    # --- golden reranker vectors (50) under the combined vocab
    logpA, _, metas = combined.logprobs_over(h["net"], val_ds, spec,
                                             torch.device("cpu"), T=T)
    logpA = logpA.numpy()
    tr_fixed, tr_hold = windows.split_decisions(songs, splits["train"])
    markov = mk.MarkovBaseline().fit(list(tr_fixed) + list(tr_hold))
    mlp = markov.log_dist_batch([mm["prev_class"] for mm in metas])

    vidxs = list(range(0, len(refs), max(1, len(refs) // 50)))[:50]
    vectors = []
    for i in vidxs:
        song, dp = refs[i]
        ctx = infer.rerank_context(song, dp)
        pf = vocab.function_of(dp.prev_class, song.mode) \
            if dp.prev_class != windows.bos_id() else len(vocab.FUNCTIONS)
        inp = {
            "model_logprobs": [round(float(x), 6) for x in logpA[i]],
            "prev_class": int(dp.prev_class), "prev_func": int(pf),
            "sounding_class": int(dp.sounding_class), "mode": song.mode,
            "window_pcs": [[int(p), round(float(w), 4)] for p, w in ctx["window_pcs"]],
            "strong_pcs": [int(p) for p in ctx["strong_pcs"]],
            "markov_logdist": [round(float(x), 6) for x in mlp[i]],
        }
        res = rr.rerank(inp["model_logprobs"], inp["prev_class"], inp["prev_func"],
                        inp["sounding_class"], inp["mode"], ctx["window_pcs"],
                        inp["strong_pcs"], inp["markov_logdist"], cfg=rcfg)
        vectors.append({"input": inp,
                        "expected": [{"class": r["class"],
                                      "score": round(float(r["score"]), 6)} for r in res]})

    vpath = os.path.join(ROOT, "artifacts", "combined", "test_vectors.json")
    json.dump({"reranker_config": rcfg, "vocab_path": cfg["data"]["vocab_path"],
               "vectors": vectors}, open(vpath, "w"), indent=1)
    print(f"wrote {len(vectors)} vectors -> {vpath}")


if __name__ == "__main__":
    main()
