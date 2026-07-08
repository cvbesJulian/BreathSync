"""First-order chord Markov baseline — melody-blind, train-split only.

P(target_class | prev_class) with add-alpha smoothing, estimated over the same
beat-grid decision points the neural models see (so the HOLD base rate matches).
This is the floor the melody-aware models must beat, and it also feeds the
reranker as a harmonic transition prior.
"""

import numpy as np

from . import vocab
from .data import bos_id


class MarkovBaseline:
    def __init__(self, alpha=0.5):
        self.alpha = alpha
        self.n = None
        self.logp = None  # [n_prev, n_classes]

    def fit(self, refs):
        n = vocab.n_classes()
        n_prev = n + 1  # + BOS
        counts = np.full((n_prev, n), self.alpha, dtype=np.float64)
        for song, dp in refs:
            prev = bos_id() if dp.prev_class == bos_id() else dp.prev_class
            counts[prev, dp.target] += 1.0
        self.n = n
        self.logp = np.log(counts / counts.sum(axis=1, keepdims=True))
        return self

    def log_dist(self, prev_class):
        return self.logp[prev_class]

    def log_dist_batch(self, prev_classes):
        return self.logp[np.asarray(prev_classes)]
