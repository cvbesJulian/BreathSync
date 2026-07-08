// JS port of nextchord/vocab.py helpers, driven by model_config.json.
// roman/function are precomputed arrays in the config; pcs/absolute derived here.

export const PC_NAME = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
export const FAMILY_PCS = {
  MAJ: [0, 4, 7], DOM: [0, 4, 7, 10], MIN: [0, 3, 7],
  HDIM: [0, 3, 6, 10], DIM: [0, 3, 6], AUG: [0, 4, 8], SUS: [0, 5, 7],
};
const ABS_SUFFIX = { MAJ: "", DOM: "7", MIN: "m", HDIM: "m7b5", DIM: "dim", AUG: "aug", SUS: "sus4" };

export function makeVocab(modelConfig) {
  const c = modelConfig;
  return {
    nClasses: c.n_classes,
    HOLD: c.hold_id,
    OTHER: c.other_id,
    functions: c.functions,
    classes: c.vocab_classes,          // index i -> class id i+1
    romanMajor: c.roman_major,
    romanMinor: c.roman_minor,
    functionMajor: c.function_major,
    functionMinor: c.function_minor,
  };
}

export function keyOfClass(v, classId) {
  if (classId === v.HOLD || classId === v.OTHER) return null;
  return v.classes[classId - 1];               // {root, family}
}

export function classPcs(v, classId) {
  const k = keyOfClass(v, classId);
  if (!k) return null;
  return FAMILY_PCS[k.family].map((iv) => (k.root + iv) % 12);
}

export function romanOf(v, classId, mode) {
  return (mode === "maj" ? v.romanMajor : v.romanMinor)[classId];
}

export function functionOf(v, classId, mode) {
  return (mode === "maj" ? v.functionMajor : v.functionMinor)[classId];
}

export function absoluteLabel(v, classId, transposeOffset, mode = "maj") {
  if (classId === v.HOLD) return "HOLD";
  if (classId === v.OTHER) return "OTHER";
  const k = v.classes[classId - 1];
  const absRoot = (((k.root - transposeOffset) % 12) + 12) % 12;
  return PC_NAME[absRoot] + ABS_SUFFIX[k.family];
}
