"""Feature encoding — the single source of truth for tokenization.

Each training/inference example becomes:
  - global_ids:  int list, one categorical id per global slot (CLS, MODE, ...)
  - note tensors: parallel int lists (pc, octave, dt, dur, phase, downbeat,
                  bar_offset), one entry per melody note in the window
All bucket edges and cardinalities are captured in ``feature_spec()`` and
serialized into model_config.json so the Node-for-Max port reproduces them
exactly (bucketing stays *outside* the ONNX graph). Bucketing uses bisect on
plain float-list edges — trivially portable to JS.
"""

import bisect
import math

from . import vocab, data

# global slots (order fixed; index into the sequence)
GLOBAL_SLOTS = ["CLS", "MODE", "METER", "PREVCHORD", "PREVFUNC", "WLEN", "HYPER", "GRIDPOS"]
N_GLOBALS = len(GLOBAL_SLOTS)

# note feature streams (order fixed)
NOTE_FEATS = ["pc", "octave", "dt", "dur", "phase", "downbeat", "bar_offset"]


def _geomspace(start, stop, num):
    if num < 2:
        return [start]
    r = (stop / start) ** (1.0 / (num - 1))
    return [start * (r ** i) for i in range(num)]


class FeatureSpec:
    """Immutable-ish holder of bucket edges + cardinalities, built from config."""

    def __init__(self, cfg):
        f = cfg["features"]
        self.octave_base = f["octave_base_pitch"]
        self.octave_buckets = f["octave_buckets"]
        self.phase_bins = f["phase_bins"]
        self.max_bar_offset = f["max_bar_offset"]
        self.max_seq_len = f["max_seq_len"]
        self.max_notes = self.max_seq_len - N_GLOBALS
        self.meters = f["meters"]
        self.meter_index = {m: i for i, m in enumerate(self.meters)}

        dt = f["dt_bucket_edges_geomspace"]
        self.dt_edges = _geomspace(dt["start"], dt["stop"], dt["num_edges"])
        du = f["dur_bucket_edges_geomspace"]
        self.dur_edges = _geomspace(du["start"], du["stop"], du["num_edges"])

        self.lengths_bars = cfg["windows"]["lengths_bars"]
        self.wlen_index = {round(L, 4): i for i, L in enumerate(self.lengths_bars)}

        # cardinalities INCLUDING pad slot 0 for note features
        self.note_card = {
            "pc": 12 + 1,
            "octave": self.octave_buckets + 1,
            "dt": len(self.dt_edges) + 1 + 1,      # searchsorted -> 0..len ; +1 pad
            "dur": len(self.dur_edges) + 1 + 1,
            "phase": self.phase_bins + 1,
            "downbeat": 2 + 1,
            "bar_offset": self.max_bar_offset + 1 + 1,
        }
        self.global_card = {
            "CLS": 1,
            "MODE": 2,
            "METER": len(self.meters) + 1,
            "PREVCHORD": vocab.n_classes() + 1 + 1,  # classes + BOS + pad
            "PREVFUNC": len(vocab.FUNCTIONS) + 1 + 1,  # T/PD/D + BOS + pad
            "WLEN": len(self.lengths_bars) + 1,
            "HYPER": 8 + 1,
            "GRIDPOS": 2 + 1,
        }

    # -- bucketers (pad slot 0 => real ids start at 1) --
    def octave_id(self, pitch):
        b = (pitch - self.octave_base) // 12
        b = max(0, min(self.octave_buckets - 1, b))
        return b + 1

    def dt_id(self, dt):
        return bisect.bisect_right(self.dt_edges, dt) + 1

    def dur_id(self, dur):
        return bisect.bisect_right(self.dur_edges, dur) + 1

    def phase_id(self, onset_in_bar, bpb):
        b = int(round(onset_in_bar / bpb * self.phase_bins)) % self.phase_bins
        return b + 1

    def to_config(self):
        return {
            "global_slots": GLOBAL_SLOTS,
            "note_feats": NOTE_FEATS,
            "note_card": self.note_card,
            "global_card": self.global_card,
            "octave_base": self.octave_base,
            "octave_buckets": self.octave_buckets,
            "phase_bins": self.phase_bins,
            "max_bar_offset": self.max_bar_offset,
            "max_seq_len": self.max_seq_len,
            "max_notes": self.max_notes,
            "meters": self.meters,
            "dt_edges": self.dt_edges,
            "dur_edges": self.dur_edges,
            "lengths_bars": self.lengths_bars,
        }


def encode_globals(spec, mode, meter, prev_class, prev_func, wlen_bars, hyper, grid):
    """Return int list of length N_GLOBALS (ids into per-slot tables)."""
    meter_id = spec.meter_index.get(int(round(meter)), len(spec.meters)) + 1
    wlen_id = spec.wlen_index.get(round(wlen_bars, 4), 0) + 1
    return [
        0,                                   # CLS (single vector)
        (0 if mode == "maj" else 1),         # MODE
        meter_id,                            # METER (pad=0 for unknown handled by +1)
        prev_class + 1,                      # PREVCHORD (0..n_classes incl BOS) +1 pad
        prev_func + 1,                       # PREVFUNC (0..3 incl BOS) +1 pad
        wlen_id,                             # WLEN
        hyper + 1,                           # HYPER (0..7) +1 pad
        grid + 1,                            # GRIDPOS (0 downbeat /1 midbar) +1 pad
    ]


def encode_notes(spec, notes, t, mask_notes=False):
    """notes: list of Note in [t-L, t). Returns dict of parallel int lists.

    If mask_notes is True, emits an empty note set (melody-masked ablation).
    """
    streams = {k: [] for k in NOTE_FEATS}
    if mask_notes:
        return streams
    for n in notes:
        streams["pc"].append((n.pitch % 12) + 1)
        streams["octave"].append(spec.octave_id(n.pitch))
        streams["dt"].append(spec.dt_id(t - n.onset))
        streams["dur"].append(spec.dur_id(n.dur))
        streams["phase"].append(spec.phase_id(n.onset_in_bar, n.beats_per_bar))
        streams["downbeat"].append((1 if abs(n.onset_in_bar) < 1e-6 else 0) + 1)
        bo = min(spec.max_bar_offset, int((t - n.onset) // max(1e-6, n.beats_per_bar)))
        streams["bar_offset"].append(bo + 1)
    return streams


def prev_function(prev_class, mode):
    """T/PD/D of the previous chord, or BOS index (=len(FUNCTIONS))."""
    if prev_class == data.bos_id():
        return len(vocab.FUNCTIONS)
    return vocab.function_of(prev_class, mode)
