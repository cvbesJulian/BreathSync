"""Window sampling, leakage-guarded note gathering, and example assembly.

Leakage guard (correctness-critical): the melody window for a decision at
beat ``t`` contains only notes with ``onset < t``; the previous chord/function
come from strictly before ``t`` (established in data.py). Enforced here and
asserted by tests/test_no_leakage.py.
"""

import copy

from . import vocab, features
from .data import bos_id


def sample_window_bars(rng, spec, weights):
    return rng.choices(spec.lengths_bars, weights=weights, k=1)[0]


def notes_in_window(song, t, L_beats):
    lo = t - L_beats
    out = []
    for n in song.notes:
        if n.onset < t - 1e-9 and n.onset >= lo - 1e-9:
            out.append(n)
    return out


def _augment(notes, rng, aug):
    kept = []
    for n in notes:
        if rng.random() < aug["note_dropout"]:
            continue
        if n.dur < aug["ornament_max_dur"] and rng.random() < aug["ornament_dropout"]:
            continue
        kept.append(n)
    if kept and rng.random() < aug["octave_shift_prob"]:
        shift = 12 if rng.random() < 0.5 else -12
        shifted = []
        for n in kept:
            m = copy.copy(n)
            m.pitch = n.pitch + shift
            shifted.append(m)
        kept = shifted
    return kept


def func_target_of(dp, mode):
    if dp.target == vocab.HOLD:
        return vocab.function_of(dp.sounding_class, mode)
    return vocab.function_of(dp.target, mode)


def build_example(song, dp, spec, wlen_bars, rng=None, aug=None, mask_notes=False):
    """Assemble one encoded example for decision point dp."""
    L_beats = wlen_bars * song.beats_per_bar
    notes = notes_in_window(song, dp.t, L_beats)
    if aug is not None and rng is not None:
        notes = _augment(notes, rng, aug)
    # truncate to the most recent max_notes (keep nearest to t)
    if len(notes) > spec.max_notes:
        notes = notes[-spec.max_notes:]

    prev_func = features.prev_function(dp.prev_class, song.mode)
    global_ids = features.encode_globals(
        spec, song.mode, song.beats_per_bar, dp.prev_class, prev_func,
        wlen_bars, dp.hyper, dp.grid,
    )
    note_streams = features.encode_notes(spec, notes, dp.t, mask_notes=mask_notes)
    return {
        "global_ids": global_ids,
        "notes": note_streams,
        # honest count of ENCODED notes: 0 under mask_notes, so the melody-masked
        # ablation is truly note-blind (note_mask all False) instead of attending
        # to N identical placeholder tokens and leaking the note count.
        "n_notes": len(note_streams["pc"]),
        "target": dp.target,
        "func_target": func_target_of(dp, song.mode),
        "meta": {
            "song_id": song.song_id, "mode": song.mode, "meter": song.beats_per_bar,
            "grid": dp.grid, "wlen": wlen_bars, "is_change": dp.target != vocab.HOLD,
            "prev_class": dp.prev_class, "sounding_class": dp.sounding_class,
            "transpose_offset": song.transpose_offset, "t": dp.t,
        },
    }


def window_pcs(song, t, span_beats):
    """Duration-weighted (pitch_class, weight) list for notes in [t-span, t)."""
    lo = t - span_beats
    out = []
    for n in song.notes:
        if lo - 1e-9 <= n.onset < t - 1e-9:
            out.append((n.pitch % 12, max(1e-3, n.dur)))
    return out


def strong_pcs(song, t, span_beats):
    """Pitch classes of notes on strong (near-integer) beats in [t-span, t)."""
    lo = t - span_beats
    out = []
    for n in song.notes:
        if lo - 1e-9 <= n.onset < t - 1e-9:
            if abs(n.onset_in_bar - round(n.onset_in_bar)) < 1e-3:
                out.append(n.pitch % 12)
    return out


def split_decisions(songs, split_ids):
    """All decision points for the given song ids, tagged fixed vs hold-pool."""
    fixed, hold_pool = [], []
    for sid in split_ids:
        s = songs.get(sid)
        if s is None:
            continue
        for dp in s.decisions:
            if dp.is_hold_candidate:
                hold_pool.append((s, dp))
            else:
                fixed.append((s, dp))
    return fixed, hold_pool


def epoch_example_refs(fixed, hold_pool, hold_target_frac, rng):
    """Return a resampled list of (song, dp) refs with HOLD balanced.

    Keeps all fixed decisions (changes + chord-onset restates) and subsamples
    the integer-beat HOLD pool so HOLD ends near ``hold_target_frac``.
    """
    n_fixed_hold = sum(1 for _, dp in fixed if dp.target == vocab.HOLD)
    n_change = len(fixed) - n_fixed_hold
    if hold_target_frac is None:
        H = len(hold_pool)  # keep the natural distribution
    else:
        # solve (n_fixed_hold + H) / (len(fixed) + H) = frac
        f = hold_target_frac
        denom = (1.0 - f)
        H = int(round((f * len(fixed) - n_fixed_hold) / denom)) if denom > 1e-9 else 0
        H = max(0, min(H, len(hold_pool)))
    sampled = rng.sample(hold_pool, H) if H < len(hold_pool) else list(hold_pool)
    refs = list(fixed) + sampled
    rng.shuffle(refs)
    return refs, {"n_change": n_change, "n_fixed_hold": n_fixed_hold, "n_hold_sampled": H}
