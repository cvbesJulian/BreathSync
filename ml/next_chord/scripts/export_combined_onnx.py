"""Export the combined transformer to ONNX + model_config.json, verify parity.

Same contract as nextchord/export_onnx.py with one addition: global_ids is
[B, 9] (trailing SOURCE id) and model_config.features gains "global_slots"
(9 entries) and "sources" so the JS port can size and fill the extra slot.
Writes artifacts/combined/onnx/.
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

from nextchord import combined, features, vocab  # noqa: E402
from nextchord.export_onnx import ExportWrapper, _batch_arrays  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n-parity", type=int, default=1000)
    args = ap.parse_args()

    cfg = combined.load_cfg()
    path = os.path.join(combined.checkpoint_dir(cfg), "transformer.pt")
    h = combined.load_checkpoint(path, device=torch.device("cpu"))
    net = h["net"].eval()
    cfg, songs, spec, splits = combined.load_everything(h["cfg"])

    val_ds = combined.EvalDataset(songs, splits["val"], spec, cfg, fixed_wlen=2.0)
    collate = combined.make_collate(spec)
    sample = collate([val_ds[i] for i in range(8)])
    inputs, order = _batch_arrays(sample)
    wrapper = ExportWrapper(net)

    onnx_dir = os.path.join(ROOT, "artifacts", "combined", "onnx")
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

    v = vocab.load(combined.vocab_path(cfg))
    model_config = {
        "model": "transformer",
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
                          "global_ids has a trailing SOURCE id "
                          "(0=unknown, then 1..n in features.sources order). "
                          "Bucketing per features spec is applied outside the graph.",
    }
    cfg_path = os.path.join(onnx_dir, "model_config.json")
    json.dump(model_config, open(cfg_path, "w"), indent=1)
    print("wrote", cfg_path)

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
