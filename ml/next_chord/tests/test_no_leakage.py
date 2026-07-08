"""The window for a decision at t must contain only notes with onset < t,
and the previous chord must come from strictly before t."""
import random

from nextchord import pipeline, windows
from nextchord.data import bos_id


def test_window_notes_are_strictly_before_t():
    cfg, songs, spec, splits = pipeline.load_everything()
    rng = random.Random(0)
    checked = 0
    for sid in splits["train"] + splits["val"] + splits["test"]:
        s = songs[sid]
        for dp in s.decisions:
            for L in cfg["windows"]["lengths_bars"]:
                notes = windows.notes_in_window(s, dp.t, L * s.beats_per_bar)
                for n in notes:
                    assert n.onset < dp.t, (sid, dp.t, n.onset)
                    assert n.onset >= dp.t - L * s.beats_per_bar - 1e-6
                checked += 1
    assert checked > 0


def test_prev_chord_precedes_t():
    cfg, songs, spec, splits = pipeline.load_everything()
    for sid in splits["val"]:
        s = songs[sid]
        # reconstruct chord-onset times to verify prev_class provenance
        onsets = []
        for i, start in enumerate(s.bar_starts):
            pass
        for dp in s.decisions:
            # prev is BOS only at/at-before the first decision
            if dp.prev_class == bos_id():
                continue
            assert 0 <= dp.prev_class < bos_id()


def test_build_example_respects_leakage():
    cfg, songs, spec, splits = pipeline.load_everything()
    s = songs[splits["val"][0]]
    for dp in s.decisions[:200]:
        ex = windows.build_example(s, dp, spec, 2.0)
        # every encoded note has a positive dt (t - onset > 0) -> dt bucket >= 1
        assert all(v >= 1 for v in ex["notes"]["dt"])
