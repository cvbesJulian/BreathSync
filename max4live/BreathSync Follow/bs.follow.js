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
  keyhold: 5    // live.dial int 1..30 s (candidate stability before commit)
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

let heldLead = null;        // { pitch, onAt } | null
let leadQueued;             // undefined = none; else { target: int|null, conf }
let heldChord = null;       // { sig, notes: int[], onAt } | null
let chordQueued;            // undefined = none; else { sig, notes, conf }

// Cached raw events for instant re-apply on mode/channel/octave/enable changes.
let lastLeadEvent = null;   // { midi, conf } | null (null = cleared / none)
let lastChordEvent = null;  // { rootPc, quality, score, pcs } | null

// --- key sync state -------------------------------------------------------------

let keyCand = null;         // { root, mode, since } | null
let lastKeySetAt = 0;

// --- Live API -------------------------------------------------------------------

let liveSet = null;
let playObserver = null;
let wasPlaying = 0;

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

// --- refcounted note emission ------------------------------------------------
// MIDI leaves the device only on 0<->1 refcount transitions, so a pitch shared
// by the lead and a chord tone sounds once and survives either owner releasing.

function noteOn(pitch, vel) {
  const count = held.get(pitch) || 0;
  held.set(pitch, count + 1);
  if (count === 0) outlet(0, 0x90 | cfg.channel, pitch, vel);
}

function noteOff(pitch) {
  const count = held.get(pitch) || 0;
  if (count <= 1) {
    held.delete(pitch);
    if (count === 1) outlet(0, 0x80 | cfg.channel, pitch, 0);
  } else {
    held.set(pitch, count - 1);
  }
}

// Note-off every held pitch on the CURRENT channel, clear all voice state and
// pending Tasks. sendCC additionally fires CC123 (all notes off) value 0 on
// all 16 channels — mirrors the web app's allNotesOff().
function releaseAll(sendCC) {
  leadTask.cancel();
  chordTask.cancel();
  leadQueued = undefined;
  chordQueued = undefined;
  for (const pitch of held.keys()) outlet(0, 0x80 | cfg.channel, pitch, 0);
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
    noteOn(target, velocityFor(conf)); // legato: new note on first
    if (old !== null) noteOff(old);
    heldLead = { pitch: target, onAt: Date.now() };
  } else {
    if (old !== null) noteOff(old);
    heldLead = null;
  }
}

function leadTransition(target, conf) {
  const now = Date.now();
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

function reapplyLead() {
  if (!lastLeadEvent) return;
  leadTransition(leadTargetFor(lastLeadEvent), lastLeadEvent.conf);
}

// --- chord lifecycle -------------------------------------------------------------
// Driven only by `chord` events. sig identity = root|quality (null on reset),
// plus the voicing octave so a Chord Oct change revoices instead of being
// swallowed by the sustain branch. Same Min-Dur coalescing as the lead;
// applying a change diffs voicings so common tones sustain untouched
// (refcounting keeps this safe against the lead).

function chordSigFor(ev) {
  return ev.rootPc + "|" + ev.quality + "|" + cfg.chordoct;
}

function voiceChord(rootPc, pcs) {
  const root = CHORD_BASE + rootPc + 12 * cfg.chordoct;
  const notes = [];
  for (const pcRaw of pcs) {
    const pc = ((Math.round(pcRaw) % 12) + 12) % 12;
    const pitch = clamp(0, 127, root + ((pc - rootPc + 12) % 12));
    if (notes.indexOf(pitch) < 0) notes.push(pitch);
  }
  return notes;
}

function doChordChange(sig, notes, conf) {
  const oldNotes = heldChord ? heldChord.notes : [];
  for (const n of oldNotes) {
    if (notes.indexOf(n) < 0) noteOff(n); // removed tones off
  }
  for (const n of notes) {
    if (oldNotes.indexOf(n) < 0) noteOn(n, velocityFor(conf)); // added tones on
  }
  heldChord = sig !== null ? { sig: sig, notes: notes, onAt: Date.now() } : null;
}

function chordTransition(sig, notes, conf) {
  const now = Date.now();
  if (!heldChord) {
    chordQueued = undefined;
    chordTask.cancel();
    if (sig !== null) {
      for (const n of notes) noteOn(n, velocityFor(conf));
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
  if (!lastChordEvent) return;
  const ev = lastChordEvent;
  chordTransition(chordSigFor(ev), voiceChord(ev.rootPc, ev.pcs), ev.score);
}

function reapplyActive() {
  if (leadEngineOn()) reapplyLead();
  if (chordEngineOn()) reapplyChord();
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
      releaseAll(false);
      pendingRestrike = true;
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
  } catch (err) {
    liveSet = null;
    playObserver = null;
    if (cfg.keysync) disp("lastset", "key sync unavailable");
  }
  refreshStatus(); // "waiting for analyzer" until the first hello/state
  disp("inchord", "-");
  disp("inkey", "-");
  disp("lastset", NBSP);
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
  lastLeadEvent = midi >= 0 ? { midi: midi, conf: c } : null;
  if (!cfg.enabled || !leadEngineOn()) return;
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
  if (!cfg.enabled || !chordEngineOn()) return;
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

// watchdog — banged by [metro 250]. 3000 ms without state/hello => analyzer
// gone: release everything it drove, clear caches, show stale.
function watchdog() {
  if (!linked) return;
  if (Date.now() - lastStateAt <= STALE_MS) return;
  linked = false;
  lastLeadEvent = null;
  lastChordEvent = null;
  keyCand = null;
  pendingRestrike = false;
  releaseAll(false);
  disp("status", "stale");
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
  if (cfg.enabled && leadEngineOn()) reapplyLead(); // retranspose live
}

function chordoct(v) {
  if (typeof v !== "number") return;
  const oct = clamp(-2, 2, Math.round(v));
  if (oct === cfg.chordoct) return;
  cfg.chordoct = oct;
  if (cfg.enabled && chordEngineOn()) reapplyChord(); // revoice live
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

// --- lifecycle -----------------------------------------------------------------------------

function panic() {
  releaseAll(true); // offs + CC123 x 16 channels
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
