// JS port of nextchord/rerank.py. Driven by reranker_config.json. Must match
// the Python reference; test_parity.mjs replays frozen golden vectors.
import { classPcs, functionOf } from "./vocab.js";

function melodyFit(v, classId, soundingClass, windowPcs) {
  const ref = classId === v.HOLD ? soundingClass : classId;
  const pcs = classPcs(v, ref);
  if (!pcs || windowPcs.length === 0) return 0.0;
  const set = new Set(pcs);
  let total = 0, hit = 0;
  for (const [pc, w] of windowPcs) { total += w; if (set.has(pc)) hit += w; }
  return total <= 0 ? 0.0 : hit / total;
}

function clash(v, classId, soundingClass, strongPcs) {
  const ref = classId === v.HOLD ? soundingClass : classId;
  const pcs = classPcs(v, ref);
  if (!pcs) return 0.0;
  const set = new Set(pcs);
  for (const pc of strongPcs) {
    if (set.has(pc)) continue;
    if (set.has((pc + 1) % 12) || set.has((pc + 11) % 12)) return 1.0;
  }
  return 0.0;
}

// modelLogprobs: Float array length nClasses (log-softmax). markovLogdist same.
export function rerank(v, cfg, modelLogprobs, ctx) {
  const { prevFunc, soundingClass, mode, windowPcs, strongPcs, markovLogdist } = ctx;
  const freedom = ctx.freedom ?? 0.0;
  const temp = 1.0 + 2.0 * Math.max(0.0, Math.min(1.0, freedom));
  const scaled = modelLogprobs.map((lp) => lp / temp);

  let cand = [...scaled.keys()].sort((a, b) => scaled[b] - scaled[a]);
  if (cfg.exclude_other_from_selection) cand = cand.filter((i) => i !== v.OTHER);
  cand = cand.slice(0, cfg.topk);

  const fprev = prevFunc >= v.functions.length ? "BOS" : v.functions[prevFunc];
  const ft = cfg.func_transition[fprev];

  const results = cand.map((c) => {
    const mf = melodyFit(v, c, soundingClass, windowPcs);
    const cl = clash(v, c, soundingClass, strongPcs);
    const fc = v.functions[functionOf(v, c === v.HOLD ? soundingClass : c, mode)];
    const fScore = Math.log(Math.max(1e-6, ft[fc] ?? 1e-6));
    const mk = markovLogdist ? markovLogdist[c] : 0.0;
    const score = scaled[c] + cfg.alpha * mf + cfg.beta * fScore + cfg.gamma * mk - cfg.delta * cl;
    return { class: c, score, model_logp: modelLogprobs[c], melody_fit: mf, func_score: fScore, markov_logp: mk, clash: cl };
  });
  results.sort((a, b) => b.score - a.score);
  return results;
}
