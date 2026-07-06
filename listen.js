const LISTEN_STORAGE_KEYS = {
  darkMode: "breathsyncDarkMode",
  inputDevice: "breathsyncListenInputDevice"
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
const listenStatus = document.getElementById("listenStatus");
const listenDebug = document.getElementById("listenDebug");

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const PITCH_RMS_GATE = 0.01;
const PITCH_INTERVAL_MS = 60;
const PITCH_HISTORY_SIZE = 5;
const PITCH_SILENCE_FRAMES = 3;

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
  const { frequency } = autoCorrelate(timeData, audioContext.sampleRate);

  if (frequency <= 0) {
    silentFrames += 1;
    if (silentFrames >= PITCH_SILENCE_FRAMES && freqHistory.length) {
      resetReadout();
    }
    return;
  }

  silentFrames = 0;
  freqHistory.push(frequency);
  if (freqHistory.length > PITCH_HISTORY_SIZE) freqHistory.shift();
  renderPitch();
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

  meterRafId = requestAnimationFrame(analyze);
}

function stopMeter() {
  if (meterRafId) {
    cancelAnimationFrame(meterRafId);
    meterRafId = 0;
  }
  meterFill.style.width = "0%";
  resetReadout();
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
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.6;
  timeData = new Float32Array(analyser.fftSize);
  sourceNode.connect(analyser);
  lastPitchAt = 0;
  freqHistory = [];
  silentFrames = 0;

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
