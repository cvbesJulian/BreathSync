// ---------------------------------------------------------------------------
// bs.follow.js — BreathSync Follow: MIDI companion for the BreathSync Listen
// analyzer.
//
// Consumes the harmony bus (bs.harmony.bus<N>) defined by max4live/PROTOCOL.md
// (protocol/schema v1 — that document is authoritative) and turns it into:
//   * Lead / Chord / Both MIDI voice generation — raw 3-byte messages on
//     outlet 0 (status, data1, data2 as three ints per outlet call).
//   * Optional Live 12 song Scale/Root sync via LiveAPI (live_set root_note /
//     scale_name). Defaults OFF and heavily gated: every LiveAPI `set` lands
//     in Live's undo history.
//   * Displays on outlet 1: `status` / `inchord` / `inkey` / `lastset`
//     selectors, multi-word text NBSP-joined (same trick as the analyzer).
//
// Consumer rules (PROTOCOL.md): the voice engine is driven ONLY by the
// immediate `lead` / `chord` events; `state` feeds key-sync, displays, and
// staleness. No `state` for 3000 ms => analyzer gone: release all, show stale.
//
// MIDI conventions mirror the web app's midi-permission.js: note-on 0x90|ch,
// note-off 0x80|ch velocity 0, panic = CC123 value 0 on all 16 channels.
//
// Requires Live 12.2+ (bundles Max 9 => the v8 object, LiveAPI root_note /
// scale_name on live_set). Embedded into the .amxd at build time (v8 @embed).
// ---------------------------------------------------------------------------

autowatch = 0;
inlets = 1;
outlets = 2;

if (typeof setinletassist === "function") {
  setinletassist(0, "messages: init / state / lead / chord / hello / watchdog / enabled / params / panic");
}
if (typeof setoutletassist === "function") {
  setoutletassist(0, "raw MIDI bytes (status, data1, data2)");
  setoutletassist(1, "displays: status / inchord / inkey / lastset");
}

// --- constants --------------------------------------------------------------

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NBSP = "\u00a0"; // Max quotes space-containing symbols; NBSP-join instead

const PROTOCOL_VERSION = 1;
const STALE_MS = 3000;                  // 3 missed 1 s heartbeats
const KEY_SET_MIN_INTERVAL_MS = 10000;  // hard rate limit between LiveAPI sets
const CHORD_BASE = 48;                  // chord root voiced in octave 3 (C3)
const SCALE_NAME_MAP = { major: "Major", minor: "Minor" }; // Live 12 scale_name

// --- grid clock ---------------------------------------------------------------
// The transport's fixed 480 PPQ. A single [metro 40 ticks] feeds a `grid`
// message; 40 = GCD of straight (120-tick 1/16) and triplet (80-tick 1/16T)
// divisions, so one clock classifies every menu division. Boundary tolerance is
// half the base-grid step so a metro tick landing a few ticks late still counts.
const PPQ = 480;
const BASE_GRID_TICKS = 40;
const GRID_TOL = 5;
// Quantize menu index -> division ticks (0 Off; -1 = whole bar, resolved live).
const QUANT_DIV = [0, 120, 240, 160, 480, 960, -1];
// Gate menu index -> division ticks (0 Off). Chord voice only.
const GATE_DIV = [0, 480, 240, 160, 120, 80];

// --- parameters (raw widget values, wired in bs.follow.maxpat) ---------------

const cfg = {
  enabled: 1,   // live.thisdevice outlet 1 (device on/off)
  mode: 1,      // live.tab index: 0 Off / 1 Lead / 2 Chord / 3 Both
  vel: 96,      // live.dial int 1..127
  velconf: 0,   // live.toggle 0/1 (scale velocity by event confidence)
  channel: 0,   // live.menu index 0..15 = MIDI channel 1..16
  leadoct: 0,   // live.dial int -2..2
  chordoct: 0,  // live.dial int -2..2
  mindur: 100,  // live.dial int 0..500 ms (min sounded duration / flap guard)
  keysync: 0,   // live.toggle 0/1 (defaults OFF — undo cost)
  keyconf: 0.5, // live.dial float 0.20..0.90 (gate on state.keyConfidence)
  keyhold: 5,   // live.dial int 1..30 s (candidate stability before commit)
  waitmode: 1,  // live.menu index: 0 Off / 1 Bars / 2 Clip (engage delay source)
  waitbars: 4,  // live.dial int 1..32 bars (Bars mode wait; Clip-mode fallback)
  // --- performability params (all defaults are a musical no-op) ---
  quantize: 0,  // live.menu index: 0 Off / 1 1/16 / 2 1/8 / 3 1/8T / 4 1/4 / 5 1/2 / 6 1 Bar
  gate: 0,      // live.menu index: 0 Off / 1 1/4 / 2 1/8 / 3 1/8T / 4 1/16 / 5 1/16T
  gatelen: 50,  // live.dial int 5..100 % (gate note length as fraction of interval)
  chance: 100,  // live.dial int 0..100 % (probability a physical note-on sounds)
  spread: 0,    // live.dial int 0..3 (octave-spread voicing stages)
  voices: 4,    // live.dial int 1..4 (chord tone budget)
  strum: 0,     // live.dial int 0..60 ms (per-tone chord stagger, low->high)
  human: 0,     // live.dial int 0..100 % (timing + velocity humanize)
  hold: 0,      // live.text toggle 0/1 (freeze current harmony)
  kill: 0       // live.text toggle 0/1 (mute output, keep tracking)
};

// --- link / protocol state ----------------------------------------------------

let linked = false;
let collision = false;      // two distinct src ids on this bus within STALE_MS
let lastSrc = "";
let lastStateAt = 0;
let lastState = null;
let pendingRestrike = false; // set by transport stop; next state re-applies
const srcSeen = new Map();  // src -> last seen ms (collision detection window)

// --- voice engine state --------------------------------------------------------

const held = new Map();     // pitch -> refcount (lead + chord may share a pitch)

// Physical ledger — the notes ACTUALLY sounding downstream and the channel each
// was struck on. Touched ONLY by emitOn/emitOff/releaseAll. Offs derive from it,
// so channel changes and chance-skips stay correct by construction.
const sounding = new Map(); // pitch -> channel (0..15) currently sounding

let heldLead = null;        // { pitch, onAt } | null
let leadQueued;             // undefined = none; else { target: int|null, conf }
let heldChord = null;       // { sig, notes: int[], onAt } | null
let chordQueued;            // undefined = none; else { sig, notes, conf }

// Cached raw events for instant re-apply on mode/channel/octave/enable changes.
// These ALWAYS update from events, even while held/killed (before any gate).
let lastLeadEvent = null;   // { midi, conf } | null (null = cleared / none)
let lastChordEvent = null;  // { rootPc, quality, score, pcs } | null

// Frozen harmony while Hold is on. undefined = not holding; null = frozen silence
// (e.g. after Panic while holding). Source of harmony = hold ? snapshot : cache.
let heldSnapshotLead = undefined;   // { midi, conf } | null | undefined
let heldSnapshotChord = undefined;  // { rootPc, quality, score, pcs } | null | undefined

// --- key sync state -------------------------------------------------------------

let keyCand = null;         // { root, mode, since } | null
let lastKeySetAt = 0;

// --- Live API -------------------------------------------------------------------

let liveSet = null;
let playObserver = null;
let wasPlaying = 0;

// --- engage gating (start silent, join after N bars) ---------------------------

let engaged = true;        // notes may flow (true = jam mode while stopped)
let waitArmed = false;     // counting down (transport playing, waitmode != 0)
let waitStartBeat = 0;     // song position (beats) when the countdown armed
let waitTargetBeats = 0;   // beats to stay silent from waitStartBeat

// --- grid clock state ----------------------------------------------------------

let gridTempo = 120;       // cached from LiveAPI (init/watchdog)
let gridSigNum = 4;
let gridSigDen = 4;
let lastGridTicks = -1;    // absolute-tick idempotency guard (dup/loop-wrap safe)
let transportPlaying = false; // grid clock only runs while the transport plays

// Pending quantized CHANGES (latest-wins), flushed on the next matching
// boundary. undefined = nothing parked.
let leadPendingGrid;       // { target:int|null, conf } | undefined
let chordPendingGrid;      // { sig, notes, conf } | undefined

// --- helpers --------------------------------------------------------------------

function clamp(lo, hi, v) {
  return v < lo ? lo : v > hi ? hi : v;
}

function clamp01(v) {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function disp(selector, text) {
  outlet(1, selector, String(text).split(" ").join(NBSP));
}

function leadEngineOn() {
  return cfg.mode === 1 || cfg.mode === 3;
}

function chordEngineOn() {
  return cfg.mode === 2 || cfg.mode === 3;
}

// A grid scheduler "owns" a voice when a boundary-driven feature is live and the
// transport is running. While owned, changes are parked to the grid and Min-Dur
// is bypassed (the grid is the flap guard). Stopped transport = jam mode: never
// owned, so the engine falls back to today's immediate/Min-Dur path verbatim.
function gridOwnsLead() {
  return cfg.quantize !== 0 && transportPlaying && engaged;
}

function gridOwnsChord() {
  return (cfg.quantize !== 0 || cfg.gate !== 0) && transportPlaying && engaged;
}

function velocityFor(conf) {
  if (!cfg.velconf) return cfg.vel;
  return clamp(1, 127, Math.round(cfg.vel * (0.4 + 0.6 * clamp01(conf))));
}

// LiveAPI.get returns arrays; coerce defensively.
function firstNumber(v) {
  const raw = Array.isArray(v) ? v[0] : v;
  const n = Number(raw);
  return isFinite(n) ? n : NaN;
}

function firstSymbol(v) {
  const raw = Array.isArray(v) ? v[0] : v;
  return raw == null ? "" : String(raw);
}

// --- physical emit layer + timeline scheduler --------------------------------
// Two-layer note model. The LOGICAL layer (held refcount, heldLead, heldChord)
// decides what should sound; strum/human/gate/chance never corrupt it. The
// PHYSICAL layer is the `sounding` ledger + these emit functions — the only
// code that writes MIDI note bytes. emitOn/emitOff may fire immediately or be
// parked in the timeline queue (strum spacing, humanize delay, gate offs); with
// every performability param at its default the queue stays empty and emits are
// synchronous, so the byte stream is identical to the pre-refactor engine.

// RNG: swappable so the harness can seed deterministically via `srand`.
// Production never sends srand, so rng stays Math.random. Fixed consumption
// order per emitted note: chance roll, then time jitter, then velocity jitter.
let rng = Math.random;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Chance gate (0..100 %); rolled per PHYSICAL note-on only, never on an off.
let chancePct = 100;
function chanceRoll() {
  if (chancePct >= 100) return true;
  if (chancePct <= 0) return false;
  return rng() * 100 < chancePct;
}

// Pure physical note-on: ledger + byte, no chance/human logic (those are decided
// upstream in physOn). Called immediately or from the timeline drain.
function emitOn(pitch, vel, ch) {
  sounding.set(pitch, ch);
  outlet(0, 0x90 | ch, pitch, clamp(1, 127, vel));
}

// Off derives from the ledger: a note that was chance-skipped (or already
// released) has no entry, so its off is a harmless no-op on the right channel.
function emitOff(pitch) {
  if (!sounding.has(pitch)) return;
  const ch = sounding.get(pitch);
  sounding.delete(pitch);
  outlet(0, 0x80 | ch, pitch, 0);
}

// The scheduled time of the most recent physical-on attempt, so a legato off can
// ride its partner's humanized time (order preserved). Set by physOn even when
// the note is chance-skipped (falls back to the requested base time).
let lastPhysAt = 0;

// Physical note-on decision point. Fixed RNG consumption order per emitted note:
// chance roll, then time jitter, then velocity jitter. baseAt already includes
// any strum offset. Chance-skipped notes consume only the chance roll and never
// touch the ledger.
function physOn(pitch, baseVel, ch, baseAt) {
  if (!chanceRoll()) { lastPhysAt = baseAt; return; }
  let at = baseAt;
  let vel = baseVel;
  if (cfg.human > 0) {
    const h = cfg.human / 100;
    at = baseAt + rng() * 20 * h;                              // [0, 20ms*h]
    vel = clamp(1, 127, baseVel + Math.round((rng() * 2 - 1) * 12 * h)); // ±12*h
  }
  lastPhysAt = at;
  if (at <= Date.now()) emitOn(pitch, vel, ch);
  else tlPush(at, "on", pitch, vel, ch);
}

// Timeline queue — ONE Task draining a sorted list of physical actions. Used by
// strum/human/gate; O(1) global cancel via tlClear() inside releaseAll.
let tl = [];        // { at, seq, kind:'on'|'off', pitch, vel, ch }
let tlSeq = 0;

function tlSchedule() {
  if (tl.length === 0) { tlTask.cancel(); return; }
  let earliest = tl[0].at;
  for (const e of tl) if (e.at < earliest) earliest = e.at;
  tlTask.schedule(Math.max(0, earliest - Date.now()));
}

function tlDrain() {
  const t = Date.now();
  tl.sort((a, b) => (a.at - b.at) || (a.seq - b.seq));
  // Extract due events before executing so a logoff's tlPurgeOn can't disturb
  // the iteration.
  const due = [];
  while (tl.length && tl[0].at <= t) due.push(tl.shift());
  for (const e of due) {
    if (e.kind === "on") emitOn(e.pitch, e.vel, e.ch);
    else if (e.kind === "logoff") noteOff(e.pitch); // logical off (refcount) at fire time
    else emitOff(e.pitch);                           // physical-only off
  }
  tlSchedule();
}

function tlPush(at, kind, pitch, vel, ch) {
  tl.push({ at: at, seq: tlSeq++, kind: kind, pitch: pitch, vel: vel, ch: ch });
  tlSchedule();
}

function tlClear() {
  tl = [];
  tlTask.cancel();
}

// Cancel an unfired physical-on for a pitch (a new change / removed chord tone
// supersedes a strum on still parked in the queue — "new change cancels unfired
// strum ons"). Leaves already-sounding notes to emitOff.
function tlPurgeOn(pitch) {
  const before = tl.length;
  tl = tl.filter((e) => !(e.kind === "on" && e.pitch === pitch));
  if (tl.length !== before) tlSchedule();
}

const tlTask = new Task(tlDrain);

// --- refcounted logical note layer -------------------------------------------
// MIDI leaves the device only on 0<->1 refcount transitions, so a pitch shared
// by the lead and a chord tone sounds once and survives either owner releasing.
// The logical refcount advances immediately; the physical emit may be strummed
// / humanized / gated later. strumMs = extra on-delay for chord strum spacing.

function noteOn(pitch, vel, strumMs) {
  const count = held.get(pitch) || 0;
  held.set(pitch, count + 1);
  if (count === 0) physOn(pitch, vel, cfg.channel, Date.now() + (strumMs || 0));
}

// at = optional absolute time to schedule the physical off (gate offs; legato
// pair riding its on). An immediate off also purges any unfired on for the pitch.
function noteOff(pitch, at) {
  const count = held.get(pitch) || 0;
  if (count <= 1) {
    held.delete(pitch);
    if (count === 1) {
      if (at != null && at > Date.now()) {
        tlPush(at, "off", pitch, 0, 0);
      } else {
        tlPurgeOn(pitch);
        emitOff(pitch);
      }
    }
  } else {
    held.set(pitch, count - 1);
  }
}

// Note-off every SOUNDING pitch on the channel it was struck on, clear all voice
// state and pending Tasks (timeline + both Min-Dur). sendCC additionally fires
// CC123 (all notes off) value 0 on all 16 channels — mirrors allNotesOff().
function releaseAll(sendCC) {
  tlClear();
  leadTask.cancel();
  chordTask.cancel();
  leadQueued = undefined;
  chordQueued = undefined;
  leadPendingGrid = undefined;
  chordPendingGrid = undefined;
  for (const [pitch, ch] of sounding) outlet(0, 0x80 | ch, pitch, 0);
  sounding.clear();
  held.clear();
  heldLead = null;
  heldChord = null;
  if (sendCC) {
    for (let ch = 0; ch < 16; ch++) outlet(0, 0xb0 + ch, 123, 0);
  }
}

// --- lead lifecycle ------------------------------------------------------------
// Driven only by `lead` events. Same target sustains; changes inside Min Dur
// are queued (latest wins) behind ONE Task scheduled at onAt + mindur; changes
// past Min Dur apply immediately with legato ordering (new on, then old off).

function leadTargetFor(ev) {
  if (!ev) return null;
  return clamp(0, 127, Math.round(ev.midi) + 12 * cfg.leadoct);
}

function doLeadChange(target, conf) {
  const old = heldLead ? heldLead.pitch : null;
  if (target !== null) {
    noteOn(target, velocityFor(conf)); // legato: new note on first (sets lastPhysAt)
    // The off rides the new note's humanized time so the pair moves together and
    // the on always precedes the off (offs are themselves never jittered).
    if (old !== null) noteOff(old, lastPhysAt);
    heldLead = { pitch: target, onAt: Date.now() };
  } else {
    if (old !== null) noteOff(old);
    heldLead = null;
  }
}

function leadTransition(target, conf) {
  const now = Date.now();
  if (gridOwnsLead()) {
    // Grid scheduler owns the voice: Min-Dur bypassed. Releases are never
    // quantized — apply immediately; changes park latest-wins to the boundary.
    if (target === null) {
      leadPendingGrid = undefined;
      releaseLead();
      return;
    }
    if (heldLead && heldLead.pitch === target) {
      leadPendingGrid = undefined; // sustain / flap resolved to current
      return;
    }
    leadPendingGrid = { target: target, conf: conf };
    return;
  }
  if (!heldLead) {
    leadQueued = undefined;
    leadTask.cancel();
    if (target !== null) {
      noteOn(target, velocityFor(conf)); // null -> pitch: immediate on
      heldLead = { pitch: target, onAt: now };
    }
    return;
  }
  if (heldLead.pitch === target) {
    leadQueued = undefined; // sustain; drop any pending flap
    return;
  }
  const elapsed = now - heldLead.onAt;
  if (elapsed < cfg.mindur) {
    const alreadyPending = leadQueued !== undefined;
    leadQueued = { target: target, conf: conf }; // latest target wins
    if (!alreadyPending) {
      leadTask.cancel();
      leadTask.schedule(Math.max(0, cfg.mindur - elapsed));
    }
  } else {
    doLeadChange(target, conf);
  }
}

function leadFlush() {
  if (leadQueued === undefined) return;
  const q = leadQueued;
  leadQueued = undefined;
  if (!heldLead) {
    if (q.target !== null) leadTransition(q.target, q.conf);
    return;
  }
  if (heldLead.pitch === q.target) return; // flap resolved back to current
  doLeadChange(q.target, q.conf);
}

function releaseLead() {
  leadTask.cancel();
  leadQueued = undefined;
  if (heldLead) {
    noteOff(heldLead.pitch);
    heldLead = null;
  }
}

// Source of harmony: the frozen snapshot while Hold is on, else the live cache.
function sourceLead() {
  return cfg.hold ? heldSnapshotLead : lastLeadEvent;
}
function sourceChord() {
  return cfg.hold ? heldSnapshotChord : lastChordEvent;
}

function reapplyLead() {
  const ev = sourceLead();
  if (!ev) return;
  leadTransition(leadTargetFor(ev), ev.conf);
}

// --- chord lifecycle -------------------------------------------------------------
// Driven only by `chord` events. sig identity = root|quality (null on reset),
// plus the voicing octave so a Chord Oct change revoices instead of being
// swallowed by the sustain branch. Same Min-Dur coalescing as the lead;
// applying a change diffs voicings so common tones sustain untouched
// (refcounting keeps this safe against the lead).

// Voicing octave, tone budget and spread are all part of the chord identity so a
// change to any of them revoices live (the sustain branch won't swallow it); the
// diff then keeps common tones ringing.
function chordSigFor(ev) {
  return ev.rootPc + "|" + ev.quality + "|" + cfg.chordoct + "|" +
    cfg.voices + "|" + cfg.spread;
}

// Voices budget: 4 = all, 3 = drop the 5th (shell), 2 = root + quality tone,
// 1 = root. Classification is by interval above the root.
function limitVoices(tones) {
  const v = cfg.voices;
  if (v >= 4 || tones.length <= v) return tones.slice();
  const root = tones.find((t) => t.interval === 0) || tones[0];
  const fifth = tones.find((t) => t.interval === 6 || t.interval === 7 || t.interval === 8);
  const third = tones.find((t) => t.interval === 3 || t.interval === 4);
  if (v === 1) return [root];
  if (v === 2) {
    const quality = third
      || tones.find((t) => t !== root && t !== fifth)
      || tones.find((t) => t !== root);
    return quality ? [root, quality] : [root];
  }
  // v === 3: shell — drop the fifth if there is one, else trim to three tones.
  if (fifth) return tones.filter((t) => t !== fifth);
  return tones.slice().sort((a, b) => a.pitch - b.pitch).slice(0, 3);
}

// Spread: stage +12 octave lifts over the ascending tones — odd indices first,
// then even indices >= 2 (root at index 0 never lifts). Cmaj7 s2 -> C3 G3 E4 B4.
function applySpread(tones, spread) {
  if (spread <= 0) return;
  const order = [];
  for (let i = 1; i < tones.length; i += 2) order.push(i); // odd indices
  for (let i = 2; i < tones.length; i += 2) order.push(i); // even indices >= 2
  const n = Math.min(spread, order.length);
  for (let k = 0; k < n; k++) tones[order[k]].pitch += 12;
}

// Pure voicing pipeline: base tones -> Voices limit -> Spread lift -> clamp/dedupe.
function voiceChord(rootPc, pcs) {
  const rootBase = CHORD_BASE + rootPc + 12 * cfg.chordoct;
  const tones = [];
  for (const pcRaw of pcs) {
    const pc = ((Math.round(pcRaw) % 12) + 12) % 12;
    const interval = (pc - rootPc + 12) % 12;
    if (!tones.some((t) => t.interval === interval)) {
      tones.push({ pitch: rootBase + interval, interval: interval });
    }
  }
  const kept = limitVoices(tones);
  kept.sort((a, b) => a.pitch - b.pitch); // ascending for indexed spread
  applySpread(kept, cfg.spread);
  const notes = [];
  for (const t of kept) {
    const p = clamp(0, 127, t.pitch);
    if (notes.indexOf(p) < 0) notes.push(p);
  }
  return notes;
}

// Strum step (ms) between consecutive struck chord tones. Under gate the spacing
// is clamped so the whole strum fits inside the gate window (gateOffMs set by the
// gate strike; -1 = no gate limit).
let gateOffMs = -1;
let gateConf = 1; // confidence/velocity source for the current gate pulse
function chordStrumStep(count) {
  if (cfg.strum <= 0 || count <= 1) return 0;
  if (gateOffMs > 0) return Math.min(cfg.strum, Math.max(0, (gateOffMs - 5) / (count - 1)));
  return cfg.strum;
}

// Strike a set of chord tones low->high with strum spacing + per-tone humanize.
function strikeChordTones(tones, conf) {
  const added = tones.slice().sort((a, b) => a - b);
  const step = chordStrumStep(added.length);
  const v = velocityFor(conf);
  for (let i = 0; i < added.length; i++) noteOn(added[i], v, i * step);
}

function doChordChange(sig, notes, conf) {
  const oldNotes = heldChord ? heldChord.notes : [];
  for (const n of oldNotes) {
    if (notes.indexOf(n) < 0) noteOff(n); // removed tones off at t=0 (purges unfired on)
  }
  const added = [];
  for (const n of notes) if (oldNotes.indexOf(n) < 0) added.push(n);
  strikeChordTones(added, conf); // diff-added only, strummed low->high
  heldChord = sig !== null ? { sig: sig, notes: notes, onAt: Date.now() } : null;
}

function chordTransition(sig, notes, conf) {
  const now = Date.now();
  if (gridOwnsChord()) {
    // Grid scheduler owns the voice: Min-Dur bypassed. Chord reset is never
    // quantized — release immediately; changes park latest-wins to the boundary.
    if (sig === null) {
      chordPendingGrid = undefined;
      releaseChord();
      return;
    }
    if (heldChord && heldChord.sig === sig) {
      chordPendingGrid = undefined; // sustain
      return;
    }
    chordPendingGrid = { sig: sig, notes: notes, conf: conf };
    return;
  }
  if (!heldChord) {
    chordQueued = undefined;
    chordTask.cancel();
    if (sig !== null) {
      strikeChordTones(notes, conf); // full-chord onset, strummed low->high
      heldChord = { sig: sig, notes: notes, onAt: now };
    }
    return;
  }
  if (heldChord.sig === sig) {
    chordQueued = undefined; // sustain
    return;
  }
  const elapsed = now - heldChord.onAt;
  if (elapsed < cfg.mindur) {
    const alreadyPending = chordQueued !== undefined;
    chordQueued = { sig: sig, notes: notes, conf: conf }; // latest wins
    if (!alreadyPending) {
      chordTask.cancel();
      chordTask.schedule(Math.max(0, cfg.mindur - elapsed));
    }
  } else {
    doChordChange(sig, notes, conf);
  }
}

function chordFlush() {
  if (chordQueued === undefined) return;
  const q = chordQueued;
  chordQueued = undefined;
  if (!heldChord) {
    if (q.sig !== null) chordTransition(q.sig, q.notes, q.conf);
    return;
  }
  if (heldChord.sig === q.sig) return;
  doChordChange(q.sig, q.notes, q.conf);
}

function releaseChord() {
  chordTask.cancel();
  chordQueued = undefined;
  if (heldChord) {
    for (const n of heldChord.notes) noteOff(n);
    heldChord = null;
  }
}

function reapplyChord() {
  const ev = sourceChord();
  if (!ev) return;
  chordTransition(chordSigFor(ev), voiceChord(ev.rootPc, ev.pcs), ev.score);
}

function reapplyActive() {
  if (!cfg.enabled || cfg.kill || !engaged) return; // master predicate
  if (leadEngineOn()) reapplyLead();
  if (chordEngineOn()) reapplyChord();
}

// Re-strike from the current source (snapshot while held, else the live cache),
// releasing a voice whose source has gone empty. Used on Kill-off / Hold-off.
function reapplyFromSource() {
  if (!cfg.enabled || cfg.kill || !engaged) return;
  if (leadEngineOn()) { if (sourceLead()) reapplyLead(); else releaseLead(); }
  else releaseLead();
  if (chordEngineOn()) { if (sourceChord()) reapplyChord(); else releaseChord(); }
  else releaseChord();
}

// --- Hold / Kill / Re-Wait (performance switches) ------------------------------
// Master predicate: a voice may emit iff enabled && !kill && engaged &&
// engineOn(voice). Source of harmony = hold ? frozen snapshot : live cache.
// Precedence (strongest first): Panic/delete > enabled 0 > Kill > stale > wait.

// Hold on = freeze what you hear: snapshot the live caches, discard every pending
// change (Min-Dur queue + grid buffers). Off = apply the live caches through the
// normal pipeline (lands on the grid if Quantize on; empty caches -> release).
function setHold(on) {
  if (on === cfg.hold) return;
  cfg.hold = on;
  if (on) {
    heldSnapshotLead = lastLeadEvent
      ? { midi: lastLeadEvent.midi, conf: lastLeadEvent.conf } : null;
    heldSnapshotChord = lastChordEvent ? {
      rootPc: lastChordEvent.rootPc, quality: lastChordEvent.quality,
      score: lastChordEvent.score, pcs: lastChordEvent.pcs.slice(),
    } : null;
    leadQueued = undefined;      // discard Min-Dur pending: freeze what you hear
    chordQueued = undefined;
    leadTask.cancel();
    chordTask.cancel();
    leadPendingGrid = undefined; // cancel pending grid buffers
    chordPendingGrid = undefined;
  } else {
    heldSnapshotLead = undefined;
    heldSnapshotChord = undefined;
    if (cfg.enabled && !cfg.kill) reapplyFromSource();
  }
}

// Kill wins over Hold. On = immediate mute + cancel every scheduled action; the
// caches keep tracking. Off = re-strike from source through the pipeline.
function setKill(on) {
  if (on === cfg.kill) return;
  cfg.kill = on;
  if (on) {
    releaseAll(false); // tlClear + Min-Dur cancel + off every ledger entry
  } else if (cfg.enabled) {
    reapplyFromSource(); // respects Hold (re-strikes the frozen snapshot)
  }
}

// Re-Wait: re-arm the engage countdown from the current position regardless of
// Wait Mode (Off falls back to the Bars rule). No-op when stopped.
function doReWait() {
  if (!transportPlaying || !liveSet) return;
  armWaitWith(cfg.waitmode === 0 ? 1 : cfg.waitmode);
}

// Min-Dur Tasks (one each; flaps coalesce into the queued slot).
const leadTask = new Task(leadFlush);
const chordTask = new Task(chordFlush);

// --- link status / collision ---------------------------------------------------

function statusKey() {
  return (collision ? "C" : "-") + (linked ? "L" : "-") + "|" + lastSrc;
}

// Track src ids seen on this bus inside the staleness window. Returns true
// when the visible status changed.
function noteSrc(src, now) {
  const before = statusKey();
  srcSeen.set(src, now);
  for (const [id, seenAt] of srcSeen) {
    if (now - seenAt > STALE_MS) srcSeen.delete(id);
  }
  collision = srcSeen.size > 1;
  lastSrc = src;
  return statusKey() !== before;
}

function refreshStatus() {
  if (collision) {
    disp("status", "bus collision!");
    return;
  }
  if (!linked) {
    disp("status", "waiting for analyzer");
    return;
  }
  disp("status", lastSrc ? "linked " + lastSrc : "linked");
}

// --- displays --------------------------------------------------------------------

function updateDisplays(s) {
  if (s.chordRoot != null && s.chordQuality != null) {
    disp("inchord", s.chordRoot + " " + s.chordQuality + " " +
      Math.round(clamp01(s.confidence) * 100) + "%");
  } else {
    disp("inchord", "-");
  }
  if (s.key != null && s.mode != null) {
    disp("inkey", s.key + " " + s.mode + " " +
      Math.round(clamp01(s.keyConfidence) * 100) + "%");
  } else {
    disp("inkey", "-");
  }
}

// --- key sync (driven from state only) --------------------------------------------

function keyStep(s, now) {
  if (!cfg.keysync || s.key == null || s.mode == null ||
      clamp01(s.keyConfidence) < cfg.keyconf) {
    keyCand = null;
    return;
  }
  if (!keyCand || keyCand.root !== s.key || keyCand.mode !== s.mode) {
    keyCand = { root: s.key, mode: s.mode, since: now }; // restart hold timer
    return;
  }
  if (now - keyCand.since >= cfg.keyhold * 1000 &&
      now - lastKeySetAt >= KEY_SET_MIN_INTERVAL_MS) {
    commitKey(keyCand.root, keyCand.mode);
  }
}

function commitKey(rootName, modeName) {
  const rootIndex = NOTE_NAMES.indexOf(rootName);
  const scaleName = SCALE_NAME_MAP[modeName];
  if (rootIndex < 0 || !scaleName) return;
  try {
    if (!liveSet) liveSet = new LiveAPI("live_set");
    // Gets are undo-free: read first and skip matching values (undo guard).
    const curRoot = firstNumber(liveSet.get("root_note"));
    const curScale = firstSymbol(liveSet.get("scale_name"));
    if (curRoot === rootIndex && curScale === scaleName) {
      lastKeySetAt = Date.now(); // keep read-backs at the >=10 s cadence
      return;
    }
    liveSet.set("root_note", rootIndex);
    liveSet.set("scale_name", scaleName);
    const seenRoot = firstNumber(liveSet.get("root_note"));
    const seenScale = firstSymbol(liveSet.get("scale_name"));
    lastKeySetAt = Date.now();
    if (seenScale !== scaleName) {
      disp("lastset", "scale name rejected: " + seenScale);
    } else if (seenRoot !== rootIndex) {
      disp("lastset", "root note rejected: " + seenRoot);
    } else {
      disp("lastset", rootName + " " + scaleName + " set");
    }
  } catch (err) {
    disp("lastset", "key sync unavailable");
  }
}

// --- engage gating -------------------------------------------------------------
// "Listen first, then join": while the transport plays, the voice engine stays
// silent until the countdown elapses. Bar math is done in beats, so tempo
// changes mid-wait are harmless. With the transport stopped the gate is open
// (jam mode) — there are no bars to count without a transport.

function songBeats() {
  return firstNumber(liveSet.get("current_song_time"));
}

function beatsPerBar() {
  const num = firstNumber(liveSet.get("signature_numerator"));
  const den = firstNumber(liveSet.get("signature_denominator"));
  return num > 0 && den > 0 ? num * (4 / den) : 4;
}

// Longest currently-playing session clip, in beats (0 = none). Clip wait mode
// sits out one full pass of the loop Follow is listening to.
function longestPlayingClipBeats() {
  try {
    const n = firstNumber(liveSet.getcount("tracks"));
    let best = 0;
    for (let t = 0; t < n; t++) {
      const track = new LiveAPI("live_set tracks " + t);
      const slot = firstNumber(track.get("playing_slot_index"));
      if (!(slot >= 0)) continue;
      const clip = new LiveAPI(
        "live_set tracks " + t + " clip_slots " + slot + " clip");
      if (!firstNumber(clip.id)) continue; // id 0 = empty slot
      const len = firstNumber(clip.get("length"));
      if (len > best) best = len;
    }
    return best;
  } catch (err) {
    return 0;
  }
}

function setEngaged(on) {
  if (on === engaged) return;
  engaged = on;
  if (!on) {
    // Hold survives the wait gate: the frozen pad keeps ringing while counting.
    if (!cfg.hold) releaseAll(false); // go silent NOW; caches keep the harmony
    return;
  }
  if (cfg.enabled) reapplyActive(); // join in on whatever is sounding
  refreshStatus();
}

// Transport started (or wait settings changed mid-wait): go silent and start
// the countdown. Fail-open: without a Live API there are no bars to count.
function armWait() {
  armWaitWith(cfg.waitmode);
}

// mode: 0 Off (engage now) / 1 Bars / 2 Clip. Re-Wait passes an effective mode
// so it can force a wait even when Wait Mode is Off.
function armWaitWith(mode) {
  if (mode === 0 || !liveSet) {
    waitArmed = false;
    setEngaged(true);
    return;
  }
  try {
    let beats = cfg.waitbars * beatsPerBar();
    if (mode === 2) {
      const clipBeats = longestPlayingClipBeats();
      if (clipBeats > 0) beats = clipBeats; // else fall back to Wait Bars
    }
    waitStartBeat = songBeats();
    waitTargetBeats = beats;
    waitArmed = true;
    setEngaged(false);
    waitStep(); // show the countdown right away
  } catch (err) {
    waitArmed = false;
    setEngaged(true);
  }
}

// Driven by the 250 ms watchdog metro while counting down.
function waitStep() {
  if (!waitArmed || engaged) return;
  try {
    let elapsed = songBeats() - waitStartBeat;
    if (elapsed < 0) { // user jumped backwards: re-anchor, keep waiting
      waitStartBeat = songBeats();
      elapsed = 0;
    }
    if (elapsed >= waitTargetBeats) {
      waitArmed = false;
      setEngaged(true);
      return;
    }
    const remain = (waitTargetBeats - elapsed) / beatsPerBar();
    disp("status", "wait " + remain.toFixed(1) + " bars");
  } catch (err) {
    waitArmed = false;
    setEngaged(true);
  }
}

// --- grid clock ----------------------------------------------------------------
// Sig/tempo cached from LiveAPI (init + watchdog). Boundary math is pure integer
// tick arithmetic so straight and triplet divisions classify from one clock.

function refreshTransportCache() {
  if (!liveSet) return;
  try {
    const t = firstNumber(liveSet.get("tempo"));
    if (isFinite(t) && t > 0) gridTempo = t;
    const num = firstNumber(liveSet.get("signature_numerator"));
    const den = firstNumber(liveSet.get("signature_denominator"));
    if (num > 0) gridSigNum = num;
    if (den > 0) gridSigDen = den;
  } catch (err) { /* LiveAPI context — never throw */ }
}

// Whole-bar length in ticks from the cached signature (4/4 -> 1920, 3/4 -> 1440).
function barTicks() {
  const beats = gridSigNum > 0 && gridSigDen > 0
    ? gridSigNum * (4 / gridSigDen) : 4;
  return Math.round(beats * PPQ);
}

// A boundary hits when the in-bar tick position sits within tolerance of a
// multiple of the division. divTicks < 0 means "whole bar", resolved live.
function isBoundary(ticksInBar, divTicks) {
  const d = divTicks < 0 ? barTicks() : divTicks;
  if (d <= 0) return false;
  return (ticksInBar % d) < GRID_TOL;
}

// grid <bar> <beat> <unit> — one message per [metro 40 ticks] bang while the
// transport plays. bar/beat are 1-based; unit is 0..479 ticks within the beat.
// The absolute-tick guard makes duplicate / loop-wrap bangs idempotent.
function grid(bar, beat, unit) {
  if (typeof bar !== "number" || typeof beat !== "number" ||
      typeof unit !== "number") return;
  const b = Math.round(bar);
  const be = Math.round(beat);
  const u = Math.round(unit);
  const ticksInBar = (be - 1) * PPQ + u;
  const absTicks = (b - 1) * barTicks() + ticksInBar;
  if (absTicks === lastGridTicks) return; // duplicate / loop-wrap bang
  lastGridTicks = absTicks;
  onGridBoundary(ticksInBar);
}

// ms per tick at the cached tempo (480 PPQ).
function ticksToMs(ticks) {
  return ticks * (60000 / gridTempo) / PPQ;
}

// Grid bang pipeline. Lead quantize flush FIRST (lead is never gated). Then the
// chord voice: gate owns it if on (change lands into the pulse record, strikes
// once on the shared boundary); otherwise quantize flush applies the change.
function onGridBoundary(ticksInBar) {
  if (leadPendingGrid !== undefined && cfg.quantize !== 0 &&
      leadEngineOn() && isBoundary(ticksInBar, QUANT_DIV[cfg.quantize])) {
    const q = leadPendingGrid;
    leadPendingGrid = undefined;
    doLeadChange(q.target, q.conf);
  }
  if (cfg.gate !== 0) {
    gateBoundary(ticksInBar);
  } else if (chordPendingGrid !== undefined && cfg.quantize !== 0 &&
      chordEngineOn() && isBoundary(ticksInBar, QUANT_DIV[cfg.quantize])) {
    const q = chordPendingGrid;
    chordPendingGrid = undefined;
    doChordChange(q.sig, q.notes, q.conf);
  }
}

// Gate boundary: adopt any parked chord change into the pulse record (the change
// lands here, so a quantize+gate shared boundary strikes the new chord once),
// then strike the full current chord. Chance/strum/human apply per strike.
function gateBoundary(ticksInBar) {
  if (!transportPlaying || !engaged) return;
  if (!isBoundary(ticksInBar, GATE_DIV[cfg.gate])) return;
  if (chordPendingGrid !== undefined) {
    const q = chordPendingGrid;
    chordPendingGrid = undefined;
    if (q.sig === null) {
      heldChord = null;
    } else {
      heldChord = { sig: q.sig, notes: q.notes, onAt: Date.now() };
      gateConf = q.conf;
    }
  }
  if (!cfg.enabled || cfg.kill || !chordEngineOn() || !heldChord) return;
  gateStrike(heldChord.notes, gateConf);
}

// Strike the full chord and schedule each tone's off mid-interval (staccato).
// noteOn takes the refcount up now; a scheduled logical off drops it later, so a
// lead-shared tone keeps ringing across gate pulses (sustained lead over pumping
// chords). gateOffMs bounds the strum spread so the whole strum fits the window.
function gateStrike(notes, conf) {
  const at = Date.now();
  const interval = ticksToMs(GATE_DIV[cfg.gate]);
  const offMs = clamp(10, Math.max(10, interval - 10), (cfg.gatelen / 100) * interval);
  const sorted = notes.slice().sort((a, b) => a - b);
  gateOffMs = offMs;
  const step = chordStrumStep(sorted.length);
  const v = velocityFor(conf);
  for (let i = 0; i < sorted.length; i++) {
    noteOn(sorted[i], v, i * step);         // chance/human/strum per strike
    tlPush(at + offMs, "logoff", sorted[i], 0, 0); // release mid-interval
  }
  gateOffMs = -1;
}

// srand <int> — swap in a seeded mulberry32 so the harness is deterministic.
// Never sent in production (rng stays Math.random).
function srand(seed) {
  if (typeof seed !== "number") return;
  rng = mulberry32(Math.round(seed) >>> 0);
}

// --- transport observer -------------------------------------------------------------

function onLiveSetProperty(args) {
  try {
    let name, value;
    if (Array.isArray(args)) {
      name = args[0];
      value = args[1];
    } else {
      name = arguments[0];
      value = arguments[1];
    }
    if (String(name) !== "is_playing") return;
    const playing = Number(value) ? 1 : 0;
    if (wasPlaying === 1 && playing === 0) {
      // Transport stopped: flush; if audio continues, the next state (<=1 s
      // heartbeat) re-applies the cached events; if audio stopped too, the
      // analyzer's lead -1 / chord reset events clear the caches first.
      // The wait gate reopens quietly (jam mode) — no reapply here, the
      // pendingRestrike path owns the re-strike.
      transportPlaying = false;
      lastGridTicks = -1;
      leadPendingGrid = undefined; // grid buffers can't outlive the grid clock
      chordPendingGrid = undefined;
      waitArmed = false;
      engaged = true;
      if (cfg.hold) {
        // Hold survives transport stop: re-establish the frozen pad as a clean
        // sustain (gate is bypassed while stopped), keep it ringing.
        tlClear();
        releaseLead();
        releaseChord();
        if (cfg.enabled && !cfg.kill) reapplyFromSource();
      } else {
        releaseAll(false);
        pendingRestrike = true;
      }
      refreshStatus(); // clear a mid-countdown "wait n bars" readout
    }
    if (wasPlaying === 0 && playing === 1) {
      transportPlaying = true;
      lastGridTicks = -1;
      refreshTransportCache();
      armWait(); // start silent; join after the countdown
    }
    wasPlaying = playing;
  } catch (err) { /* LiveAPI callback context — never throw */ }
}

// --- message handlers ------------------------------------------------------------------

// Bang from live.thisdevice (via the patch's `init` message): LiveAPI is only
// legal after device init, never at loadbang time.
function init() {
  try {
    liveSet = new LiveAPI("live_set");
    playObserver = new LiveAPI(onLiveSetProperty, "live_set");
    playObserver.property = "is_playing";
    wasPlaying = firstNumber(playObserver.get("is_playing")) ? 1 : 0;
    transportPlaying = wasPlaying === 1;
    refreshTransportCache();
  } catch (err) {
    liveSet = null;
    playObserver = null;
    if (cfg.keysync) disp("lastset", "key sync unavailable");
  }
  refreshStatus(); // "waiting for analyzer" until the first hello/state
  disp("inchord", "-");
  disp("inkey", "-");
  disp("lastset", NBSP);
  if (wasPlaying) armWait(); // already mid-song: count from here
}

// state <jsonSym> — authoritative harmonyState. Feeds ONLY key-sync, displays,
// staleness/collision (voice engine is event-driven per PROTOCOL.md).
function state(jsonSym) {
  let s;
  try {
    s = JSON.parse(String(jsonSym));
  } catch (err) {
    return; // malformed; ignore
  }
  if (!s || typeof s !== "object") return;
  if (s.v !== PROTOCOL_VERSION) {
    disp("status", "protocol v" + s.v + " unsupported");
    return;
  }
  const now = Date.now();
  lastStateAt = now;
  lastState = s;
  const wasLinked = linked;
  linked = true;
  let dirty = !wasLinked;
  if (s.src != null) dirty = noteSrc(String(s.src), now) || dirty;
  if (dirty) refreshStatus();
  if (pendingRestrike) {
    pendingRestrike = false;
    if (cfg.enabled) reapplyActive(); // post-transport-stop re-strike
  }
  keyStep(s, now);
  updateDisplays(s);
}

// lead <midi|-1> <confidence> — immediate event; the ONLY driver of the lead
// voice. Cached even while gated so mode changes re-apply instantly.
function lead(midi, conf) {
  if (typeof midi !== "number") return;
  const c = typeof conf === "number" ? clamp01(conf) : 1;
  lastLeadEvent = midi >= 0 ? { midi: midi, conf: c } : null; // cache always updates
  if (cfg.hold) return; // frozen: the snapshot drives the voice, not live events
  if (!cfg.enabled || cfg.kill || !engaged || !leadEngineOn()) return;
  leadTransition(leadTargetFor(lastLeadEvent), c);
}

// chord <rootPc|-1> <quality|none> <score> <pc...> — immediate event on
// post-hysteresis commit/reset; the ONLY driver of the chord voice.
function chord(rootPc, quality, score, ...pcs) {
  if (typeof rootPc !== "number") return;
  if (rootPc >= 0) {
    lastChordEvent = {
      rootPc: ((Math.round(rootPc) % 12) + 12) % 12,
      quality: String(quality),
      score: clamp01(score),
      pcs: pcs.map(Number).filter(isFinite)
    };
  } else {
    lastChordEvent = null;
  }
  if (cfg.hold) return; // frozen: the snapshot drives the voice, not live events
  if (!cfg.enabled || cfg.kill || !engaged || !chordEngineOn()) return;
  if (lastChordEvent) {
    const ev = lastChordEvent;
    chordTransition(chordSigFor(ev), voiceChord(ev.rootPc, ev.pcs), ev.score);
  } else {
    chordTransition(null, [], 0);
  }
}

// hello <v> <src> — lifecycle; resets link status (always followed by a full
// state burst per PROTOCOL.md, so it also counts as liveness).
function hello(v, src) {
  if (Number(v) !== PROTOCOL_VERSION) {
    disp("status", "protocol v" + v + " unsupported");
    return;
  }
  const now = Date.now();
  lastStateAt = now;
  linked = true;
  if (src != null) noteSrc(String(src), now);
  refreshStatus();
}

// watchdog — banged by [metro 250]. Advances the engage countdown, then the
// staleness check: 3000 ms without state/hello => analyzer gone: release
// everything it drove, clear caches, show stale.
function watchdog() {
  refreshTransportCache(); // keep sig/tempo fresh for the grid clock
  waitStep();
  if (!linked) return;
  if (Date.now() - lastStateAt <= STALE_MS) return;
  linked = false;
  lastLeadEvent = null;
  lastChordEvent = null;
  keyCand = null;
  pendingRestrike = false;
  // Hold survives staleness: the frozen pad keeps ringing (it plays the snapshot,
  // not the now-empty cache). Everything else releases.
  if (cfg.hold) {
    disp("status", "stale hold");
  } else {
    releaseAll(false);
    disp("status", "stale");
  }
  disp("inchord", "-");
  disp("inkey", "-");
}

// enabled <0|1> — live.thisdevice outlet 1 (device on/off; outlet 2 is
// PREVIEW mode — do not wire it here). Disabled: flush and gate the engines;
// re-enabled: re-apply cached events for instant response.
function enabled(b) {
  const on = b ? 1 : 0;
  if (on === cfg.enabled) return;
  cfg.enabled = on;
  if (!on) {
    releaseAll(false);
    return;
  }
  reapplyActive();
}

// --- parameter setters (raw widget values) ---------------------------------------------

// mode <0..3> from live.tab. Type-guarded: the analyzer's `mode <sym>` state
// field message shares this selector when the receive is wired straight in.
function mode(i) {
  if (typeof i !== "number") return;
  const m = clamp(0, 3, Math.round(i));
  if (m === cfg.mode) return;
  cfg.mode = m;
  if (!leadEngineOn()) releaseLead();
  if (!chordEngineOn()) releaseChord();
  if (cfg.enabled) reapplyActive(); // fresh cached events => instant response
}

function vel(v) {
  if (typeof v !== "number") return;
  cfg.vel = clamp(1, 127, Math.round(v));
}

function velconf(v) {
  cfg.velconf = v ? 1 : 0;
}

// channel <0..15> (live.menu index). Release on the OLD channel first so no
// note-off ever lands on a channel that never saw its note-on.
function channel(i) {
  if (typeof i !== "number") return;
  const ch = clamp(0, 15, Math.round(i));
  if (ch === cfg.channel) return;
  releaseAll(false); // offs go out on the old channel
  cfg.channel = ch;
  if (cfg.enabled) reapplyActive();
}

function leadoct(v) {
  if (typeof v !== "number") return;
  const oct = clamp(-2, 2, Math.round(v));
  if (oct === cfg.leadoct) return;
  cfg.leadoct = oct;
  if (cfg.enabled && !cfg.kill && leadEngineOn()) reapplyLead(); // retranspose live
}

function chordoct(v) {
  if (typeof v !== "number") return;
  const oct = clamp(-2, 2, Math.round(v));
  if (oct === cfg.chordoct) return;
  cfg.chordoct = oct;
  if (cfg.enabled && !cfg.kill && chordEngineOn()) reapplyChord(); // revoice live
}

function mindur(v) {
  if (typeof v !== "number") return;
  cfg.mindur = clamp(0, 500, Math.round(v));
}

function keysync(v) {
  cfg.keysync = v ? 1 : 0;
  if (!cfg.keysync) keyCand = null;
}

function keyconf(v) {
  if (typeof v !== "number") return;
  cfg.keyconf = clamp01(v);
}

function keyhold(v) {
  if (typeof v !== "number") return;
  cfg.keyhold = clamp(1, 30, Math.round(v));
}

// waitmode <0..2> from live.menu: 0 Off / 1 Bars / 2 Clip.
function waitmode(v) {
  if (typeof v !== "number") return;
  const m = clamp(0, 2, Math.round(v));
  if (m === cfg.waitmode) return;
  cfg.waitmode = m;
  if (m === 0) {
    waitArmed = false;
    setEngaged(true);
  } else if (wasPlaying) {
    armWait(); // the new rule counts from the current song position
  }
}

// waitbars <1..32> from live.dial. Mid-countdown changes re-derive the target
// but keep counting from the original start.
function waitbars(v) {
  if (typeof v !== "number") return;
  const bars = clamp(1, 32, Math.round(v));
  if (bars === cfg.waitbars) return;
  cfg.waitbars = bars;
  if (waitArmed && !engaged && wasPlaying) {
    const anchor = waitStartBeat;
    armWait();
    waitStartBeat = anchor;
    waitStep();
  }
}

// --- performability parameter setters -----------------------------------------
// All numerically type-guarded like mode(i). Defaults are a no-op; behaviour is
// layered in across the implementation milestones.

// quantize <0..6> from live.menu: Off, 1/16, 1/8, 1/8T, 1/4, 1/2, 1 Bar.
function quantize(v) {
  if (typeof v !== "number") return;
  const q = clamp(0, 6, Math.round(v));
  if (q === cfg.quantize) return;
  cfg.quantize = q;
  // Turning quantize off (and no gate holding the chord) strands any parked
  // change — apply it now so the voice never sticks on a stale note.
  if (!gridOwnsLead() && leadPendingGrid !== undefined) {
    const p = leadPendingGrid;
    leadPendingGrid = undefined;
    doLeadChange(p.target, p.conf);
  }
  if (!gridOwnsChord() && chordPendingGrid !== undefined) {
    const p = chordPendingGrid;
    chordPendingGrid = undefined;
    doChordChange(p.sig, p.notes, p.conf);
  }
}

// gate <0..5> from live.menu: Off, 1/4, 1/8, 1/8T, 1/16, 1/16T (chord voice).
// Gate is bypassed while the transport is stopped (jam mode = sustain).
function gate(v) {
  if (typeof v !== "number") return;
  const g = clamp(0, 5, Math.round(v));
  if (g === cfg.gate) return;
  const wasOff = cfg.gate === 0;
  cfg.gate = g;
  if (!transportPlaying || !engaged || cfg.kill) return; // stopped/killed: gate inert
  if (g !== 0 && wasOff) {
    // Gate on mid-sustain: release the sustained chord now (lead-shared tones
    // survive via refcount); pulsing starts from the next boundary.
    gateConf = lastChordEvent ? lastChordEvent.score : 1;
    if (heldChord) for (const n of heldChord.notes) noteOff(n);
  } else if (g === 0 && !wasOff) {
    // Gate off mid-cycle: cancel pending gate offs, restore the sustained chord.
    tlClear();
    releaseChord();
    if (cfg.enabled && chordEngineOn()) reapplyChord();
  }
}

// gatelen <5..100> from live.dial (% of the gate interval the note sustains).
function gatelen(v) {
  if (typeof v !== "number") return;
  cfg.gatelen = clamp(5, 100, Math.round(v));
}

// chance <0..100> from live.dial (% probability each physical note-on sounds).
function chance(v) {
  if (typeof v !== "number") return;
  cfg.chance = clamp(0, 100, Math.round(v));
  chancePct = cfg.chance;
}

// spread <0..3> from live.dial (octave-spread voicing stages).
function spread(v) {
  if (typeof v !== "number") return;
  const s = clamp(0, 3, Math.round(v));
  if (s === cfg.spread) return;
  cfg.spread = s;
  if (cfg.enabled && !cfg.kill && engaged && chordEngineOn()) reapplyChord(); // revoice
}

// voices <1..4> from live.dial (chord tone budget).
function voices(v) {
  if (typeof v !== "number") return;
  const n = clamp(1, 4, Math.round(v));
  if (n === cfg.voices) return;
  cfg.voices = n;
  if (cfg.enabled && !cfg.kill && engaged && chordEngineOn()) reapplyChord(); // revoice
}

// strum <0..60> from live.dial (ms per diff-added chord tone, low->high).
function strum(v) {
  if (typeof v !== "number") return;
  cfg.strum = clamp(0, 60, Math.round(v));
}

// human <0..100> from live.dial (one knob: timing jitter + velocity jitter).
function human(v) {
  if (typeof v !== "number") return;
  cfg.human = clamp(0, 100, Math.round(v));
}

// hold <0|1> from live.text toggle (freeze current harmony) — milestone 6.
function hold(b) {
  setHold(b ? 1 : 0);
}

// kill <0|1> from live.text toggle (mute output, keep tracking) — milestone 6.
function kill(b) {
  setKill(b ? 1 : 0);
}

// rewait — live.text button; re-arm the engage countdown — milestone 6.
function rewait() {
  doReWait();
}

// --- lifecycle -----------------------------------------------------------------------------

function panic() {
  releaseAll(true); // offs + CC123 x 16 channels
  // Panic clears the frozen snapshot too: a held pad becomes frozen silence.
  if (cfg.hold) {
    heldSnapshotLead = null;
    heldSnapshotChord = null;
  }
}

// Called by Max when the device is deleted / the patcher closes: never leave
// a synth hanging downstream.
function notifydeleted() {
  releaseAll(true);
}

// Swallow the analyzer's patcher-level field messages (key, chordRoot,
// leadNote, keyConfidence, ...) so the bus receive can be wired straight into
// this object without console spam. Unknown selectors are ignored by design.
function anything() {}
