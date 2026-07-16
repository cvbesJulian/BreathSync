// End-to-end next-chord inference for Node for Max:
//   encode window+context -> onnxruntime-node -> calibrate -> rerank -> chord.
// onnxruntime-node is imported lazily so the pure-JS parts stay testable
// without the native dependency.
import { makeSpec, encodeGlobals, encodeNotes, NOTE_FEATS, N_GLOBALS } from "./features.js";
import { makeVocab, romanOf, absoluteLabel } from "./vocab.js";
import { rerank } from "./rerank.js";

export function logSoftmax(logits) {
  const m = Math.max(...logits);
  let s = 0;
  const ex = logits.map((x) => { const e = Math.exp(x - m); s += e; return e; });
  const ls = Math.log(s);
  return ex.map((_, i) => (logits[i] - m) - ls);
}

// Derive the reranker's melody context from raw notes (matches Python
// windows.window_pcs / strong_pcs), so the Max side only sends notes.
export function melodyContext(notes, t, meter) {
  const hb = 0.5 * meter;
  const windowPcs = [];
  const strongPcs = [];
  for (const n of notes) {
    if (n.onset >= t - hb - 1e-9 && n.onset < t - 1e-9) {
      windowPcs.push([((n.pitch % 12) + 12) % 12, Math.max(1e-3, n.dur)]);
    }
    if (n.onset >= t - meter - 1e-9 && n.onset < t - 1e-9 &&
        Math.abs(n.onsetInBar - Math.round(n.onsetInBar)) < 1e-3) {
      strongPcs.push(((n.pitch % 12) + 12) % 12);
    }
  }
  return { windowPcs, strongPcs };
}

export function buildEncoding(spec, notes, t, ctx, maskNotes = false) {
  return {
    global_ids: encodeGlobals(spec, ctx),
    notes: encodeNotes(spec, notes, t, maskNotes),
  };
}

// Build the onnxruntime feed (batch 1) from an encoding.
export function buildFeed(ort, spec, encoding) {
  const M = spec.maxNotes;
  const gi = BigInt64Array.from(encoding.global_ids.map((x) => BigInt(x)));
  const feed = { global_ids: new ort.Tensor("int64", gi, [1, spec.nGlobals ?? N_GLOBALS]) };
  const n = encoding.notes.pc.length;
  for (const k of NOTE_FEATS) {
    const arr = new BigInt64Array(M);
    for (let i = 0; i < n && i < M; i++) arr[i] = BigInt(encoding.notes[k][i]);
    feed[k] = new ort.Tensor("int64", arr, [1, M]);
  }
  const mask = new Uint8Array(M);
  for (let i = 0; i < n && i < M; i++) mask[i] = 1;
  feed.note_mask = new ort.Tensor("bool", mask, [1, M]);
  return feed;
}

export async function loadModel(ort, onnxPath, modelConfig, rerankerConfig) {
  const session = await ort.InferenceSession.create(onnxPath);
  return {
    session,
    spec: makeSpec(modelConfig.features),
    vocab: makeVocab(modelConfig),
    T: modelConfig.calibration_T,
    rerankerConfig,
  };
}

// notes: [{pitch, onset, dur, onsetInBar, beatsPerBar}]; t = decision beat.
// ctx: {mode, meter, prevClass, prevFunc, wlenBars, hyper, grid, soundingClass,
//       transposeOffset, windowPcs, strongPcs, freedom?}
export async function predict(ort, model, notes, t, ctx) {
  const enc = buildEncoding(model.spec, notes, t, ctx);
  const feed = buildFeed(ort, model.spec, enc);
  const out = await model.session.run(feed);
  const logits = Array.from(out.chord_logits.data);
  const logprobs = logSoftmax(logits.map((x) => x / model.T));
  const reranked = rerank(model.vocab, model.rerankerConfig, logprobs, {
    ...ctx, markovLogdist: ctx.markovLogdist ?? null,
  });
  const chosen = reranked[0].class;
  return {
    logits, logprobs, reranked, chosen,
    roman: romanOf(model.vocab, chosen, ctx.mode),
    chord: absoluteLabel(model.vocab, chosen, ctx.transposeOffset ?? 0, ctx.mode),
  };
}
