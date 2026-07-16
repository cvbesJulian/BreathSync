"""Replay frozen COMBINED-vocab reranker vectors (Python<->JS port parity).

Loads the combined vocab for the replay and restores the default afterwards,
since nextchord.vocab keeps module-global state shared with the other tests.
"""
import json
import os

import pytest

from nextchord import rerank as rr, vocab

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VEC = os.path.join(ROOT, "artifacts", "combined", "test_vectors.json")


@pytest.mark.skipif(not os.path.exists(VEC),
                    reason="run scripts/make_combined_deploy_fixtures.py first")
def test_reranker_reproduces_combined_vectors():
    data = json.load(open(VEC))
    vocab.load(os.path.join(ROOT, data["vocab_path"]))
    try:
        cfg = data["reranker_config"]
        for v in data["vectors"]:
            inp = v["input"]
            res = rr.rerank(inp["model_logprobs"], inp["prev_class"], inp["prev_func"],
                            inp["sounding_class"], inp["mode"],
                            [(p, w) for p, w in inp["window_pcs"]], inp["strong_pcs"],
                            inp["markov_logdist"], cfg=cfg)
            got = [(r["class"], round(r["score"], 6)) for r in res]
            exp = [(e["class"], e["score"]) for e in v["expected"]]
            assert [g[0] for g in got] == [e[0] for e in exp], "class order drift"
            for (gc, gs), (ec, es) in zip(got, exp):
                assert abs(gs - es) < 1e-4, (gc, gs, es)
    finally:
        vocab.load()  # restore the default vocab for other tests
