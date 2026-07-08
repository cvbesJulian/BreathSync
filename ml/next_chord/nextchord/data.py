"""Load OpenBook per-song JSON + songs.csv and extract decision points.

Timeline notes:
- Absolute beat positions come from a cumulative sum of per-bar
  ``beats_per_bar`` (handles the rare 3/4 and 5/4 tunes among mostly 4/4).
- Melody pitches in the JSON are NOT transposed; chord ``t`` labels are.
  We transpose pitches with ``pitch + transpose_offset`` so melody and chord
  classes share the C-relative (maj) / A-relative (min) space.
- Jazz changes chords constantly (downbeat hold-rate ~14%) and onsets land on
  beats, so the decision grid is beat-level: every real chord onset is a change
  decision; integer beats with no onset are HOLD candidates (subsampled).
"""

import csv
import glob
import json
import os
from dataclasses import dataclass, field

from . import vocab

DOWNBEAT, MIDBAR = 0, 1
EPS = 1e-6


def bos_id():
    """Previous-chord token used for song-initial decisions."""
    return vocab.n_classes()


@dataclass
class Note:
    pitch: int          # transposed (C/A-relative) MIDI pitch
    onset: float        # absolute beats from song start
    dur: float
    bar_idx: int
    onset_in_bar: float
    beats_per_bar: float


@dataclass
class DecisionPoint:
    t: float
    bar_idx: int
    beat_in_bar: float
    grid: int
    target: int
    target_label: str
    prev_class: int          # sounding class before t, or bos_id()
    prev_label: str
    sounding_class: int      # class in effect at/just-before t (for HOLD scoring)
    hyper: int
    is_hold_candidate: bool


@dataclass
class Song:
    song_id: str
    mode: str                # "maj" | "min"
    key: str
    transpose_offset: int
    collection: str          # OpenBook has no sub-collections; use mode
    beats_per_bar: float
    n_bars: int
    notes: list = field(default_factory=list)
    bar_starts: list = field(default_factory=list)
    bar_beats: list = field(default_factory=list)
    decisions: list = field(default_factory=list)


def load_song_meta(dataset_dir, songs_csv="songs.csv", source="openbook"):
    meta = {}
    with open(os.path.join(dataset_dir, songs_csv), newline="") as f:
        for row in csv.DictReader(f):
            if row["source"] != source or row["included"] != "True":
                continue
            meta[row["song_id"]] = {
                "mode": row["mode"],
                "key": row["key"],
                "transpose_offset": int(float(row["transpose_offset"])),
            }
    return meta


def _bar_of(bar_starts, bar_beats, t):
    """Return (bar_idx, beat_in_bar) for absolute beat t."""
    lo, hi = 0, len(bar_starts) - 1
    idx = 0
    for i in range(len(bar_starts)):
        if bar_starts[i] <= t + EPS:
            idx = i
        else:
            break
    return idx, t - bar_starts[idx]


def load_song(path, meta):
    with open(path) as f:
        d = json.load(f)
    m = meta[d["song_id"]]
    offset = m["transpose_offset"]
    song = Song(
        song_id=d["song_id"], mode=m["mode"], key=m["key"],
        transpose_offset=offset, collection=m["mode"],
        beats_per_bar=d["beats_per_bar"], n_bars=d["n_bars"],
    )

    t = 0.0
    for bar in d["bars"]:
        song.bar_starts.append(t)
        song.bar_beats.append(float(bar["beats_per_bar"]))
        t += float(bar["beats_per_bar"])
    song_end = t

    for i, bar in enumerate(d["bars"]):
        start, bpb = song.bar_starts[i], song.bar_beats[i]
        for pitch, onset, dur, _vel in bar["notes"]:
            song.notes.append(Note(
                pitch=pitch + offset, onset=start + onset, dur=dur,
                bar_idx=i, onset_in_bar=onset, beats_per_bar=bpb,
            ))
    song.notes.sort(key=lambda n: n.onset)

    _extract_decisions(song, d["bars"], song_end)
    return song


def _extract_decisions(song, bars, song_end):
    # global, absolute-beat chord-event timeline
    events = []  # (abs_beat, class_id, label_t)
    for i, bar in enumerate(bars):
        start = song.bar_starts[i]
        for c in bar["chords"]:
            events.append((start + float(c["onset"]), vocab.class_of(c["t"]), c["t"]))
    events.sort(key=lambda e: e[0])
    if not events:
        return

    first_t = events[0][0]
    first_bar = _bar_of(song.bar_starts, song.bar_beats, first_t)[0]

    def hyper_at(t):
        return (_bar_of(song.bar_starts, song.bar_beats, t)[0] - first_bar) % 8

    def add(t, grid, target, target_label, prev_class, prev_label,
            sounding_class, is_hold_candidate=False):
        bi, bib = _bar_of(song.bar_starts, song.bar_beats, t)
        song.decisions.append(DecisionPoint(
            t=t, bar_idx=bi, beat_in_bar=bib, grid=grid, target=target,
            target_label=target_label, prev_class=prev_class,
            prev_label=prev_label, sounding_class=sounding_class,
            hyper=hyper_at(t), is_hold_candidate=is_hold_candidate,
        ))

    # 1) every chord onset -> change (or restate = HOLD)
    for j, (te, cls, lab) in enumerate(events):
        if j == 0:
            prev_class, prev_label = bos_id(), ""
            target = cls  # establish the first chord
        else:
            _, pcls, plab = events[j - 1]
            prev_class, prev_label = pcls, plab
            target = vocab.HOLD if cls == pcls else cls
        grid = DOWNBEAT if abs(te - round(te)) < EPS and \
            _bar_of(song.bar_starts, song.bar_beats, te)[1] < EPS else MIDBAR
        add(te, grid, target, lab, prev_class, prev_label,
            sounding_class=(cls if target == vocab.HOLD else prev_class if prev_class != bos_id() else cls))

    # 2) integer beats with no onset, while a chord sounds -> HOLD candidate
    onset_set = {round(te, 4) for te, _, _ in events}
    ev_beats = [te for te, _, _ in events]
    ev_cls = [cls for _, cls, _ in events]
    ev_lab = [lab for _, _, lab in events]

    def sounding_before(t):
        # last event strictly before t
        idx = None
        for k, te in enumerate(ev_beats):
            if te < t - EPS:
                idx = k
            else:
                break
        return idx

    b = float(int(first_t))
    while b <= song_end + EPS:
        if b >= first_t - EPS and round(b, 4) not in onset_set:
            idx = sounding_before(b)
            if idx is not None:
                bi = _bar_of(song.bar_starts, song.bar_beats, b)
                grid = DOWNBEAT if bi[1] < EPS else MIDBAR
                add(b, grid, vocab.HOLD, ev_lab[idx], ev_cls[idx], ev_lab[idx],
                    sounding_class=ev_cls[idx], is_hold_candidate=True)
        b += 1.0

    song.decisions.sort(key=lambda dp: (dp.t, dp.is_hold_candidate))


def load_all_songs(dataset_dir, songs_glob="improspira_max/songs/openbook.*.json",
                   songs_csv="songs.csv", source="openbook"):
    meta = load_song_meta(dataset_dir, songs_csv, source)
    songs = {}
    for path in sorted(glob.glob(os.path.join(dataset_dir, songs_glob))):
        song_id = os.path.basename(path).split(".", 1)[1].rsplit(".", 1)[0]
        if song_id in meta:
            songs[song_id] = load_song(path, meta)
    return songs
