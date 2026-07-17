"""Temperature scaling on the validation set. Writes calibration_T back into
the checkpoint so downstream confidences are meaningful."""

import argparse
import os

import torch
import torch.nn.functional as F

from . import pipeline, infer, dataset as ds


def fit_temperature(logits, targets):
    T = torch.ones(1, requires_grad=True)
    opt = torch.optim.LBFGS([T], lr=0.1, max_iter=100)

    def closure():
        opt.zero_grad()
        loss = F.cross_entropy(logits / T.clamp(min=1e-2), targets)
        loss.backward()
        return loss

    opt.step(closure)
    return float(T.detach().clamp(min=1e-2).item())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="transformer")
    ap.add_argument("--config", default=None,
                    help="config json; checkpoint dir is resolved from it "
                         "(default: OpenBook artifacts/checkpoints)")
    args = ap.parse_args()
    cfg0 = pipeline.load_cfg(args.config) if args.config else None
    path = os.path.join(pipeline.checkpoint_dir(cfg0), f"{args.model}.pt")
    h = infer.load_checkpoint(path)
    cfg, songs, spec, splits = pipeline.load_everything(h["cfg"])
    val_ds = ds.EvalDataset(songs, splits["val"], spec, cfg, fixed_wlen=2.0)
    logits, tgt, _ = infer.logits_over(h["net"], val_ds, spec, h["device"], T=1.0)

    nll0 = F.cross_entropy(logits, tgt).item()
    T = fit_temperature(logits, tgt)
    nll1 = F.cross_entropy(logits / T, tgt).item()
    print(f"val NLL {nll0:.4f} -> {nll1:.4f}  (T={T:.3f})")

    ckpt = torch.load(path, map_location="cpu", weights_only=False)
    ckpt["calibration_T"] = T
    torch.save(ckpt, path)
    print(f"updated {path}")


if __name__ == "__main__":
    main()
