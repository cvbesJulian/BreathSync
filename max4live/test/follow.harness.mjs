// ---------------------------------------------------------------------------
// follow.harness.mjs — headless functional verification of bs.follow.js.
//
// Compiles the device script with `new Function`, injecting stubs for the Max
// globals it touches (outlet/post/Task/LiveAPI/jsarguments) plus a fake
// Date.now clock backed by an event queue so Task.schedule() fires
// deterministically. Each test section gets a completely fresh instance of
// the script (fresh module scope => fresh cfg/held/task state).
//
// Run:  node max4live/test/follow.harness.mjs
// Exit code 0 = all assertions passed.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = join(HERE, "..", "BreathSync Follow", "bs.follow.js");
const src = readFileSync(SRC_PATH, "utf8");

const NBSP = " ";

// --- fake clock + scheduled-task event queue ---------------------------------

let now = 100000; // fake epoch ms
const realDateNow = Date.now;
Date.now = () => now;

let queue = []; // { at, seq, task, cancelled }
let seqCounter = 0;

class FakeTask {
  constructor(fn) {
    this.fn = fn;
    this._entry = null;
  }
  schedule(ms) {
    this.cancel();
    const e = { at: now + Math.max(0, Number(ms) || 0), seq: seqCounter++, task: this, cancelled: false };
    this._entry = e;
    queue.push(e);
  }
  cancel() {
    if (this._entry) {
      this._entry.cancelled = true;
      this._entry = null;
    }
  }
}

// Advance the fake clock, executing due tasks in (time, schedule-order),
// with `now` set to each task's due time as it fires (as Max would).
function advance(ms) {
  const target = now + ms;
  for (;;) {
    queue = queue.filter((e) => !e.cancelled);
    let due = null;
    for (const e of queue) {
      if (e.at <= target && (!due || e.at < due.at || (e.at === due.at && e.seq < due.seq))) due = e;
    }
    if (!due) break;
    queue.splice(queue.indexOf(due), 1);
    now = due.at;
    due.task._entry = null;
    due.task.fn();
  }
  now = target;
}

// --- per-instance context (outlet capture, fake Live song) -------------------

function makeInstance() {
  queue = []; // orphan any tasks from a previous instance

  const ctx = {
    midi: [],   // { at, status, data1, data2 }
    disp: [],   // { at, sel, text }
    gets: [],   // { at, prop }
    sets: [],   // { at, prop, val }  <- undo-relevant LiveAPI writes
    song: { root_note: 0, scale_name: "Major", is_playing: 0, // fake C Major
      current_song_time: 0, signature_numerator: 4, signature_denominator: 4,
      tempo: 120 },
    tracks: [], // { playing_slot_index, clipLength } for the clip-wait scan
    observers: [], // LiveAPI instances constructed with a callback
  };

  function outlet(idx, ...args) {
    if (idx === 0) ctx.midi.push({ at: now, status: args[0], data1: args[1], data2: args[2] });
    else ctx.disp.push({ at: now, sel: args[0], text: String(args[1]) });
  }
  function post() {}
  function messnamed() {}

  class FakeLiveAPI {
    constructor(a, b) {
      if (typeof a === "function") {
        this.callback = a;
        this.path = b;
        ctx.observers.push(this);
      } else {
        this.path = a;
      }
      this._property = null;
      // Clip objects resolve to id 0 (LiveAPI's "no object") on empty slots.
      const cm = /^live_set tracks (\d+) clip_slots \d+ clip$/.exec(this.path || "");
      this.id = cm && !(ctx.tracks[+cm[1]] || {}).clipLength ? 0 : 1;
    }
    get property() { return this._property; }
    set property(p) { this._property = p; }
    getcount(name) {
      return name === "tracks" ? ctx.tracks.length : 0;
    }
    get(prop) {
      ctx.gets.push({ at: now, prop });
      const tm = /^live_set tracks (\d+)$/.exec(this.path || "");
      if (tm) {
        const t = ctx.tracks[+tm[1]];
        return [t ? t.playing_slot_index : -1];
      }
      const cm = /^live_set tracks (\d+) clip_slots \d+ clip$/.exec(this.path || "");
      if (cm) {
        const t = ctx.tracks[+cm[1]];
        return [prop === "length" && t ? t.clipLength : 0];
      }
      const v = ctx.song[prop];
      return v === undefined ? [0] : [v]; // LiveAPI returns arrays
    }
    set(prop, val) {
      ctx.sets.push({ at: now, prop, val });
      ctx.song[prop] = val;
    }
  }

  const EXPORTS = [
    "init", "state", "lead", "chord", "hello", "watchdog", "enabled",
    "mode", "vel", "velconf", "channel", "leadoct", "chordoct", "mindur",
    "keysync", "keyconf", "keyhold", "panic", "notifydeleted", "anything",
    "waitmode", "waitbars",
    "grid", "srand", "quantize", "gate", "gatelen", "chance", "spread",
    "voices", "strum", "human", "hold", "kill", "rewait",
  ];
  const factory = new Function(
    "outlet", "post", "messnamed", "Task", "LiveAPI", "jsarguments",
    src + "\n;return {" + EXPORTS.map((n) => n + ":" + n).join(",") + "};"
  );
  const api = factory(outlet, post, messnamed, FakeTask, FakeLiveAPI, ["bs.follow.js"]);
  for (const n of EXPORTS) {
    if (typeof api[n] !== "function") throw new Error("bs.follow.js missing handler: " + n);
  }
  return { api, ctx };
}

// helpers over a ctx
const midiSince = (ctx, t) => ctx.midi.filter((m) => m.at >= t);
const drainMidi = (ctx) => ctx.midi.splice(0);
const statusTexts = (ctx) => ctx.disp.filter((d) => d.sel === "status").map((d) => d.text);
const fireTransport = (ctx, v) => {
  const obs = ctx.observers.find((o) => o.property === "is_playing");
  if (!obs) throw new Error("no is_playing observer registered by init()");
  obs.callback(["is_playing", v]);
};
const mkstate = (o) => JSON.stringify(Object.assign({
  v: 1, src: "013bstime", key: null, mode: null, scalePitchClasses: [],
  chordRoot: null, chordQuality: null, chordPitchClasses: [], leadNote: null,
  density: 0, confidence: 0, keyConfidence: 0, updatedAt: now,
}, o));

// Drive the grid clock exactly as the patch's [metro 40 ticks] -> [transport] ->
// [pack] -> [prepend grid] chain would: one grid message every `step` ticks
// (default 40, the base grid), advancing the fake clock in lockstep and wrapping
// bar/beat/unit from an absolute tick counter. Returns the tick positions sent.
function playGrid(api, ctx, steps, opts = {}) {
  const [num, den] = opts.sig || [4, 4];
  const tempo = opts.tempo || 120;
  const step = opts.step || 40;
  const PPQ = 480;
  ctx.song.tempo = tempo;
  ctx.song.signature_numerator = num;
  ctx.song.signature_denominator = den;
  const barTicks = Math.round(num * (4 / den) * PPQ);
  const msPerTick = (60000 / tempo) / PPQ;
  const from = opts.from || [1, 1, 0]; // bar, beat, unit (1-based bar/beat)
  let abs = (from[0] - 1) * barTicks + (from[1] - 1) * PPQ + from[2];
  const sent = [];
  for (let i = 0; i < steps; i++) {
    const bar = Math.floor(abs / barTicks) + 1;
    const inBar = abs - (bar - 1) * barTicks;
    const beat = Math.floor(inBar / PPQ) + 1;
    const unit = inBar - (beat - 1) * PPQ;
    api.grid(bar, beat, unit);
    sent.push({ bar, beat, unit, inBar, abs });
    advance(step * msPerTick);
    abs += step;
  }
  return sent;
}

// Convenience: n sixteenth-notes' worth of base-grid bangs (120/40 = 3 per 16th).
const play16ths = (api, ctx, n, opts = {}) =>
  playGrid(api, ctx, n * 3, opts);

// --- assertion accumulator ----------------------------------------------------

const failures = [];
let checks = 0;
function check(name, cond, detail) {
  checks++;
  if (cond) {
    console.log("  ok  " + name);
  } else {
    const msg = name + (detail !== undefined ? "  [" + detail + "]" : "");
    failures.push(msg);
    console.log("  FAIL " + msg);
  }
}
function section(t) { console.log("\n== " + t); }
const fmt = (m) => "0x" + m.status.toString(16) + " " + m.data1 + " " + m.data2 + " @" + m.at;
const dump = (ms) => ms.map(fmt).join(", ") || "(none)";

// ============================================================================
// a. init + hello + state -> status "linked"
// ============================================================================
section("a. link handshake");
{
  const { api, ctx } = makeInstance();
  api.init();
  check("a1: init shows 'waiting for analyzer'",
    statusTexts(ctx).some((t) => t === "waiting" + NBSP + "for" + NBSP + "analyzer"),
    JSON.stringify(statusTexts(ctx)));
  api.hello(1, "013bstime");
  api.state(mkstate({}));
  const st = statusTexts(ctx);
  check("a2: hello+state -> status 'linked'",
    st.some((t) => t === "linked" + NBSP + "013bstime" || t === "linked"),
    JSON.stringify(st));
  check("a3: no MIDI from handshake alone", ctx.midi.length === 0, dump(ctx.midi));
}

// ============================================================================
// b. default mode Lead: on / legato change / clear
// ============================================================================
section("b. lead voice (default mode Lead, vel 96)");
{
  const { api, ctx } = makeInstance();
  api.init();
  api.lead(69, 0.8);
  let m = drainMidi(ctx);
  check("b1: lead 69 0.8 -> exactly [0x90,69,96]",
    m.length === 1 && m[0].status === 0x90 && m[0].data1 === 69 && m[0].data2 === 96,
    dump(m));

  advance(150); // > mindur (100)
  api.lead(71, 0.8);
  m = drainMidi(ctx);
  const onIdx = m.findIndex((x) => x.status === 0x90 && x.data1 === 71);
  const offIdx = m.findIndex((x) => x.status === 0x80 && x.data1 === 69);
  check("b2: legato — 0x90 71 emitted BEFORE 0x80 69",
    m.length === 2 && onIdx === 0 && offIdx === 1, dump(m));

  advance(150);
  api.lead(-1, 0);
  m = drainMidi(ctx);
  check("b3: lead -1 -> exactly 0x80 71",
    m.length === 1 && m[0].status === 0x80 && m[0].data1 === 71, dump(m));
}

// ============================================================================
// c. Min Dur coalescing (flap guard)
// ============================================================================
section("c. Min Dur coalescing (mindur 100)");
{
  const { api, ctx } = makeInstance();
  api.init();
  api.mindur(100);
  const t0 = now;
  api.lead(60, 0.9);
  advance(30);
  api.lead(62, 0.9); // inside Min Dur: queued
  advance(30);
  api.lead(64, 0.9); // inside Min Dur: replaces queued target (latest wins)
  const before = midiSince(ctx, t0 + 1); // everything after the initial on
  check("c1: no MIDI between onset and Min Dur expiry", before.length === 0, dump(before));
  advance(40); // reach t0+100 — the single scheduled Task fires
  const m = midiSince(ctx, t0 + 1);
  check("c2: one coalesced change at exactly t0+100ms",
    m.length === 2 && m.every((x) => x.at === t0 + 100), dump(m));
  check("c3: change lands on 64 (legato on-64 then off-60)",
    m.length === 2 &&
    m[0].status === 0x90 && m[0].data1 === 64 &&
    m[1].status === 0x80 && m[1].data1 === 60, dump(m));
  check("c4: intermediate 62 never sounded",
    !ctx.midi.some((x) => x.data1 === 62), dump(ctx.midi));
  // every sounded note >= 100 ms: match each note-off with its note-on
  const durs = ctx.midi
    .filter((x) => x.status === 0x80)
    .map((off) => {
      const on = [...ctx.midi].reverse().find((x) => x.status === 0x90 && x.data1 === off.data1 && x.at <= off.at);
      return on ? off.at - on.at : -1;
    });
  check("c5: every sounded note lasted >= 100 ms", durs.every((d) => d >= 100), JSON.stringify(durs));
}

// ============================================================================
// d. velocity-by-confidence
// ============================================================================
section("d. velconf scaling");
{
  const { api, ctx } = makeInstance();
  api.init();
  api.velconf(1);
  api.lead(69, 0.5); // round(96*(0.4+0.6*0.5)) = round(67.2) = 67
  const m = drainMidi(ctx);
  check("d1: lead 69 0.5 with velconf -> velocity 67",
    m.length === 1 && m[0].status === 0x90 && m[0].data1 === 69 && m[0].data2 === 67,
    dump(m));
}

// ============================================================================
// e. chord mode: voicing + exact diff on chord change
// ============================================================================
section("e. chord engine (mode 2)");
{
  const { api, ctx } = makeInstance();
  api.init();
  api.mode(2);
  api.chord(0, "maj", 0.8, 0, 4, 7); // C maj -> 48,52,55
  let m = drainMidi(ctx);
  const ons = (a) => a.filter((x) => (x.status & 0xf0) === 0x90).map((x) => x.data1).sort((p, q) => p - q);
  const offs = (a) => a.filter((x) => (x.status & 0xf0) === 0x80).map((x) => x.data1).sort((p, q) => p - q);
  check("e1: C maj -> exactly notes 48,52,55 on",
    m.length === 3 && JSON.stringify(ons(m)) === "[48,52,55]", dump(m));

  advance(200); // past Min Dur -> immediate diff
  api.chord(9, "min", 0.8, 9, 0, 4); // A min -> 57,60,64 (root 48+9, pcs stacked above)
  m = drainMidi(ctx);
  check("e2: A min diff — on exactly 57,60,64",
    JSON.stringify(ons(m)) === "[57,60,64]", dump(m));
  check("e3: A min diff — off exactly 48,52,55 (no common tones)",
    JSON.stringify(offs(m)) === "[48,52,55]", dump(m));
  check("e4: diff is exactly 6 messages", m.length === 6, dump(m));
}

// ============================================================================
// f. Both mode refcounting (lead lands on a chord tone)
// ============================================================================
section("f. Both mode refcount (mode 3)");
{
  const { api, ctx } = makeInstance();
  api.init();
  api.mode(3);
  api.chord(0, "maj", 0.8, 0, 4, 7); // 48,52,55 on
  drainMidi(ctx);
  advance(200);
  api.lead(48, 0.8); // 48 already held by the chord
  let m = drainMidi(ctx);
  check("f1: lead onto held chord tone 48 -> NO duplicate 0x90", m.length === 0, dump(m));
  advance(200);
  api.lead(-1, 0);
  m = drainMidi(ctx);
  check("f2: lead clear -> NO 0x80 48 (chord still holds it)", m.length === 0, dump(m));
  advance(200);
  api.chord(-1, "none", 0); // chord reset must now finally release 48 (+52,55)
  m = drainMidi(ctx);
  check("f3: chord reset releases 48,52,55 exactly once each",
    m.length === 3 && m.every((x) => x.status === 0x80) &&
    JSON.stringify(m.map((x) => x.data1).sort((p, q) => p - q)) === "[48,52,55]",
    dump(m));
}

// ============================================================================
// g. channel change mid-note (UI "Channel 2" = handler value 1 -> 0x91/0x81)
// ============================================================================
section("g. channel change mid-note");
{
  const { api, ctx } = makeInstance();
  api.init();
  api.mode(2);
  api.chord(0, "maj", 0.8, 0, 4, 7); // 48,52,55 on channel index 0
  drainMidi(ctx);
  advance(200);
  api.channel(1); // patch mapping: live.menu "2" -> index 1
  const m = drainMidi(ctx);
  const oldOffs = m.filter((x) => x.status === 0x80);
  const newOns = m.filter((x) => x.status === 0x91);
  check("g1: note-offs on OLD channel (0x80) for 48,52,55",
    JSON.stringify(oldOffs.map((x) => x.data1).sort((p, q) => p - q)) === "[48,52,55]", dump(m));
  check("g2: re-strike on NEW channel (0x91) for 48,52,55",
    JSON.stringify(newOns.map((x) => x.data1).sort((p, q) => p - q)) === "[48,52,55]", dump(m));
  check("g3: offs precede ons and nothing else emitted",
    m.length === 6 && m.slice(0, 3).every((x) => x.status === 0x80) && m.slice(3).every((x) => x.status === 0x91),
    dump(m));
  advance(200);
  api.chord(-1, "none", 0);
  const m2 = drainMidi(ctx);
  check("g4: subsequent release uses new channel (0x81)",
    m2.length === 3 && m2.every((x) => x.status === 0x81), dump(m2));
}

// ============================================================================
// h. staleness watchdog
// ============================================================================
section("h. staleness (3 s without state)");
{
  const { api, ctx } = makeInstance();
  api.init();
  api.hello(1, "013bstime");
  api.state(mkstate({}));
  api.lead(69, 0.8);
  drainMidi(ctx);
  const tState = now;
  // watchdog ticks every 250 ms while the clock advances 3.5 s with no state
  for (let i = 0; i < 14; i++) {
    advance(250);
    api.watchdog();
  }
  const m = drainMidi(ctx);
  check("h1: all notes released on staleness",
    m.length === 1 && m[0].status === 0x80 && m[0].data1 === 69, dump(m));
  check("h2: release happened after 3000 ms of silence",
    m.length === 1 && m[0].at - tState > 3000 && m[0].at - tState <= 3500,
    m.length ? m[0].at - tState + " ms" : "no midi");
  check("h3: status shows 'stale'", statusTexts(ctx).includes("stale"),
    JSON.stringify(statusTexts(ctx)));
}

// ============================================================================
// i. enabled 0 / notifydeleted / panic mid-note
// ============================================================================
section("i. enabled 0 / notifydeleted / panic");
{
  const { api, ctx } = makeInstance();
  api.init();
  api.lead(69, 0.8);
  drainMidi(ctx);
  advance(200);
  api.enabled(0);
  let m = drainMidi(ctx);
  check("i1: enabled 0 mid-note -> note released",
    m.length === 1 && m[0].status === 0x80 && m[0].data1 === 69, dump(m));
  api.enabled(1); // re-applies the cached lead event
  m = drainMidi(ctx);
  check("i2: enabled 1 re-strikes cached lead 69",
    m.length === 1 && m[0].status === 0x90 && m[0].data1 === 69, dump(m));

  advance(200);
  api.notifydeleted();
  m = drainMidi(ctx);
  const cc = m.filter((x) => (x.status & 0xf0) === 0xb0);
  check("i3: notifydeleted mid-note -> note released",
    m.some((x) => x.status === 0x80 && x.data1 === 69), dump(m));
  check("i4: notifydeleted -> CC123 value 0 on all 16 channels",
    cc.length === 16 &&
    Array.from({ length: 16 }, (_, ch) => ch).every((ch) =>
      cc.some((x) => x.status === 0xb0 + ch && x.data1 === 123 && x.data2 === 0)),
    dump(cc));

  api.lead(69, 0.8); // heldLead cleared by releaseAll -> immediate re-strike
  drainMidi(ctx);
  advance(200);
  api.panic();
  m = drainMidi(ctx);
  const cc2 = m.filter((x) => (x.status & 0xf0) === 0xb0);
  check("i5: panic mid-note -> note released + CC123 x16",
    m.some((x) => x.status === 0x80 && x.data1 === 69) &&
    cc2.length === 16 &&
    Array.from({ length: 16 }, (_, ch) => ch).every((ch) =>
      cc2.some((x) => x.status === 0xb0 + ch && x.data1 === 123 && x.data2 === 0)),
    dump(m));
}

// ============================================================================
// j. transport stop -> releaseAll
// ============================================================================
section("j. transport is_playing 1->0");
{
  const { api, ctx } = makeInstance();
  api.init();
  api.waitmode(0); // isolate pure transport semantics from the engage gate
  check("j1: init registered an is_playing observer",
    ctx.observers.some((o) => o.property === "is_playing"),
    JSON.stringify(ctx.observers.map((o) => o.property)));
  api.lead(69, 0.8);
  drainMidi(ctx);
  fireTransport(ctx, 1);
  check("j2: transport start emits nothing", ctx.midi.length === 0, dump(ctx.midi));
  fireTransport(ctx, 0);
  const m = drainMidi(ctx);
  check("j3: transport stop releases all notes",
    m.length === 1 && m[0].status === 0x80 && m[0].data1 === 69, dump(m));
  api.state(mkstate({}));
  const m2 = drainMidi(ctx);
  check("j4: next state after stop re-strikes the cached lead",
    m2.length === 1 && m2[0].status === 0x90 && m2[0].data1 === 69, dump(m2));
}

// ============================================================================
// k. key sync gating (keysync 1, keyconf 0.5, keyhold 2)
// ============================================================================
section("k. key sync");
{
  const { api, ctx } = makeInstance();
  api.init();
  api.keysync(1);
  api.keyconf(0.5);
  api.keyhold(2);
  const t0 = now;

  const feed = (key, mode, kc) => api.state(mkstate({ key, mode, keyConfidence: kc }));

  // F minor @ 0.62 every 250 ms for 2.5 s (fake song starts C Major)
  for (let k = 0; k <= 10; k++) {
    feed("F", "minor", 0.62);
    if (k < 10) advance(250);
  }
  const firstSets = ctx.sets.slice();
  check("k1: exactly ONE commit -> set root_note 5 + set scale_name Minor",
    firstSets.length === 2 &&
    firstSets[0].prop === "root_note" && firstSets[0].val === 5 &&
    firstSets[1].prop === "scale_name" && firstSets[1].val === "Minor",
    JSON.stringify(firstSets));
  check("k2: commit fired at hold expiry (t0+2000)",
    firstSets.length === 2 && firstSets[0].at === t0 + 2000,
    firstSets.length ? "at t0+" + (firstSets[0].at - t0) : "no sets");
  const readBefore = ctx.gets.find((g) => g.prop === "root_note" && g.at === (firstSets[0] || {}).at);
  check("k3: read-back skip check ran before writing (get root_note at commit time)",
    !!readBefore, JSON.stringify(ctx.gets));

  // keep feeding the SAME key for 12 more s: the >=10 s re-attempt reads back
  // F/Minor from the fake song and must skip (no additional sets)
  for (let k = 0; k < 48; k++) {
    advance(250);
    feed("F", "minor", 0.62);
  }
  check("k4: stable key -> NO further sets (read-before-write guard)",
    ctx.sets.length === 2, JSON.stringify(ctx.sets));

  // change key to G major @ 0.7: no set before 10 s since the last set
  // attempt, set once hold (2 s) AND the 10 s interval are both satisfied
  const lastAttemptAt = Math.max(...ctx.gets.filter((g) => g.prop === "root_note").map((g) => g.at));
  advance(250);
  const tG = now;
  for (let k = 0; k < 48; k++) {
    feed("G", "major", 0.7);
    advance(250);
  }
  const gSets = ctx.sets.slice(2);
  check("k5: G major eventually committed (root_note 7 + scale_name Major)",
    gSets.length === 2 &&
    gSets[0].prop === "root_note" && gSets[0].val === 7 &&
    gSets[1].prop === "scale_name" && gSets[1].val === "Major",
    JSON.stringify(gSets));
  check("k6: no set before 10 s since the last set/read-back",
    gSets.length === 2 && gSets[0].at - lastAttemptAt >= 10000,
    gSets.length ? gSets[0].at - lastAttemptAt + " ms after last attempt" : "no sets");
  check("k7: G hold time respected (>= 2 s after candidate start)",
    gSets.length === 2 && gSets[0].at - tG >= 2000,
    gSets.length ? gSets[0].at - tG + " ms" : "no sets");
  check("k8: total sets across whole scenario is exactly 4",
    ctx.sets.length === 4, JSON.stringify(ctx.sets));
}

// ============================================================================
// l. key sync default OFF: no LiveAPI set ever
// ============================================================================
section("l. key sync default off");
{
  const { api, ctx } = makeInstance();
  api.init();
  // strong, stable key for 30 s — must never touch the song
  for (let k = 0; k < 120; k++) {
    api.state(mkstate({ key: "F", mode: "minor", keyConfidence: 0.9 }));
    advance(250);
  }
  check("l1: without keysync 1, no LiveAPI set ever happens",
    ctx.sets.length === 0, JSON.stringify(ctx.sets));
  check("l2: fake song untouched (still C Major)",
    ctx.song.root_note === 0 && ctx.song.scale_name === "Major",
    JSON.stringify(ctx.song));
}

// ============================================================================
// m. engage gating — Bars mode (default: waitmode 1, waitbars 4 => 16 beats)
// ============================================================================
section("m. wait gating, Bars mode (default 4 bars)");
{
  const { api, ctx } = makeInstance();
  api.init();
  api.hello(1, "013bstime");
  api.state(mkstate({}));

  api.lead(60, 0.8); // transport stopped => jam mode, plays immediately
  let m = drainMidi(ctx);
  check("m1: jam mode (transport stopped) plays immediately",
    m.length === 1 && m[0].status === 0x90 && m[0].data1 === 60, dump(m));

  ctx.song.is_playing = 1;
  ctx.song.current_song_time = 0;
  fireTransport(ctx, 1); // arm: go silent, count 4 bars
  m = drainMidi(ctx);
  check("m2: transport start releases the jam note (starts silent)",
    m.length === 1 && m[0].status === 0x80 && m[0].data1 === 60, dump(m));
  check("m3: countdown shown in status",
    statusTexts(ctx).some((t) => t.startsWith("wait" + NBSP)),
    JSON.stringify(statusTexts(ctx).slice(-3)));

  api.lead(64, 0.8); // mid-wait events are gated but cached
  ctx.song.current_song_time = 8; // 2 of 4 bars
  advance(250);
  api.watchdog();
  check("m4: no MIDI mid-wait (2 of 4 bars)", ctx.midi.length === 0, dump(ctx.midi));

  ctx.song.current_song_time = 16.01; // past 4 bars
  advance(250);
  api.watchdog();
  m = drainMidi(ctx);
  check("m5: engages after 4 bars and re-strikes the cached lead 64",
    m.length === 1 && m[0].status === 0x90 && m[0].data1 === 64, dump(m));
  const st = statusTexts(ctx);
  check("m6: status returns to linked after engage",
    st[st.length - 1] === "linked" + NBSP + "013bstime", JSON.stringify(st.slice(-2)));

  advance(150); // > mindur
  api.lead(65, 0.8); // engaged: events flow normally again (legato pair)
  m = drainMidi(ctx);
  check("m7: post-engage events flow (legato 65 on, 64 off)",
    m.length === 2 && m[0].status === 0x90 && m[0].data1 === 65 &&
    m[1].status === 0x80 && m[1].data1 === 64, dump(m));
}

// ============================================================================
// n. wait gating — user bars input + mid-wait changes
// ============================================================================
section("n. wait gating, Wait Bars input");
{
  const { api, ctx } = makeInstance();
  api.init();
  api.waitbars(1); // 1 bar @ 4/4 = 4 beats
  ctx.song.is_playing = 1;
  ctx.song.current_song_time = 0;
  fireTransport(ctx, 1);
  api.lead(60, 0.8);
  ctx.song.current_song_time = 3.9;
  api.watchdog();
  check("n1: gated before 1 bar elapses", ctx.midi.length === 0, dump(ctx.midi));
  ctx.song.current_song_time = 4.01;
  api.watchdog();
  let m = drainMidi(ctx);
  check("n2: engages after the user-set 1 bar",
    m.length === 1 && m[0].status === 0x90 && m[0].data1 === 60, dump(m));

  // waitmode 0 mid-wait engages immediately
  const inst2 = makeInstance();
  inst2.api.init();
  inst2.ctx.song.is_playing = 1;
  inst2.ctx.song.current_song_time = 0;
  fireTransport(inst2.ctx, 1);
  inst2.api.lead(62, 0.8);
  check("n3: gated right after transport start", inst2.ctx.midi.length === 0,
    dump(inst2.ctx.midi));
  inst2.api.waitmode(0);
  m = drainMidi(inst2.ctx);
  check("n4: switching Wait Mode off engages immediately (re-strike 62)",
    m.length === 1 && m[0].status === 0x90 && m[0].data1 === 62, dump(m));
}

// ============================================================================
// o. wait gating — Clip mode (longest playing session clip; fallback to bars)
// ============================================================================
section("o. wait gating, Clip mode");
{
  const { api, ctx } = makeInstance();
  api.init();
  api.waitmode(2);
  ctx.tracks = [
    { playing_slot_index: -1, clipLength: 0 },  // silent track
    { playing_slot_index: 0, clipLength: 8 },   // playing 2-bar loop
  ];
  ctx.song.is_playing = 1;
  ctx.song.current_song_time = 0;
  fireTransport(ctx, 1);
  api.lead(60, 0.8);
  ctx.song.current_song_time = 7.9;
  api.watchdog();
  check("o1: gated during the clip's first pass (8 beats)",
    ctx.midi.length === 0, dump(ctx.midi));
  ctx.song.current_song_time = 8.01;
  api.watchdog();
  let m = drainMidi(ctx);
  check("o2: engages after one full clip pass",
    m.length === 1 && m[0].status === 0x90 && m[0].data1 === 60, dump(m));

  // Fallback: no playing clip => Wait Bars applies (default 4 bars = 16 beats)
  const inst2 = makeInstance();
  inst2.api.init();
  inst2.api.waitmode(2);
  inst2.ctx.song.is_playing = 1;
  inst2.ctx.song.current_song_time = 0;
  fireTransport(inst2.ctx, 1);
  inst2.api.lead(64, 0.8);
  inst2.ctx.song.current_song_time = 8.1;
  inst2.api.watchdog();
  check("o3: no playing clip -> still gated at 8.1 beats (bars fallback)",
    inst2.ctx.midi.length === 0, dump(inst2.ctx.midi));
  inst2.ctx.song.current_song_time = 16.1;
  inst2.api.watchdog();
  m = drainMidi(inst2.ctx);
  check("o4: falls back to Wait Bars (engages after 16 beats)",
    m.length === 1 && m[0].status === 0x90 && m[0].data1 === 64, dump(m));
}

// ============================================================================
// p. wait gating — transport stop mid-wait reopens jam mode
// ============================================================================
section("p. wait gating, transport stop mid-wait");
{
  const { api, ctx } = makeInstance();
  api.init();
  ctx.song.is_playing = 1;
  ctx.song.current_song_time = 0;
  fireTransport(ctx, 1);
  api.lead(60, 0.8);
  ctx.song.current_song_time = 4;
  api.watchdog();
  check("p1: gated mid-wait", ctx.midi.length === 0, dump(ctx.midi));
  ctx.song.is_playing = 0;
  fireTransport(ctx, 0); // stop: countdown cancelled, back to jam mode
  api.state(mkstate({})); // pendingRestrike path
  let m = drainMidi(ctx);
  check("p2: after stop, cached lead re-strikes via the next state",
    m.length === 1 && m[0].status === 0x90 && m[0].data1 === 60, dump(m));
  advance(150);
  api.lead(62, 0.8);
  m = drainMidi(ctx);
  check("p3: jam mode after stop plays events immediately",
    m.length === 2 && m[0].status === 0x90 && m[0].data1 === 62 &&
    m[1].status === 0x80 && m[1].data1 === 60, dump(m));
}

// ============================================================================
// grid. grid clock is inert with quantize/gate off (defaults are a no-op)
// ============================================================================
section("grid. grid clock inert at defaults");
{
  const { api, ctx } = makeInstance();
  api.init();
  api.mode(3);
  api.srand(1);
  ctx.song.is_playing = 1;
  fireTransport(ctx, 1);
  api.waitmode(0); // engage immediately, isolate the grid clock
  api.chord(0, "maj", 0.8, 0, 4, 7);
  api.lead(60, 0.8);
  drainMidi(ctx);
  // A full bar of base-grid bangs must not emit a single byte with everything off.
  play16ths(api, ctx, 16, { sig: [4, 4], tempo: 120 });
  check("grid1: grid clock emits nothing with quantize+gate off",
    ctx.midi.length === 0, dump(ctx.midi));

  // Boundary classification: 1/16 boundaries land every 120 ticks; a mid-16th
  // tick (40, 80) is not a boundary; triplet 1/16T lands every 80 ticks.
  const inst = makeInstance();
  inst.api.init();
  check("grid2: helper advanced the fake clock over a full bar (16 x 1/16)",
    typeof inst.api.grid === "function", "grid handler present");
}

// ============================================================================
// q. Quantize — park changes, flush on the matching boundary, Min-Dur bypass
// ============================================================================
const ons = (a) => a.filter((x) => (x.status & 0xf0) === 0x90).map((x) => x.data1).sort((p, q) => p - q);
const offs = (a) => a.filter((x) => (x.status & 0xf0) === 0x80).map((x) => x.data1).sort((p, q) => p - q);

// A device engaged, playing, mode Both, with the grid clock live.
function playingBoth(opts = {}) {
  const { api, ctx } = makeInstance();
  api.init();
  api.srand(opts.seed || 1);
  api.mode(opts.mode || 3);
  api.waitmode(0);           // engage immediately
  ctx.song.is_playing = 1;
  ctx.song.tempo = opts.tempo || 120;
  ctx.song.signature_numerator = (opts.sig || [4, 4])[0];
  ctx.song.signature_denominator = (opts.sig || [4, 4])[1];
  fireTransport(ctx, 1);     // transportPlaying = true, engaged (waitmode 0)
  return { api, ctx };
}

section("q. quantize");
{
  const { api, ctx } = playingBoth();
  api.quantize(4); // 1/4 note
  api.chord(0, "maj", 0.8, 0, 4, 7); // change parked, nothing yet
  let m = drainMidi(ctx);
  check("q1a: parked change emits nothing before the boundary",
    m.length === 0, dump(m));
  // Walk to the next quarter-note boundary (beat 2 @ 480 ticks).
  playGrid(api, ctx, 12, { from: [1, 1, 40] }); // 40..480 ticks: crosses beat 2
  m = drainMidi(ctx);
  check("q1b: chord snaps to the 1/4 boundary (48,52,55 on)",
    JSON.stringify(ons(m)) === "[48,52,55]", dump(m));
}
{
  // q2: latest-wins — two changes parked before the boundary, only the last lands.
  const { api, ctx } = playingBoth();
  api.quantize(4);
  api.chord(0, "maj", 0.8, 0, 4, 7);   // parked
  api.chord(9, "min", 0.8, 9, 0, 4);   // supersedes (latest wins)
  playGrid(api, ctx, 12, { from: [1, 1, 40] });
  const m = drainMidi(ctx);
  check("q2: latest-wins — only A min (57,60,64) lands, C maj never sounds",
    JSON.stringify(ons(m)) === "[57,60,64]" &&
    !ctx.midi.some((x) => (x.status & 0xf0) === 0x90 && x.data1 === 52),
    dump(m));
}
{
  // q3: Min-Dur bypass at 200 BPM — rapid changes never flap; they just re-park.
  const { api, ctx } = playingBoth({ tempo: 200 });
  api.quantize(1); // 1/16
  api.mindur(100);
  api.chord(0, "maj", 0.8, 0, 4, 7);
  api.chord(2, "min", 0.8, 2, 5, 9);
  api.chord(4, "min", 0.8, 4, 7, 11);
  const mid = drainMidi(ctx);
  check("q3a: no Min-Dur flap — nothing sounds between boundaries",
    mid.length === 0, dump(mid));
  playGrid(api, ctx, 4, { from: [1, 1, 40], tempo: 200 }); // cross a 1/16 (120 ticks)
  const m = drainMidi(ctx);
  check("q3b: exactly one chord lands on the boundary (the latest: E min)",
    JSON.stringify(ons(m)) === "[52,55,59]", dump(m));
}
{
  // q4: jam mode (transport stopped) bypasses quantize — plays immediately.
  const { api, ctx } = makeInstance();
  api.init();
  api.mode(3);
  api.quantize(4);
  api.chord(0, "maj", 0.8, 0, 4, 7); // stopped -> today's path, immediate
  const m = drainMidi(ctx);
  check("q4: transport stopped -> quantize bypassed, chord sounds now",
    JSON.stringify(ons(m)) === "[48,52,55]", dump(m));
}
{
  // q5: bar boundary honours the time signature (3/4 = 1440 ticks/bar).
  const { api, ctx } = playingBoth({ sig: [3, 4] });
  api.quantize(6); // 1 Bar
  api.chord(0, "maj", 0.8, 0, 4, 7);
  playGrid(api, ctx, 6, { from: [1, 1, 40], sig: [3, 4] }); // 40..280, still bar 1
  let m = drainMidi(ctx);
  check("q5a: 3/4 — no flush mid-bar", m.length === 0, dump(m));
  // Advance to the downbeat of bar 2 (tick 1440 -> bar 2 beat 1 unit 0).
  playGrid(api, ctx, 1, { from: [2, 1, 0], sig: [3, 4] });
  m = drainMidi(ctx);
  check("q5b: 3/4 — chord snaps to the bar-2 downbeat",
    JSON.stringify(ons(m)) === "[48,52,55]", dump(m));

  // Releases are never quantized: a chord reset clears immediately.
  api.chord(-1, "none", 0);
  m = drainMidi(ctx);
  check("q5c: chord reset releases immediately (not quantized)",
    JSON.stringify(offs(m)) === "[48,52,55]", dump(m));
}

// ============================================================================
// s. Strum — chord tones staggered low->high; ledger stays correct under cancel
// ============================================================================
section("s. strum");
{
  const { api, ctx } = makeInstance();
  api.init();
  api.mode(2);
  api.strum(20); // 20 ms per added tone
  const t0 = now;
  api.chord(0, "maj", 0.8, 0, 4, 7); // 48,52,55 — full-chord onset strum
  let m = drainMidi(ctx);
  check("s1a: only the lowest tone (48) sounds at t0",
    m.length === 1 && m[0].status === 0x90 && m[0].data1 === 48, dump(m));
  advance(20);
  m = drainMidi(ctx);
  check("s1b: 52 sounds at t0+20", m.length === 1 && m[0].data1 === 52 &&
    m[0].at === t0 + 20, dump(m));
  advance(20);
  m = drainMidi(ctx);
  check("s1c: 55 sounds at t0+40", m.length === 1 && m[0].data1 === 55 &&
    m[0].at === t0 + 40, dump(m));
}
{
  // s2: panic mid-strum — unfired strum ons are cancelled, ledger clears, no
  // orphaned note ever sounds.
  const { api, ctx } = makeInstance();
  api.init();
  api.mode(2);
  api.strum(20);
  api.chord(0, "maj", 0.8, 0, 4, 7); // 48 now; 52,55 parked
  drainMidi(ctx);
  api.panic(); // releaseAll(true): tlClear drops 52,55; off 48; CC123 x16
  let m = drainMidi(ctx);
  const off48 = m.some((x) => x.status === 0x80 && x.data1 === 48);
  const cc = m.filter((x) => (x.status & 0xf0) === 0xb0);
  check("s2a: panic offs the sounding tone (48) + CC123 x16",
    off48 && cc.length === 16, dump(m));
  advance(60); // the parked 52,55 must NOT surface
  m = drainMidi(ctx);
  check("s2b: cancelled strum ons never sound after panic",
    m.length === 0 && !ctx.midi.some((x) => x.status === 0x90 && (x.data1 === 52 || x.data1 === 55)),
    dump(m));
}
{
  // s3: channel change mid-strum — old channel released, re-strike on new channel,
  // no orphaned on from the old strum.
  const { api, ctx } = makeInstance();
  api.init();
  api.mode(2);
  api.strum(20);
  api.chord(0, "maj", 0.8, 0, 4, 7); // 48 on ch0; 52,55 parked
  drainMidi(ctx);
  advance(10);
  api.channel(1); // releaseAll(false) then reapply on ch1
  let m = drainMidi(ctx);
  check("s3a: old channel off for 48 (0x80), no stray 0x90 from old strum",
    m.some((x) => x.status === 0x80 && x.data1 === 48) &&
    !m.some((x) => x.status === 0x90 && (x.data1 === 52 || x.data1 === 55)),
    dump(m));
  // re-strike begins on the new channel (0x91), strummed again
  const first91 = m.find((x) => (x.status & 0xf0) === 0x90);
  check("s3b: re-strike on new channel 0x91 (lowest tone 48 first)",
    first91 && first91.status === 0x91 && first91.data1 === 48, dump(m));
  advance(60);
  m = drainMidi(ctx).filter((x) => (x.status & 0xf0) === 0x90);
  check("s3c: remaining strummed tones (52,55) strike on channel 1",
    [52, 55].every((p) => m.some((x) => x.status === 0x91 && x.data1 === p)),
    dump(m));
}

// ============================================================================
// h. Human — seeded jitter is deterministic; h=0 is byte-exact
// ============================================================================
section("h. human");
function runHuman(seed, humanPct) {
  const { api, ctx } = makeInstance();
  api.init();
  api.srand(seed);
  api.mode(2);
  api.human(humanPct);
  const t0 = now;
  api.chord(0, "maj7", 0.8, 0, 4, 7, 11); // 48,52,55,59
  advance(60); // let any humanized ons fire
  // Relative timing: absolute `now` differs between runs, jitter offsets do not.
  return ctx.midi.map((x) => ({ s: x.status, d: x.data1, v: x.data2, at: x.at - t0 }));
}
{
  const a = runHuman(42, 100);
  const b = runHuman(42, 100);
  check("h1a: same seed -> identical MIDI (bytes + timing)",
    JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a.slice(0, 4)));
  const c = runHuman(43, 100);
  check("h1b: different seed -> different result (jitter is live)",
    JSON.stringify(a) !== JSON.stringify(c), "seed sensitivity");
  check("h1c: velocities stay in 1..127 under jitter",
    a.filter((e) => (e.s & 0xf0) === 0x90).every((e) => e.v >= 1 && e.v <= 127),
    JSON.stringify(a.filter((e) => (e.s & 0xf0) === 0x90).map((e) => e.v)));
}
{
  // h=0 must be perfectly synchronous at the base velocity (byte-exact path).
  const z = runHuman(42, 0);
  const onZ = z.filter((e) => (e.s & 0xf0) === 0x90);
  check("h2a: h=0 -> all four tones at the same instant",
    onZ.length === 4 && onZ.every((e) => e.at === onZ[0].at), JSON.stringify(onZ));
  check("h2b: h=0 -> exact base velocity 96, no jitter",
    onZ.every((e) => e.v === 96), JSON.stringify(onZ.map((e) => e.v)));
}

// ============================================================================
// g_. Gate — chord-voice pulsing, note lengths, shared boundary, stop orphans
// ============================================================================
section("g_. gate (chord pulsing)");
{
  // g1: strike cadence + note length. 120 BPM, 1/8 gate -> 250 ms interval,
  // gatelen 50 % -> 125 ms note.
  const { api, ctx } = playingBoth({ mode: 2, tempo: 120 });
  api.gate(2);     // 1/8
  api.gatelen(50);
  api.chord(0, "maj", 0.8, 0, 4, 7); // parked (gate owns the chord voice)
  drainMidi(ctx);
  const t0 = now;
  api.grid(2, 1, 0); // tick 480 -> 1/8 boundary: adopt + strike
  let m = drainMidi(ctx);
  check("g1a: gate strike sounds 48,52,55 at the boundary",
    JSON.stringify(ons(m)) === "[48,52,55]" && m.every((x) => x.at === t0), dump(m));
  advance(125);
  m = drainMidi(ctx);
  check("g1b: notes release at gatelen (t0+125 ms)",
    JSON.stringify(offs(m)) === "[48,52,55]" && m.every((x) => x.at === t0 + 125), dump(m));
  advance(200);
  check("g1c: chord stays silent until the next gate boundary",
    drainMidi(ctx).length === 0, "gap");
}
{
  // g2: quantize + gate on the same 1/8 boundary strikes the chord exactly once.
  const { api, ctx } = playingBoth({ mode: 2, tempo: 120 });
  api.quantize(2); // 1/8
  api.gate(2);     // 1/8
  api.chord(0, "maj", 0.8, 0, 4, 7);
  drainMidi(ctx);
  api.grid(2, 1, 0);
  const m = drainMidi(ctx);
  check("g2: shared quantize+gate boundary strikes once (3 ons, not 6)",
    m.filter((x) => (x.status & 0xf0) === 0x90).length === 3 &&
    JSON.stringify(ons(m)) === "[48,52,55]", dump(m));
}
{
  // g3: transport stop mid-pulse releases everything, no orphaned logoff fires.
  const { api, ctx } = playingBoth({ mode: 2, tempo: 120 });
  api.gate(2);
  api.gatelen(50);
  api.chord(0, "maj", 0.8, 0, 4, 7);
  drainMidi(ctx);
  api.grid(2, 1, 0);          // strike
  drainMidi(ctx);
  advance(50);                // mid-pulse (before the 125 ms off)
  fireTransport(ctx, 0);      // stop
  let m = drainMidi(ctx);
  check("g3a: transport stop releases the sounding pulse (48,52,55 off)",
    JSON.stringify(offs(m)) === "[48,52,55]", dump(m));
  advance(300);               // the cancelled logoffs must never fire
  check("g3b: no orphaned note events after stop",
    drainMidi(ctx).length === 0, "orphans");
}

// Net hanging notes (channel/pitch with more ons than offs) — the invariant that
// must stay empty after any full release, regardless of chance-skips.
function hanging(ctx) {
  const bal = new Map();
  for (const m of ctx.midi) {
    const st = m.status & 0xf0;
    if (st !== 0x90 && st !== 0x80) continue;
    const key = (m.status & 0x0f) + "/" + m.data1;
    bal.set(key, (bal.get(key) || 0) + (st === 0x90 ? 1 : -1));
  }
  return [...bal.entries()].filter(([, v]) => v > 0).map(([k]) => k);
}

// ============================================================================
// k. Kill — immediate mute; caches keep tracking; off re-strikes from source
// ============================================================================
section("k. kill");
{
  const { api, ctx } = makeInstance();
  api.init();
  api.mode(3);
  api.chord(0, "maj", 0.8, 0, 4, 7); // 48,52,55
  api.lead(60, 0.8);                  // + 60
  drainMidi(ctx);
  api.kill(1);
  let m = drainMidi(ctx);
  check("k1a: kill on -> everything muted at once",
    JSON.stringify(offs(m)) === "[48,52,55,60]", dump(m));
  // Live events keep updating the cache but never sound while killed.
  api.chord(9, "min", 0.8, 9, 0, 4); // Am -> cache only
  api.lead(62, 0.8);
  m = drainMidi(ctx);
  check("k1b: killed -> live events produce no MIDI", m.length === 0, dump(m));
  api.kill(0);
  m = drainMidi(ctx);
  check("k2: kill off -> re-strike from the CURRENT source (Am 57,60,64 + lead 62)",
    JSON.stringify(ons(m)) === "[57,60,62,64]", dump(m));
  check("k2b: no notes left hanging after the kill cycle",
    hanging(ctx).length === 0, JSON.stringify(hanging(ctx)));
}

// ============================================================================
// c. Chance — gates physical note-ons only, never offs; no stuck notes
// ============================================================================
section("c. chance");
{
  const { api, ctx } = makeInstance();
  api.init();
  api.mode(2);
  api.chance(0); // never sound
  api.chord(0, "maj", 0.8, 0, 4, 7);
  check("c1a: chance 0 -> no note-ons at all",
    !ctx.midi.some((x) => (x.status & 0xf0) === 0x90), dump(ctx.midi));
  api.chord(-1, "none", 0); // reset: offs are never gated, but nothing sounds
  check("c1b: chance 0 -> nothing hanging, no spurious offs",
    hanging(ctx).length === 0 && ctx.midi.length === 0, dump(ctx.midi));
}
{
  const { api, ctx } = makeInstance();
  api.init();
  api.srand(5);
  api.mode(2);
  api.mindur(0);  // isolate chance from the Min-Dur flap guard
  api.chance(50);
  api.chord(0, "maj7", 0.8, 0, 4, 7, 11); // 48,52,55,59 — a seeded subset sounds
  const on = ctx.midi.filter((x) => (x.status & 0xf0) === 0x90); // keep the record
  check("c2a: chance 50 -> a partial, deterministic subset sounds",
    on.length >= 1 && on.length <= 3, "sounded " + on.length + " of 4");
  api.chord(-1, "none", 0); // release (immediate: mindur 0)
  check("c2b: offs are never gated -> exactly the sounded notes release, none hang",
    hanging(ctx).length === 0, JSON.stringify(hanging(ctx)));
}
{
  // c3: shared lead/chord pitch under chance — the refcount hazard must not leave
  // a stuck note or underflow no matter which owner is skipped.
  const { api, ctx } = makeInstance();
  api.init();
  api.srand(3);
  api.mode(3);
  api.mindur(0);
  api.chance(50);
  api.chord(0, "maj", 0.8, 0, 4, 7); // 48,52,55
  api.lead(48, 0.8);                  // lead lands on chord tone 48
  api.lead(-1, 0);                    // lead clears
  api.chord(-1, "none", 0);           // chord resets
  check("c3: shared-pitch chance skips leave nothing hanging (no underflow)",
    hanging(ctx).length === 0, JSON.stringify(hanging(ctx)));
}

// ============================================================================
// r. Re-Wait — re-arm the engage countdown from the current position
// ============================================================================
section("r. re-wait");
{
  const { api, ctx } = makeInstance();
  api.init();
  api.waitmode(0); // engage immediately
  ctx.song.is_playing = 1;
  ctx.song.current_song_time = 0;
  fireTransport(ctx, 1);
  api.lead(60, 0.8);
  let m = drainMidi(ctx);
  check("r1a: engaged (Wait Mode off) plays immediately",
    m.length === 1 && m[0].status === 0x90 && m[0].data1 === 60, dump(m));
  api.rewait(); // re-arm from here — Bars rule even though Wait Mode is Off
  m = drainMidi(ctx);
  check("r1b: re-wait re-arms the countdown -> voice goes silent",
    m.length === 1 && m[0].status === 0x80 && m[0].data1 === 60, dump(m));
  ctx.song.current_song_time = 16.01; // past 4 bars
  advance(250);
  api.watchdog();
  m = drainMidi(ctx);
  check("r1c: re-engages after the re-armed wait, re-strikes lead 60",
    m.length === 1 && m[0].status === 0x90 && m[0].data1 === 60, dump(m));
}
{
  // Re-Wait is a no-op when the transport is stopped.
  const { api, ctx } = makeInstance();
  api.init();
  api.lead(60, 0.8); // jam mode
  drainMidi(ctx);
  api.rewait();
  check("r2: re-wait no-op when stopped (voice keeps sounding)",
    drainMidi(ctx).length === 0, "stopped");
}

// ============================================================================
// g4. Gate x Hold — the gate keeps striking the FROZEN chord
// ============================================================================
section("g4. gate x hold");
{
  const { api, ctx } = playingBoth({ mode: 2, tempo: 120 });
  api.gate(2);   // 1/8
  api.gatelen(50);
  api.chord(0, "maj", 0.8, 0, 4, 7); // parked
  api.grid(2, 1, 0); // strike C maj
  drainMidi(ctx);
  api.hold(1); // freeze the C major pad
  api.chord(9, "min", 0.8, 9, 0, 4); // live change to Am -> cache only, frozen out
  advance(250); // let the pulse's offs fire
  drainMidi(ctx);
  api.grid(2, 1, 240); // next 1/8 boundary
  const m = drainMidi(ctx);
  check("g4: gate keeps striking the frozen C major (48,52,55), not Am",
    JSON.stringify(ons(m)) === "[48,52,55]", dump(m));
}

// ============================================================================
// mx. Interaction matrix — the master predicate + Kill-wins-over-Hold precedence
// ============================================================================
section("mx. interaction matrix");
{
  const matrix = [
    { name: "enabled1 kill0 hold0 -> sounds",        en: 1, kill: 0, hold: 0, expect: true },
    { name: "kill1 -> muted",                        en: 1, kill: 1, hold: 0, expect: false },
    { name: "enabled0 -> muted",                     en: 0, kill: 0, hold: 0, expect: false },
    { name: "hold1 (live event frozen) -> no sound", en: 1, kill: 0, hold: 1, expect: false },
    { name: "kill1+hold1 (Kill wins) -> muted",      en: 1, kill: 1, hold: 1, expect: false },
  ];
  for (const c of matrix) {
    const { api, ctx } = makeInstance();
    api.init();
    api.mode(1); // Lead
    if (c.en === 0) api.enabled(0);
    if (c.hold) api.hold(1);  // empty snapshot: a live event is frozen out
    if (c.kill) api.kill(1);
    drainMidi(ctx);
    api.lead(72, 0.8);
    const sounded = drainMidi(ctx).some((x) => (x.status & 0xf0) === 0x90);
    check("mx: " + c.name, sounded === c.expect, "sounded=" + sounded);
  }
}

// ============================================================================
// v. Voicing — Voices budget + Spread lift, revoiced live via the diff
// ============================================================================
section("v. voicing (voices + spread)");
{
  // Worked example: Cmaj7 base = C3 E3 G3 B3; spread stages lift odd then even>=2.
  const { api, ctx } = makeInstance();
  api.init();
  api.mode(2);
  api.mindur(0);
  api.chord(0, "maj7", 0.8, 0, 4, 7, 11); // C3 E3 G3 B3 = 48,52,55,59
  let m = drainMidi(ctx);
  check("v1a: voices 4 spread 0 -> C3 E3 G3 B3 (48,52,55,59)",
    JSON.stringify(ons(m)) === "[48,52,55,59]", dump(m));

  // Spread 2 revoices in place: 48,55 sustain; 52,59 lift to 64,71.
  api.spread(2);
  m = drainMidi(ctx);
  check("v1b: spread 2 -> Cmaj7 becomes C3 G3 E4 B4 (48,55,64,71)",
    JSON.stringify(ons(m)) === "[64,71]" && JSON.stringify(offs(m)) === "[52,59]",
    dump(m));
  api.spread(0);
  drainMidi(ctx);

  // Voices 3 = shell (drop the 5th, G): C3 E3 B3.
  api.voices(3);
  m = drainMidi(ctx);
  check("v1c: voices 3 drops the 5th (G) -> shell C3 E3 B3, 55 released",
    JSON.stringify(offs(m)) === "[55]" && !ctx.midi.slice(-4).some((x) => x.status === 0x90),
    dump(m));

  // Voices 2 = root + third: C3 E3 (drop B3 too).
  api.voices(2);
  m = drainMidi(ctx);
  check("v1d: voices 2 -> root + third only (drop B3=59)",
    JSON.stringify(offs(m)) === "[59]", dump(m));

  // Voices 1 = root only: C3 (drop E3).
  api.voices(1);
  m = drainMidi(ctx);
  check("v1e: voices 1 -> root only (drop E3=52)",
    JSON.stringify(offs(m)) === "[52]", dump(m));

  // Back to 4 restores the full chord, common root sustained (only 52,55,59 re-add).
  api.voices(4);
  m = drainMidi(ctx);
  check("v1f: voices 4 restores E3,G3,B3 (root C3=48 sustained, not re-struck)",
    JSON.stringify(ons(m)) === "[52,55,59]" && !m.some((x) => x.data1 === 48),
    dump(m));
}

// --- summary -------------------------------------------------------------------

Date.now = realDateNow;
console.log("\n" + "-".repeat(60));
if (failures.length) {
  console.log("FAILURES (" + failures.length + "/" + checks + " checks):");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
} else {
  console.log("ALL " + checks + " CHECKS PASSED");
  process.exit(0);
}
