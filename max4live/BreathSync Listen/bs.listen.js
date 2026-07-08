// bs.listen.js
// BreathSync Listen - Max for Live port of the web app's listen.js analysis pipeline.
//
// Runs in Max 9's [v8] object (real V8, ES2020) - Live 12.2+ required. The
// patcher records device audio into a circular buffer~ (mono, 65536 samples)
// and drives this script with a qmetro. Each tick reads the most recent 8192
// samples and runs the same analysis as the web app:
//   - autocorrelation pitch detection (note, octave, cents) on the last 2048 samples
//   - Blackman-windowed 8192-point FFT -> 12-bin chroma (fast/slow EMAs)
//   - chord matching against 9 templates (cosine similarity, 2-frame hysteresis)
//   - Krumhansl-Schmuckler key/mode detection (Pearson correlation)
//
// Emission implements harmony bus protocol v1 - see ../PROTOCOL.md, which is
// the single source of truth (it wins over this comment if they disagree):
//   - state layer: "state <json>" + companion field messages, throttled with
//     the web app's exact math (on-change with >= 250 ms spacing, 1 s
//     heartbeat) but run UNCONDITIONALLY from tick(), outside the harmony RMS
//     gate, so idle states keep flowing during silence.
//   - event layer (immediate, on-change only): "lead <midi|-1> <confidence>"
//     on every lead change/clear; "chord <rootPc|-1> <quality|none> <score>
//     <pc...>" on post-hysteresis chord commit/reset.
//   - lifecycle: "hello 1 <src>" + full state burst + current lead/chord
//     events on load and on "announce" (the patch re-sends "announce" after a
//     bus retarget).
//
// Object box: [v8 bs.listen.js ---bstime @autowatch 0]. jsarguments[1] is the
// ----substituted buffer~ name; the substituted string doubles as the protocol
// "src" instance id. "setbuffer <name>" remains as a debug override for
// standalone Max only.
//
// Outlet 0: UI messages (note/freq/cents/needle/chord/chordconf/key/keyconf/chroma/status)
// Outlet 1: protocol messages (state + fields, lead/chord events, hello)

autowatch = 0;
inlets = 1;
outlets = 2;

// ---------------------------------------------------------------------------
// Constants (identical to listen.js)
// ---------------------------------------------------------------------------

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const PITCH_RMS_GATE = 0.01;
const PITCH_INTERVAL_MS = 60;
const PITCH_HISTORY_SIZE = 5;
const PITCH_SILENCE_FRAMES = 3;
const PITCH_WINDOW = 2048;

const FFT_SIZE = 8192;
const HARMONY_INTERVAL_MS = 90;
const KEY_INTERVAL_MS = 550;
const HARMONY_RMS_GATE = 0.008;
const HARMONY_SILENCE_FRAMES = 4;
const CHROMA_MIN_FREQ = 55;
const CHROMA_MAX_FREQ = 5000;
const CHROMA_FAST_ALPHA = 0.28;
const CHROMA_SLOW_ALPHA = 0.045;
const CHORD_MIN_CONFIDENCE = 0.5;
const CHORD_STRONG_CONFIDENCE = 0.72;
const CHORD_COMMIT_FRAMES = 2;
const KEY_MIN_CONFIDENCE = 0.2;
const KEY_STRONG_CONFIDENCE = 0.5;
const MAG_SMOOTHING = 0.5; // mirrors AnalyserNode.smoothingTimeConstant

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
const DENSITY_WINDOW_MS = 4000;
const STATE_WRITE_MIN_MS = 250;
const STATE_REFRESH_MS = 1000;

const PROTOCOL_VERSION = 1; // harmony bus schema version (PROTOCOL.md)
const PERF_REPORT_MS = 5000;

const CHORD_TEMPLATES = [
  { quality: "maj", label: "maj", intervals: [0, 4, 7] },
  { quality: "min", label: "min", intervals: [0, 3, 7] },
  { quality: "dim", label: "dim", intervals: [0, 3, 6] },
  { quality: "aug", label: "aug", intervals: [0, 4, 8] },
  { quality: "sus2", label: "sus2", intervals: [0, 2, 7] },
  { quality: "sus4", label: "sus4", intervals: [0, 5, 7] },
  { quality: "maj7", label: "maj7", intervals: [0, 4, 7, 11] },
  { quality: "min7", label: "min7", intervals: [0, 3, 7, 10] },
  { quality: "dom7", label: "7", intervals: [0, 4, 7, 10] }
];

const KS_MAJOR_PROFILE = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88
];
const KS_MINOR_PROFILE = [
  6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17
];

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

let sampleRate = 44100;
let timeBuf = null;
let writePhase = 0;
let isActive = 1;
let dspOn = 1;

let lastPitchAt = 0;
let lastHarmonyAt = 0;
let lastKeyAt = 0;
let silentFrames = 0;
let harmonySilentFrames = 0;
let displayedChord = null;
let displayedKey = null;
let pendingChord = null;
let pendingChordCount = 0;
let currentLeadMidi = null;
let noteOnsetTimes = [];
let lastStateSignature = "";
let lastStateWriteAt = 0;

let perfEnabled = 0;
let perfTickSum = 0;
let perfTickCount = 0;
let perfWindowStart = 0;

// Buffer name arrives as an object-box argument (--- IS substituted there,
// unlike in message boxes). It doubles as the protocol "src" instance id.
let timeBufName = "";
if (typeof jsarguments !== "undefined" && jsarguments.length > 1 && jsarguments[1]) {
  timeBufName = String(jsarguments[1]);
} else {
  post("bs.listen.js: missing buffer name argument " +
    "(expected [v8 bs.listen.js ---bstime]); analysis disabled until setbuffer\n");
}

function srcId() {
  return timeBufName || "unknown";
}

// ---------------------------------------------------------------------------
// Preallocated scratch (zero-allocation hot path)
// ---------------------------------------------------------------------------

const window8192 = new Float64Array(FFT_SIZE);
const scratchRe = new Float64Array(FFT_SIZE);
const scratchIm = new Float64Array(FFT_SIZE);
const smoothedMag = new Float64Array(FFT_SIZE / 2);
const binPitchClasses = new Int8Array(FFT_SIZE / 2);
const chromaFast = new Float32Array(12); // Float32 matches the web app's EMA precision
const chromaSlow = new Float32Array(12);
const chromaRaw = new Float32Array(12);  // per-frame accumulator, zeroed each call
const ksRotated = new Float32Array(12);  // detectKey profile-rotation scratch
const chromaMsg = new Array(13);         // reused outlet-0 chroma message
chromaMsg[0] = "chroma";
const freqHistory = new Float64Array(PITCH_HISTORY_SIZE);
let freqHistoryLen = 0;
const medianScratch = new Float64Array(PITCH_HISTORY_SIZE);

// ---------------------------------------------------------------------------
// FFT (iterative radix-2, cached twiddle/bit-reversal tables per size, plus
// per-size re/im scratch for the autocorrelation path)
// ---------------------------------------------------------------------------

const fftCache = {};

function getFFT(n) {
  let tables = fftCache[n];
  if (!tables) {
    const rev = new Int32Array(n);
    for (let i = 1; i < n; i++) {
      rev[i] = (rev[i >> 1] >> 1) | ((i & 1) ? (n >> 1) : 0);
    }
    const cosT = new Float64Array(n / 2);
    const sinT = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      cosT[i] = Math.cos(-2 * Math.PI * i / n);
      sinT[i] = Math.sin(-2 * Math.PI * i / n);
    }
    tables = {
      rev,
      cos: cosT,
      sin: sinT,
      re: new Float64Array(n),
      im: new Float64Array(n)
    };
    fftCache[n] = tables;
  }
  return tables;
}

function fft(re, im, n, tables) {
  const rev = tables.rev;
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let j = 0; j < half; j++) {
        const tw = j * step;
        const wr = tables.cos[tw];
        const wi = tables.sin[tw];
        const idx = i + j + half;
        const xr = re[idx] * wr - im[idx] * wi;
        const xi = re[idx] * wi + im[idx] * wr;
        re[idx] = re[i + j] - xr;
        im[idx] = im[i + j] - xi;
        re[i + j] += xr;
        im[i + j] += xi;
      }
    }
  }
}

function nextPow2(v) {
  let n = 1;
  while (n < v) n <<= 1;
  return n;
}

function buildBlackman(n) {
  // Exact Blackman as used by Web Audio's AnalyserNode (alpha = 0.16).
  const alpha = 0.16;
  const a0 = (1 - alpha) / 2;
  const a1 = 0.5;
  const a2 = alpha / 2;
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = a0 - a1 * Math.cos(2 * Math.PI * i / n) + a2 * Math.cos(4 * Math.PI * i / n);
  }
  return w;
}

const blackman = buildBlackman(FFT_SIZE);

// ---------------------------------------------------------------------------
// Pitch detection (port of listen.js autoCorrelate / median / describePitch)
// ---------------------------------------------------------------------------

function autoCorrelate(buf, offset, size, sr) {
  let sumSquares = 0;
  for (let i = 0; i < size; i++) {
    const sample = buf[offset + i];
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / size);
  if (rms < PITCH_RMS_GATE) return { frequency: -1, rms };

  let start = 0;
  let end = size - 1;
  const edgeThreshold = 0.2;
  for (let i = 0; i < size / 2; i++) {
    if (Math.abs(buf[offset + i]) < edgeThreshold) { start = i; break; }
  }
  for (let i = 1; i < size / 2; i++) {
    if (Math.abs(buf[offset + size - i]) < edgeThreshold) { end = size - i; break; }
  }

  const trimmedSize = end - start;
  if (trimmedSize < 32) return { frequency: -1, rms };

  // Linear autocorrelation via FFT (Wiener-Khinchin). Produces the same values
  // as the web app's O(n^2) loop (times a constant factor, which cancels in
  // the dip-skip / peak-pick / parabolic-interpolation steps below). Uses the
  // preallocated per-size scratch from the FFT cache - no allocation per call.
  const m = nextPow2(trimmedSize * 2);
  const tables = getFFT(m);
  const re = tables.re;
  const im = tables.im;
  re.fill(0);
  im.fill(0);
  for (let i = 0; i < trimmedSize; i++) re[i] = buf[offset + start + i];
  fft(re, im, m, tables);
  for (let i = 0; i < m; i++) {
    const power = re[i] * re[i] + im[i] * im[i];
    re[i] = power;
    im[i] = 0;
  }
  // The power spectrum is real and even, so a second forward FFT equals the
  // inverse FFT scaled by m.
  fft(re, im, m, tables);
  const correlations = re;

  let lag = 0;
  while (lag < trimmedSize - 1 && correlations[lag] > correlations[lag + 1]) {
    lag += 1;
  }

  let peakValue = -Infinity;
  let peakLag = -1;
  for (let i = lag; i < trimmedSize; i++) {
    if (correlations[i] > peakValue) {
      peakValue = correlations[i];
      peakLag = i;
    }
  }
  if (peakLag <= 0) return { frequency: -1, rms };

  let refinedLag = peakLag;
  if (peakLag > 0 && peakLag < trimmedSize - 1) {
    const left = correlations[peakLag - 1];
    const center = correlations[peakLag];
    const right = correlations[peakLag + 1];
    const shapeA = (left + right - 2 * center) / 2;
    const shapeB = (right - left) / 2;
    if (shapeA) refinedLag = peakLag - shapeB / (2 * shapeA);
  }

  const frequency = sr / refinedLag;
  if (!Number.isFinite(frequency) || frequency < 40 || frequency > 4200) {
    return { frequency: -1, rms };
  }
  return { frequency, rms };
}

function pushFreq(frequency) {
  if (freqHistoryLen === PITCH_HISTORY_SIZE) {
    for (let i = 1; i < PITCH_HISTORY_SIZE; i++) freqHistory[i - 1] = freqHistory[i];
    freqHistory[PITCH_HISTORY_SIZE - 1] = frequency;
  } else {
    freqHistory[freqHistoryLen] = frequency;
    freqHistoryLen += 1;
  }
}

function median() {
  // Median of freqHistory[0..freqHistoryLen) via insertion sort into a
  // preallocated 5-slot scratch - same values as the web app's slice().sort().
  const len = freqHistoryLen;
  if (!len) return 0;
  for (let i = 0; i < len; i++) {
    const value = freqHistory[i];
    let j = i - 1;
    while (j >= 0 && medianScratch[j] > value) {
      medianScratch[j + 1] = medianScratch[j];
      j -= 1;
    }
    medianScratch[j + 1] = value;
  }
  const middle = len >> 1;
  return len % 2
    ? medianScratch[middle]
    : (medianScratch[middle - 1] + medianScratch[middle]) / 2;
}

function describePitch(frequency) {
  const midiExact = 69 + 12 * Math.log2(frequency / 440);
  const midi = Math.round(midiExact);
  const cents = Math.round((midiExact - midi) * 100);
  return {
    midi,
    name: NOTE_NAMES[((midi % 12) + 12) % 12],
    octave: Math.floor(midi / 12) - 1,
    cents
  };
}

// Max quotes symbols containing spaces when a message box displays them, so
// display text is sent with non-breaking spaces instead.
const NBSP = "\u00a0";

function disp(selector, text) {
  outlet(0, selector, String(text).split(" ").join(NBSP));
}

function clearNoteReadout() {
  disp("note", "-");
  disp("freq", NBSP);
  outlet(0, "needle", 50);
  disp("cents", "waiting for a clear note");
}

function renderPitch(now) {
  const smoothed = median();
  if (smoothed <= 0) return;

  const pitch = describePitch(smoothed);
  if (currentLeadMidi !== pitch.midi) {
    noteOnsetTimes.push(now);
    currentLeadMidi = pitch.midi;
    emitLeadEvent(); // protocol event layer: immediate, every lead change
  }

  disp("note", pitch.name + pitch.octave);
  disp("freq", smoothed.toFixed(1) + " Hz");

  const needlePercent = Math.max(0, Math.min(100, 50 + pitch.cents));
  outlet(0, "needle", needlePercent);

  const inTune = Math.abs(pitch.cents) <= 5;
  const sign = pitch.cents > 0 ? "+" : "";
  disp("cents", inTune
    ? pitch.name + pitch.octave + " in tune"
    : pitch.name + pitch.octave + " " + sign + pitch.cents + " cents");
}

function detectPitch(now) {
  const result = autoCorrelate(window8192, FFT_SIZE - PITCH_WINDOW, PITCH_WINDOW, sampleRate);

  if (result.frequency <= 0) {
    silentFrames += 1;
    if (silentFrames >= PITCH_SILENCE_FRAMES && freqHistoryLen) {
      freqHistoryLen = 0;
      clearLead(); // emits "lead -1" from the pitch-silence branch
      clearNoteReadout();
    }
    return;
  }

  silentFrames = 0;
  pushFreq(result.frequency);
  renderPitch(now);
}

// ---------------------------------------------------------------------------
// Chroma / chord / key (port of listen.js)
// ---------------------------------------------------------------------------

function rebuildBinTables() {
  const binCount = FFT_SIZE / 2;
  const nyquistStep = sampleRate / FFT_SIZE;
  for (let i = 0; i < binCount; i++) {
    const frequency = i * nyquistStep;
    if (frequency < CHROMA_MIN_FREQ || frequency > CHROMA_MAX_FREQ) {
      binPitchClasses[i] = -1;
    } else {
      const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
      binPitchClasses[i] = ((midi % 12) + 12) % 12;
    }
  }
  smoothedMag.fill(0);
}

rebuildBinTables();

function computeChroma() {
  const tables = getFFT(FFT_SIZE);
  const re = scratchRe;
  const im = scratchIm;
  for (let i = 0; i < FFT_SIZE; i++) {
    re[i] = window8192[i] * blackman[i];
    im[i] = 0;
  }
  fft(re, im, FFT_SIZE, tables);

  const half = FFT_SIZE / 2;
  const raw = chromaRaw;
  raw.fill(0);
  let total = 0;
  for (let k = 0; k < half; k++) {
    const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / FFT_SIZE;
    const smoothed = MAG_SMOOTHING * smoothedMag[k] + (1 - MAG_SMOOTHING) * mag;
    smoothedMag[k] = smoothed;
    const pitchClass = binPitchClasses[k];
    if (pitchClass < 0) continue;
    raw[pitchClass] += smoothed;
    total += smoothed;
  }

  if (total <= 0) return false;

  let maxBin = 0;
  for (let i = 0; i < 12; i++) {
    raw[i] /= total;
    if (raw[i] > maxBin) maxBin = raw[i];
  }

  for (let i = 0; i < 12; i++) {
    const normalized = maxBin > 0 ? raw[i] / maxBin : 0;
    chromaFast[i] = CHROMA_FAST_ALPHA * normalized + (1 - CHROMA_FAST_ALPHA) * chromaFast[i];
    chromaSlow[i] = CHROMA_SLOW_ALPHA * normalized + (1 - CHROMA_SLOW_ALPHA) * chromaSlow[i];
  }
  return true;
}

function detectChord(chroma) {
  let chromaNorm = 0;
  for (let i = 0; i < 12; i++) chromaNorm += chroma[i] * chroma[i];
  chromaNorm = Math.sqrt(chromaNorm);
  if (chromaNorm < 1e-6) return null;

  let best = null;
  for (let root = 0; root < 12; root++) {
    for (let t = 0; t < CHORD_TEMPLATES.length; t++) {
      const template = CHORD_TEMPLATES[t];
      let dot = 0;
      for (let toneIndex = 0; toneIndex < template.intervals.length; toneIndex++) {
        dot += chroma[(root + template.intervals[toneIndex]) % 12];
      }
      const score = dot / (chromaNorm * Math.sqrt(template.intervals.length));
      if (!best || score > best.score) {
        best = { root, quality: template.quality, label: template.label, score };
      }
    }
  }
  return best;
}

function pearson(a, b) {
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < 12; i++) {
    meanA += a[i];
    meanB += b[i];
  }
  meanA /= 12;
  meanB /= 12;

  let numerator = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < 12; i++) {
    const devA = a[i] - meanA;
    const devB = b[i] - meanB;
    numerator += devA * devB;
    varA += devA * devA;
    varB += devB * devB;
  }
  if (varA === 0 || varB === 0) return 0;
  return numerator / Math.sqrt(varA * varB);
}

function detectKey(chroma) {
  const rotated = ksRotated;
  let best = null;
  for (let root = 0; root < 12; root++) {
    for (let i = 0; i < 12; i++) {
      rotated[i] = KS_MAJOR_PROFILE[(((i - root) % 12) + 12) % 12];
    }
    const majorScore = pearson(chroma, rotated);
    if (!best || majorScore > best.score) {
      best = { root, mode: "major", score: majorScore };
    }
    for (let i = 0; i < 12; i++) {
      rotated[i] = KS_MINOR_PROFILE[(((i - root) % 12) + 12) % 12];
    }
    const minorScore = pearson(chroma, rotated);
    if (minorScore > best.score) {
      best = { root, mode: "minor", score: minorScore };
    }
  }
  return best;
}

function renderChroma() {
  for (let i = 0; i < 12; i++) chromaMsg[i + 1] = chromaFast[i];
  outlet(0, chromaMsg);
}

function renderChord() {
  if (!displayedChord) {
    disp("chord", "-");
    disp("chordconf", NBSP);
    return;
  }
  disp("chord", NOTE_NAMES[displayedChord.root] + " " + displayedChord.label);
  const tentative = displayedChord.score < CHORD_STRONG_CONFIDENCE;
  disp("chordconf", Math.round(displayedChord.score * 100) + "% match" +
    (tentative ? " (tentative)" : ""));
}

function updateChord() {
  const candidate = detectChord(chromaFast);

  if (!candidate || candidate.score < CHORD_MIN_CONFIDENCE) {
    pendingChord = null;
    pendingChordCount = 0;
    return;
  }

  const sameAsDisplayed = displayedChord &&
    displayedChord.root === candidate.root &&
    displayedChord.quality === candidate.quality;

  if (sameAsDisplayed) {
    displayedChord = candidate;
    pendingChord = null;
    pendingChordCount = 0;
    renderChord();
    return;
  }

  const sameAsPending = pendingChord &&
    pendingChord.root === candidate.root &&
    pendingChord.quality === candidate.quality;

  if (sameAsPending) {
    pendingChordCount += 1;
  } else {
    pendingChord = candidate;
    pendingChordCount = 1;
  }

  if (pendingChordCount >= CHORD_COMMIT_FRAMES) {
    displayedChord = candidate;
    pendingChord = null;
    pendingChordCount = 0;
    renderChord();
    emitChordEvent(); // protocol event layer: post-hysteresis commit
  }
}

function updateKey() {
  const candidate = detectKey(chromaSlow);
  if (!candidate || candidate.score < KEY_MIN_CONFIDENCE) {
    displayedKey = null;
    disp("key", "-");
    disp("keyconf", NBSP);
    return;
  }
  displayedKey = candidate;
  disp("key", NOTE_NAMES[candidate.root] + " " + candidate.mode);
  const tentative = candidate.score < KEY_STRONG_CONFIDENCE;
  disp("keyconf", Math.round(Math.max(0, candidate.score) * 100) + "% fit" +
    (tentative ? " (tentative)" : ""));
}

// ---------------------------------------------------------------------------
// Harmony bus protocol v1 (see ../PROTOCOL.md)
// ---------------------------------------------------------------------------

function round2(value) {
  return Math.round(value * 100) / 100;
}

function chordTemplateFor(quality) {
  for (let i = 0; i < CHORD_TEMPLATES.length; i++) {
    if (CHORD_TEMPLATES[i].quality === quality) return CHORD_TEMPLATES[i];
  }
  return null;
}

// Web-app semantics kept for contract parity: chord score while a chord is
// displayed, else key score, else 0.
function currentConfidence() {
  if (displayedChord) return round2(displayedChord.score);
  if (displayedKey) return round2(Math.max(0, displayedKey.score));
  return 0;
}

function emitLeadEvent() {
  outlet(1, "lead", currentLeadMidi === null ? -1 : currentLeadMidi, currentConfidence());
}

function clearLead() {
  if (currentLeadMidi === null) return;
  currentLeadMidi = null;
  emitLeadEvent();
}

function emitChordEvent() {
  if (!displayedChord) {
    outlet(1, "chord", -1, "none", 0);
    return;
  }
  const msg = ["chord", displayedChord.root, displayedChord.quality,
    round2(displayedChord.score)];
  const template = chordTemplateFor(displayedChord.quality);
  if (template) {
    for (let i = 0; i < template.intervals.length; i++) {
      msg.push((displayedChord.root + template.intervals[i]) % 12);
    }
  }
  outlet(1, msg);
}

// harmonyState contract - same shape the web app writes to chrome.storage,
// plus the v1 protocol fields v / src / keyConfidence.
function buildHarmonyState(now) {
  const recentOnsets = noteOnsetTimes.filter((time) => now - time <= DENSITY_WINDOW_MS);
  noteOnsetTimes = recentOnsets;
  const density = recentOnsets.length / (DENSITY_WINDOW_MS / 1000);

  const state = {
    v: PROTOCOL_VERSION,
    src: srcId(),
    key: null,
    mode: null,
    scalePitchClasses: [],
    chordRoot: null,
    chordQuality: null,
    chordPitchClasses: [],
    leadNote: currentLeadMidi,
    density: round2(density),
    confidence: 0,
    keyConfidence: displayedKey ? round2(Math.max(0, displayedKey.score)) : 0,
    updatedAt: Date.now()
  };

  if (displayedKey) {
    state.key = NOTE_NAMES[displayedKey.root];
    state.mode = displayedKey.mode;
    const scale = displayedKey.mode === "minor" ? MINOR_SCALE : MAJOR_SCALE;
    state.scalePitchClasses = scale.map((interval) => (displayedKey.root + interval) % 12);
  }

  if (displayedChord) {
    state.chordRoot = NOTE_NAMES[displayedChord.root];
    state.chordQuality = displayedChord.quality;
    const template = chordTemplateFor(displayedChord.quality);
    state.chordPitchClasses = template
      ? template.intervals.map((interval) => (displayedChord.root + interval) % 12)
      : [];
    state.confidence = round2(displayedChord.score);
  } else if (displayedKey) {
    state.confidence = round2(Math.max(0, displayedKey.score));
  }

  return state;
}

// Field-for-field identical to the web app's stateSignature(), computed from
// live analysis state so the per-tick throttle check allocates no state object.
function currentSignature() {
  return [
    displayedKey ? NOTE_NAMES[displayedKey.root] : null,
    displayedKey ? displayedKey.mode : null,
    displayedChord ? NOTE_NAMES[displayedChord.root] : null,
    displayedChord ? displayedChord.quality : null,
    currentLeadMidi
  ].join("|");
}

function emitState(state) {
  outlet(1, "state", JSON.stringify(state));
  outlet(1, "key", state.key === null ? "none" : state.key);
  outlet(1, "mode", state.mode === null ? "none" : state.mode);
  outlet(1, ["scalePitchClasses"].concat(state.scalePitchClasses));
  outlet(1, "chordRoot", state.chordRoot === null ? "none" : state.chordRoot);
  outlet(1, "chordQuality", state.chordQuality === null ? "none" : state.chordQuality);
  outlet(1, ["chordPitchClasses"].concat(state.chordPitchClasses));
  outlet(1, "leadNote", state.leadNote === null ? -1 : state.leadNote);
  outlet(1, "density", state.density);
  outlet(1, "confidence", state.confidence);
  outlet(1, "keyConfidence", state.keyConfidence);
}

// Exact web-app throttle math (changed || stale >= 1 s, min 250 ms spacing),
// but called unconditionally from tick() so idle states flow during silence.
function maybeWriteHarmonyState(now) {
  const signature = currentSignature();
  const changed = signature !== lastStateSignature;
  const stale = now - lastStateWriteAt >= STATE_REFRESH_MS;

  if ((changed || stale) && now - lastStateWriteAt >= STATE_WRITE_MIN_MS) {
    lastStateSignature = signature;
    lastStateWriteAt = now;
    emitState(buildHarmonyState(now));
  }
}

// Lifecycle layer: "hello 1 <src>" + forced full state burst + current
// lead/chord events. Runs on loadbang and on an "announce" message (the patch
// sends "announce" after retargeting the [forward] to a new bus).
function announce() {
  outlet(1, "hello", PROTOCOL_VERSION, srcId());
  const now = Date.now();
  const state = buildHarmonyState(now);
  lastStateSignature = currentSignature();
  lastStateWriteAt = now;
  emitState(state);
  if (currentLeadMidi !== null) emitLeadEvent();
  if (displayedChord) emitChordEvent();
}

// ---------------------------------------------------------------------------
// Reset / silence handling
// ---------------------------------------------------------------------------

function resetHarmony() {
  chromaFast.fill(0);
  chromaSlow.fill(0);
  harmonySilentFrames = 0;
  const hadChord = displayedChord !== null;
  displayedChord = null;
  displayedKey = null;
  pendingChord = null;
  pendingChordCount = 0;
  clearLead();                    // "lead -1" if a lead was showing
  if (hadChord) emitChordEvent(); // "chord -1 none 0" on reset
  noteOnsetTimes = [];
  disp("chord", "-");
  disp("chordconf", NBSP);
  disp("key", "-");
  disp("keyconf", NBSP);
  renderChroma();
  // No direct state write here: the unconditional tick() heartbeat picks up
  // the idle signature within 250 ms (PROTOCOL.md cadence guarantee).
}

function detectHarmony(now, rms) {
  if (rms < HARMONY_RMS_GATE) {
    harmonySilentFrames += 1;
    if (harmonySilentFrames >= HARMONY_SILENCE_FRAMES && displayedChord) {
      resetHarmony();
    }
    return;
  }

  harmonySilentFrames = 0;
  if (!computeChroma()) return;

  renderChroma();
  updateChord();

  if (now - lastKeyAt >= KEY_INTERVAL_MS) {
    lastKeyAt = now;
    updateKey();
  }
  // State emission happens unconditionally in tick(), outside this RMS gate.
}

// ---------------------------------------------------------------------------
// Buffer access + main loop
// ---------------------------------------------------------------------------

function ensureBuffer() {
  if (timeBuf) return true;
  if (!timeBufName) return false;
  try {
    timeBuf = new Buffer(timeBufName);
  } catch (err) {
    timeBuf = null;
    return false;
  }
  return true;
}

function copyPeek(startFrame, count, destOffset) {
  const data = timeBuf.peek(1, startFrame, count);
  if (typeof data === "number") {
    // peek returns a bare float when count is 1
    window8192[destOffset] = data;
    return count === 1;
  }
  if (!data || data.length < count) return false;
  for (let i = 0; i < count; i++) window8192[destOffset + i] = data[i];
  return true;
}

function readWindow() {
  if (!ensureBuffer()) return false;
  const frames = timeBuf.framecount();
  if (!frames || frames < FFT_SIZE) return false;

  const writeIndex = Math.floor(writePhase * frames) % frames;
  let start = writeIndex - FFT_SIZE;
  if (start < 0) start += frames;

  // At most two ranged peeks totaling exactly FFT_SIZE frames (wrap-around) -
  // never a whole-buffer read (the buffer~ is 65536 frames).
  const firstCount = Math.min(FFT_SIZE, frames - start);
  if (!copyPeek(start, firstCount, 0)) return false;
  if (firstCount < FFT_SIZE) {
    if (!copyPeek(0, FFT_SIZE - firstCount, firstCount)) return false;
  }
  return true;
}

function tick() {
  if (!isActive || !dspOn) return;

  const now = Date.now();
  const needPitch = now - lastPitchAt >= PITCH_INTERVAL_MS;
  const needHarmony = now - lastHarmonyAt >= HARMONY_INTERVAL_MS;

  if ((needPitch || needHarmony) && readWindow()) {
    // Same RMS the web app computes in analyze() over the full 8192-sample window.
    let sumSquares = 0;
    for (let i = 0; i < FFT_SIZE; i++) {
      const sample = window8192[i];
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / FFT_SIZE);

    if (needPitch) {
      lastPitchAt = now;
      detectPitch(now);
    }
    if (needHarmony) {
      lastHarmonyAt = now;
      detectHarmony(now, rms);
    }
  }

  // PROTOCOL.md cadence guarantee: the state throttle/heartbeat runs on every
  // tick, OUTSIDE the harmony RMS gate - idle states keep flowing during
  // silence (state at least every 1 s, at most every 250 ms).
  maybeWriteHarmonyState(now);
}

function stopAnalysis(statusText) {
  freqHistoryLen = 0;
  silentFrames = 0;
  clearNoteReadout();
  resetHarmony();
  if (statusText) disp("status", statusText);
}

// ---------------------------------------------------------------------------
// Message handlers (from the patcher)
// ---------------------------------------------------------------------------

const perfNow = (typeof performance !== "undefined" && typeof performance.now === "function")
  ? () => performance.now()
  : () => Date.now();

function bang() {
  if (!perfEnabled) {
    tick();
    return;
  }
  const t0 = perfNow();
  tick();
  perfTickSum += perfNow() - t0;
  perfTickCount += 1;
  const wall = Date.now();
  if (wall - perfWindowStart >= PERF_REPORT_MS) {
    const avg = perfTickCount ? perfTickSum / perfTickCount : 0;
    post("bs.listen perf: avg tick " + avg.toFixed(3) + " ms over " +
      perfTickCount + " ticks\n");
    perfWindowStart = wall;
    perfTickSum = 0;
    perfTickCount = 0;
  }
}

function writephase(value) {
  writePhase = value;
}

function samplerate(value) {
  if (value > 0 && value !== sampleRate) {
    sampleRate = value;
    rebuildBinTables();
  }
}

// Debug override for standalone Max only - the shipped device passes the
// ---name as an object-box argument (message boxes never substitute ---).
function setbuffer(name) {
  timeBufName = String(name);
  timeBuf = null;
  post("bs.listen.js: buffer override -> " + timeBufName + "\n");
}

function dspon(value) {
  const on = value ? 1 : 0;
  if (on === dspOn) return;
  dspOn = on;
  if (!dspOn) {
    stopAnalysis("audio engine off");
  } else if (isActive) {
    disp("status", "listening");
  }
}

function listen(value) {
  const on = value ? 1 : 0;
  if (on === isActive) return;
  isActive = on;
  if (!on) {
    stopAnalysis("stopped");
  } else {
    disp("status", "listening");
  }
}

function perf(value) {
  perfEnabled = value ? 1 : 0;
  perfTickSum = 0;
  perfTickCount = 0;
  perfWindowStart = Date.now();
  post("bs.listen perf: " + (perfEnabled ? "on" : "off") + "\n");
}

function loadbang() {
  clearNoteReadout();
  disp("chord", "-");
  disp("chordconf", NBSP);
  disp("key", "-");
  disp("keyconf", NBSP);
  renderChroma();
  disp("status", "waiting for audio");
  announce();
}
