"""Export the Hooktheory transformer to ONNX + model_config.json, verify parity.

Same graph contract as nextchord/export_onnx.py — the only differences are the
frozen artifacts it reads (the 76-class Hooktheory vocab and the pop checkpoint,
both resolved from configs/hooktheory.json via pipeline dispatch) and the output
directory (artifacts/hooktheory/onnx/). Bucketing stays OUTSIDE the graph (see
model_config.json) so the Node-for-Max port reproduces features in JS.
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

import numpy as np  # noqa: E402
import torch  # noqa: E402

from nextchord import pipeline, infer, dataset as ds, vocab  # noqa: E402
from nextchord.export_onnx import ExportWrapper, _batch_arrays  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=os.path.join(ROOT, "configs", "hooktheory.json"))
    ap.add_argument("--n-parity", type=int, default=1000)
    args = ap.parse_args()

    cfg = pipeline.load_cfg(args.config)
    path = os.path.join(pipeline.checkpoint_dir(cfg), "transformer.pt")
    h = infer.load_checkpoint(path, device=torch.device("cpu"))
    net = h["net"].eval()
    cfg, songs, spec, splits = pipeline.load_everything(h["cfg"])

    val_ds = ds.EvalDataset(songs, splits["val"], spec, cfg, fixed_wlen=2.0)
    collate = ds.make_collate(spec)
    sample = collate([val_ds[i] for i in range(min(8, len(val_ds)))])
    inputs, order = _batch_arrays(sample)
    wrapper = ExportWrapper(net)

    onnx_dir = os.path.join(pipeline.ROOT, "artifacts", "hooktheory", "onnx")
    os.makedirs(onnx_dir, exist_ok=True)
    onnx_path = os.path.join(onnx_dir, "model.onnx")
    dyn = {name: {0: "batch"} for name in order}
    dyn["chord_logits"] = {0: "batch"}
    dyn["func_logits"] = {0: "batch"}

    torch.onnx.export(
        wrapper, tuple(inputs), onnx_path,
        input_names=order, output_names=["chord_logits", "func_logits"],
        dynamic_axes=dyn, opset_version=17, do_constant_folding=True,
    )
    print("exported", onnx_path)

    v = vocab.load(pipeline.vocab_path(cfg))
    model_config = {
        "model": "transformer",
        "corpus": "hooktheory",
        "n_classes": vocab.n_classes(),
        "calibration_T": h["T"],
        "input_order": order,
        "hold_id": vocab.HOLD,
        "other_id": vocab.other_id(),
        "families": vocab.FAMILIES,
        "vocab_classes": v["classes"],
        "roman_major": [vocab.roman_of(c, "maj") for c in range(vocab.n_classes())],
        "roman_minor": [vocab.roman_of(c, "min") for c in range(vocab.n_classes())],
        "function_major": [vocab.function_of(c, "maj") for c in range(vocab.n_classes())],
        "function_minor": [vocab.function_of(c, "min") for c in range(vocab.n_classes())],
        "functions": vocab.FUNCTIONS,
        "features": spec.to_config(),
        "query_contract": "Query at beat gridpoints (downbeats and integer beats). "
                          "Notes padded to max_notes; note_mask marks real notes. "
                          "Bucketing per features spec is applied outside the graph.",
    }
    cfg_path = os.path.join(onnx_dir, "model_config.json")
    json.dump(model_config, open(cfg_path, "w"), indent=1)
    print("wrote", cfg_path)

    # --- parity check
    try:
        import onnxruntime as ort
    except ImportError:
        print("onnxruntime not installed; skipping parity")
        return
    sess = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
    max_diff, argmax_mismatch, n_done = 0.0, 0, 0
    loader = torch.utils.data.DataLoader(val_ds, batch_size=128, shuffle=False,
                                         collate_fn=collate)
    with torch.no_grad():
        for batch in loader:
            ins, _ = _batch_arrays(batch)
            feed = {}
            for name, t in zip(order, ins):
                a = t.numpy()
                feed[name] = a.astype(np.bool_) if name == "note_mask" else a.astype(np.int64)
            onnx_logits = sess.run(["chord_logits"], feed)[0]
            torch_logits = wrapper(*ins)[0].numpy()
            max_diff = max(max_diff, float(np.abs(onnx_logits - torch_logits).max()))
            argmax_mismatch += int((onnx_logits.argmax(1) != torch_logits.argmax(1)).sum())
            n_done += onnx_logits.shape[0]
            if n_done >= args.n_parity:
                break
    print(f"parity over {n_done} examples: max|diff|={max_diff:.2e}  "
          f"argmax mismatches={argmax_mismatch}")
    assert max_diff < 1e-4, f"parity failed: {max_diff}"
    assert argmax_mismatch == 0
    print("PARITY OK")


if __name__ == "__main__":
    main()
