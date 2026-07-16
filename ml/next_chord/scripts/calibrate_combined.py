"""Temperature-scale the combined checkpoint on its validation split."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

import torch  # noqa: E402
import torch.nn.functional as F  # noqa: E402

from nextchord import combined  # noqa: E402
from nextchord.calibrate import fit_temperature  # noqa: E402


def main():
    path = os.path.join(combined.checkpoint_dir(combined.load_cfg()), "transformer.pt")
    h = combined.load_checkpoint(path)
    cfg, songs, spec, splits = combined.load_everything(h["cfg"])
    val_ds = combined.EvalDataset(songs, splits["val"], spec, cfg, fixed_wlen=2.0)
    logits, tgt, _ = combined.logits_over(h["net"], val_ds, spec, h["device"], T=1.0)

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
