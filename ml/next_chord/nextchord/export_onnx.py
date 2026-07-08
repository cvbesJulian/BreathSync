"""Export the trained Transformer to ONNX + a sidecar model_config.json, then
verify parity against PyTorch. All bucketing stays OUTSIDE the graph (see
model_config.json) so the Node-for-Max port reproduces features in JS.

Inputs (all batch-major; notes padded to max_notes, mask marks real notes):
  global_ids [B, G] int64
  pc, octave, dt, dur, phase, downbeat, bar_offset [B, M] int64
  note_mask [B, M] bool
Outputs: chord_logits [B, C], func_logits [B, 3]  (pre-temperature).
"""

import argparse
import json
import os

import numpy as np
import torch
import torch.nn as nn

from . import pipeline, infer, dataset as ds, features, vocab


class ExportWrapper(nn.Module):
    def __init__(self, net):
        super().__init__()
        self.net = net

    def forward(self, global_ids, pc, octave, dt, dur, phase, downbeat,
                bar_offset, note_mask):
        note_feats = {"pc": pc, "octave": octave, "dt": dt, "dur": dur,
                      "phase": phase, "downbeat": downbeat, "bar_offset": bar_offset}
        return self.net(global_ids, note_feats, note_mask)


def _batch_arrays(batch):
    order = ["global_ids"] + list(features.NOTE_FEATS) + ["note_mask"]
    arr = {"global_ids": batch["global_ids"]}
    for k in features.NOTE_FEATS:
        arr[k] = batch["note_feats"][k]
    arr["note_mask"] = batch["note_mask"]
    return [arr[k] for k in order], order


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="transformer")
    ap.add_argument("--n-parity", type=int, default=1000)
    args = ap.parse_args()

    path = os.path.join(pipeline.ROOT, "artifacts", "checkpoints", f"{args.model}.pt")
    h = infer.load_checkpoint(path, device=torch.device("cpu"))
    net = h["net"].eval()
    cfg, songs, spec, splits = pipeline.load_everything(h["cfg"])

    val_ds = ds.EvalDataset(songs, splits["val"], spec, cfg, fixed_wlen=2.0)
    collate = ds.make_collate(spec)
    sample = collate([val_ds[i] for i in range(min(8, len(val_ds)))])
    inputs, order = _batch_arrays(sample)
    wrapper = ExportWrapper(net)

    onnx_dir = os.path.join(pipeline.ROOT, "artifacts", "onnx")
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

    # sidecar config (everything the JS port needs)
    v = vocab.load()
    model_config = {
        "model": args.model,
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
    max_diff = 0.0
    argmax_mismatch = 0
    n_done = 0
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
