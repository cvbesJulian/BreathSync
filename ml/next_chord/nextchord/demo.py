"""Offline demo: melody window in -> reranked next-chord out.

Replay a real decision point from a dataset song:
  python -m nextchord.demo replay --song afternoon_in_paris --bar 8
  python -m nextchord.demo replay --song a_night_in_tunisia --bar 5 --beat 2 --window-bars 2

Hand-entered window (onsets are beats relative to the decision point, negative):
  python -m nextchord.demo adhoc --notes "E4@-2:1,G4@-1:0.5,A4@-0.5:0.5" \
      --mode maj --meter 4 --prev-chord D:min7
"""

import argparse
import os

import torch
import torch.nn.functional as F

from . import pipeline, infer, dataset as ds, features, windows, rerank as rr, vocab
from .data import Note, DecisionPoint, bos_id, DOWNBEAT, MIDBAR

NOTE_PC = {"C": 0, "C#": 1, "DB": 1, "D": 2, "D#": 3, "EB": 3, "E": 4, "F": 5,
           "F#": 6, "GB": 6, "G": 7, "G#": 8, "AB": 8, "A": 9, "A#": 10, "BB": 10, "B": 11}


def _forward_one(h, spec, ex):
    batch = ds.collate([ex], spec)
    batch = pipeline.move_batch(batch, h["device"])
    with torch.no_grad():
        logits, _ = h["net"](batch["global_ids"], batch["note_feats"], batch["note_mask"])
    return F.log_softmax(logits / h["T"], dim=1)[0].cpu()


def _print_result(logp, ctx, mode, transpose_offset, prev_class, sounding_class,
                  ground_truth=None, window_desc=None):
    n = vocab.n_classes()
    prev_func = vocab.function_of(prev_class, mode) if prev_class != bos_id() else len(vocab.FUNCTIONS)
    markov_none = [0.0] * n
    res = rr.rerank(logp.tolist(), prev_class, prev_func, sounding_class, mode,
                    ctx["window_pcs"], ctx["strong_pcs"], markov_none, cfg=rr.load_config())

    probs = logp.exp()
    top5 = probs.argsort(descending=True)[:5].tolist()
    if window_desc:
        print("melody window:", window_desc)
    prev_str = "BOS" if prev_class == bos_id() else vocab.roman_of(prev_class, mode)
    print(f"key-relative mode: {mode}   previous chord: {prev_str}")
    print("\n  model top-5 (calibrated):")
    for c in top5:
        print(f"    {vocab.roman_of(c, mode):8s} {vocab.absolute_label(c, transpose_offset, mode):8s} "
              f"p={probs[c]:.3f}")
    print("\n  reranked (model + melody-fit + function - clash):")
    for r in res:
        c = r["class"]
        print(f"    {vocab.roman_of(c, mode):8s} {vocab.absolute_label(c, transpose_offset, mode):8s} "
              f"score={r['score']:.3f}  [logp {r['model_logp']:.2f} fit {r['melody_fit']:.2f} "
              f"func {r['func_score']:.2f} clash {r['clash']:.0f}]")
    choice = res[0]["class"]
    print(f"\n  >>> CHOSEN: {vocab.roman_of(choice, mode)}  "
          f"({vocab.absolute_label(choice, transpose_offset, mode)})")
    if ground_truth is not None:
        print(f"      ground truth: {vocab.roman_of(ground_truth, mode)}  "
              f"({vocab.absolute_label(ground_truth, transpose_offset, mode)})  "
              f"{'MATCH' if ground_truth == choice else 'differ'}")


def replay(args, h, cfg, songs, spec):
    s = songs[args.song]
    cands = [dp for dp in s.decisions if dp.bar_idx == args.bar
             and (args.beat is None or abs(dp.beat_in_bar - args.beat) < 1e-3)]
    if not cands:
        # nearest decision to the requested bar
        cands = sorted(s.decisions, key=lambda dp: abs(dp.bar_idx - args.bar))[:1]
    dp = cands[0]
    ex = windows.build_example(s, dp, spec, args.window_bars)
    logp = _forward_one(h, spec, ex)
    ctx = infer.rerank_context(s, dp)
    L = args.window_bars * s.beats_per_bar
    notes = windows.notes_in_window(s, dp.t, L)
    desc = " ".join(f"{vocab.PC_NAME[n.pitch % 12]}{(n.pitch//12)-1}@{n.onset-dp.t:+.1f}" for n in notes) or "(empty)"
    print(f"=== {args.song}  key {s.key} ({s.mode})  bar {dp.bar_idx} beat {dp.beat_in_bar:.1f}  "
          f"window {args.window_bars} bars  grid={'downbeat' if dp.grid==DOWNBEAT else 'midbar'} ===")
    _print_result(logp, ctx, s.mode, s.transpose_offset, dp.prev_class,
                  dp.sounding_class, ground_truth=dp.target, window_desc=desc)


def _parse_notes(text):
    notes = []
    for tok in text.split(","):
        tok = tok.strip()
        if not tok:
            continue
        name_oct, _, rest = tok.partition("@")
        onset_s, _, dur_s = rest.partition(":")
        # split pitch name from octave
        i = len(name_oct)
        while i > 0 and (name_oct[i-1].isdigit() or name_oct[i-1] == "-"):
            i -= 1
        pc = NOTE_PC[name_oct[:i].upper()]
        octave = int(name_oct[i:])
        pitch = (octave + 1) * 12 + pc
        notes.append((pitch, float(onset_s), float(dur_s or 1.0)))
    return notes


def adhoc(args, h, cfg, spec):
    meter = float(args.meter)
    t = 4.0 * meter  # place the decision a few bars in so onsets stay positive
    parsed = _parse_notes(args.notes)
    note_objs = []
    for pitch, rel, dur in parsed:
        onset = t + rel
        oib = onset % meter
        note_objs.append(Note(pitch=pitch, onset=onset, dur=dur, bar_idx=int(onset // meter),
                              onset_in_bar=oib, beats_per_bar=meter))
    note_objs.sort(key=lambda nn: nn.onset)

    prev_class = bos_id() if args.prev_chord.upper() == "BOS" else vocab.class_of(args.prev_chord)
    prev_func = features.prev_function(prev_class, args.mode)
    global_ids = features.encode_globals(spec, args.mode, meter, prev_class, prev_func,
                                          args.window_bars, 0, DOWNBEAT)
    streams = features.encode_notes(spec, note_objs, t)
    ex = {"global_ids": global_ids, "notes": streams, "n_notes": len(note_objs),
          "target": 0, "func_target": 0, "meta": {}}
    logp = _forward_one(h, spec, ex)

    hb = 0.5 * meter
    ctx = {"window_pcs": [(nn.pitch % 12, max(1e-3, nn.dur)) for nn in note_objs if nn.onset >= t - hb],
           "strong_pcs": [nn.pitch % 12 for nn in note_objs if abs(nn.onset_in_bar - round(nn.onset_in_bar)) < 1e-3]}
    desc = " ".join(f"{vocab.PC_NAME[p % 12]}{(p//12)-1}@{r:+.1f}" for p, r, _ in parsed)
    print(f"=== ad-hoc  mode {args.mode}  meter {int(meter)}  prev {args.prev_chord} ===")
    _print_result(logp, ctx, args.mode, 0, prev_class, prev_class if prev_class != bos_id() else vocab.HOLD,
                  window_desc=desc)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("replay")
    r.add_argument("--song", required=True)
    r.add_argument("--bar", type=int, required=True)
    r.add_argument("--beat", type=float, default=None)
    r.add_argument("--window-bars", type=float, default=2.0)
    a = sub.add_parser("adhoc")
    a.add_argument("--notes", required=True)
    a.add_argument("--mode", default="maj", choices=["maj", "min"])
    a.add_argument("--meter", default=4)
    a.add_argument("--prev-chord", default="BOS")
    a.add_argument("--window-bars", type=float, default=2.0)
    args = ap.parse_args()

    h = infer.load_checkpoint(os.path.join(pipeline.ROOT, "artifacts", "checkpoints", "transformer.pt"))
    cfg, songs, spec, splits = pipeline.load_everything(h["cfg"])
    if args.cmd == "replay":
        replay(args, h, cfg, songs, spec)
    else:
        adhoc(args, h, cfg, spec)


if __name__ == "__main__":
    main()
