const LISTEN_STORAGE_KEYS = {
  darkMode: "breathsyncDarkMode",
  inputDevice: "breathsyncListenInputDevice",
  harmonyState: "breathsyncHarmonyState"
};

const hasChromeStorage =
  typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;

const toggleListenButton = document.getElementById("toggleListen");
const rescanButton = document.getElementById("rescanDevices");
const inputDeviceSelect = document.getElementById("inputDevice");
const darkModeToggle = document.getElementById("darkModeToggle");
const meterFill = document.getElementById("meterFill");
const noteNameEl = document.getElementById("noteName");
const noteOctaveEl = document.getElementById("noteOctave");
const noteFreqEl = document.getElementById("noteFreq");
const tuningNeedle = document.getElementById("tuningNeedle");
const tuningCents = document.getElementById("tuningCents");
const chordNameEl = document.getElementById("chordName");
const chordConfidenceEl = document.getElementById("chordConfidence");
const keyNameEl = document.getElementById("keyName");
const keyConfidenceEl = document.getElementById("keyConfidence");
const chromaContainer = document.getElementById("chroma");
const listenStatus = document.getElementById("listenStatus");
const listenDebug = document.getElementById("listenDebug");

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

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
const DENSITY_WINDOW_MS = 4000;
const STATE_WRITE_MIN_MS = 250;
const STATE_REFRESH_MS = 1000;

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

let audioContext = null;
let analyser = null;
let mediaStream = null;
let sourceNode = null;
let timeData = null;
let meterRafId = 0;
let listening = false;
let selectedDeviceId = "";
let darkModeEnabled = false;
let lastPitchAt = 0;
let freqHistory = [];
let silentFrames = 0;
let freqData = null;
let binFrequencies = null;
let binPitchClasses = null;
let chromaFast = new Float32Array(12);
let chromaSlow = new Float32Array(12);
let chromaBarFills = [];
let chromaBarNodes = [];
let lastHarmonyAt = 0;
let lastKeyAt = 0;
let harmonySilentFrames = 0;
let displayedChord = null;
let displayedKey = null;
let pendingChord = null;
let pendingChordCount = 0;
let currentLeadMidi = null;
let noteOnsetTimes = [];
let lastStateSignature = "";
let lastStateWriteAt = 0;

function setStatus(text) {
  listenStatus.textContent = text;
}

function setDebug(text) {
  listenDebug.textContent = text;
}

function applyDarkMode() {
  document.body.classList.toggle("dark-mode", darkModeEnabled);
  if (darkModeToggle) darkModeToggle.checked = darkModeEnabled;
}

async function persistDarkMode() {
  darkModeEnabled = darkModeToggle.checked;
  applyDarkMode();
  if (!hasChromeStorage) return;
  await chrome.storage.local.set({
    [LISTEN_STORAGE_KEYS.darkMode]: darkModeEnabled
  });
}

async function persistInputDevice() {
  if (!hasChromeStorage) return;
  await chrome.storage.local.set({
    [LISTEN_STORAGE_KEYS.inputDevice]: selectedDeviceId
  });
}

function setLiveState(isLive) {
  listening = isLive;
  toggleListenButton.textContent = isLive ? "Stop listening" : "Start listening";
  toggleListenButton.classList.toggle("is-live", isLive);
}

function autoCorrelate(buffer, sampleRate) {
  const size = buffer.length;
  let sumSquares = 0;
  for (let index = 0; index < size; index += 1) {
    const sample = buffer[index];
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / size);
  if (rms < PITCH_RMS_GATE) return { frequency: -1, rms };

  let start = 0;
  let end = size - 1;
  const edgeThreshold = 0.2;
  for (let index = 0; index < size / 2; index += 1) {
    if (Math.abs(buffer[index]) < edgeThreshold) {
      start = index;
      break;
    }
  }
  for (let index = 1; index < size / 2; index += 1) {
    if (Math.abs(buffer[size - index]) < edgeThreshold) {
      end = size - index;
      break;
    }
  }

  const trimmed = buffer.subarray(start, end);
  const trimmedSize = trimmed.length;
  if (trimmedSize < 32) return { frequency: -1, rms };

  const correlations = new Float32Array(trimmedSize);
  for (let lag = 0; lag < trimmedSize; lag += 1) {
    let sum = 0;
    for (let index = 0; index < trimmedSize - lag; index += 1) {
      sum += trimmed[index] * trimmed[index + lag];
    }
    correlations[lag] = sum;
  }

  let lag = 0;
  while (lag < trimmedSize - 1 && correlations[lag] > correlations[lag + 1]) {
    lag += 1;
  }

  let peakValue = -Infinity;
  let peakLag = -1;
  for (let index = lag; index < trimmedSize; index += 1) {
    if (correlations[index] > peakValue) {
      peakValue = correlations[index];
      peakLag = index;
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

  const frequency = sampleRate / refinedLag;
  if (!Number.isFinite(frequency) || frequency < 40 || frequency > 4200) {
    return { frequency: -1, rms };
  }

  return { frequency, rms };
}

function median(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
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

function resetReadout() {
  freqHistory = [];
  silentFrames = 0;
  noteNameEl.innerHTML = "&mdash;";
  noteOctaveEl.textContent = "";
  noteFreqEl.textContent = "";
  tuningNeedle.style.left = "50%";
  tuningNeedle.classList.remove("in-tune");
  tuningCents.textContent = "Melody: waiting for a clear note.";
}

function renderPitch() {
  const smoothed = median(freqHistory);
  if (smoothed <= 0) return;

  const pitch = describePitch(smoothed);
  if (currentLeadMidi !== pitch.midi) {
    noteOnsetTimes.push(performance.now());
    currentLeadMidi = pitch.midi;
  }
  noteNameEl.textContent = pitch.name;
  noteOctaveEl.textContent = String(pitch.octave);
  noteFreqEl.textContent = `${smoothed.toFixed(1)} Hz`;

  const needlePercent = Math.max(0, Math.min(100, 50 + pitch.cents));
  tuningNeedle.style.left = `${needlePercent}%`;
  const inTune = Math.abs(pitch.cents) <= 5;
  tuningNeedle.classList.toggle("in-tune", inTune);

  const sign = pitch.cents > 0 ? "+" : "";
  tuningCents.textContent = inTune
    ? `Melody: ${pitch.name}${pitch.octave} in tune`
    : `Melody: ${pitch.name}${pitch.octave} ${sign}${pitch.cents} cents`;
}

function detectPitch() {
  const window = timeData.length > PITCH_WINDOW ? timeData.subarray(0, PITCH_WINDOW) : timeData;
  const { frequency } = autoCorrelate(window, audioContext.sampleRate);

  if (frequency <= 0) {
    silentFrames += 1;
    if (silentFrames >= PITCH_SILENCE_FRAMES && freqHistory.length) {
      freqHistory = [];
      currentLeadMidi = null;
      noteNameEl.innerHTML = "&mdash;";
      noteOctaveEl.textContent = "";
      noteFreqEl.textContent = "";
      tuningNeedle.style.left = "50%";
      tuningNeedle.classList.remove("in-tune");
      tuningCents.textContent = "Melody: waiting for a clear note.";
    }
    return;
  }

  silentFrames = 0;
  freqHistory.push(frequency);
  if (freqHistory.length > PITCH_HISTORY_SIZE) freqHistory.shift();
  renderPitch();
}

function buildChromaBars() {
  chromaContainer.innerHTML = "";
  chromaBarFills = [];
  chromaBarNodes = [];

  NOTE_NAMES.forEach((name) => {
    const bar = document.createElement("div");
    bar.className = "chroma-bar";

    const fill = document.createElement("span");
    fill.className = "chroma-fill";

    const label = document.createElement("span");
    label.className = "chroma-label";
    label.textContent = name;

    bar.appendChild(fill);
    bar.appendChild(label);
    chromaContainer.appendChild(bar);
    chromaBarFills.push(fill);
    chromaBarNodes.push(bar);
  });
}

function precomputeBinTables() {
  const binCount = analyser.frequencyBinCount;
  const nyquistStep = audioContext.sampleRate / analyser.fftSize;
  freqData = new Float32Array(binCount);
  binFrequencies = new Float32Array(binCount);
  binPitchClasses = new Int8Array(binCount);

  for (let index = 0; index < binCount; index += 1) {
    const frequency = index * nyquistStep;
    binFrequencies[index] = frequency;
    if (frequency < CHROMA_MIN_FREQ || frequency > CHROMA_MAX_FREQ) {
      binPitchClasses[index] = -1;
    } else {
      const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
      binPitchClasses[index] = ((midi % 12) + 12) % 12;
    }
  }
}

function computeChroma() {
  analyser.getFloatFrequencyData(freqData);

  const raw = new Float32Array(12);
  let total = 0;
  for (let index = 0; index < freqData.length; index += 1) {
    const pitchClass = binPitchClasses[index];
    if (pitchClass < 0) continue;
    const magnitude = 10 ** (freqData[index] / 20);
    raw[pitchClass] += magnitude;
    total += magnitude;
  }

  if (total <= 0) return false;

  let maxBin = 0;
  for (let index = 0; index < 12; index += 1) {
    raw[index] /= total;
    if (raw[index] > maxBin) maxBin = raw[index];
  }

  for (let index = 0; index < 12; index += 1) {
    const normalized = maxBin > 0 ? raw[index] / maxBin : 0;
    chromaFast[index] =
      CHROMA_FAST_ALPHA * normalized + (1 - CHROMA_FAST_ALPHA) * chromaFast[index];
    chromaSlow[index] =
      CHROMA_SLOW_ALPHA * normalized + (1 - CHROMA_SLOW_ALPHA) * chromaSlow[index];
  }

  return true;
}

function detectChord(chroma) {
  let chromaNorm = 0;
  for (let index = 0; index < 12; index += 1) chromaNorm += chroma[index] * chroma[index];
  chromaNorm = Math.sqrt(chromaNorm);
  if (chromaNorm < 1e-6) return null;

  let best = null;
  for (let root = 0; root < 12; root += 1) {
    for (let templateIndex = 0; templateIndex < CHORD_TEMPLATES.length; templateIndex += 1) {
      const template = CHORD_TEMPLATES[templateIndex];
      let dot = 0;
      for (let toneIndex = 0; toneIndex < template.intervals.length; toneIndex += 1) {
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
  for (let index = 0; index < 12; index += 1) {
    meanA += a[index];
    meanB += b[index];
  }
  meanA /= 12;
  meanB /= 12;

  let numerator = 0;
  let varA = 0;
  let varB = 0;
  for (let index = 0; index < 12; index += 1) {
    const devA = a[index] - meanA;
    const devB = b[index] - meanB;
    numerator += devA * devB;
    varA += devA * devA;
    varB += devB * devB;
  }
  if (varA === 0 || varB === 0) return 0;
  return numerator / Math.sqrt(varA * varB);
}

function detectKey(chroma) {
  const rotated = new Float32Array(12);
  let best = null;

  for (let root = 0; root < 12; root += 1) {
    for (let index = 0; index < 12; index += 1) {
      rotated[index] = KS_MAJOR_PROFILE[((index - root) % 12 + 12) % 12];
    }
    const majorScore = pearson(chroma, rotated);
    if (!best || majorScore > best.score) {
      best = { root, mode: "major", score: majorScore };
    }

    for (let index = 0; index < 12; index += 1) {
      rotated[index] = KS_MINOR_PROFILE[((index - root) % 12 + 12) % 12];
    }
    const minorScore = pearson(chroma, rotated);
    if (minorScore > best.score) {
      best = { root, mode: "minor", score: minorScore };
    }
  }

  return best;
}

function renderChroma() {
  for (let index = 0; index < 12; index += 1) {
    const height = Math.max(2, Math.round(chromaFast[index] * 100));
    chromaBarFills[index].style.height = `${height}%`;
    chromaBarNodes[index].classList.toggle("is-peak", chromaFast[index] >= 0.85);
  }
}

function renderChord() {
  if (!displayedChord) {
    chordNameEl.innerHTML = "&mdash;";
    chordNameEl.classList.remove("is-tentative");
    chordConfidenceEl.textContent = "";
    return;
  }
  chordNameEl.textContent = `${NOTE_NAMES[displayedChord.root]} ${displayedChord.label}`;
  const tentative = displayedChord.score < CHORD_STRONG_CONFIDENCE;
  chordNameEl.classList.toggle("is-tentative", tentative);
  chordConfidenceEl.textContent = `${Math.round(displayedChord.score * 100)}% match${
    tentative ? " · tentative" : ""
  }`;
}

function updateChord() {
  const candidate = detectChord(chromaFast);

  if (!candidate || candidate.score < CHORD_MIN_CONFIDENCE) {
    pendingChord = null;
    pendingChordCount = 0;
    return;
  }

  const sameAsDisplayed =
    displayedChord &&
    displayedChord.root === candidate.root &&
    displayedChord.quality === candidate.quality;

  if (sameAsDisplayed) {
    displayedChord = candidate;
    pendingChord = null;
    pendingChordCount = 0;
    renderChord();
    return;
  }

  const sameAsPending =
    pendingChord &&
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
  }
}

function updateKey() {
  const candidate = detectKey(chromaSlow);
  if (!candidate || candidate.score < KEY_MIN_CONFIDENCE) {
    displayedKey = null;
    keyNameEl.innerHTML = "&mdash;";
    keyNameEl.classList.remove("is-tentative");
    keyConfidenceEl.textContent = "";
    return;
  }
  displayedKey = candidate;
  keyNameEl.textContent = `${NOTE_NAMES[candidate.root]} ${candidate.mode}`;
  const tentative = candidate.score < KEY_STRONG_CONFIDENCE;
  keyNameEl.classList.toggle("is-tentative", tentative);
  keyConfidenceEl.textContent = `${Math.round(Math.max(0, candidate.score) * 100)}% fit${
    tentative ? " · tentative" : ""
  }`;
}

function buildHarmonyState(now) {
  const recentOnsets = noteOnsetTimes.filter((time) => now - time <= DENSITY_WINDOW_MS);
  noteOnsetTimes = recentOnsets;
  const density = recentOnsets.length / (DENSITY_WINDOW_MS / 1000);

  const state = {
    key: null,
    mode: null,
    scalePitchClasses: [],
    chordRoot: null,
    chordQuality: null,
    chordPitchClasses: [],
    leadNote: currentLeadMidi,
    density: Math.round(density * 100) / 100,
    confidence: 0,
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
    const template = CHORD_TEMPLATES.find((entry) => entry.quality === displayedChord.quality);
    state.chordPitchClasses = template
      ? template.intervals.map((interval) => (displayedChord.root + interval) % 12)
      : [];
    state.confidence = Math.round(displayedChord.score * 100) / 100;
  } else if (displayedKey) {
    state.confidence = Math.round(Math.max(0, displayedKey.score) * 100) / 100;
  }

  return state;
}

function stateSignature(state) {
  return [
    state.key,
    state.mode,
    state.chordRoot,
    state.chordQuality,
    state.leadNote
  ].join("|");
}

function maybeWriteHarmonyState(now) {
  if (!hasChromeStorage) return;

  const state = buildHarmonyState(now);
  const signature = stateSignature(state);
  const changed = signature !== lastStateSignature;
  const stale = now - lastStateWriteAt >= STATE_REFRESH_MS;

  if ((changed || stale) && now - lastStateWriteAt >= STATE_WRITE_MIN_MS) {
    lastStateSignature = signature;
    lastStateWriteAt = now;
    chrome.storage.local.set({ [LISTEN_STORAGE_KEYS.harmonyState]: state });
  }
}

function writeIdleHarmonyState(now) {
  if (!hasChromeStorage) return;
  const idleSignature = "idle";
  if (lastStateSignature === idleSignature) return;
  lastStateSignature = idleSignature;
  lastStateWriteAt = now;
  chrome.storage.local.set({
    [LISTEN_STORAGE_KEYS.harmonyState]: {
      key: null,
      mode: null,
      scalePitchClasses: [],
      chordRoot: null,
      chordQuality: null,
      chordPitchClasses: [],
      leadNote: null,
      density: 0,
      confidence: 0,
      updatedAt: Date.now()
    }
  });
}

function resetHarmony() {
  chromaFast = new Float32Array(12);
  chromaSlow = new Float32Array(12);
  harmonySilentFrames = 0;
  displayedChord = null;
  displayedKey = null;
  pendingChord = null;
  pendingChordCount = 0;
  currentLeadMidi = null;
  noteOnsetTimes = [];
  chordNameEl.innerHTML = "&mdash;";
  chordNameEl.classList.remove("is-tentative");
  chordConfidenceEl.textContent = "";
  keyNameEl.innerHTML = "&mdash;";
  keyNameEl.classList.remove("is-tentative");
  keyConfidenceEl.textContent = "";
  chromaBarFills.forEach((fill) => {
    fill.style.height = "2%";
  });
  chromaBarNodes.forEach((bar) => bar.classList.remove("is-peak"));
  writeIdleHarmonyState(performance.now());
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

  maybeWriteHarmonyState(now);
}

function analyze(timestamp) {
  if (!analyser || !timeData) return;

  analyser.getFloatTimeDomainData(timeData);

  let sumSquares = 0;
  for (let index = 0; index < timeData.length; index += 1) {
    const sample = timeData[index];
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / timeData.length);
  const level = Math.max(0, Math.min(1, rms * 4));
  meterFill.style.width = `${Math.round(level * 100)}%`;

  const now = typeof timestamp === "number" ? timestamp : performance.now();
  if (now - lastPitchAt >= PITCH_INTERVAL_MS) {
    lastPitchAt = now;
    detectPitch();
  }

  if (now - lastHarmonyAt >= HARMONY_INTERVAL_MS) {
    lastHarmonyAt = now;
    detectHarmony(now, rms);
  }

  meterRafId = requestAnimationFrame(analyze);
}

function stopMeter() {
  if (meterRafId) {
    cancelAnimationFrame(meterRafId);
    meterRafId = 0;
  }
  meterFill.style.width = "0%";
  resetReadout();
  resetHarmony();
}

function releaseStream() {
  stopMeter();

  if (sourceNode) {
    try {
      sourceNode.disconnect();
    } catch (error) {
      // Node may already be disconnected.
    }
    sourceNode = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  if (audioContext) {
    audioContext.close().catch(() => {});
    audioContext = null;
  }

  analyser = null;
  timeData = null;
}

async function populateDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    setDebug("Inputs: device enumeration unavailable in this browser.");
    return;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((device) => device.kind === "audioinput");

    inputDeviceSelect.innerHTML = '<option value="">Default input</option>';
    inputs.forEach((device, index) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label || `Audio input ${index + 1}`;
      inputDeviceSelect.appendChild(option);
    });

    const hasSelected = inputs.some((device) => device.deviceId === selectedDeviceId);
    inputDeviceSelect.value = hasSelected ? selectedDeviceId : "";

    setDebug(
      inputs.length
        ? `Inputs: ${inputs
            .map((device, index) => device.label || `Audio input ${index + 1}`)
            .join(", ")}`
        : "Inputs: none detected."
    );
  } catch (error) {
    setDebug(`Inputs: scan failed (${error.name || "unknown error"}).`);
  }
}

function buildConstraints() {
  const audioConstraints = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false
  };

  if (selectedDeviceId) {
    audioConstraints.deviceId = { exact: selectedDeviceId };
  }

  return { audio: audioConstraints, video: false };
}

async function startListening() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus("Audio capture unavailable in this browser.");
    setDebug("Inputs: getUserMedia is not supported here.");
    return;
  }

  setStatus("Requesting microphone access...");

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia(buildConstraints());
  } catch (error) {
    mediaStream = null;
    const name = error.name || "unknown error";
    if (name === "NotAllowedError" || name === "SecurityError") {
      setStatus("Microphone access was blocked.");
      setDebug("Inputs: allow microphone for this extension, then try again.");
    } else if (name === "NotFoundError" || name === "OverconstrainedError") {
      setStatus("Selected audio input is unavailable.");
      setDebug(`Inputs: ${name}. Pick a different input and retry.`);
    } else {
      setStatus("Could not start audio capture.");
      setDebug(`Inputs: ${name}${error.message ? ` - ${error.message}` : ""}`);
    }
    return;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    setStatus("Web Audio unavailable in this browser.");
    releaseStream();
    return;
  }

  audioContext = new AudioContextClass();
  if (audioContext.state === "suspended") {
    await audioContext.resume().catch(() => {});
  }

  sourceNode = audioContext.createMediaStreamSource(mediaStream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0.5;
  timeData = new Float32Array(analyser.fftSize);
  sourceNode.connect(analyser);
  precomputeBinTables();
  lastPitchAt = 0;
  lastHarmonyAt = 0;
  lastKeyAt = 0;
  freqHistory = [];
  silentFrames = 0;
  resetHarmony();

  const activeTrack = mediaStream.getAudioTracks()[0];
  const trackLabel = activeTrack ? activeTrack.label || "audio input" : "audio input";

  setLiveState(true);
  setStatus(`Listening: ${trackLabel}`);
  meterRafId = requestAnimationFrame(analyze);

  await populateDevices();
}

function stopListening() {
  releaseStream();
  setLiveState(false);
  setStatus("Stopped listening.");
  setDebug("Press Start listening to grant microphone access.");
}

async function toggleListening() {
  if (listening) {
    stopListening();
  } else {
    await startListening();
  }
}

toggleListenButton.addEventListener("click", toggleListening);

rescanButton.addEventListener("click", populateDevices);

inputDeviceSelect.addEventListener("change", async () => {
  selectedDeviceId = inputDeviceSelect.value;
  await persistInputDevice();
  if (listening) {
    releaseStream();
    setLiveState(false);
    await startListening();
  }
});

darkModeToggle.addEventListener("change", persistDarkMode);

window.addEventListener("beforeunload", releaseStream);

buildChromaBars();

if (hasChromeStorage) {
  chrome.storage.local.get(
    {
      [LISTEN_STORAGE_KEYS.darkMode]: false,
      [LISTEN_STORAGE_KEYS.inputDevice]: ""
    },
    (data) => {
      darkModeEnabled = Boolean(data[LISTEN_STORAGE_KEYS.darkMode]);
      selectedDeviceId = data[LISTEN_STORAGE_KEYS.inputDevice] || "";
      applyDarkMode();
      populateDevices();
    }
  );

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[LISTEN_STORAGE_KEYS.darkMode]) {
      darkModeEnabled = Boolean(changes[LISTEN_STORAGE_KEYS.darkMode].newValue);
      applyDarkMode();
    }
  });
} else {
  applyDarkMode();
  populateDevices();
}
