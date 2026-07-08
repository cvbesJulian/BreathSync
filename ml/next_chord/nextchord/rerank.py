"""Theory-constrained reranker (minimal, config-driven).

Rescores the model's top-k candidates:

  score(c) = log p_model(c)
           + alpha * melody_fit(c)
           + beta  * log T_func[f_prev -> f(c)]
           + gamma * log P_markov(c | prev_class)
           - delta * clash(c)

All constants live in artifacts/reranker_config.json so the future JS port and
the Python demo stay in lock-step (tests/test_rerank_vectors.py replays frozen
vectors). Knobs: `freedom` is wired (softmax temperature on p_model); the
others (tension/complexity/evolution) are accepted and documented no-ops until
the realization/knob layer exists.
"""

import json
import math
import os

from . import vocab

DEFAULT_CONFIG = {
    "alpha": 1.0, "beta": 0.5, "gamma": 0.5, "delta": 1.0,
    "topk": 5,
    "func_transition": {
        "T":  {"T": 0.35, "PD": 0.45, "D": 0.20},
        "PD": {"T": 0.15, "PD": 0.35, "D": 0.50},
        "D":  {"T": 0.65, "PD": 0.15, "D": 0.20},
        "BOS": {"T": 0.50, "PD": 0.30, "D": 0.20},
    },
    "exclude_other_from_selection": True,
}

_CFG_PATH = os.path.join(os.path.dirname(__file__), "..", "artifacts", "reranker_config.json")


def load_config(path=None):
    p = path or _CFG_PATH
    if os.path.exists(p):
        return json.load(open(p))
    return dict(DEFAULT_CONFIG)


def save_default_config(path=None):
    p = path or _CFG_PATH
    json.dump(DEFAULT_CONFIG, open(p, "w"), indent=1)
    return p


def melody_fit(class_id, sounding_class, window_pcs):
    """Duration-weighted fraction of window melody mass that are chord tones.

    window_pcs: list of (pitch_class, weight). For HOLD, evaluate against the
    sounding chord's tones.
    """
    ref = sounding_class if class_id == vocab.HOLD else class_id
    pcs = vocab.class_pcs(ref)
    if not pcs or not window_pcs:
        return 0.0
    pcs = set(pcs)
    total = sum(w for _, w in window_pcs)
    if total <= 0:
        return 0.0
    hit = sum(w for pc, w in window_pcs if pc in pcs)
    return hit / total


def clash(class_id, sounding_class, strong_pcs):
    """1.0 if any strong-beat melody pc sits a semitone from a chord tone
    (and is not itself a chord tone), else 0.0."""
    ref = sounding_class if class_id == vocab.HOLD else class_id
    pcs = vocab.class_pcs(ref)
    if not pcs:
        return 0.0
    pcs = set(pcs)
    for pc in strong_pcs:
        if pc in pcs:
            continue
        if ((pc + 1) % 12 in pcs) or ((pc - 1) % 12 in pcs):
            return 1.0
    return 0.0


def _func_name(f):
    return vocab.FUNCTIONS[f]


def rerank(model_logprobs, prev_class, prev_func, sounding_class, mode,
           window_pcs, strong_pcs, markov_logdist, cfg=None,
           freedom=0.0, tension=0.5, complexity=0.5, evolution=0.5):
    """Return list of dicts (sorted by score desc) with component breakdown.

    model_logprobs: list[float] length n_classes (already log-softmax).
    markov_logdist:  list[float] length n_classes (log P_markov(.|prev)).
    """
    cfg = cfg or load_config()
    n = vocab.n_classes()
    # freedom knob: temperature on model distribution (>0 flattens)
    temp = 1.0 + 2.0 * max(0.0, min(1.0, freedom))
    scaled = [lp / temp for lp in model_logprobs]

    # candidate set: top-k of the (temized) model distribution
    order = sorted(range(n), key=lambda i: scaled[i], reverse=True)
    cand = [i for i in order]
    if cfg.get("exclude_other_from_selection", True):
        cand = [i for i in cand if i != vocab.other_id()]
    cand = cand[:cfg["topk"]]

    fprev = "BOS" if prev_func >= len(vocab.FUNCTIONS) else _func_name(prev_func)
    ft = cfg["func_transition"][fprev]

    results = []
    for c in cand:
        mf = melody_fit(c, sounding_class, window_pcs)
        cl = clash(c, sounding_class, strong_pcs)
        fc = _func_name(vocab.function_of(c if c != vocab.HOLD else sounding_class, mode))
        f_score = math.log(max(1e-6, ft.get(fc, 1e-6)))
        mk = markov_logdist[c] if markov_logdist is not None else 0.0
        score = (scaled[c]
                 + cfg["alpha"] * mf
                 + cfg["beta"] * f_score
                 + cfg["gamma"] * mk
                 - cfg["delta"] * cl)
        results.append({
            "class": c, "score": score, "model_logp": model_logprobs[c],
            "melody_fit": mf, "func_score": f_score, "markov_logp": mk, "clash": cl,
        })
    results.sort(key=lambda r: r["score"], reverse=True)
    return results
