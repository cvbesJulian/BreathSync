// listen.harness.mjs
// Headless functional verification of bs.listen.js (BreathSync Listen analyzer)
// under Node. Stubs the Max v8 globals, simulates the patch's record~/buffer~
// ring + qmetro 33 drive with a fake clock, and asserts the harmony bus
// protocol v1 behavior documented in ../PROTOCOL.md.
//
// Run: node "max4live/test/listen.harness.mjs"

import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(HERE, "..", "BreathSync Listen", "bs.listen.js");
const SRC = readFileSync(SCRIPT_PATH, "utf8");

const SR = 44100;
const RING_FRAMES = 65536;
const TICK_MS = 33; // qmetro 33 grid
const BUF_NAME = "013bstime"; // device---substituted buffer name / src id
const NBSP = " ";

// ---------------------------------------------------------------------------
// Result accumulation (never stop at first failure)
// ---------------------------------------------------------------------------

const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail: detail === undefined ? "" : String(detail) });
}

// ---------------------------------------------------------------------------
// Instance factory: fresh vm context + fake Max environment per scenario
// ---------------------------------------------------------------------------

function createInstance() {
  const emissions = []; // { t, outlet, msg: [atoms...] }
  const posts = [];

  let fakeNow = 1_000_000; // ms, controllable clock
  const simStart = fakeNow;

  const ring = new Float64Array(RING_FRAMES);
  let written = 0; // total samples ever written (monotonic)
  let gen = null;  // (tSeconds) => sample, absolute time since simStart

  class FakeBuffer {
    constructor(name) {
      if (String(name) !== BUF_NAME) {
        throw new Error("no such buffer~: " + name);
      }
      this._name = String(name);
    }
    framecount() {
      return RING_FRAMES;
    }
    // Max semantics: peek(channel(1-based), startFrame, count) -> number[]
    // (bare number when count === 1). No wrap-around; the script must stay
    // in-bounds (we throw to surface bugs).
    peek(channel, startFrame, count) {
      if (channel !== 1) throw new Error("peek: bad channel " + channel);
      if (!Number.isInteger(startFrame) || startFrame < 0 ||
          !Number.isInteger(count) || count < 1 ||
          startFrame + count > RING_FRAMES) {
        throw new Error("peek out of bounds: start=" + startFrame + " count=" + count);
      }
      if (count === 1) return ring[startFrame];
      const out = new Array(count);
      for (let i = 0; i < count; i++) out[i] = ring[startFrame + i];
      return out;
    }
  }

  const sandbox = {
    jsarguments: ["bs.listen.js", BUF_NAME],
    Buffer: FakeBuffer,
    Date: { now: () => fakeNow },
    outlet(idx, ...args) {
      // Max flattens list-as-single-arg into a message
      const msg = [];
      for (const a of args) {
        if (Array.isArray(a)) msg.push(...a);
        else msg.push(a);
      }
      emissions.push({ t: fakeNow, outlet: idx, msg });
    },
    post(...args) {
      posts.push(args.join(" "));
    },
    messnamed() {},
    Task: function Task() { this.schedule = () => {}; this.cancel = () => {}; }
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: "bs.listen.js" });

  function tickOnce() {
    fakeNow += TICK_MS;
    // record~ has written everything up to "now"
    const target = Math.floor(((fakeNow - simStart) / 1000) * SR);
    while (written < target) {
      ring[written % RING_FRAMES] = gen ? gen(written / SR) : 0;
      written += 1;
    }
    // snapshot~ of record~'s sync outlet -> prepend writephase -> js
    sandbox.writephase((written % RING_FRAMES) / RING_FRAMES);
    sandbox.bang(); // qmetro tick
  }

  return {
    sandbox,
    emissions,
    posts,
    now: () => fakeNow,
    elapsedSec: () => (fakeNow - simStart) / 1000,
    setGen: (g) => { gen = g; },
    run(ms) {
      const end = fakeNow + ms;
      while (fakeNow < end) tickOnce();
    },
    loadbang() {
      sandbox.samplerate(SR);
      sandbox.loadbang();
    }
  };
}

// ---------------------------------------------------------------------------
// Signal helpers
// ---------------------------------------------------------------------------

const midiToFreq = (m) => 440 * 2 ** ((m - 69) / 12);
const sine = (freq, amp) => (t) => amp * Math.sin(2 * Math.PI * freq * t);
const mix = (...gens) => (t) => {
  let s = 0;
  for (const g of gens) s += g(t);
  return s;
};

// ---------------------------------------------------------------------------
// Emission query helpers
// ---------------------------------------------------------------------------

const deNbsp = (s) => String(s).split(NBSP).join(" ");

function uiMsgs(inst, selector, fromT = -Infinity, toT = Infinity) {
  return inst.emissions.filter((e) =>
    e.outlet === 0 && e.msg[0] === selector && e.t >= fromT && e.t <= toT);
}

function busMsgs(inst, selector, fromT = -Infinity, toT = Infinity) {
  return inst.emissions.filter((e) =>
    e.outlet === 1 && e.msg[0] === selector && e.t >= fromT && e.t <= toT);
}

function states(inst, fromT = -Infinity, toT = Infinity) {
  return busMsgs(inst, "state", fromT, toT).map((e) => ({ t: e.t, state: JSON.parse(e.msg[1]) }));
}

function checkThrottle(label, inst, fromT, toT) {
  const times = busMsgs(inst, "state", fromT, toT).map((e) => e.t);
  let minGap = Infinity;
  let maxGap = -Infinity;
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    if (gap < minGap) minGap = gap;
    if (gap > maxGap) maxGap = gap;
  }
  check(label + ": >= 2 states in window", times.length >= 2, "count=" + times.length);
  check(label + ": no two states closer than 250 ms", minGap >= 250,
    "minGap=" + (Number.isFinite(minGap) ? minGap : "n/a") + " ms");
  check(label + ": state gaps never exceed ~1.1 s", maxGap <= 1100,
    "maxGap=" + (Number.isFinite(maxGap) ? maxGap : "n/a") + " ms");
}

// ---------------------------------------------------------------------------
// Scenario A: 440 Hz sine, 2 s -> A4, freq within 1 Hz, |cents| <= 5, lead 69
// ---------------------------------------------------------------------------

function scenarioA() {
  const inst = createInstance();
  inst.loadbang();
  inst.run(200); // settle in silence
  inst.setGen(sine(440, 0.3));
  const soundStart = inst.now();
  inst.run(2000);

  const notes = uiMsgs(inst, "note", soundStart);
  const lastNote = notes.length ? deNbsp(notes[notes.length - 1].msg[1]) : "(none)";
  check("A: note message shows A4", lastNote === "A4", "last note=" + JSON.stringify(lastNote));

  const freqs = uiMsgs(inst, "freq", soundStart)
    .map((e) => parseFloat(deNbsp(e.msg[1])))
    .filter((v) => Number.isFinite(v));
  const lastFreq = freqs.length ? freqs[freqs.length - 1] : NaN;
  check("A: freq within 1 Hz of 440", Math.abs(lastFreq - 440) <= 1, "freq=" + lastFreq);

  const needles = uiMsgs(inst, "needle", soundStart).map((e) => e.msg[1]);
  const lastNeedle = needles.length ? needles[needles.length - 1] : NaN;
  check("A: |cents| <= 5 (needle within 45..55)",
    Number.isFinite(lastNeedle) && Math.abs(lastNeedle - 50) <= 5, "needle=" + lastNeedle);

  const lead69 = busMsgs(inst, "lead", soundStart).find((e) => e.msg[1] === 69);
  check("A: 'lead 69' event emitted", !!lead69,
    lead69 ? "at +" + (lead69.t - soundStart) + " ms, confidence=" + lead69.msg[2] : "no lead 69 event");
}

// ---------------------------------------------------------------------------
// Scenario B: C major chord 3 s -> chord commit rootPc 0 maj, chordconf UI,
// state JSON fields
// ---------------------------------------------------------------------------

function scenarioB() {
  const inst = createInstance();
  inst.loadbang();
  inst.run(200);
  inst.setGen(mix(sine(261.63, 0.2), sine(329.63, 0.2), sine(392.0, 0.2)));
  const soundStart = inst.now();
  inst.run(3000);

  const commits = busMsgs(inst, "chord", soundStart).filter((e) => e.msg[1] !== -1);
  const cMaj = commits.find((e) => e.msg[1] === 0 && e.msg[2] === "maj");
  check("B: chord commit event rootPc 0 quality maj", !!cMaj,
    cMaj
      ? "at +" + (cMaj.t - soundStart) + " ms, score=" + cMaj.msg[3] + ", pcs=[" + cMaj.msg.slice(4).join(",") + "]"
      : "commits seen: " + commits.map((e) => e.msg.slice(1, 3).join(" ")).join("; "));
  if (cMaj) {
    check("B: chord event pcs are 0,4,7", cMaj.msg.slice(4).join(",") === "0,4,7",
      "pcs=[" + cMaj.msg.slice(4).join(",") + "]");
    check("B: chord event score > 0.5", cMaj.msg[3] > 0.5, "score=" + cMaj.msg[3]);
  }

  const confs = uiMsgs(inst, "chordconf", soundStart)
    .map((e) => deNbsp(e.msg[1]))
    .filter((s) => s.indexOf("match") !== -1);
  check("B: chordconf UI message present", confs.length > 0,
    confs.length ? "last=" + JSON.stringify(confs[confs.length - 1]) : "none");

  const sts = states(inst, soundStart);
  const last = sts.length ? sts[sts.length - 1].state : null;
  check("B: state JSON parses and chordRoot is C", !!last && last.chordRoot === "C",
    last ? "chordRoot=" + last.chordRoot : "no state");
  if (last) {
    check("B: state chordQuality maj", last.chordQuality === "maj", "chordQuality=" + last.chordQuality);
    check("B: state v === 1", last.v === 1, "v=" + last.v);
    check("B: state src === '" + BUF_NAME + "'", last.src === BUF_NAME, "src=" + last.src);
    check("B: state keyConfidence numeric", typeof last.keyConfidence === "number",
      "keyConfidence=" + last.keyConfidence);
    check("B: state chordPitchClasses [0,4,7]",
      Array.isArray(last.chordPitchClasses) && last.chordPitchClasses.join(",") === "0,4,7",
      "chordPitchClasses=" + JSON.stringify(last.chordPitchClasses));
  }
}

// ---------------------------------------------------------------------------
// Scenario C: sound then silence -> lead -1 fast, chord reset, heartbeat
// keeps flowing, idle state shape. Also throttle checks (scenario D) over the
// whole run.
// ---------------------------------------------------------------------------

function scenarioCD() {
  const inst = createInstance();
  inst.loadbang();
  inst.run(200);
  inst.setGen(mix(sine(261.63, 0.2), sine(329.63, 0.2), sine(392.0, 0.2)));
  const soundStart = inst.now();
  inst.run(3000);

  const hadChord = busMsgs(inst, "chord", soundStart).some((e) => e.msg[1] === 0 && e.msg[2] === "maj");
  check("C: precondition - chord committed before silence", hadChord);
  const hadLead = busMsgs(inst, "lead", soundStart).some((e) => e.msg[1] !== -1);
  check("C: precondition - lead present before silence", hadLead);

  inst.setGen(null); // silence
  const silenceStart = inst.now();
  inst.run(5000);

  const leadClear = busMsgs(inst, "lead", silenceStart).find((e) => e.msg[1] === -1);
  check("C: 'lead -1' within ~250 ms of silence",
    !!leadClear && leadClear.t - silenceStart <= 300,
    leadClear ? "+" + (leadClear.t - silenceStart) + " ms" : "no lead -1 event");

  // Harmony reset: window drain (~186 ms for RMS to fall under gate) + 4
  // harmony frames at ~99 ms tick grid => expect within ~900 ms.
  const chordReset = busMsgs(inst, "chord", silenceStart).find((e) => e.msg[1] === -1);
  check("C: chord reset event after ~4 harmony frames",
    !!chordReset && chordReset.t - silenceStart <= 900,
    chordReset
      ? "+" + (chordReset.t - silenceStart) + " ms, msg=[" + chordReset.msg.join(" ") + "]"
      : "no chord -1 event");
  if (chordReset) {
    check("C: chord reset payload is 'chord -1 none 0'",
      chordReset.msg[1] === -1 && chordReset.msg[2] === "none" && chordReset.msg[3] === 0,
      "msg=[" + chordReset.msg.join(" ") + "]");
  }

  // CRITICAL heartbeat check: states keep arriving >= 1/s through 5 s of silence
  const silentStates = states(inst, silenceStart + 1000, silenceStart + 5000);
  checkThrottle("C: heartbeat during silence", inst, silenceStart + 1000, silenceStart + 5000);
  check("C: >= 3 states in silent seconds 1..5", silentStates.length >= 3,
    "count=" + silentStates.length);

  const idle = silentStates.length ? silentStates[silentStates.length - 1].state : null;
  check("C: idle state leadNote is null", !!idle && idle.leadNote === null,
    idle ? "leadNote=" + JSON.stringify(idle.leadNote) : "no idle state");
  check("C: idle state confidence is 0", !!idle && idle.confidence === 0,
    idle ? "confidence=" + idle.confidence : "no idle state");
  check("C: idle state chordRoot is null", !!idle && idle.chordRoot === null,
    idle ? "chordRoot=" + JSON.stringify(idle.chordRoot) : "no idle state");

  // Scenario D: throttle over the entire run (load -> end of silence)
  checkThrottle("D: full-run throttle", inst, -Infinity, Infinity);
}

// ---------------------------------------------------------------------------
// Scenario E: hello on loadbang and on announce
// ---------------------------------------------------------------------------

function scenarioE() {
  const inst = createInstance();
  inst.loadbang();
  const hellosAfterLoad = busMsgs(inst, "hello");
  check("E: hello emitted on loadbang", hellosAfterLoad.length === 1,
    "count=" + hellosAfterLoad.length);
  const h = hellosAfterLoad[0];
  check("E: hello payload is 'hello 1 " + BUF_NAME + "'",
    !!h && h.msg[1] === 1 && h.msg[2] === BUF_NAME,
    h ? "msg=[" + h.msg.join(" ") + "]" : "none");

  // hello must be followed immediately by a full state burst (PROTOCOL.md)
  const stAfterHello = states(inst);
  check("E: state burst follows hello", stAfterHello.length === 1,
    "state count=" + stAfterHello.length);

  inst.run(500);
  const before = busMsgs(inst, "hello").length;
  inst.sandbox.announce();
  const after = busMsgs(inst, "hello");
  check("E: hello emitted again on announce()", after.length === before + 1,
    "count " + before + " -> " + after.length);
  const h2 = after[after.length - 1];
  check("E: announce hello payload correct", h2.msg[1] === 1 && h2.msg[2] === BUF_NAME,
    "msg=[" + h2.msg.join(" ") + "]");
}

// ---------------------------------------------------------------------------
// Scenario F: A minor 7 (A2 C3 E3 G3) -> min7 or min; report which
// ---------------------------------------------------------------------------

function scenarioF() {
  const inst = createInstance();
  inst.loadbang();
  inst.run(200);
  inst.setGen(mix(
    sine(midiToFreq(45), 0.2),  // A2 110 Hz
    sine(midiToFreq(48), 0.2),  // C3 130.81
    sine(midiToFreq(52), 0.2),  // E3 164.81
    sine(midiToFreq(55), 0.2)   // G3 196.00
  ));
  const soundStart = inst.now();
  inst.run(3000);

  const commits = busMsgs(inst, "chord", soundStart).filter((e) => e.msg[1] !== -1);
  const lastCommit = commits.length ? commits[commits.length - 1] : null;
  const isAminX = !!lastCommit && lastCommit.msg[1] === 9 &&
    (lastCommit.msg[2] === "min7" || lastCommit.msg[2] === "min");
  check("F: A-C-E-G detected as A min7 or A min", isAminX,
    lastCommit
      ? "detected root=" + lastCommit.msg[1] + " quality=" + lastCommit.msg[2] +
        " score=" + lastCommit.msg[3] +
        " (all commits: " + commits.map((e) => e.msg[1] + " " + e.msg[2]).join("; ") + ")"
      : "no chord commit");
}

// ---------------------------------------------------------------------------
// Scenario G: 30 s C-major scale arpeggio -> key "C major", keyConfidence >= 0.2
// ---------------------------------------------------------------------------

function scenarioG() {
  const inst = createInstance();
  inst.loadbang();
  inst.run(200);

  // C-major scale arpeggio as a I-IV-V-I cadence (covers all 7 scale
  // degrees, tonic-anchored), 250 ms per note. The chroma EMA is
  // recency-weighted (~2.2 s time constant), so the pattern must keep every
  // local window C-major-shaped and end on the tonic triad.
  const seq = [60, 64, 67, 65, 69, 72, 67, 71, 62, 60, 64, 67];
  const noteDur = 0.25;
  const startSec = inst.elapsedSec();
  inst.setGen((t) => {
    // Clamp: the first generated sample can land fractionally before startSec
    // (integer sample truncation), and a negative rel would index seq[-1].
    const rel = Math.max(0, t - startSec);
    const midi = seq[Math.floor(rel / noteDur) % seq.length];
    return 0.3 * Math.sin(2 * Math.PI * midiToFreq(midi) * t);
  });
  const soundStart = inst.now();
  inst.run(30000);

  const keyMsgs = uiMsgs(inst, "key", soundStart).map((e) => deNbsp(e.msg[1]));
  const lastKey = keyMsgs.length ? keyMsgs[keyMsgs.length - 1] : "(none)";
  check("G: key message shows 'C major'", lastKey === "C major",
    "last key=" + JSON.stringify(lastKey) +
    " (distinct: " + [...new Set(keyMsgs)].join(", ") + ")");

  const sts = states(inst, soundStart);
  const last = sts.length ? sts[sts.length - 1].state : null;
  check("G: state key/mode C major", !!last && last.key === "C" && last.mode === "major",
    last ? "key=" + last.key + " mode=" + last.mode : "no state");
  check("G: keyConfidence >= 0.2", !!last && last.keyConfidence >= 0.2,
    last ? "keyConfidence=" + last.keyConfidence : "no state");
  if (last) {
    check("G: scalePitchClasses are C major",
      Array.isArray(last.scalePitchClasses) && last.scalePitchClasses.join(",") === "0,2,4,5,7,9,11",
      "scalePitchClasses=" + JSON.stringify(last.scalePitchClasses));
  }

  // Throttle holds under constant change (lead changes every 250 ms)
  checkThrottle("G: throttle under activity", inst, soundStart, inst.now());
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const scenarios = [
  ["A: 440 Hz sine pitch", scenarioA],
  ["B: C major chord", scenarioB],
  ["C/D: silence, heartbeat, throttle", scenarioCD],
  ["E: hello lifecycle", scenarioE],
  ["F: A minor 7", scenarioF],
  ["G: key detection", scenarioG]
];

for (const [label, fn] of scenarios) {
  try {
    fn();
  } catch (err) {
    check(label + " (scenario crashed)", false, (err && err.stack) || String(err));
  }
}

let failed = 0;
for (const r of results) {
  const mark = r.pass ? "PASS" : "FAIL";
  if (!r.pass) failed += 1;
  console.log(mark + "  " + r.name + (r.detail ? "  [" + r.detail + "]" : ""));
}
console.log("\n" + (results.length - failed) + "/" + results.length + " checks passed");
process.exit(failed ? 1 : 0);
