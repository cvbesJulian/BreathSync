// Node for Max entry point (node.script). Loads the ONNX model once, then
// answers "predict" requests from bs.chord.js with the chosen next chord.
// Max owns beat timing and Ableton sync; this process is stateless per request.
//
// NOTE: runs only inside Max (needs the `max-api` package Max injects). It is a
// thin max-api wrapper around chord_service.js — all logic is tested by
// deploy/test_parity.mjs and max4live/test/chord.harness.mjs (which drives this
// exact request/reply contract against the real model, without max-api).
//
// Request (Max -> node):  predict <json>
//   { notes:[[pitch,onset,dur,onsetInBar,beatsPerBar],...],  // pitch = model space
//     t, mode:"maj"|"min", meter, prevClass, soundingClass,  // -1 = BOS / none
//     wlenBars, hyper, grid, transposeOffset, freedom }
// Reply (node -> Max):
//   modelchord <classId> <familyIdx> <soundingRootPc> <roman> <absName>
//     familyIdx < 0  => HOLD / OTHER (device sustains the current chord)
//   top <classId> <prob> ...   (model top-5, for UI)
import maxApi from "max-api";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ort from "onnxruntime-node";

import { loadModel } from "./predict.js";
import { respond } from "./chord_service.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ART = join(HERE, "..", "artifacts");
const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"));

let model = null;
let modelConfig = null;

async function init() {
  modelConfig = readJSON(join(ART, "onnx", "model_config.json"));
  const rerankerConfig = readJSON(join(ART, "reranker_config.json"));
  model = await loadModel(ort, join(ART, "onnx", "model.onnx"), modelConfig, rerankerConfig);
  maxApi.post(`nextchord: model loaded (${modelConfig.n_classes} classes)`);
}

maxApi.addHandler("predict", async (payload) => {
  if (!model) { maxApi.post("nextchord: model not ready"); return; }
  const req = typeof payload === "string" ? JSON.parse(payload) : payload;
  const r = await respond(ort, model, modelConfig, req);
  await maxApi.outlet("modelchord", r.classId, r.familyIdx, r.soundingRootPc, r.roman, r.chord);
  const top = r.logprobs
    .map((lp, i) => [i, Math.exp(lp)])
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .flatMap(([i, p]) => [i, +p.toFixed(3)]);
  await maxApi.outlet("top", ...top);
});

init().catch((e) => maxApi.post("nextchord init error: " + e.message));
