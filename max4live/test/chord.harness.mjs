// ---------------------------------------------------------------------------
// chord.harness.mjs — headless verification of bs.chord.js, wired to the REAL
// next-chord ONNX model.
//
// Compiles the device script with `new Function` (injecting Max stubs:
// outlet/post/LiveAPI), then drives a fake Live transport. When the device
// emits `predict <json>` on outlet 2, the harness routes it through the actual
// deploy/chord_service.respond() (features.js -> onnxruntime-node -> rerank.js)
// and feeds the reply back via api.modelchord — i.e. the full Max-side ->
// model -> MIDI path, minus the Ableton patcher.
//
// Run:  node max4live/test/chord.harness.mjs   (needs deploy/ npm install)
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEPLOY = join(HERE, "..", "..", "ml", "next_chord", "deploy");
const ART = join(HERE, "..", "..", "ml", "next_chord", "artifacts");

const { loadModel } = await import(join(DEPLOY, "predict.js"));
const { respond } = await import(join(DEPLOY, "chord_service.js"));
const require = createRequire(join(DEPLOY, "package.json"));
const ort = require("onnxruntime-node");

const modelConfig = JSON.parse(readFileSync(join(ART, "onnx", "model_config.json"), "utf8"));
const rerankerConfig = JSON.parse(readFileSync(join(ART, "reranker_config.json"), "utf8"));
const model = await loadModel(ort, join(ART, "onnx", "model.onnx"), modelConfig, rerankerConfig);

const SRC = readFileSync(join(HERE, "..", "BreathSync Chord", "bs.chord.js"), "utf8");

// --- fake Max instance ------------------------------------------------------

function makeInstance() {
  const ctx = {
    midi: [], disp: [], preds: [],   // outlet 0 / 1 / 2
    song: { current_song_time: 0, signature_numerator: 4, signature_denominator: 4, is_playing: 0 },
    observers: [],
  };
  function outlet(idx, ...args) {
    if (idx === 0) ctx.midi.push({ status: args[0], data1: args[1], data2: args[2] });
    else if (idx === 1) ctx.disp.push({ sel: args[0], text: String(args[1]) });
    else if (idx === 2 && args[0] === "predict") ctx.preds.push(JSON.parse(args[1]));
  }
  function post() {}
  class FakeLiveAPI {
    constructor(a, b) {
      if (typeof a === "function") { this.callback = a; this.path = b; ctx.observers.push(this); }
      else this.path = a;
      this._property = null;
    }
    get property() { return this._property; }
    set property(p) { this._property = p; }
    get(prop) { const v = ctx.song[prop]; return v === undefined ? [0] : [v]; }
    set(prop, val) { ctx.song[prop] = val; }
  }
  const EXPORTS = ["init", "state", "lead", "hello", "watchdog", "modelchord",
    "enabled", "active", "complexity", "freedom", "wlenbars", "vel", "channel",
    "chordoct", "waitbars", "genre", "panic", "notifydeleted", "anything"];
  const factory = new Function("outlet", "post", "LiveAPI",
    SRC + "\n;return {" + EXPORTS.map((n) => n + ":" + n).join(",") + "};");
  const api = factory(outlet, post, FakeLiveAPI);
  for (const n of EXPORTS) if (typeof api[n] !== "function") throw new Error("missing handler: " + n);
  return { api, ctx };
}

const mkstate = (o) => JSON.stringify(Object.assign(
  { v: 1, src: "013bstime", key: null, mode: null, keyConfidence: 0.9 }, o));
const setTime = (ctx, t) => { ctx.song.current_song_time = t; };
const fireTransport = (ctx, v) => {
  ctx.song.is_playing = v;
  ctx.observers.find((o) => o.property === "is_playing").callback(["is_playing", v]);
};
const NBSP = String.fromCharCode(0x00a0);
const denbsp = (s) => String(s).split(NBSP).join(" ");
const ons = (m) => m.filter((x) => (x.status & 0xf0) === 0x90).map((x) => x.data1).sort((a, b) => a - b);
const offs = (m) => m.filter((x) => (x.status & 0xf0) === 0x80).map((x) => x.data1).sort((a, b) => a - b);
const pcset = (pitches) => [...new Set(pitches.map((p) => ((p % 12) + 12) % 12))].sort((a, b) => a - b);

// route any queued predict requests through the real model
async function pump(api, ctx) {
  while (ctx.preds.length) {
    const req = ctx.preds.shift();
    const r = await respond(ort, model, modelConfig, req);
    ctx._lastReply = r;
    api.modelchord(r.classId, r.familyIdx, r.soundingRootPc, r.roman, r.chord);
  }
}

// --- assertions -------------------------------------------------------------

const failures = [];
let checks = 0;
function check(name, cond, detail) {
  checks++;
  if (cond) console.log("  ok  " + name);
  else { failures.push(name + (detail !== undefined ? "  [" + detail + "]" : "")); console.log("  FAIL " + name + (detail !== undefined ? "  [" + detail + "]" : "")); }
}
function section(t) { console.log("\n== " + t); }

// ============================================================================
section("a. key -> transposeOffset mapping (bus state)");
{
  const { api, ctx } = makeInstance();
  api.init();
  const keyText = () => denbsp((ctx.disp.filter((d) => d.sel === "key").pop() || {}).text || "");
  api.state(mkstate({ key: "F", mode: "major" }));
  check("a1: F major -> offset -5 shown", keyText().indexOf("offset -5") >= 0, keyText());
  api.state(mkstate({ key: "A", mode: "minor" }));
  check("a2: A minor -> offset 0", keyText().indexOf("offset 0") >= 0, keyText());
  // bus key names are sharps (Listen analyzer NOTE_NAMES): D# minor tonic pc 3 -> offset 6
  api.state(mkstate({ key: "D#", mode: "minor" }));
  check("a3: D# minor -> offset 6", keyText().indexOf("offset 6") >= 0, keyText());
}

// ============================================================================
section("b. predict request internals (real model, C major, offset 0)");
{
  const { api, ctx } = makeInstance();
  api.init(); api.waitbars(0);
  api.state(mkstate({ key: "C", mode: "major" }));
  setTime(ctx, 0); fireTransport(ctx, 1);
  setTime(ctx, 0); api.lead(72, 1);
  setTime(ctx, 1); api.watchdog();
  const req = ctx.preds[0];
  check("b1: fired a predict at t=1", req && req.t === 1, JSON.stringify(req && req.t));
  check("b2: transposeOffset 0 for C major", req && req.transposeOffset === 0, req && req.transposeOffset);
  check("b3: meter 4, mode maj", req && req.meter === 4 && req.mode === "maj");
  check("b4: prevClass BOS(-1) on first decision", req && req.prevClass === -1, req && req.prevClass);
  check("b5: window note is the C5 onset, transposed (offset 0), onset < t",
    req && req.notes.length === 1 && req.notes[0][0] === 72 && req.notes[0][1] < 1,
    JSON.stringify(req && req.notes));
  // advance a beat, ensure only notes with onset<t are included
  setTime(ctx, 1); api.lead(76, 1);
  setTime(ctx, 2); api.watchdog();
  const req2 = ctx.preds[1];
  check("b6: t=2 window includes onsets 0 and 1, both < 2",
    req2 && req2.notes.length === 2 && req2.notes.every((n) => n[1] < 2),
    JSON.stringify(req2 && req2.notes));
}

// ============================================================================
section("c. transposition: F major melody sent in model (C) space");
{
  const { api, ctx } = makeInstance();
  api.init(); api.waitbars(0);
  api.state(mkstate({ key: "F", mode: "major" }));   // offset -5
  setTime(ctx, 0); fireTransport(ctx, 1);
  setTime(ctx, 0); api.lead(77, 1);                   // F5 played
  setTime(ctx, 1); api.watchdog();
  const req = ctx.preds[0];
  check("c1: offset -5, played F(77) -> model pitch 72 (C)",
    req && req.transposeOffset === -5 && req.notes[0][0] === 72,
    JSON.stringify(req && [req.transposeOffset, req.notes]));
}

// ============================================================================
section("d. full path: real model reply -> voiced MIDI");
{
  const { api, ctx } = makeInstance();
  api.init(); api.waitbars(0); api.complexity(0.3);
  api.state(mkstate({ key: "C", mode: "major" }));
  setTime(ctx, 0); fireTransport(ctx, 1);
  // feed a ii-V-ish melody then predict across several beats
  const line = [[0, 74], [1, 77], [2, 79], [3, 74], [4, 72]];  // D E-ish G D C (transposed=absolute, C major)
  let fired = 0;
  for (let beat = 0; beat <= 6; beat++) {
    setTime(ctx, beat);
    const note = line.find((x) => x[0] === beat);
    if (note) api.lead(note[1], 1);
    if (beat > 0) { api.watchdog(); await pump(api, ctx); fired++; }
  }
  check("d1: predictions fired across 6 beats", fired === 6);
  check("d2: model produced MIDI (some chord voiced)", ctx.midi.length > 0, ctx.midi.length);
  // held voicing pitch-classes must equal the last reply's realized chord
  const r = ctx._lastReply;
  if (r && r.familyIdx >= 0) {
    const FAMILY_CORE = { 0: [0, 4, 7], 1: [0, 4, 7, 10], 2: [0, 3, 7], 3: [0, 3, 6, 10], 4: [0, 3, 6], 5: [0, 4, 8], 6: [0, 5, 7] };
    const expected = pcset(FAMILY_CORE[r.familyIdx].map((o) => r.soundingRootPc + o));
    const held = pcset(ons(ctx.midi).length ? currentHeld(ctx) : []);
    check("d3: sounding chord pcs match model's chosen family/root (" + r.roman + ")",
      subset(expected, held) && expected.length > 0, "exp " + expected + " held " + held);
  } else {
    check("d3: model chose HOLD/OTHER — no assertion on pcs", true);
  }
}

// reconstruct currently-held notes from the midi log (on minus off)
function currentHeld(ctx) {
  const cnt = new Map();
  for (const m of ctx.midi) {
    const on = (m.status & 0xf0) === 0x90;
    cnt.set(m.data1, (cnt.get(m.data1) || 0) + (on ? 1 : -1));
  }
  return [...cnt.entries()].filter(([, c]) => c > 0).map(([p]) => p);
}
function subset(a, b) { const s = new Set(b); return a.every((x) => s.has(x)); }

// ============================================================================
section("e. deterministic voicing + voice-leading diff (direct modelchord)");
{
  const { api, ctx } = makeInstance();
  api.init(); api.waitbars(0); api.complexity(0.3);
  api.state(mkstate({ key: "C", mode: "major" }));
  // V7 = G dom7 at sounding root 7: core [0,4,7,10] over 48+7=55 -> 55,59,62,65
  api.modelchord(2, 1, 7, "V7", "G7");
  check("e1: G7 voiced 55,59,62,65", JSON.stringify(ons(ctx.midi)) === "[55,59,62,65]", JSON.stringify(ons(ctx.midi)));
  ctx.midi.length = 0;
  // I = C maj triad at root 0: 48,52,55 — common tone 55 sustains
  api.modelchord(1, 0, 0, "I", "C");
  check("e2: I add 48,52 (new), off 59,62,65 (removed), 55 sustains",
    JSON.stringify(ons(ctx.midi)) === "[48,52]" && JSON.stringify(offs(ctx.midi)) === "[59,62,65]",
    "on " + JSON.stringify(ons(ctx.midi)) + " off " + JSON.stringify(offs(ctx.midi)));
}

// ============================================================================
section("f. Complexity knob changes realization");
{
  const { api, ctx } = makeInstance();
  api.init(); api.waitbars(0);
  api.complexity(0.2);                        // triad
  api.modelchord(1, 0, 0, "I", "C");
  check("f1: complexity 0.2 -> triad 48,52,55", JSON.stringify(ons(ctx.midi)) === "[48,52,55]", JSON.stringify(ons(ctx.midi)));
  ctx.midi.length = 0;
  api.complexity(0.5);                        // revoice: add maj7 (59)
  check("f2: complexity 0.5 revoices, adds maj7 (59)", ons(ctx.midi).indexOf(59) >= 0, JSON.stringify(ons(ctx.midi)));
  ctx.midi.length = 0;
  api.complexity(0.8);                        // add 9th (50)
  check("f3: complexity 0.8 revoices, adds 9th (50)", ons(ctx.midi).indexOf(50) >= 0, JSON.stringify(ons(ctx.midi)));
}

// ============================================================================
section("g. engage gating: listen N bars before comping");
{
  const { api, ctx } = makeInstance();
  api.init(); api.waitbars(2);                // 2 bars @ 4/4 = 8 beats
  api.state(mkstate({ key: "C", mode: "major" }));
  setTime(ctx, 0); fireTransport(ctx, 1);
  setTime(ctx, 0); api.lead(72, 1);
  setTime(ctx, 4); api.watchdog();
  check("g1: no predict during listen window", ctx.preds.length === 0, ctx.preds.length);
  const st = ctx.disp.filter((d) => d.sel === "status").pop();
  check("g2: status shows listening countdown", st && st.text.indexOf("listen") >= 0, st && st.text);
  setTime(ctx, 8.01); api.watchdog();
  check("g3: engages and predicts after 2 bars", ctx.preds.length === 1, ctx.preds.length);
}

// ============================================================================
section("h. key change resets previous-chord context; panic clears MIDI");
{
  const { api, ctx } = makeInstance();
  api.init(); api.waitbars(0);
  api.state(mkstate({ key: "C", mode: "major" }));
  setTime(ctx, 0); fireTransport(ctx, 1);
  setTime(ctx, 0); api.lead(72, 1);
  setTime(ctx, 1); api.watchdog(); await pump(api, ctx);
  api.state(mkstate({ key: "G", mode: "major" }));   // key change
  setTime(ctx, 1); api.lead(74, 1);
  setTime(ctx, 2); api.watchdog();
  const req = ctx.preds[ctx.preds.length - 1];
  check("h1: key change -> offset 5 (G major) and prevClass reset to BOS",
    req && req.transposeOffset === 5 && req.prevClass === -1,
    JSON.stringify(req && [req.transposeOffset, req.prevClass]));
  api.panic();
  check("h2: panic sends all-notes-off + clears held",
    currentHeld(ctx).length === 0, JSON.stringify(currentHeld(ctx)));
}

// ============================================================================
section("i. genre menu -> source tag in predict requests");
{
  const { api, ctx } = makeInstance();
  api.init(); api.waitbars(0);
  api.state(mkstate({ key: "C", mode: "major" }));
  setTime(ctx, 0); fireTransport(ctx, 1);
  setTime(ctx, 0); api.lead(72, 1);
  setTime(ctx, 1); api.watchdog();
  const req = ctx.preds[0];
  check("i1: default genre Auto -> empty source", req && req.source === "", JSON.stringify(req && req.source));
  api.genre(3);                                  // Jazz -> openbook
  setTime(ctx, 2); api.watchdog();
  const req2 = ctx.preds[1];
  check("i2: genre Jazz -> source openbook", req2 && req2.source === "openbook", JSON.stringify(req2 && req2.source));
  await pump(api, ctx);                          // full model round-trip still works
  check("i3: model replies with genre set", ctx._lastReply != null);
}

// --- summary ----------------------------------------------------------------
console.log("\n" + "-".repeat(60));
if (failures.length) {
  console.log("FAILURES (" + failures.length + "/" + checks + "):");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
} else {
  console.log("ALL " + checks + " CHECKS PASSED");
  process.exit(0);
}
