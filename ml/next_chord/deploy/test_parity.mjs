// Headless parity harness (run: node test_parity.mjs). Verifies the JS port
// reproduces the Python reference:
//   A. reranker golden vectors (artifacts/test_vectors.json)
//   B. feature encoding, bit-exact (artifacts/parity_fixtures.json)
//   C. reranker on frozen logprobs (parity_fixtures)
//   D. full ONNX path via onnxruntime-node, if installed (logits + end-to-end)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { makeSpec, encodeGlobals, encodeNotes, NOTE_FEATS } from "./features.js";
import { makeVocab } from "./vocab.js";
import { rerank } from "./rerank.js";
import { logSoftmax, buildEncoding, buildFeed, melodyContext } from "./predict.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ART = join(HERE, "..", "artifacts");
// Corpus selector: "" (default) = OpenBook top-level artifacts; otherwise a
// subdir (e.g. NEXTCHORD_CORPUS=hooktheory -> artifacts/hooktheory/). The
// reranker config is shared (theory-based, corpus-agnostic in structure).
const CORPUS = process.env.NEXTCHORD_CORPUS || "";
const ART_C = CORPUS ? join(ART, CORPUS) : ART;
const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"));

const modelConfig = readJSON(join(ART_C, "onnx", "model_config.json"));
const rerankerConfig = readJSON(join(ART, "reranker_config.json"));
const spec = makeSpec(modelConfig.features);
const vocab = makeVocab(modelConfig);

let pass = 0, fail = 0;
const eq = (a, b) => a === b;
const close = (a, b, tol = 1e-4) => Math.abs(a - b) <= tol;
function check(name, ok, detail = "") {
  if (ok) { pass++; } else { fail++; console.error(`  FAIL ${name} ${detail}`); }
}

// ---- A. reranker golden vectors ----
// With a corpus selected, vectors live beside its model (artifacts/<corpus>/).
// Otherwise: combined (source-conditioned) deployments freeze theirs under
// artifacts/combined/; the top-level file describes the OpenBook-only model.
const gv = readJSON(CORPUS
  ? join(ART_C, "test_vectors.json")
  : (spec.sources ? join(ART, "combined", "test_vectors.json") : join(ART, "test_vectors.json")));
for (let i = 0; i < gv.vectors.length; i++) {
  const { input: inp } = gv.vectors[i];
  const res = rerank(vocab, gv.reranker_config, inp.model_logprobs, {
    prevFunc: inp.prev_func, soundingClass: inp.sounding_class, mode: inp.mode,
    windowPcs: inp.window_pcs, strongPcs: inp.strong_pcs, markovLogdist: inp.markov_logdist,
  });
  const exp = gv.vectors[i].expected;
  check(`golden[${i}] order`, res.map((r) => r.class).join(",") === exp.map((e) => e.class).join(","));
  let sok = res.length === exp.length;
  for (let j = 0; j < exp.length; j++) if (!close(res[j].score, exp[j].score)) sok = false;
  check(`golden[${i}] scores`, sok);
}

// ---- B & C. encoding + rerank from parity fixtures ----
const pf = readJSON(join(ART_C, "parity_fixtures.json"));
for (let i = 0; i < pf.fixtures.length; i++) {
  const fx = pf.fixtures[i];
  const notes = fx.raw_notes.map(([pitch, onset, dur, onsetInBar, beatsPerBar]) =>
    ({ pitch, onset, dur, onsetInBar, beatsPerBar }));
  const c = fx.context;
  const enc = buildEncoding(spec, notes, fx.t, {
    mode: c.mode, meter: c.meter, prevClass: c.prev_class, prevFunc: c.prev_func,
    wlenBars: c.wlen_bars, hyper: c.hyper, grid: c.grid, source: c.source,
  });
  check(`fixture[${i}] global_ids`, enc.global_ids.join(",") === fx.expected_encoding.global_ids.join(","),
    `${enc.global_ids} vs ${fx.expected_encoding.global_ids}`);
  let nok = true;
  for (const k of NOTE_FEATS) {
    if (enc.notes[k].join(",") !== fx.expected_encoding.notes[k].join(",")) {
      nok = false; console.error(`    note[${k}] ${enc.notes[k]} vs ${fx.expected_encoding.notes[k]}`);
    }
  }
  check(`fixture[${i}] note streams`, nok);

  // melodyContext derived from raw notes must match Python's window/strong pcs
  const mc = melodyContext(notes, fx.t, c.meter);
  const wOk = mc.windowPcs.length === c.window_pcs.length &&
    mc.windowPcs.every(([p, w], j) => p === c.window_pcs[j][0] && close(w, c.window_pcs[j][1], 1e-3));
  check(`fixture[${i}] windowPcs`, wOk, `${JSON.stringify(mc.windowPcs)} vs ${JSON.stringify(c.window_pcs)}`);
  check(`fixture[${i}] strongPcs`, mc.strongPcs.join(",") === c.strong_pcs.join(","),
    `${mc.strongPcs} vs ${c.strong_pcs}`);

  const res = rerank(vocab, rerankerConfig, fx.expected_logprobs, {
    prevFunc: c.prev_func, soundingClass: c.sounding_class, mode: c.mode,
    windowPcs: c.window_pcs, strongPcs: c.strong_pcs, markovLogdist: new Array(vocab.nClasses).fill(0),
  });
  check(`fixture[${i}] rerank order`, res.map((r) => r.class).join(",") === fx.expected_reranked.map((e) => e.class).join(","));
}

// ---- D. full ONNX path (optional) ----
let ort = null;
try { ort = (await import("onnxruntime-node")).default; }
catch { console.log("  (onnxruntime-node not installed — skipping ONNX path D)"); }

if (ort) {
  const session = await ort.InferenceSession.create(join(ART_C, "onnx", "model.onnx"));
  let maxDiff = 0;
  for (let i = 0; i < pf.fixtures.length; i++) {
    const fx = pf.fixtures[i];
    const notes = fx.raw_notes.map(([pitch, onset, dur, onsetInBar, beatsPerBar]) =>
      ({ pitch, onset, dur, onsetInBar, beatsPerBar }));
    const c = fx.context;
    const enc = buildEncoding(spec, notes, fx.t, {
      mode: c.mode, meter: c.meter, prevClass: c.prev_class, prevFunc: c.prev_func,
      wlenBars: c.wlen_bars, hyper: c.hyper, grid: c.grid, source: c.source,
    });
    const feed = buildFeed(ort, spec, enc);
    const out = await session.run(feed);
    const logits = Array.from(out.chord_logits.data);
    for (let j = 0; j < logits.length; j++) maxDiff = Math.max(maxDiff, Math.abs(logits[j] - fx.expected_logits[j]));
    const logprobs = logSoftmax(logits.map((x) => x / pf.calibration_T));
    const res = rerank(vocab, rerankerConfig, logprobs, {
      prevFunc: c.prev_func, soundingClass: c.sounding_class, mode: c.mode,
      windowPcs: c.window_pcs, strongPcs: c.strong_pcs, markovLogdist: new Array(vocab.nClasses).fill(0),
    });
    check(`onnx[${i}] chosen class`, res[0].class === fx.expected_reranked[0].class);
  }
  check(`onnx logits parity (max|diff|=${maxDiff.toExponential(2)})`, maxDiff < 1e-3, `maxDiff=${maxDiff}`);
}

console.log(`\n[${CORPUS || "openbook"} · ${modelConfig.n_classes} classes] ` +
  `${fail === 0 ? "PASS" : "FAIL"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
