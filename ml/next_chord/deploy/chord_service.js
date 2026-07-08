// Pure request/reply logic for the chord device — no max-api dependency, so it
// is reused by both nextchord.node.js (in Max) and the headless harness
// (max4live/test/chord.harness.mjs), which drives it against the real model.
import { predict, melodyContext } from "./predict.js";
import { functionOf } from "./vocab.js";

// req dict (see nextchord.node.js) -> { notes, ctx } ready for predict().
export function buildContext(model, req) {
  const v = model.vocab;
  const prevClass = req.prevClass < 0 ? v.nClasses : req.prevClass;       // BOS id
  const soundingClass = req.soundingClass < 0 ? v.HOLD : req.soundingClass;
  const prevFunc = req.prevClass < 0 ? v.functions.length
    : functionOf(v, req.prevClass, req.mode);
  const notes = (req.notes || []).map(([pitch, onset, dur, onsetInBar, beatsPerBar]) =>
    ({ pitch, onset, dur, onsetInBar, beatsPerBar }));
  const { windowPcs, strongPcs } = melodyContext(notes, req.t, req.meter);
  return {
    notes,
    ctx: {
      mode: req.mode, meter: req.meter, prevClass, prevFunc,
      wlenBars: req.wlenBars, hyper: req.hyper, grid: req.grid,
      soundingClass, transposeOffset: req.transposeOffset ?? 0,
      windowPcs, strongPcs, freedom: req.freedom ?? 0.0,
    },
  };
}

// chosen class -> [classId, familyIdx, soundingRootPc]; familyIdx<0 = HOLD/OTHER.
export function chordReply(model, modelConfig, chosen, transposeOffset) {
  const v = model.vocab;
  if (chosen === v.HOLD || chosen === v.OTHER) return [chosen, -1, -1];
  const cls = v.classes[chosen - 1];
  const familyIdx = modelConfig.families.indexOf(cls.family);
  const soundingRootPc = (((cls.root - transposeOffset) % 12) + 12) % 12;
  return [chosen, familyIdx, soundingRootPc];
}

// Full response for one predict request (the same shape node.script sends back).
export async function respond(ort, model, modelConfig, req) {
  const { notes, ctx } = buildContext(model, req);
  const out = await predict(ort, model, notes, req.t, ctx);
  const [classId, familyIdx, soundingRootPc] = chordReply(model, modelConfig, out.chosen, ctx.transposeOffset);
  return { classId, familyIdx, soundingRootPc, roman: out.roman, chord: out.chord, logprobs: out.logprobs };
}
