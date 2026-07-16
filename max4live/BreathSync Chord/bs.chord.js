// ---------------------------------------------------------------------------
// bs.chord.js — BreathSync Chord: ML next-chord comping for the BreathSync
// Listen analyzer.
//
// Consumes the harmony bus (bs.harmony.bus<N>, PROTOCOL.md v1):
//   * `lead <midi> <conf>` events  -> buffers the played melody (beat-stamped
//     off the Live transport).
//   * `state` (key / mode)         -> maps the sounding key to the model's
//     transposeOffset (tonic -> C major / A minor, range -5..6).
//
// At each beat boundary it asks the ONNX model (running in a sibling
// `node.script nextchord.node.js`) for the next chord, then REALIZES it
// (Complexity knob adds 7ths/9ths) and VOICE-LEADS it to MIDI (common tones
// sustain, refcounted like bs.follow.js). Max owns beat timing; the model owns
// the harmonic move; this script owns realization + voicing.
//
//   outlet 0: raw MIDI (status, data1, data2)
//   outlet 1: displays (status / chord / key)
//   outlet 2: `predict <json>` to node.script; replies arrive as `modelchord`.
//
// Requires Live 12.2+ (Max 9 v8 + LiveAPI). Embedded into the .amxd (v8 @embed).
// ---------------------------------------------------------------------------

autowatch = 0;
inlets = 1;
outlets = 3;

if (typeof setinletassist === "function") {
  setinletassist(0, "bus: state/lead/hello ; node: modelchord ; params ; watchdog");
}
if (typeof setoutletassist === "function") {
  setoutletassist(0, "raw MIDI bytes (status, data1, data2)");
  setoutletassist(1, "displays: status / chord / key");
  setoutletassist(2, "predict <json> -> node.script");
}

// --- constants --------------------------------------------------------------

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NBSP = " ";
const PROTOCOL_VERSION = 1;
const STALE_MS = 3000;
const CHORD_BASE = 48;              // sounding root voiced in octave 3 (C3)
const MAX_WINDOW_BARS = 4;          // melody buffer horizon
const BOS = -1;                     // previous-chord sentinel for node

// Genre menu index -> model source tag ("" = Auto: the model's trained
// unknown-genre slot). Names must match model_config.features.sources.
const GENRE_SOURCES = ["", "pop909", "nottingham", "openbook"];

// FAMILIES order must match model_config.families; core chord tones per family.
const FAMILIES = ["MAJ", "DOM", "MIN", "HDIM", "DIM", "AUG", "SUS"];
const FAMILY_CORE = {
  0: [0, 4, 7], 1: [0, 4, 7, 10], 2: [0, 3, 7], 3: [0, 3, 6, 10],
  4: [0, 3, 6], 5: [0, 4, 8], 6: [0, 5, 7]
};

// --- parameters (raw widget values, wired in bs.chord.maxpat) ---------------

const cfg = {
  enabled: 1,       // live.thisdevice on/off
  active: 1,        // live.toggle: comping engine on
  complexity: 0.3,  // live.dial 0..1  (triad -> 7th -> 9th realization)
  freedom: 0.0,     // live.dial 0..1  (model softmax temperature in reranker)
  wlenbars: 2.0,    // live.menu: melody window fed to the model
  vel: 90,          // live.dial 1..127
  channel: 0,       // live.menu index 0..15
  chordoct: 0,      // live.dial -2..2
  waitbars: 2,      // live.dial 0..32 bars to listen before first comp (0 = now)
  genre: 0          // live.menu: 0 Auto / 1 Pop / 2 Folk / 3 Jazz (GENRE_SOURCES)
};

// --- link / bus state -------------------------------------------------------

let linked = false;
let lastStateAt = 0;
let haveKey = false;
let offset = 0;                 // transposeOffset for the current key
let modeStr = "maj";            // "maj" | "min"
let keyName = "";

// --- melody buffer ----------------------------------------------------------

let melody = [];                // { pitch (absolute MIDI), onset (song beats) }
let openPitch = -1;             // currently sounding lead pitch (-1 = silence)

// --- beat / transport -------------------------------------------------------

let liveSet = null;
let playObserver = null;
let wasPlaying = 0;
let lastBeat = -1;              // last integer beat we predicted at
let firstBar = -1;             // bar index of the first prediction (hypermeter anchor)

// --- engage gating ----------------------------------------------------------

let engaged = false;
let waitStartBeat = 0;

// --- model result / voice engine --------------------------------------------

let prevClass = BOS;            // last COMMITTED transposed class (BOS at start)
let soundingClass = BOS;        // chord currently sounding (transposed class id)
let pendingT = null;            // beat of the in-flight predict (drop stale replies)
const held = new Map();         // pitch -> refcount
let heldChord = null;           // { sig, notes:int[] } | null

// --- helpers ----------------------------------------------------------------

function clamp(lo, hi, v) { return v < lo ? lo : v > hi ? hi : v; }
function clamp01(v) { const n = Number(v); return !isFinite(n) ? 0 : n < 0 ? 0 : n > 1 ? 1 : n; }
function disp(sel, text) { outlet(1, sel, String(text).split(" ").join(NBSP)); }
function firstNumber(v) { const r = Array.isArray(v) ? v[0] : v; const n = Number(r); return isFinite(n) ? n : NaN; }

function transposeOffsetFor(tonicPc, mode) {
  let o = (((mode === "maj" ? -tonicPc : 9 - tonicPc) % 12) + 12) % 12;
  return o > 6 ? o - 12 : o;    // representative in [-5, 6], matches training
}

function songBeats() { return firstNumber(liveSet.get("current_song_time")); }
function beatsPerBar() {
  const num = firstNumber(liveSet.get("signature_numerator"));
  const den = firstNumber(liveSet.get("signature_denominator"));
  return num > 0 && den > 0 ? num * (4 / den) : 4;
}

// --- refcounted MIDI (a pitch shared across chords sounds once) --------------

function noteOn(pitch, vel) {
  const c = held.get(pitch) || 0;
  held.set(pitch, c + 1);
  if (c === 0) outlet(0, 0x90 | cfg.channel, pitch, vel);
}
function noteOff(pitch) {
  const c = held.get(pitch) || 0;
  if (c <= 1) { held.delete(pitch); if (c === 1) outlet(0, 0x80 | cfg.channel, pitch, 0); }
  else held.set(pitch, c - 1);
}
function releaseAll(sendCC) {
  for (const p of held.keys()) outlet(0, 0x80 | cfg.channel, p, 0);
  held.clear();
  heldChord = null;
  if (sendCC) for (let ch = 0; ch < 16; ch++) outlet(0, 0xb0 + ch, 123, 0);
}

// --- realization (Complexity) + voicing -------------------------------------

// family core tones, plus Complexity color: mid adds the diatonic 7th to triad
// families, high adds a 9th. Returns pitch-class offsets above the root.
function realize(familyIdx, complexity) {
  const pcs = FAMILY_CORE[familyIdx].slice();
  const add = (x) => { if (pcs.indexOf(x) < 0) pcs.push(x); };
  if (complexity >= 0.34) {
    if (familyIdx === 0 || familyIdx === 5) add(11);      // MAJ/AUG -> maj7
    else if (familyIdx === 2 || familyIdx === 6) add(10); // MIN/SUS -> b7
  }
  if (complexity >= 0.67) add(2);                          // 9th
  return pcs;
}

// Voice family offsets over a sounding root, stacked above CHORD_BASE.
function voiceChord(soundingRootPc, offsets) {
  const root = CHORD_BASE + soundingRootPc + 12 * cfg.chordoct;
  const notes = [];
  for (const o of offsets) {
    const pitch = clamp(0, 127, root + o);
    if (notes.indexOf(pitch) < 0) notes.push(pitch);
  }
  return notes;
}

// Diff against the held voicing so common tones sustain untouched.
function doChordChange(sig, notes) {
  const oldNotes = heldChord ? heldChord.notes : [];
  for (const n of oldNotes) if (notes.indexOf(n) < 0) noteOff(n);
  for (const n of notes) if (oldNotes.indexOf(n) < 0) noteOn(n, cfg.vel);
  heldChord = sig !== null ? { sig: sig, notes: notes } : null;
}

// --- melody buffer ----------------------------------------------------------

function pushOnset(pitch, at) {
  melody.push({ pitch: pitch, onset: at });
}
function pruneMelody(now, bpb) {
  const horizon = now - MAX_WINDOW_BARS * bpb - 1e-6;
  while (melody.length && melody[0].onset < horizon) melody.shift();
}

// Build the model's note list for a decision at beat t: notes with onset < t
// within the window, transposed to model space, with durations from successive
// onsets (open note runs to t).
function windowNotes(t, bpb) {
  const L = cfg.wlenbars * bpb;
  const lo = t - L;
  const win = [];
  for (let i = 0; i < melody.length; i++) {
    const m = melody[i];
    if (m.onset >= lo - 1e-9 && m.onset < t - 1e-9) win.push(m);
  }
  const out = [];
  for (let i = 0; i < win.length; i++) {
    const nextOnset = i + 1 < win.length ? win[i + 1].onset : t;
    const dur = Math.max(0.01, nextOnset - win[i].onset);
    const onsetInBar = win[i].onset - Math.floor(win[i].onset / bpb) * bpb;
    out.push([win[i].pitch + offset, win[i].onset, dur, onsetInBar, bpb]); // transposed pitch
  }
  return out;
}

// --- prediction -------------------------------------------------------------

function firePredict(t, bpb) {
  const bar = Math.floor(t / bpb);
  if (firstBar < 0) firstBar = bar;
  const req = {
    notes: windowNotes(t, bpb),
    t: t,
    mode: modeStr,
    meter: Math.round(bpb),
    prevClass: prevClass,
    soundingClass: soundingClass,
    wlenBars: cfg.wlenbars,
    hyper: ((bar - firstBar) % 8 + 8) % 8,
    grid: (t - bar * bpb) < 1e-6 ? 0 : 1,
    transposeOffset: offset,
    freedom: cfg.freedom,
    source: GENRE_SOURCES[cfg.genre] || ""
  };
  pendingT = t;
  outlet(2, "predict", JSON.stringify(req));
}

// node.script reply: modelchord <classId> <familyIdx> <soundingRootPc> <roman> <absName>
// familyIdx < 0 => HOLD / OTHER (sustain the current chord).
function modelchord(classId, familyIdx, soundingRootPc, roman, absName) {
  pendingT = null;
  if (!cfg.enabled || !cfg.active) return;
  if (typeof familyIdx !== "number" || familyIdx < 0) {
    disp("chord", roman ? String(roman) : "HOLD");
    return; // hold current voicing
  }
  const offsets = realize(familyIdx, cfg.complexity);
  const notes = voiceChord(((Math.round(soundingRootPc) % 12) + 12) % 12, offsets);
  const sig = classId + "|" + familyIdx + "|" + cfg.chordoct + "|" + cfg.complexity;
  doChordChange(sig, notes);
  prevClass = classId;
  soundingClass = classId;
  disp("chord", (roman || "?") + "  " + (absName || ""));
}

// Re-voice the last committed chord when Complexity / Chord Oct change (instant,
// no round-trip) — mirrors bs.follow.js reapplyChord.
function revoiceHeld() {
  if (!heldChord || soundingClass < 0) return;
  // heldChord.sig encodes classId|familyIdx|...; re-realize from it.
  const parts = String(heldChord.sig).split("|");
  const familyIdx = Number(parts[1]);
  // recover sounding root from the lowest held note
  const rootPitch = Math.min.apply(null, heldChord.notes);
  const soundingRootPc = ((rootPitch % 12) + 12) % 12;
  const offsets = realize(familyIdx, cfg.complexity);
  const notes = voiceChord(soundingRootPc, offsets);
  const sig = parts[0] + "|" + familyIdx + "|" + cfg.chordoct + "|" + cfg.complexity;
  doChordChange(sig, notes);
}

// --- transport / beat detection ---------------------------------------------

function resetBeatClock() {
  lastBeat = liveSet ? Math.floor(songBeats() + 1e-6) : -1;
}

function onLiveSetProperty(args) {
  try {
    const name = Array.isArray(args) ? args[0] : arguments[0];
    const value = Array.isArray(args) ? args[1] : arguments[1];
    if (String(name) !== "is_playing") return;
    const playing = Number(value) ? 1 : 0;
    if (wasPlaying === 0 && playing === 1) {
      waitStartBeat = songBeats();
      engaged = cfg.waitbars <= 0;
      firstBar = -1;
      resetBeatClock();
    } else if (wasPlaying === 1 && playing === 0) {
      releaseAll(false);
      engaged = false;
      prevClass = BOS;
      soundingClass = BOS;
    }
    wasPlaying = playing;
  } catch (e) { /* LiveAPI callback: never throw */ }
}

// Banged by [metro ~20ms]: advance engage gate, then predict on each new beat.
function watchdog() {
  if (linked && Date.now() - lastStateAt > STALE_MS) {
    linked = false; releaseAll(false); disp("status", "stale");
  }
  if (!liveSet || !wasPlaying || !cfg.enabled) return;
  const bpb = beatsPerBar();
  if (!engaged) {
    if (songBeats() - waitStartBeat >= cfg.waitbars * bpb) {
      engaged = true;
      // don't resetBeatClock: let the beat that triggered engagement comp now
      disp("status", "comping");
    } else {
      const remain = (cfg.waitbars * bpb - (songBeats() - waitStartBeat)) / bpb;
      disp("status", "listen " + remain.toFixed(1) + " bars");
      return;
    }
  }
  const b = Math.floor(songBeats() + 1e-6);
  if (b > lastBeat && haveKey && cfg.active) {
    lastBeat = b;
    pruneMelody(songBeats(), bpb);
    firePredict(b, bpb);
  } else if (b > lastBeat) {
    lastBeat = b;
  }
}

// --- bus handlers -----------------------------------------------------------

function init() {
  try {
    liveSet = new LiveAPI("live_set");
    playObserver = new LiveAPI(onLiveSetProperty, "live_set");
    playObserver.property = "is_playing";
    wasPlaying = firstNumber(playObserver.get("is_playing")) ? 1 : 0;
  } catch (e) { liveSet = null; playObserver = null; }
  disp("status", "waiting for analyzer");
  disp("chord", "-");
  disp("key", "-");
  if (wasPlaying) { waitStartBeat = songBeats(); engaged = cfg.waitbars <= 0; resetBeatClock(); }
}

// state <json> — read key/mode -> transposeOffset. Voice engine is beat-driven,
// not state-driven, so this only updates key context + liveness.
function state(jsonSym) {
  let s;
  try { s = JSON.parse(String(jsonSym)); } catch (e) { return; }
  if (!s || s.v !== PROTOCOL_VERSION) return;
  lastStateAt = Date.now();
  if (!linked) { linked = true; disp("status", wasPlaying ? "comping" : "linked"); }
  if (s.key != null && s.mode != null) {
    const tonic = NOTE_NAMES.indexOf(String(s.key));
    if (tonic >= 0) {
      const m = String(s.mode).slice(0, 3) === "min" ? "min" : "maj";
      const newOff = transposeOffsetFor(tonic, m);
      if (m !== modeStr || newOff !== offset) { prevClass = BOS; soundingClass = BOS; }
      offset = newOff; modeStr = m; keyName = String(s.key); haveKey = true;
      disp("key", keyName + " " + (m === "min" ? "minor" : "major") + " (offset " + offset + ")");
    }
  }
}

// lead <midi|-1> <conf> — melody onset stream. A new pitch = a note onset,
// beat-stamped off the transport. Buffered even while listening (pre-engage).
function lead(midi, conf) {
  if (typeof midi !== "number") return;
  const p = Math.round(midi);
  if (p === openPitch) return;               // sustain: same pitch
  openPitch = p;
  if (p >= 0 && liveSet && wasPlaying) pushOnset(p, songBeats());
}

function hello(v, src) {
  if (Number(v) !== PROTOCOL_VERSION) return;
  lastStateAt = Date.now();
  if (!linked) { linked = true; disp("status", "linked"); }
}

// --- parameter setters ------------------------------------------------------

function enabled(b) { const on = b ? 1 : 0; if (on === cfg.enabled) return; cfg.enabled = on; if (!on) releaseAll(false); }
function active(b) { cfg.active = b ? 1 : 0; if (!cfg.active) releaseAll(false); }
function complexity(v) { if (typeof v !== "number") return; cfg.complexity = clamp01(v); revoiceHeld(); }
function freedom(v) { if (typeof v !== "number") return; cfg.freedom = clamp01(v); }
function wlenbars(v) { if (typeof v !== "number") return; cfg.wlenbars = clamp(0.5, MAX_WINDOW_BARS, v); }
function vel(v) { if (typeof v !== "number") return; cfg.vel = clamp(1, 127, Math.round(v)); }
function channel(i) { if (typeof i !== "number") return; const ch = clamp(0, 15, Math.round(i)); if (ch === cfg.channel) return; releaseAll(false); cfg.channel = ch; }
function chordoct(v) { if (typeof v !== "number") return; const o = clamp(-2, 2, Math.round(v)); if (o === cfg.chordoct) return; cfg.chordoct = o; revoiceHeld(); }
function waitbars(v) { if (typeof v !== "number") return; cfg.waitbars = clamp(0, 32, Math.round(v)); }
function genre(i) { if (typeof i !== "number") return; cfg.genre = clamp(0, GENRE_SOURCES.length - 1, Math.round(i)); }

function panic() { releaseAll(true); }
function notifydeleted() { releaseAll(true); }
function anything() {}    // swallow analyzer patcher field messages
