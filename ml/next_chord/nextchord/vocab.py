"""Jazz chord-class vocabulary in transposed space (C major / A minor relative).

A class is a (transposed root pitch-class, quality-family) pair. Quality is
collapsed to a *family* — MAJ / DOM / MIN / HDIM / DIM / AUG / SUS — because
the family is what carries harmonic function (Cmaj7 = I vs C7 = V/IV vs
Dm7 = ii vs Bo7). Sevenths / tensions are re-added later by the realization
layer, exactly as with the Complexity knob.

The concrete class list is *data-driven*: `scripts/build_vocab.py` counts
(root, family) pairs over the training split, keeps those above a threshold,
and freezes the result to ``artifacts/vocab.json``. This module loads that
file and exposes id<->label helpers. HOLD is always id 0; OTHER is the last id.
"""

import json
import os

ROOT_PC = {
    "C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "Fb": 4,
    "E#": 5, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9,
    "A#": 10, "Bb": 10, "B": 11, "Cb": 11,
}
PC_NAME = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]

FAMILIES = ["MAJ", "DOM", "MIN", "HDIM", "DIM", "AUG", "SUS"]

# canonical quality (after the ':') -> family
QUALITY_FAMILY = {
    "maj": "MAJ", "maj7": "MAJ", "maj6": "MAJ", "6": "MAJ", "add9": "MAJ",
    "7": "DOM", "9": "DOM", "11": "DOM", "13": "DOM", "7b9": "DOM", "7#9": "DOM",
    "7b5": "DOM", "7#5": "DOM", "7alt": "DOM",
    "min": "MIN", "min7": "MIN", "min6": "MIN", "min9": "MIN", "min11": "MIN",
    "minmaj7": "MIN",
    "hdim7": "HDIM", "min7b5": "HDIM", "m7b5": "HDIM",
    "dim": "DIM", "dim7": "DIM",
    "aug": "AUG", "aug7": "AUG",
    "sus4": "SUS", "sus2": "SUS", "7sus4": "SUS",
}

# chord tones (semitones above root) per family, for melody-fit / clash scoring
FAMILY_PCS = {
    "MAJ": (0, 4, 7),
    "DOM": (0, 4, 7, 10),
    "MIN": (0, 3, 7),
    "HDIM": (0, 3, 6, 10),
    "DIM": (0, 3, 6),
    "AUG": (0, 4, 8),
    "SUS": (0, 5, 7),
}

FUNCTIONS = ["T", "PD", "D"]
T, PD, D = 0, 1, 2

# transposed tonic pitch class per mode (major -> C, minor -> A)
TONIC_PC = {"maj": 0, "min": 9}

HOLD = 0

# ---- module state, populated by load() -------------------------------------
_LOADED = False
_CLASS_KEYS = []          # list of (root_pc, family), index i -> class id i+1
_KEY_TO_ID = {}           # (root_pc, family) -> class id
_OTHER_ID = None
_N_CLASSES = None
_VOCAB_PATH = os.path.join(os.path.dirname(__file__), "..", "artifacts", "vocab.json")


def parse_label(label_t):
    """'G:7' -> (root_pc, family). family is None if quality is unknown."""
    root, _, quality = label_t.partition(":")
    pc = ROOT_PC.get(root)
    if pc is None:
        return None, None
    return pc, QUALITY_FAMILY.get(quality)


def class_key(label_t):
    """Transposed label -> (root_pc, family) or None if unparseable."""
    pc, fam = parse_label(label_t)
    if pc is None or fam is None:
        return None
    return (pc, fam)


def load(path=None):
    """Load the frozen vocabulary. Idempotent."""
    global _LOADED, _CLASS_KEYS, _KEY_TO_ID, _OTHER_ID, _N_CLASSES
    p = path or _VOCAB_PATH
    with open(p) as f:
        v = json.load(f)
    _CLASS_KEYS = [(c["root"], c["family"]) for c in v["classes"]]
    _KEY_TO_ID = {k: i + 1 for i, k in enumerate(_CLASS_KEYS)}
    _OTHER_ID = len(_CLASS_KEYS) + 1
    _N_CLASSES = _OTHER_ID + 1
    _LOADED = True
    return v


def _ensure():
    if not _LOADED:
        load()


def n_classes():
    _ensure()
    return _N_CLASSES


def other_id():
    _ensure()
    return _OTHER_ID


def class_of(label_t):
    """Transposed chord label -> class id (OTHER if outside the frozen vocab)."""
    _ensure()
    k = class_key(label_t)
    if k is None:
        return _OTHER_ID
    return _KEY_TO_ID.get(k, _OTHER_ID)


def key_of_class(class_id):
    """Class id -> (root_pc, family), or None for HOLD/OTHER."""
    _ensure()
    if class_id == HOLD or class_id == _OTHER_ID:
        return None
    return _CLASS_KEYS[class_id - 1]


def class_pcs(class_id):
    """Absolute (transposed-space) chord-tone pitch classes for a class."""
    k = key_of_class(class_id)
    if k is None:
        return None
    root, fam = k
    return tuple((root + iv) % 12 for iv in FAMILY_PCS[fam])


def _degree(root_pc, mode):
    return (root_pc - TONIC_PC[mode]) % 12


# scale-degree roman for MAJ/MIN triadic classes (mode-relative)
_DEGREE_ROMAN = {
    "maj": {0: "I", 2: "II", 4: "III", 5: "IV", 7: "V", 9: "VI", 11: "VII",
            1: "bII", 3: "bIII", 6: "#IV", 8: "bVI", 10: "bVII"},
    "min": {0: "I", 2: "II", 3: "III", 5: "IV", 7: "V", 8: "VI", 10: "VII",
            1: "bII", 4: "#III", 6: "#IV", 9: "#VI", 11: "VII+"},
}


def roman_of(class_id, mode):
    _ensure()
    if class_id == HOLD:
        return "HOLD"
    if class_id == _OTHER_ID:
        return "OTHER"
    root, fam = _CLASS_KEYS[class_id - 1]
    deg = _degree(root, mode)
    rn = _DEGREE_ROMAN[mode].get(deg, "?")
    if fam in ("MIN", "HDIM", "DIM"):
        rn = rn.lower()
    suffix = {"MAJ": "", "DOM": "7", "MIN": "", "HDIM": "ø7",
              "DIM": "°", "AUG": "+", "SUS": "sus"}[fam]
    return rn + suffix


def function_of(class_id, mode):
    """Class id -> T/PD/D (auxiliary label). HOLD callers should pass the
    sounding class instead."""
    _ensure()
    if class_id == HOLD:
        return T
    if class_id == _OTHER_ID:
        return D  # tail is dominated by altered/passing chords
    root, fam = _CLASS_KEYS[class_id - 1]
    if fam in ("DOM", "DIM", "AUG", "SUS"):
        return D
    if fam == "HDIM":
        return PD
    deg = _degree(root, mode)  # MAJ or MIN family
    if mode == "maj":
        if deg in (0, 4, 9, 3):      # I, iii, vi, bIII
            return T
        if deg in (2, 5, 8, 10):     # ii, IV, bVI, bVII
            return PD
        if deg in (7, 11):           # V, vii
            return D
        return T
    else:  # minor (tonic A)
        if deg in (0, 3, 8):         # i, III, VI
            return T
        if deg in (2, 5, 10):        # ii, iv, VII
            return PD
        if deg in (7, 11):           # v/V, vii
            return D
        return T


def absolute_label(class_id, transpose_offset, mode="maj"):
    """Class id -> absolute chord name (inverts tonic->C/A transposition)."""
    _ensure()
    if class_id == HOLD:
        return "HOLD"
    if class_id == _OTHER_ID:
        return "OTHER"
    root, fam = _CLASS_KEYS[class_id - 1]
    abs_root = (root - int(transpose_offset)) % 12
    suffix = {"MAJ": "", "DOM": "7", "MIN": "m", "HDIM": "m7b5",
              "DIM": "dim", "AUG": "aug", "SUS": "sus4"}[fam]
    return PC_NAME[abs_root] + suffix
