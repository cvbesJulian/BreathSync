// Node for Max entry point (node.script). Loads the ONNX model once, then
// answers "predict" requests from Max with the chosen next chord. Max owns
// beat timing and Ableton sync; this process is stateless per request.
//
// NOTE: runs only inside Max (needs the `max-api` package Max injects). It is
// intentionally thin — all tested logic lives in predict.js / features.js /
// rerank.js (see test_parity.mjs). Not exercised by the headless harness.
//
// Message protocol (Max -> node):
//   predict <json>
// where <json> is a dict:
//   { "notes": [[pitch, onset, dur, onsetInBar, beatsPerBar], ...],  // onset absolute beats
//     "t": <decision beat>, "mode": "maj"|"min", "meter": 4,
//     "prevClass": <id|-> , "prevFunc": <0..3|4=BOS>, "wlenBars": 2.0,
//     "hyper": 0, "grid": 0, "soundingClass": <id>, "transposeOffset": 0,
//     "freedom": 0.0 }
// Reply (node -> Max), on the default outlet:
//   chord <classId> <roman> <absName>
//   chordpcs <pc> <pc> ...
//   top <classId> <prob> <classId> <prob> ...   (model top-5, for UI)
import maxApi from "max-api";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ort from "onnxruntime-node";

import { loadModel, predict, melodyContext } from "./predict.js";
import { classPcs, romanOf, absoluteLabel } from "./vocab.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ART = join(HERE, "..", "artifacts");
const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"));

let model = null;

async function init() {
  const modelConfig = readJSON(join(ART, "onnx", "model_config.json"));
  const rerankerConfig = readJSON(join(ART, "reranker_config.json"));
  model = await loadModel(ort, join(ART, "onnx", "model.onnx"), modelConfig, rerankerConfig);
  maxApi.post(`nextchord: model loaded (${modelConfig.n_classes} classes)`);
}

maxApi.addHandler("predict", async (payload) => {
  if (!model) { maxApi.post("nextchord: model not ready"); return; }
  const req = typeof payload === "string" ? JSON.parse(payload) : payload;
  const notes = (req.notes || []).map(([pitch, onset, dur, onsetInBar, beatsPerBar]) =>
    ({ pitch, onset, dur, onsetInBar, beatsPerBar }));
  const { windowPcs, strongPcs } = melodyContext(notes, req.t, req.meter);
  const ctx = {
    mode: req.mode, meter: req.meter, prevClass: req.prevClass, prevFunc: req.prevFunc,
    wlenBars: req.wlenBars, hyper: req.hyper, grid: req.grid,
    soundingClass: req.soundingClass, transposeOffset: req.transposeOffset ?? 0,
    windowPcs, strongPcs, freedom: req.freedom ?? 0.0,
  };
  const out = await predict(ort, model, notes, req.t, ctx);
  const pcs = classPcs(model.vocab, out.chosen) || [];
  await maxApi.outlet("chord", out.chosen, out.roman, out.chord);
  await maxApi.outlet("chordpcs", ...pcs);
  const top = out.logprobs
    .map((lp, i) => [i, Math.exp(lp)])
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .flatMap(([i, p]) => [i, +p.toFixed(3)]);
  await maxApi.outlet("top", ...top);
});

init().catch((e) => maxApi.post("nextchord init error: " + e.message));
