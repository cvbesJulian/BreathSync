"""Train the SOURCE-conditioned transformer on the combined corpus.

Usage:  python scripts/train_combined.py [--epochs N] [--seed S]

Self-contained analogue of nextchord.train for the combined pipeline —
imports only stable modules (dataset/model/vocab) plus nextchord.combined,
so it does not depend on the OpenBook config plumbing in pipeline.py.
"""
import argparse
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

import numpy as np  # noqa: E402
import torch  # noqa: E402
import torch.nn as nn  # noqa: E402
from torch.utils.data import DataLoader  # noqa: E402

from nextchord import combined, vocab  # noqa: E402


def class_weights(songs, train_ids, cfg, n_classes):
    counts = np.zeros(n_classes)
    for sid in train_ids:
        s = songs.get(sid)
        if s is None:
            continue
        for dp in s.decisions:
            counts[dp.target] += 1
    counts = np.maximum(counts, 1.0)
    w = 1.0 / np.sqrt(counts)
    w = w / w.mean()
    lo, hi = cfg["train"]["class_weight_clamp"]
    return np.clip(w, lo, hi).astype(np.float32)


def evaluate_nll(net, loader, device):
    net.eval()
    tot_nll, tot_correct, tot = 0.0, 0, 0
    ce = nn.CrossEntropyLoss(reduction="sum")
    with torch.no_grad():
        for batch in loader:
            batch = combined.move_batch(batch, device)
            logits, _ = net(batch["global_ids"], batch["note_feats"], batch["note_mask"])
            tot_nll += ce(logits, batch["target"]).item()
            tot_correct += (logits.argmax(1) == batch["target"]).sum().item()
            tot += batch["target"].numel()
    return tot_nll / tot, tot_correct / tot


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=None)
    ap.add_argument("--seed", type=int, default=None)
    args = ap.parse_args()

    cfg = combined.load_cfg()
    seed = args.seed if args.seed is not None else cfg["train"]["seed"]
    torch.manual_seed(seed)
    np.random.seed(seed)

    cfg, songs, spec, splits = combined.load_everything(cfg)
    device = combined.pick_device()
    n_classes = vocab.n_classes()
    print(f"device={device}  n_classes={n_classes}  songs={len(songs)}  "
          f"train_songs={len(splits['train'])}")

    train_ds = combined.TrainDataset(songs, splits["train"], spec, cfg, base_seed=seed)
    val_ds = combined.EvalDataset(songs, splits["val"], spec, cfg, fixed_wlen=2.0)
    collate = combined.make_collate(spec)
    bs = cfg["train"]["batch_size"]
    train_loader = DataLoader(train_ds, batch_size=bs, shuffle=True, collate_fn=collate)
    val_loader = DataLoader(val_ds, batch_size=512, shuffle=False, collate_fn=collate)
    print(f"train examples/epoch={len(train_ds)} ({train_ds.stats})  val={len(val_ds)}",
          flush=True)

    net = combined.build_model(spec, n_classes, cfg).to(device)
    n_params = sum(p.numel() for p in net.parameters() if p.requires_grad)
    print(f"model=transformer(combined)  params={n_params:,}")

    cw = torch.tensor(class_weights(songs, splits["train"], cfg, n_classes), device=device)
    ce_chord = nn.CrossEntropyLoss(weight=cw, label_smoothing=cfg["model"]["label_smoothing"])
    ce_func = nn.CrossEntropyLoss()
    fw = cfg["train"]["func_loss_weight"]

    opt = torch.optim.AdamW(net.parameters(), lr=cfg["train"]["lr"],
                            weight_decay=cfg["train"]["weight_decay"])
    max_epochs = args.epochs or cfg["train"]["max_epochs"]
    steps_per_epoch = max(1, len(train_loader))
    total_steps = max_epochs * steps_per_epoch
    warmup = cfg["train"]["warmup_steps"]

    def lr_lambda(step):
        if step < warmup:
            return step / max(1, warmup)
        prog = (step - warmup) / max(1, total_steps - warmup)
        return 0.5 * (1 + math.cos(math.pi * min(1.0, prog)))

    sched = torch.optim.lr_scheduler.LambdaLR(opt, lr_lambda)

    best_nll, best_state, patience = float("inf"), None, 0
    best_metrics = {}
    for epoch in range(max_epochs):
        train_ds.resample(epoch)
        net.train()
        run = 0.0
        for batch in train_loader:
            batch = combined.move_batch(batch, device)
            logits, flog = net(batch["global_ids"], batch["note_feats"], batch["note_mask"])
            loss = ce_chord(logits, batch["target"]) + fw * ce_func(flog, batch["func_target"])
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0)
            opt.step()
            sched.step()
            run += loss.item()
        val_nll, val_acc = evaluate_nll(net, val_loader, device)
        print(f"epoch {epoch:2d}  train_loss {run/steps_per_epoch:.4f}  "
              f"val_nll {val_nll:.4f}  val_top1 {val_acc:.4f}  "
              f"lr {sched.get_last_lr()[0]:.2e}", flush=True)
        if val_nll < best_nll - 1e-4:
            best_nll = val_nll
            best_state = {k: v.detach().cpu().clone() for k, v in net.state_dict().items()}
            best_metrics = {"val_nll": val_nll, "val_top1": val_acc, "epoch": epoch}
            patience = 0
        else:
            patience += 1
            if patience >= cfg["train"]["early_stop_patience"]:
                print(f"early stop at epoch {epoch}")
                break

    ckpt = {
        "model": "transformer",
        "state_dict": best_state,
        "cfg": cfg,
        "spec_config": spec.to_config(),
        "n_classes": n_classes,
        "vocab": vocab.load(combined.vocab_path(cfg)),
        "metrics": best_metrics,
        "calibration_T": 1.0,
    }
    ckpt_dir = combined.checkpoint_dir(cfg)
    os.makedirs(ckpt_dir, exist_ok=True)
    out = os.path.join(ckpt_dir, "transformer.pt")
    torch.save(ckpt, out)
    print(f"saved {out}  best {best_metrics}")


if __name__ == "__main__":
    main()
