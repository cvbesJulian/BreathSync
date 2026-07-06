const STORAGE_KEYS = {
  running: "breathsyncRunning",
  launchDefaultsVersion: "breathsyncLaunchDefaultsVersion",
  technique: "breathsyncTechnique",
  cycleStartedAt: "breathsyncCycleStartedAt",
  sound: "breathsyncSound",
  soundDefaultMigrated: "breathsyncSoundDefaultSilentMigrated",
  darkMode: "breathsyncDarkMode",
  soundPreset: "breathsyncSoundPreset",
  masterVolume: "breathsyncMasterVolume",
  volume: "breathsyncVolume",
  volumeTouched: "breathsyncVolumeTouched",
  ambientEnabled: "breathsyncAmbientEnabled",
  fountainVolume: "breathsyncFountainVolume",
  rainVolume: "breathsyncRainVolume",
  kidsVolume: "breathsyncKidsVolume",
  ambientDebug: "breathsyncAmbientDebug",
  temperature: "breathsyncTemperature",
  reverb: "breathsyncReverb",
  binaural: "breathsyncBinaural",
  space: "breathsyncSpace",
  tick: "breathsyncTick",
  tickVolume: "breathsyncTickVolume",
  tickVolumeTouched: "breathsyncTickVolumeTouched",
  midi: "breathsyncMidi",
  midiOutput: "breathsyncMidiOutput",
  midiOutputLabel: "breathsyncMidiOutputLabel",
  activeTabId: "breathsyncActiveTabId",
  muted: "breathsyncMuted",
  widgetX: "breathsyncWidgetX",
  widgetY: "breathsyncWidgetY"
};
const PALETTE_FADE_IN_SECONDS = 1.5;

const TECHNIQUES = {
  focus: {
    label: "Focus",
    subtitle: "Box breathing",
    inhale: 4,
    holdIn: 4,
    exhale: 4,
    holdOut: 4
  },
  relax: {
    label: "Relax",
    subtitle: "4-7-8 breathing",
    inhale: 4,
    holdIn: 7,
    exhale: 8,
    holdOut: 0
  },
  sleep: {
    label: "Sleep",
    subtitle: "Slow diaphragmatic",
    inhale: 5,
    holdIn: 0,
    exhale: 7,
    holdOut: 0
  },
  reset: {
    label: "Reset",
    subtitle: "Physiological sigh",
    inhale: 2,
    holdIn: 0,
    exhale: 6,
    holdOut: 0
  },
  performance: {
    label: "Performance",
    subtitle: "Rhythmic nasal breathing",
    inhale: 3,
    holdIn: 0,
    exhale: 3,
    holdOut: 0
  }
};

const LAUNCH_DEFAULTS_VERSION = "2026-05-04-v8";
const DEFAULT_AMBIENT_VOLUME = 0.15;
const PALETTE_REFERENCE_VOLUME = 0.25;
const PALETTE_REFERENCE_GAIN = 0.88;
const PALETTE_LUFS_RANGE_DB = 5;
const AMBIENT_SAMPLES = {
  fountain: { url: "Sound_FX/Fountain.wav", level: 1.87, crossfade: 3.2 },
  rain: { url: "Sound_FX/Rain.wav", level: 0.746, crossfade: 3.2 },
  kids: { url: "Sound_FX/Kids_Playing.wav", level: 0.547, crossfade: 2.8 }
};

const techniqueSelect = document.getElementById("technique");
const soundToggle = document.getElementById("soundToggle");
const darkModeToggle = document.getElementById("darkModeToggle");
const darkModeLabel = document.getElementById("darkModeLabel");
const soundPreset = document.getElementById("soundPreset");
const ambientToggle = document.getElementById("ambientToggle");
const fountainVolumeControl = document.getElementById("fountainVolumeControl");
const fountainVolumeValue = document.getElementById("fountainVolumeValue");
const rainVolumeControl = document.getElementById("rainVolumeControl");
const rainVolumeValue = document.getElementById("rainVolumeValue");
const kidsVolumeControl = document.getElementById("kidsVolumeControl");
const kidsVolumeValue = document.getElementById("kidsVolumeValue");
const masterVolumeControl = document.getElementById("masterVolumeControl");
const masterVolumeValue = document.getElementById("masterVolumeValue");
const volumeControl = document.getElementById("volumeControl");
const volumeValue = document.getElementById("volumeValue");
const temperatureControl = document.getElementById("temperatureControl");
const temperatureValue = document.getElementById("temperatureValue");
const reverbControl = document.getElementById("reverbControl");
const reverbValue = document.getElementById("reverbValue");
const binauralToggle = document.getElementById("binauralToggle");
const spaceControl = document.getElementById("spaceControl");
const spaceValue = document.getElementById("spaceValue");
const tickToggle = document.getElementById("tickToggle");
const tickVolumeControl = document.getElementById("tickVolumeControl");
const tickVolumeValue = document.getElementById("tickVolumeValue");
const midiToggle = document.getElementById("midiToggle");
const midiOutput = document.getElementById("midiOutput");
const midiTest = document.getElementById("midiTest");
const midiStatus = document.getElementById("midiStatus");
const midiDebug = document.getElementById("midiDebug");
const openListen = document.getElementById("openListen");
const toggleWidget = document.getElementById("toggleWidget");
const stopWidget = document.getElementById("stopWidget");
const guideStatus = document.getElementById("guideStatus");
const previewOrb = document.getElementById("previewOrb");
const phaseLabel = document.getElementById("phaseLabel");
const sliderControls = [
  fountainVolumeControl,
  rainVolumeControl,
  kidsVolumeControl,
  masterVolumeControl,
  volumeControl,
  temperatureControl,
  reverbControl,
  spaceControl,
  tickVolumeControl
].filter(Boolean);

let previewTimeouts = [];
let previewInterval = null;
let running = false;
let soundEnabled = false;
let cycleStartedAt = 0;
let darkModeEnabled = false;
let currentSoundPreset = "tide";
let ambientEnabled = false;
let fountainVolume = 0;
let rainVolume = 0;
let kidsVolume = 0;
let mixMasterVolume = 0.5;
let soundVolume = 0.35;
let temperature = 0;
let reverbAmount = 0.8;
let binauralEnabled = false;
let spaceAmount = 0.5;
let tickEnabled = false;
let tickVolume = 0.35;
let midiEnabled = false;
let midiOutputId = "";
let midiOutputLabel = "";
let muted = false;
let volumeTouched = false;
let tickVolumeTouched = false;
let localWidgetX = NaN;
let localWidgetY = NaN;
let masterVolumeScale = 1;
let techniqueTransitionTimer = null;
let audioContext = null;
let mixOutputGain = null;
let masterGain = null;
let dryGain = null;
let reverbGain = null;
let reverbNode = null;
let reverbDelay = null;
let pingPongGain = null;
let binauralGain = null;
let binauralDelayLeft = null;
let binauralDelayRight = null;
let binauralPanLeft = null;
let binauralPanRight = null;
let binauralHrtfGain = null;
let binauralPanner = null;
let activeSound = null;
let reversedPianoBuffer = null;
let tickTimeouts = [];
let midiAccess = null;
let midiOut = null;
let midiNoteTimers = [];
let midiSendCount = 0;
let feedbackChimeActive = false;
let paletteFadeTimer = null;
let ambientElements = {};
let ambientRampTimers = {};
const sliderMotionTimers = new WeakMap();

const storage = createStorageAdapter();
const isExtensionRuntime =
  typeof chrome !== "undefined" &&
  chrome.runtime &&
  chrome.runtime.id &&
  location.protocol === "chrome-extension:";

function createStorageAdapter() {
  const hasChromeStorage =
    typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;

  if (hasChromeStorage) {
    return {
      get(defaults, callback) {
        chrome.storage.local.get(defaults, callback);
      },
      set(values) {
        return chrome.storage.local.set(values);
      },
      onChanged(callback) {
        chrome.storage.onChanged.addListener(callback);
      }
    };
  }

  return {
    get(defaults, callback) {
      const data = { ...defaults };
      Object.keys(defaults).forEach((key) => {
        const value = localStorage.getItem(key);
        if (value === "true") data[key] = true;
        if (value === "false") data[key] = false;
        if (value && value !== "true" && value !== "false") data[key] = value;
      });
      callback(data);
    },
    set(values) {
      const changes = {};
      Object.entries(values).forEach(([key, value]) => {
        const oldValue = localStorage.getItem(key);
        localStorage.setItem(key, String(value));
        changes[key] = { oldValue, newValue: value };
      });
      window.dispatchEvent(
        new CustomEvent("breathsync-storage-change", { detail: changes })
      );
      return Promise.resolve();
    },
    onChanged(callback) {
      window.addEventListener("breathsync-storage-change", (event) => {
        callback(event.detail, "local");
      });
    }
  };
}

function clearPreviewTimers() {
  previewTimeouts.forEach((timerId) => clearTimeout(timerId));
  previewTimeouts = [];
}

function setPreviewPhase(label, scale, duration, glow) {
  phaseLabel.textContent = label;
  previewOrb.style.transitionDuration = `${duration}s`;
  previewOrb.style.transform = `scale(${scale})`;
  previewOrb.style.opacity = label === "Exhale" ? "0.58" : "1";
  previewOrb.style.filter = glow ? "brightness(1.04)" : "brightness(1)";
  if (!isExtensionRuntime || !running) {
    setBinauralPosition(label);
    routeLocalPhaseMidi(label, duration);
    playLocalPhaseSound(label, duration);
    startLocalTickPattern(label, duration);
  }
  updateLocalDemoWidget();
}

function ensureLocalAudio() {
  if (
    muted ||
    (!feedbackChimeActive && !soundEnabled && !tickEnabled)
  ) {
    return null;
  }

  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;

    audioContext = new AudioContextClass();
    mixOutputGain = audioContext.createGain();
    masterGain = audioContext.createGain();
    dryGain = audioContext.createGain();
    reverbGain = audioContext.createGain();
    reverbDelay = audioContext.createDelay(0.2);
    pingPongGain = audioContext.createGain();
    const pingInput = audioContext.createGain();
    const pingDelayLeft = audioContext.createDelay(1);
    const pingDelayRight = audioContext.createDelay(1);
    const pingFeedback = audioContext.createGain();
    const pingPanLeft = audioContext.createStereoPanner();
    const pingPanRight = audioContext.createStereoPanner();
    binauralGain = audioContext.createGain();
    binauralDelayLeft = audioContext.createDelay(0.05);
    binauralDelayRight = audioContext.createDelay(0.05);
    binauralPanLeft = audioContext.createStereoPanner();
    binauralPanRight = audioContext.createStereoPanner();
    binauralHrtfGain = audioContext.createGain();
    binauralPanner = audioContext.createPanner();
    reverbNode = audioContext.createConvolver();

    mixOutputGain.gain.value = Math.max(0, Math.min(1, mixMasterVolume));
    masterGain.gain.value = getScaledMasterVolume();
    dryGain.gain.value = 0.46;
    reverbGain.gain.value = getReverbWetLevel();
    reverbDelay.delayTime.value = 0.045;
    pingPongGain.gain.value = 0.25;
    pingDelayLeft.delayTime.value = 0.28;
    pingDelayRight.delayTime.value = 0.42;
    pingFeedback.gain.value = 0.26;
    pingPanLeft.pan.value = -0.75;
    pingPanRight.pan.value = 0.75;
    applyBinauralSpace();
    reverbNode.buffer = createLargeReverbImpulse(
      audioContext,
      getReverbDuration(),
      getReverbDecay()
    );

    masterGain.connect(dryGain);
    masterGain.connect(reverbDelay);
    masterGain.connect(pingInput);
    reverbDelay.connect(reverbNode);
    dryGain.connect(mixOutputGain);
    reverbNode.connect(reverbGain);
    reverbGain.connect(mixOutputGain);
    pingInput.connect(pingDelayLeft);
    pingDelayLeft.connect(pingPanLeft);
    pingDelayLeft.connect(pingDelayRight);
    pingDelayRight.connect(pingPanRight);
    pingDelayRight.connect(pingFeedback);
    pingFeedback.connect(pingDelayLeft);
    pingPanLeft.connect(pingPongGain);
    pingPanRight.connect(pingPongGain);
    pingPongGain.connect(mixOutputGain);
    masterGain.connect(binauralDelayLeft);
    masterGain.connect(binauralDelayRight);
    binauralDelayLeft.connect(binauralPanLeft);
    binauralDelayRight.connect(binauralPanRight);
    binauralPanLeft.connect(binauralGain);
    binauralPanRight.connect(binauralGain);
    binauralGain.connect(mixOutputGain);
    binauralPanner.panningModel = "HRTF";
    binauralPanner.distanceModel = "inverse";
    binauralPanner.refDistance = 1;
    binauralPanner.maxDistance = 10;
    binauralPanner.rolloffFactor = 0.65;
    binauralPanner.coneInnerAngle = 360;
    binauralPanner.coneOuterAngle = 360;
    masterGain.connect(binauralPanner);
    binauralPanner.connect(binauralHrtfGain);
    binauralHrtfGain.connect(mixOutputGain);
    mixOutputGain.connect(audioContext.destination);
  }

  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }

  return audioContext;
}

function playFeedbackChime(kind = "welcome") {
  feedbackChimeActive = true;
  const context = ensureLocalAudio();
  feedbackChimeActive = false;
  if (!context) return;

  const now = context.currentTime;
  const output = context.createGain();
  const notes = kind === "enabled" ? [329.63, 440, 587.33] : [293.66, 369.99, 493.88];
  const outputPeak = kind === "welcome" ? 0.028 : 0.095;
  const voicePeak = kind === "welcome" ? 0.16 : 0.36;

  output.gain.setValueAtTime(0.0001, now);
  output.gain.linearRampToValueAtTime(outputPeak, now + 0.18);
  output.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
  output.connect(context.destination);

  notes.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startAt = now + index * 0.11;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.linearRampToValueAtTime(voicePeak / (index + 1), startAt + 0.24);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 1.25);
    oscillator.connect(gain);
    gain.connect(output);
    oscillator.start(startAt);
    oscillator.stop(startAt + 1.35);
  });
}

function getScaledMasterVolume() {
  const volume = Math.max(0, Math.min(1, soundVolume));
  if (volume <= 0.001) return 0;
  if (volume <= PALETTE_REFERENCE_VOLUME) {
    return (
      PALETTE_REFERENCE_GAIN *
      (volume / PALETTE_REFERENCE_VOLUME) *
      masterVolumeScale
    );
  }

  const dbOffset =
    ((volume - PALETTE_REFERENCE_VOLUME) / (1 - PALETTE_REFERENCE_VOLUME)) *
    PALETTE_LUFS_RANGE_DB;
  return PALETTE_REFERENCE_GAIN * 10 ** (dbOffset / 20) * masterVolumeScale;
}

function applyMasterVolume() {
  masterVolumeControl.value = String(Math.round(mixMasterVolume * 100));
  masterVolumeValue.textContent = `${Math.round(mixMasterVolume * 100)}%`;
  if (mixOutputGain && audioContext) {
    mixOutputGain.gain.setTargetAtTime(
      Math.max(0, Math.min(1, mixMasterVolume)),
      audioContext.currentTime,
      0.08
    );
  }
  applyLocalAmbientPlayback();
}

function applyLocalVolume() {
  volumeControl.value = String(Math.round(soundVolume * 100));
  volumeValue.textContent = `${Math.round(soundVolume * 100)}%`;

  if (masterGain && audioContext) {
    masterGain.gain.setTargetAtTime(
      getScaledMasterVolume(),
      audioContext.currentTime,
      0.08
    );
  }
}

function applyAmbientVolumes() {
  if (ambientToggle) ambientToggle.checked = ambientEnabled;
  fountainVolumeControl.disabled = !ambientEnabled;
  rainVolumeControl.disabled = !ambientEnabled;
  kidsVolumeControl.disabled = !ambientEnabled;
  fountainVolumeControl.value = String(Math.round(fountainVolume * 100));
  fountainVolumeValue.textContent = `${Math.round(fountainVolume * 100)}%`;
  rainVolumeControl.value = String(Math.round(rainVolume * 100));
  rainVolumeValue.textContent = `${Math.round(rainVolume * 100)}%`;
  kidsVolumeControl.value = String(Math.round(kidsVolume * 100));
  kidsVolumeValue.textContent = `${Math.round(kidsVolume * 100)}%`;
}

function getAmbientVolume(kind) {
  if (kind === "fountain") return fountainVolume;
  if (kind === "rain") return rainVolume;
  if (kind === "kids") return kidsVolume;
  return 0;
}

function getAmbientUrl(kind) {
  const config = AMBIENT_SAMPLES[kind];
  return isExtensionRuntime && chrome.runtime ? chrome.runtime.getURL(config.url) : config.url;
}

function ensureAmbientElement(kind) {
  if (ambientElements[kind]) return ambientElements[kind];

  const element = new Audio(getAmbientUrl(kind));
  element.loop = true;
  element.preload = "auto";
  element.volume = 0;
  ambientElements[kind] = element;
  return element;
}

function rampAmbientElement(kind, targetVolume) {
  const element = ensureAmbientElement(kind);
  const startVolume = element.volume;
  const startedAt = Date.now();
  const duration = 260;

  clearInterval(ambientRampTimers[kind]);
  ambientRampTimers[kind] = window.setInterval(() => {
    const progress = Math.min(1, (Date.now() - startedAt) / duration);
    element.volume = startVolume + (targetVolume - startVolume) * progress;
    if (progress >= 1) {
      clearInterval(ambientRampTimers[kind]);
      delete ambientRampTimers[kind];
      if (targetVolume <= 0.001) {
        element.pause();
        element.currentTime = 0;
      }
    }
  }, 30);

  if (targetVolume > 0.001 && element.paused) {
    element.play()
      .then(() => {
        guideStatus.textContent = `Ambient playing: ${kind}`;
      })
      .catch((error) => {
        guideStatus.textContent = `Ambient blocked: ${kind} (${error.name || "play failed"})`;
      });
  }
}

function applyLocalAmbientPlayback() {
  Object.keys(AMBIENT_SAMPLES).forEach((kind) => {
    const amount = muted || !ambientEnabled ? 0 : getAmbientVolume(kind);
    const targetVolume =
      amount > 0.001
        ? Math.min(1, amount * AMBIENT_SAMPLES[kind].level * mixMasterVolume)
        : 0;
    rampAmbientElement(kind, targetVolume);
  });
}

function stopLocalAmbientPlayback() {
  Object.keys(ambientElements).forEach((kind) => {
    rampAmbientElement(kind, 0);
  });
}

function applyTickVolume() {
  tickVolumeControl.value = String(Math.round(tickVolume * 100));
  tickVolumeValue.textContent = `${Math.round(tickVolume * 100)}%`;
}

function applyDarkMode() {
  document.body.classList.toggle("dark-mode", darkModeEnabled);
  if (darkModeToggle) darkModeToggle.checked = darkModeEnabled;
  if (darkModeLabel) darkModeLabel.textContent = darkModeEnabled ? "Light mode" : "Dark mode";
}

function setMidiStatus(text) {
  if (midiStatus) midiStatus.textContent = text;
}

function isMidiBlockedByPreviewContext() {
  return location.protocol === "file:";
}

function setMidiDebug(text) {
  if (midiDebug) midiDebug.textContent = text;
}

function openMidiPermissionPage(reason = "") {
  if (!isExtensionRuntime || !chrome.tabs || !chrome.runtime) return;

  const url = chrome.runtime.getURL("midi-permission.html");
  chrome.tabs.create({ url }).catch(() => {});
  setMidiStatus("Opened MIDI setup tab");
  setMidiDebug(
    reason
      ? `Outputs: ${reason}. Press Enable MIDI access in the setup tab.`
      : "Outputs: press Enable MIDI access in the setup tab"
  );
}

function openListenPage() {
  if (!isExtensionRuntime || !chrome.tabs || !chrome.runtime) {
    setMidiStatus("Listen needs the loaded extension");
    setMidiDebug("Inputs: open BreathSync from the toolbar, not the file preview.");
    return;
  }

  const url = chrome.runtime.getURL("listen.html");
  chrome.tabs.create({ url }).catch(() => {});
}

async function queryMidiPermissionState() {
  if (!navigator.permissions || typeof navigator.permissions.query !== "function") {
    return "unknown";
  }

  try {
    const result = await navigator.permissions.query({ name: "midi", sysex: false });
    return result.state || "unknown";
  } catch (error) {
    try {
      const result = await navigator.permissions.query({ name: "midi" });
      return result.state || "unknown";
    } catch (fallbackError) {
      return "unknown";
    }
  }
}

function describeMidiPorts(outputs) {
  if (!outputs.length) return "Outputs: none";
  return `Outputs: ${outputs.map((output) => output.name || output.id).join(", ")}`;
}

function setMidiWaitingOption(label = "IAC MIDI Driver Bus 1") {
  if (!midiOutput) return;
  midiOutput.innerHTML = "";
  const option = document.createElement("option");
  option.value = midiOutputId || "iac-waiting";
  option.textContent = `${label} (waiting)`;
  midiOutput.appendChild(option);
  midiOutput.value = option.value;
}

function renderMidiOutputSelection() {
  if (!midiOutput) return;

  midiOutput.innerHTML = "";
  const option = document.createElement("option");
  option.value = midiOutputId || "";
  option.textContent = midiOutputLabel || "Open MIDI setup to select IAC";
  midiOutput.appendChild(option);
  midiOutput.value = option.value;
}

function renderMidiSetupHint() {
  renderMidiOutputSelection();
  if (midiOutputLabel) {
    setMidiStatus(`Routing via ${midiOutputLabel}`);
    setMidiDebug("Outputs: setup tab sends MIDI to Ableton");
  } else {
    setMidiStatus("MIDI setup tab handles output");
    setMidiDebug("Outputs: open MIDI setup and scan outputs");
  }
}

function frequencyToMidiNote(frequency) {
  return Math.max(0, Math.min(127, Math.round(69 + 12 * Math.log2(frequency / 440))));
}

function clearMidiTimers() {
  midiNoteTimers.forEach((timerId) => clearTimeout(timerId));
  midiNoteTimers = [];
}

function allMidiNotesOff() {
  clearMidiTimers();
  if (!midiOut) return;
  for (let channel = 0; channel < 16; channel += 1) {
    sendRawMidi([0xb0 + channel, 123, 0]);
  }
}

async function refreshMidiOutputs(options = {}) {
  openMidiPermissionPage("MIDI output lives in setup tab");
  return false;
}

async function ensureMidiOutput() {
  return null;
}

function sendRawMidi(message) {
  if (!midiOut) return false;
  try {
    midiOut.send(message);
    midiSendCount += 1;
    setMidiDebug(
      `Selected: ${midiOut.name || midiOut.id} | State: ${midiOut.state || "unknown"} | Sends: ${midiSendCount}`
    );
    return true;
  } catch (error) {
    setMidiStatus(`MIDI send failed: ${error.message || error.name || "unknown error"}`);
    return false;
  }
}

function scheduleMidiNote(frequency, startDelayMs, durationMs, velocity = 54) {
  if (!midiEnabled || !midiOut) return;

  const note = frequencyToMidiNote(frequency);
  const onTimer = setTimeout(() => {
    sendRawMidi([0x90, note, velocity]);
  }, Math.max(0, startDelayMs));
  const offTimer = setTimeout(() => {
    sendRawMidi([0x80, note, 0]);
  }, Math.max(0, startDelayMs + durationMs));

  midiNoteTimers.push(onTimer, offTimer);
}

async function sendMidiPhaseNotes(label, duration, sound, melodyNotes) {
  const output = await ensureMidiOutput();
  if (!output || !sound) return;

  clearMidiTimers();
  const phaseMs = duration * 1000;
  const sequence = Array.isArray(sound.sequence) ? sound.sequence : [];

  if (sound.bell || sound.granular || !Array.isArray(sequence[0])) {
    const stepMs = Math.max(240, phaseMs / Math.max(1, sequence.length));
    sequence.forEach((frequency, index) => {
      scheduleMidiNote(frequency, index * stepMs, Math.min(stepMs * 0.78, 900), 48);
    });
  } else {
    const stepMs = Math.max(420, phaseMs / Math.max(1, sequence.length));
    sequence.forEach((chord, stepIndex) => {
      chord.forEach((frequency, voiceIndex) => {
        scheduleMidiNote(
          frequency,
          stepIndex * stepMs,
          Math.min(stepMs * 0.92, phaseMs - stepIndex * stepMs),
          voiceIndex === 0 ? 46 : 38
        );
      });
    });
  }

  if (Array.isArray(melodyNotes)) {
    const stepMs = Math.max(250, phaseMs / Math.max(1, melodyNotes.length));
    melodyNotes.forEach((frequency, index) => {
      const velocity = Math.max(24, 58 - Math.max(0, frequency - 440) / 18);
      scheduleMidiNote(frequency, index * stepMs + 80, stepMs * 0.72, velocity);
    });
  }

  setMidiStatus(`Routing to ${output.name || "selected MIDI output"}`);
}

function routeLocalPhaseMidi(label, duration) {
  return;
}

async function sendMidiTestNote() {
  openMidiPermissionPage("test MIDI from setup tab");
}

async function requestOffscreenAudio(type) {
  if (!isExtensionRuntime || !chrome.runtime) return;

  try {
    const response = await chrome.runtime.sendMessage({ type });
    if (response && response.ok === false) {
      console.warn("BreathSync offscreen audio request failed:", response.error);
    }
  } catch (error) {
    console.warn("BreathSync offscreen audio request failed:", error);
  }
}

async function ensureDurableAudioPlayback() {
  if (
    !soundEnabled &&
    !tickEnabled &&
    fountainVolume <= 0.001 &&
    rainVolume <= 0.001 &&
    kidsVolume <= 0.001
  ) {
    return;
  }
  await requestOffscreenAudio("breathsync-restart-offscreen-audio");
}

async function closeDurableAudioPlayback() {
  await requestOffscreenAudio("breathsync-close-offscreen-audio");
}

async function startAmbientOffscreenPlayback() {
  if (!isExtensionRuntime || !chrome.runtime) return;

  const hasAmbientVolume =
    ambientEnabled &&
    (fountainVolume > 0.001 || rainVolume > 0.001 || kidsVolume > 0.001);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "breathsync-start-ambient-offscreen",
      ambientEnabled,
      volumes: {
        fountain: fountainVolume,
        rain: rainVolume,
        kids: kidsVolume
      }
    });
    if (response && response.ok === false) {
      guideStatus.textContent = hasAmbientVolume
        ? "Ambient playing while popup stays open"
        : `Ambient failed: ${response.error || "offscreen unavailable"}`;
    }
  } catch (error) {
    guideStatus.textContent = hasAmbientVolume
      ? "Ambient playing while popup stays open"
      : `Ambient failed: ${error.message || "offscreen unavailable"}`;
  }
}

function applyTemperature() {
  temperatureControl.value = String(Math.round(temperature * 100));
  temperatureValue.textContent = `${Math.round(temperature * 100)}%`;
}

function getReverbDuration() {
  return 1.2 + reverbAmount * 7.2;
}

function getReverbDecay() {
  return 3.1 - reverbAmount * 1.55;
}

function getReverbWetLevel() {
  return 0.08 + reverbAmount * 0.86;
}

function applyReverb() {
  reverbControl.value = String(Math.round(reverbAmount * 100));
  reverbValue.textContent = `${Math.round(reverbAmount * 100)}%`;

  if (audioContext && reverbNode && reverbGain) {
    reverbNode.buffer = createLargeReverbImpulse(
      audioContext,
      getReverbDuration(),
      getReverbDecay()
    );
    reverbGain.gain.setTargetAtTime(
      getReverbWetLevel(),
      audioContext.currentTime,
      0.1
    );
  }
}

function applyBinauralSpace() {
  if (spaceControl && spaceValue) {
    spaceControl.value = String(Math.round(spaceAmount * 100));
    spaceValue.textContent = `${Math.round(spaceAmount * 100)}%`;
  }

  if (
    audioContext &&
    dryGain &&
    binauralGain &&
    binauralDelayLeft &&
    binauralDelayRight &&
    binauralPanLeft &&
    binauralPanRight &&
    binauralHrtfGain &&
    binauralPanner
  ) {
    const tempBoost = binauralEnabled ? temperature * spaceAmount * 0.25 : 0;
    const effectiveSpace = Math.min(1, spaceAmount + tempBoost);
    const dryLevel = binauralEnabled ? 0.52 : 0.46;
    const wet = binauralEnabled ? 0.08 + effectiveSpace * 0.28 : 0;
    const hrtfWet = binauralEnabled ? 0.12 + effectiveSpace * 0.38 : 0;
    const spread = binauralEnabled ? 0.35 + effectiveSpace * 0.75 : 0;
    dryGain.gain.setTargetAtTime(dryLevel, audioContext.currentTime, 0.12);
    binauralGain.gain.setTargetAtTime(wet, audioContext.currentTime, 0.12);
    binauralHrtfGain.gain.setTargetAtTime(hrtfWet, audioContext.currentTime, 0.12);
    binauralDelayLeft.delayTime.setTargetAtTime(
      0.006 + effectiveSpace * 0.02,
      audioContext.currentTime,
      0.12
    );
    binauralDelayRight.delayTime.setTargetAtTime(
      0.018 + effectiveSpace * 0.04,
      audioContext.currentTime,
      0.12
    );
    binauralPanLeft.pan.setTargetAtTime(-spread, audioContext.currentTime, 0.12);
    binauralPanRight.pan.setTargetAtTime(spread, audioContext.currentTime, 0.12);
    setBinauralPosition("Hold");
  }
}

function setBinauralPosition(label) {
  if (!audioContext || !binauralEnabled || !binauralPanner) return;

  const effectiveSpace = Math.min(1, spaceAmount + temperature * spaceAmount * 0.25);
  const lateral = 0.55 + effectiveSpace * 1.65;
  const height = 0.12 + effectiveSpace * 0.55;
  const distance = 0.95 - effectiveSpace * 0.35;
  const x = label === "Inhale" ? -lateral : label === "Exhale" ? lateral : lateral * 0.46;
  const y = label === "Inhale" ? height : label === "Exhale" ? -height * 0.4 : height * 0.34;
  const z = -distance;

  binauralPanner.positionX.setTargetAtTime(x, audioContext.currentTime, 0.35);
  binauralPanner.positionY.setTargetAtTime(y, audioContext.currentTime, 0.35);
  binauralPanner.positionZ.setTargetAtTime(z, audioContext.currentTime, 0.35);
}

function clearLocalTickTimers() {
  tickTimeouts.forEach((timerId) => clearTimeout(timerId));
  tickTimeouts = [];
}

function playLocalTick(label, progress, accent) {
  const context = ensureLocalAudio();
  if (!context || !tickEnabled || muted || tickVolume <= 0) return;

  const now = context.currentTime;
  const gain = context.createGain();
  const clockBody = context.createOscillator();
  const tickClick = context.createOscillator();
  const filter = context.createBiquadFilter();
  const peak = (accent ? 1.35 : 0.92) * tickVolume;

  clockBody.type = "square";
  tickClick.type = "triangle";
  clockBody.frequency.setValueAtTime(210, now);
  tickClick.frequency.setValueAtTime(3200, now);
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(1850, now);
  filter.Q.value = 10;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(peak, now + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
  clockBody.connect(filter);
  tickClick.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  clockBody.start(now);
  tickClick.start(now);
  clockBody.stop(now + 0.055);
  tickClick.stop(now + 0.035);
}

function startLocalTickPattern(label, duration) {
  clearLocalTickTimers();
  if (!tickEnabled) return;

  const interval = 1000;
  const ticks = Math.max(1, Math.floor(duration * 1000 / interval));

  for (let index = 0; index <= ticks; index += 1) {
    const progress = ticks === 0 ? 0 : index / ticks;
    const timerId = setTimeout(() => {
      playLocalTick(label, progress, index === 0);
    }, index * interval);
    tickTimeouts.push(timerId);
  }
}

function setLocalMasterScale(scale, fadeTime) {
  masterVolumeScale = scale;

  if (masterGain && audioContext) {
    masterGain.gain.setTargetAtTime(
      getScaledMasterVolume(),
      audioContext.currentTime,
      fadeTime
    );
  }
}

function resumeLocalAudio() {
  if (muted || (!soundEnabled && !tickEnabled)) return;

  const context = ensureLocalAudio();
  if (context && context.state === "suspended") {
    context.resume().catch(() => {});
  }

  if (soundEnabled && !activeSound) {
    playLocalPhaseSound(phaseLabel.textContent || "Inhale", 1.8);
  }
}

function bindLocalAudioUnlock() {
  document.addEventListener("pointerdown", resumeLocalAudio, true);
  document.addEventListener("keydown", resumeLocalAudio, true);
}

function unbindLocalAudioUnlock() {
  document.removeEventListener("pointerdown", resumeLocalAudio, true);
  document.removeEventListener("keydown", resumeLocalAudio, true);
}

function softRestartPreviewLoop() {
  clearTimeout(techniqueTransitionTimer);

  if (!running || !soundEnabled || !audioContext) {
    restartPreviewLoop();
    return;
  }

  setLocalMasterScale(0.2, 0.18);
  techniqueTransitionTimer = setTimeout(() => {
    restartPreviewLoop();
    setLocalMasterScale(1, 0.35);
  }, 420);
}

function createLargeReverbImpulse(context, duration, decay) {
  const sampleRate = context.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const impulse = context.createBuffer(2, length, sampleRate);
  const earlyReflections = [0.011, 0.019, 0.031, 0.047, 0.073, 0.109];

  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const data = impulse.getChannelData(channel);

    for (let index = 0; index < length; index += 1) {
      const progress = index / length;
      const tail = Math.pow(1 - progress, decay);
      const stereoOffset = channel === 0 ? 0.94 : 1.06;
      data[index] = (Math.random() * 2 - 1) * tail * 0.36 * stereoOffset;
    }

    earlyReflections.forEach((reflection, reflectionIndex) => {
      const position = Math.floor(sampleRate * reflection * (channel === 0 ? 1 : 1.13));
      if (position < length) {
        data[position] += (0.28 / (reflectionIndex + 1)) * (channel === 0 ? 1 : -1);
      }
    });
  }

  return impulse;
}

function createReversedPianoBuffer(context) {
  const sampleRate = context.sampleRate;
  const duration = 2.4;
  const length = Math.floor(sampleRate * duration);
  const buffer = context.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  const partials = [
    { ratio: 1, level: 0.9, decay: 2.1 },
    { ratio: 2.01, level: 0.36, decay: 1.5 },
    { ratio: 3.02, level: 0.18, decay: 1.1 },
    { ratio: 4.03, level: 0.1, decay: 0.8 }
  ];

  for (let index = 0; index < length; index += 1) {
    const time = index / sampleRate;
    const strike = Math.exp(-time * 14);
    const body = partials.reduce((sum, partial) => {
      const frequency = 220 * partial.ratio;
      return (
        sum +
        Math.sin(2 * Math.PI * frequency * time) *
          partial.level *
          Math.exp(-time * partial.decay)
      );
    }, 0);
    const hammer = (Math.random() * 2 - 1) * strike * 0.025;
    data[length - index - 1] = (body * 0.74 + hammer) * 1.12;
  }

  return buffer;
}

function getReversedPianoBuffer(context) {
  if (!reversedPianoBuffer) {
    reversedPianoBuffer = createReversedPianoBuffer(context);
  }

  return reversedPianoBuffer;
}

function getPhaseSound(label) {
  const preset = soundPreset.value || currentSoundPreset;

  if (preset === "halo") {
    if (label === "Inhale") {
      return {
        sequence: [
          [220.0, 329.63, 659.25],
          [246.94, 369.99, 739.99],
          [293.66, 440.0, 880.0],
          [329.63, 493.88, 987.77]
        ],
        filter: 1400,
        waveform: "sine",
        shimmer: true
      };
    }
    if (label === "Hold") {
      return {
        sequence: [[293.66, 440.0, 880.0]],
        filter: 1180,
        waveform: "sine",
        shimmer: true
      };
    }
    if (label === "Exhale") {
      return {
        sequence: [
          [329.63, 493.88, 987.77],
          [293.66, 440.0, 880.0],
          [246.94, 369.99, 739.99],
          [220.0, 329.63, 659.25]
        ],
        filter: 980,
        waveform: "sine",
        shimmer: true
      };
    }
    return {
      sequence: [[146.83, 220.0, 440.0]],
      filter: 820,
      waveform: "sine",
      shimmer: true
    };
  }

  if (preset === "aura") {
    if (label === "Inhale") {
      return {
        sequence: [
          [146.83, 220.0, 293.66],
          [164.81, 246.94, 329.63],
          [185.0, 293.66, 369.99],
          [220.0, 329.63, 440.0]
        ],
        filter: 1240,
        waveform: "sine",
        fm: true,
        fmRatio: 2,
        fmDepth: 14
      };
    }
    if (label === "Hold") {
      return {
        sequence: [[185.0, 277.18, 369.99]],
        filter: 980,
        waveform: "sine",
        fm: true,
        fmRatio: 1.5,
        fmDepth: 9
      };
    }
    if (label === "Exhale") {
      return {
        sequence: [
          [220.0, 329.63, 440.0],
          [185.0, 293.66, 369.99],
          [164.81, 246.94, 329.63],
          [146.83, 220.0, 293.66]
        ],
        filter: 820,
        waveform: "sine",
        fm: true,
        fmRatio: 1,
        fmDepth: 11
      };
    }
    return {
      sequence: [[110.0, 164.81, 220.0]],
      filter: 720,
      waveform: "sine",
      fm: true,
      fmRatio: 1,
      fmDepth: 7
    };
  }

  if (preset === "ivory") {
    if (label === "Inhale") {
      return {
        granular: true,
        sequence: [146.83, 164.81, 185.0, 220.0],
        filter: 1320,
        grainSize: 0.42,
        grainRate: 0.14,
        density: 1.05
      };
    }
    if (label === "Hold") {
      return {
        granular: true,
        sequence: [185.0, 220.0, 293.66],
        filter: 980,
        grainSize: 0.48,
        grainRate: 0.18,
        density: 0.82
      };
    }
    if (label === "Exhale") {
      return {
        granular: true,
        sequence: [220.0, 185.0, 164.81, 146.83],
        filter: 840,
        grainSize: 0.5,
        grainRate: 0.16,
        density: 0.96
      };
    }
    return {
      granular: true,
      sequence: [110.0, 146.83],
      filter: 720,
      grainSize: 0.54,
      grainRate: 0.22,
      density: 0.72
    };
  }

  if (preset === "glock") {
    if (label === "Inhale") {
      return {
        bell: true,
        sequence: [146.83, 164.81, 185.0, 220.0],
        filter: 2400,
        bellDecay: 2.8,
        bellGain: 0.58
      };
    }
    if (label === "Hold") {
      return {
        bell: true,
        sequence: [185.0, 220.0, 293.66],
        filter: 2100,
        bellDecay: 3.2,
        bellGain: 0.44
      };
    }
    if (label === "Exhale") {
      return {
        bell: true,
        sequence: [220.0, 185.0, 164.81, 146.83],
        filter: 1900,
        bellDecay: 3.4,
        bellGain: 0.52
      };
    }
    return {
      bell: true,
      sequence: [146.83, 110.0],
      filter: 1700,
      bellDecay: 3.6,
      bellGain: 0.36
    };
  }

  if (preset === "meadow") {
    if (label === "Inhale") {
      return {
        sequence: [
          [110.0, 146.83, 220.0],
          [123.47, 164.81, 246.94],
          [146.83, 185.0, 293.66],
          [164.81, 220.0, 329.63]
        ],
        filter: 720,
        waveform: "sawtooth",
        tape: true,
        targetGain: 0.1
      };
    }
    if (label === "Hold") {
      return {
        sequence: [[146.83, 185.0, 293.66]],
        filter: 620,
        waveform: "sawtooth",
        tape: true,
        targetGain: 0.085
      };
    }
    if (label === "Exhale") {
      return {
        sequence: [
          [164.81, 220.0, 329.63],
          [146.83, 185.0, 293.66],
          [123.47, 164.81, 246.94],
          [110.0, 146.83, 220.0]
        ],
        filter: 560,
        waveform: "sawtooth",
        tape: true,
        targetGain: 0.095
      };
    }
    return {
      sequence: [[98.0, 146.83, 220.0]],
      filter: 500,
      waveform: "sawtooth",
      tape: true,
      targetGain: 0.075
    };
  }

  if (preset === "saw") {
    if (label === "Inhale") {
      return {
        sequence: [
          [130.81, 196.0, 261.63],
          [146.83, 220.0, 293.66],
          [164.81, 246.94, 329.63],
          [196.0, 293.66, 392.0]
        ],
        filter: 1180,
        waveform: "sine",
        fm: true,
        fmRatio: 2.5,
        fmDepth: 6,
        shimmer: true,
        targetGain: 0.09
      };
    }
    if (label === "Hold") {
      return {
        sequence: [[164.81, 246.94, 329.63]],
        filter: 1040,
        waveform: "sine",
        fm: true,
        fmRatio: 2,
        fmDepth: 5,
        shimmer: true,
        targetGain: 0.075
      };
    }
    if (label === "Exhale") {
      return {
        sequence: [
          [196.0, 293.66, 392.0],
          [164.81, 246.94, 329.63],
          [146.83, 220.0, 293.66],
          [130.81, 196.0, 261.63]
        ],
        filter: 900,
        waveform: "sine",
        fm: true,
        fmRatio: 1.5,
        fmDepth: 5,
        shimmer: true,
        targetGain: 0.085
      };
    }
    return {
      sequence: [[98.0, 146.83, 196.0]],
      filter: 760,
      waveform: "sine",
      fm: true,
      fmRatio: 1,
      fmDepth: 4,
      shimmer: true,
      targetGain: 0.065
    };
  }

  if (label === "Inhale") {
    return {
      sequence: [
        [146.83, 220.0, 293.66],
        [164.81, 246.94, 329.63],
        [185.0, 293.66, 369.99],
        [220.0, 329.63, 440.0]
      ],
      filter: 980,
      waveform: "triangle"
    };
  }
  if (label === "Hold") {
    return {
      sequence: [[185.0, 220.0, 293.66]],
      filter: 760,
      waveform: "triangle"
    };
  }
  if (label === "Exhale") {
    return {
      sequence: [
        [220.0, 329.63, 440.0],
        [185.0, 293.66, 369.99],
        [164.81, 246.94, 329.63],
        [146.83, 220.0, 293.66]
      ],
      filter: 620,
      waveform: "triangle"
    };
  }
  return {
    sequence: [[73.42, 146.83, 220.0]],
    filter: 520,
    waveform: "triangle"
  };
}

const CONSONANT_SCALE = [
  73.42, 82.41, 92.5, 98, 110, 123.47, 138.59, 146.83, 164.81, 185,
  196, 220, 246.94, 277.18, 293.66, 329.63, 369.99, 392, 440, 493.88,
  554.37, 587.33, 659.25, 739.99, 783.99, 880, 987.77, 1108.73,
  1174.66
];

function nearestScaleIndex(frequency) {
  let bestIndex = 0;
  let bestDistance = Infinity;

  CONSONANT_SCALE.forEach((note, index) => {
    const distance = Math.abs(note - frequency);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function getDiatonicNoteFromIndex(index) {
  const nextIndex = Math.max(
    0,
    Math.min(CONSONANT_SCALE.length - 1, index)
  );

  return CONSONANT_SCALE[nextIndex];
}

function buildTemperatureChord(chord, amount, chordIndex) {
  if (!Array.isArray(chord) || chord.length === 0) return chord;

  let rootIndex = nearestScaleIndex(chord[0]);
  if (rootIndex % 7 === 6) rootIndex += 1;

  const degree = rootIndex % 7;
  const chordTypes = [[0, 2, 4]];
  if (amount > 0.46 && degree !== 2) chordTypes.push([0, 1, 4]);
  if (amount > 0.72 && degree !== 3) chordTypes.push([0, 3, 4]);
  const triad = chordTypes[chordIndex % chordTypes.length];
  const intervals = amount < 0.22 ? [0, 4] : triad;

  return intervals.map((interval) => getDiatonicNoteFromIndex(rootIndex + interval));
}

function applyTemperatureToSequence(sequence, amount) {
  if (!Array.isArray(sequence)) return sequence;

  if (!Array.isArray(sequence[0])) {
    return sequence;
  }

  return sequence.map((chord, chordIndex) =>
    buildTemperatureChord(chord, amount, chordIndex)
  );
}

function applyTemperatureToSound(sound) {
  const amount = temperature;
  if (!sound) return sound;

  return {
    ...sound,
    sequence: applyTemperatureToSequence(sound.sequence, amount),
    filter: sound.filter + amount * 520,
    targetGain: sound.targetGain ? sound.targetGain * (1 - amount * 0.08) : sound.targetGain
  };
}

function getHighNoteDamping(frequency) {
  const normalized = Math.max(0, Math.min(1, (frequency - 440) / 734.66));
  return {
    gain: 1 - normalized * temperature * 0.32,
    cutoff: 2600 + temperature * 900 - normalized * temperature * 420
  };
}

function getOrnamentChord(sound, duration, offset, amount) {
  const sequence = Array.isArray(sound.sequence) ? sound.sequence : [];

  if (!sequence.length) return buildTemperatureChord([220], amount, 0);

  const stepLength = Math.max(0.45, duration / sequence.length);
  const chordIndex = Math.min(sequence.length - 1, Math.floor(offset / stepLength));
  const chord = sequence[chordIndex] || sequence[0];

  if (!Array.isArray(chord)) {
    return buildTemperatureChord([chord], amount, chordIndex);
  }

  return chord;
}

function getOrnamentFrequency(chord, index, label, amount, octaveMultiplier = 2) {
  const topChordTone = Math.max(...chord);
  const highChordTones = chord
    .map((note) => note * octaveMultiplier)
    .filter((note) => note > topChordTone && note <= topChordTone * 4)
    .sort((left, right) => left - right);
  const direction = label === "Exhale" ? -1 : 1;
  const ordered = direction > 0 ? highChordTones : highChordTones.slice().reverse();
  const spread = Math.max(1, Math.min(ordered.length, Math.ceil(1 + amount * (ordered.length - 1))));
  const stride = amount > 0.84 ? 3 : amount > 0.68 ? 2 : 1;
  return ordered[(index * stride + Math.floor(index * amount * 2)) % spread] || topChordTone * octaveMultiplier;
}

function getGenerativeScaleFrequency(chord, index, label, amount) {
  const topChordTone = Math.max(...chord);
  const rootIndex = nearestScaleIndex(chord[0]);
  const scaleOffsets = [0, 1, 2, 4, 5, 7, 8, 9, 11, 12, 14, 16, 18];
  const contour =
    label === "Exhale"
      ? [18, 14, 11, 16, 9, 12, 7, 5, 2]
      : [0, 4, 9, 2, 12, 7, 16, 11, 18];
  const tempReach = Math.max(4, Math.round(4 + amount * (contour.length - 4)));
  const leap =
    amount > 0.86
      ? index * 5 + Math.floor(index / 2)
      : amount > 0.68
        ? index * 3 + Math.floor(index / 3)
        : index * 2;
  const freeLeap = amount > 0.64 ? Math.floor(Math.random() * tempReach) : 0;
  let note = getDiatonicNoteFromIndex(
    rootIndex + scaleOffsets[contour[(leap + freeLeap) % tempReach] % scaleOffsets.length]
  );

  while (note < Math.max(880, topChordTone * 2)) note *= 2;
  if (amount > 0.72 && index % 4 === 1) note *= 2;
  if (amount > 0.9 && index % 5 === 3) note *= 2;
  while (note > 4186) note /= 2;

  return note;
}

function getOrnamentMelodyNotes(sound, duration, label, amount, octaveMultiplier = 2) {
  if (amount < 0.5 || !sound) return [];

  const subdivision =
    octaveMultiplier === 4
      ? 1 - (amount - 0.5) * 1.5
      : 1.25 - (amount - 0.5) * 1.5;
  const noteCount = Math.max(1, Math.floor((duration - subdivision * 0.25) / subdivision));

  return Array.from({ length: noteCount }, (_, index) => {
    const offset = index * subdivision + subdivision * 0.5;
    const chord = getOrnamentChord(sound, duration, offset, amount);
    if (octaveMultiplier === 4) {
      return getGenerativeScaleFrequency(chord, index, label, amount);
    }
    return getOrnamentFrequency(chord, index, label, amount, octaveMultiplier);
  });
}

function getOrnamentOffset(index, subdivision, amount, duration) {
  const offsets = [0, -0.16, 0.12, 0.24, -0.08, 0.18];
  const jitter = amount > 0.7 ? offsets[index % offsets.length] * subdivision * amount : 0;
  return Math.max(0.05, Math.min(duration - 0.05, index * subdivision + subdivision * 0.5 + jitter));
}

function createReflectiveMelodyNodes(context, now, duration, label, destination, sound) {
  const melodyNotes = getOrnamentMelodyNotes(sound, duration, label, temperature, 2);
  const counterpointNotes = [];
  if (!melodyNotes.length && !counterpointNotes.length) return [];
  const melodySubdivision = 1.25 - (temperature - 0.5) * 1.5;
  const counterpointSubdivision = 1 - (temperature - 0.5) * 1.5;

  const createNode = (frequency, index, subdivision, offsetShift, levelScale, lengthScale, type) => {
    const offset = getOrnamentOffset(index, subdivision, temperature, duration) + offsetShift;
    const oscillator = context.createOscillator();
    const noteGain = context.createGain();
    const noteFilter = context.createBiquadFilter();
    const damping = getHighNoteDamping(frequency);
    const startAt = now + Math.min(duration - 0.05, offset);
    const noteLength = Math.max(0.055, Math.min(0.24, subdivision * 0.42 * lengthScale));
    const expressiveLevel = (0.009 + temperature * 0.018) * levelScale;

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, startAt);
    oscillator.detune.setValueAtTime(0, startAt);

    noteFilter.type = "lowpass";
    noteFilter.frequency.setValueAtTime(
      Math.min(7200, Math.max(frequency * 1.35, damping.cutoff * 0.82)),
      startAt
    );
    noteFilter.Q.value = 0.28;

    noteGain.gain.setValueAtTime(0.0001, startAt);
    noteGain.gain.linearRampToValueAtTime(
      expressiveLevel * damping.gain,
      startAt + Math.min(0.035, noteLength * 0.35)
    );
    noteGain.gain.exponentialRampToValueAtTime(0.0001, startAt + noteLength);

    oscillator.connect(noteFilter);
    noteFilter.connect(noteGain);
    noteGain.connect(destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + noteLength + 0.08);
    oscillator.startAt = startAt;

    return oscillator;
  };

  return melodyNotes
    .map((frequency, index) =>
      createNode(frequency, index, melodySubdivision, 0, 0.82, 0.9, "sine")
    )
    .concat(
      counterpointNotes.map((frequency, index) =>
        createNode(
          frequency,
          index + 1,
          counterpointSubdivision,
          counterpointSubdivision * 0.5,
          0.92 + temperature * 0.28,
          0.32,
          "triangle"
        )
      )
    );
}

function getTemperatureLeadFrequency(
  sound,
  duration,
  label,
  amount,
  index,
  offset,
  octaveBase = 4
) {
  const chord = getOrnamentChord(sound, duration, offset, amount);
  const topChordTone = Math.max(...chord);
  const rootIndex = nearestScaleIndex(chord[0]);
  const chordToneOffsets = [0, 2, 4, 7, 9, 12, 14];
  const scaleOffsets = [0, 1, 2, 4, 5, 7, 8, 9, 11, 12, 14, 16];
  const consonantOffsets = index % 4 === 0 ? chordToneOffsets : scaleOffsets;
  const direction = label === "Exhale" ? -1 : 1;
  const randomReach = Math.max(3, Math.round(3 + amount * (consonantOffsets.length - 3)));
  const randomStep = amount > 0.62 ? Math.floor(Math.random() * randomReach) : 0;
  const contourStep = direction > 0 ? index * 2 + randomStep : randomReach - 1 - ((index * 2 + randomStep) % randomReach);
  let note = getDiatonicNoteFromIndex(
    rootIndex + consonantOffsets[Math.abs(contourStep) % consonantOffsets.length]
  );

  while (note < Math.max(523.25 * (octaveBase / 2), topChordTone * octaveBase)) note *= 2;
  if (amount > 0.78 && index % 3 === 1) note *= 2;
  while (note > 4186) note /= 2;

  return note;
}

function getTemperatureLeadSubdivision(amount, octaveBase = 4) {
  const clampedAmount = Math.max(0.5, Math.min(1, amount));

  if (octaveBase >= 4) {
    if (clampedAmount >= 0.975) return 0.25;
    if (clampedAmount >= 0.95) return 0.5;
    if (clampedAmount >= 0.925) return 1;
    if (clampedAmount >= 0.9) return 2;

    return 3.2 - (clampedAmount - 0.5) * 3;
  }

  return Math.max(0.25, 0.55 - (clampedAmount - 0.5) * 0.6);
}

function createTemperatureLeadNodes(
  context,
  now,
  duration,
  label,
  sound,
  destination,
  octaveBase = 4,
  responseOffset = 0,
  gainScale = 1
) {
  const amount = temperature;
  if (amount < 0.5 || !sound || !destination) return [];

  const subdivision = getTemperatureLeadSubdivision(amount, octaveBase);
  const noteCount = Math.max(1, Math.ceil((duration - 0.08) / subdivision));
  const nodes = [];

  for (let index = 0; index < noteCount; index += 1) {
    const isSteppedHighLead = octaveBase >= 4 && amount >= 0.9;
    const rhythmPush = amount > 0.72
      ? (Math.random() - 0.5) * subdivision * (isSteppedHighLead ? 0.12 : 0.38)
      : 0;
    const offset = Math.max(
      0.04,
      Math.min(duration - 0.06, index * subdivision + subdivision * 0.32 + rhythmPush)
    );
    const frequency = getTemperatureLeadFrequency(
      sound,
      duration,
      label,
      amount,
      index,
      offset,
      octaveBase
    );
    const oscillator = context.createOscillator();
    const leadGain = context.createGain();
    const leadFilter = context.createBiquadFilter();
    const startAt = now + offset;
    const noteLength = Math.max(0.045, Math.min(0.16, subdivision * 0.3));
    const peak = (0.035 + amount * 0.038) * gainScale;

    oscillator.type = amount > 0.76 ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(frequency, startAt);
    leadFilter.type = "bandpass";
    leadFilter.frequency.setValueAtTime(frequency, startAt);
    leadFilter.Q.value = 3.2;
    leadGain.gain.setValueAtTime(0.0001, startAt);
    leadGain.gain.linearRampToValueAtTime(peak, startAt + 0.018 + responseOffset * 0.02);
    leadGain.gain.exponentialRampToValueAtTime(0.0001, startAt + noteLength);
    oscillator.connect(leadFilter);
    leadFilter.connect(leadGain);
    leadGain.connect(destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + noteLength + 0.06);
    oscillator.startAt = startAt;
    nodes.push(oscillator);
  }

  return nodes;
}

function stopLocalSound() {
  clearTimeout(techniqueTransitionTimer);
  masterVolumeScale = 1;
  allMidiNotesOff();

  if (!activeSound || !audioContext) return;

  const now = audioContext.currentTime;
  activeSound.gain.gain.cancelScheduledValues(now);
  activeSound.gain.gain.setTargetAtTime(0.0001, now, 0.45);
  activeSound.nodes.forEach((node) => {
    try {
      node.stop(now + 1.75);
      if (node.modulator) node.modulator.stop(now + 1.75);
      if (node.wow) node.wow.stop(now + 1.75);
    } catch (error) {
      // Oscillator may already be stopped.
    }
  });
  activeSound = null;
}

function createSequencedChordNodes(context, now, duration, sound, destination) {
  const nodes = [];
  const sequence = sound.sequence;
  const stepLength = Math.max(0.45, duration / sequence.length);
  const noteLength = Math.max(0.56, Math.min(stepLength * 1.22, duration + 0.35));

  sequence.forEach((chord, stepIndex) => {
    const startAt = now + stepIndex * stepLength;

    chord.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const voiceGain = context.createGain();
      const voiceFilter = context.createBiquadFilter();
      const damping = getHighNoteDamping(frequency);
      const voiceScale = Math.min(1, 3 / Math.max(3, chord.length));
      const peak = (index === 0 ? 0.9 : 0.62) * damping.gain * voiceScale;

      oscillator.type = index === 0 ? "sine" : sound.waveform;
      oscillator.frequency.setValueAtTime(frequency, startAt);
      oscillator.detune.value = index === 1 ? 2 : index === 2 ? -3 : 0;

      if (sound.fm) {
        const modulator = context.createOscillator();
        const modGain = context.createGain();

        modulator.type = "sine";
        modulator.frequency.setValueAtTime(frequency * sound.fmRatio, startAt);
        modGain.gain.setValueAtTime(sound.fmDepth / (index + 1), startAt);
        modulator.connect(modGain);
        modGain.connect(oscillator.frequency);
        modulator.start(startAt);
        modulator.stop(startAt + noteLength + 0.25);
        oscillator.modulator = modulator;
      }

      if (sound.tape) {
        const wow = context.createOscillator();
        const wowGain = context.createGain();

        wow.type = "sine";
        wow.frequency.setValueAtTime(0.18 + index * 0.07, startAt);
        wowGain.gain.setValueAtTime(8 + index * 2, startAt);
        wow.connect(wowGain);
        wowGain.connect(oscillator.detune);
        wow.start(startAt);
        wow.stop(startAt + noteLength + 0.25);
        oscillator.wow = wow;
      }

      const attackTime = Math.min(0.12, noteLength * 0.14);
      const releaseTime = Math.min(0.46, stepLength * 0.46);
      const releaseStart = startAt + Math.max(attackTime + 0.04, noteLength - releaseTime);
      const decayEnd = Math.min(releaseStart, startAt + attackTime + Math.min(0.48, noteLength * 0.38));

      voiceGain.gain.setValueAtTime(0.0001, startAt);
      voiceGain.gain.linearRampToValueAtTime(peak, startAt + attackTime);
      voiceGain.gain.linearRampToValueAtTime(peak * 0.58, decayEnd);
      voiceGain.gain.linearRampToValueAtTime(peak * 0.5, releaseStart);
      voiceGain.gain.linearRampToValueAtTime(0.0001, startAt + noteLength);
      voiceFilter.type = "lowpass";
      voiceFilter.frequency.setValueAtTime(damping.cutoff, startAt);
      voiceFilter.Q.value = 0.2;
      oscillator.connect(voiceGain);
      voiceGain.connect(voiceFilter);
      voiceFilter.connect(destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + noteLength + 0.25);
      oscillator.startAt = startAt;
      nodes.push(oscillator);
    });
  });

  return nodes;
}

function playLocalPhaseSound(label, duration) {
  if (!soundEnabled || muted) return;

  const context = ensureLocalAudio();
  if (!context) return;

  const now = context.currentTime;
  const sound = applyTemperatureToSound(getPhaseSound(label));
  const gain = context.createGain();
  const filter = context.createBiquadFilter();
  let nodes;

  filter.type = "lowpass";
  filter.frequency.setValueAtTime(sound.filter, now);
  filter.Q.value = 0.18;
  gain.gain.setValueAtTime(0.0001, now);

  if (sound.granular) {
    nodes = createGranularPianoNodes(context, now, duration, sound, filter);
    gain.gain.linearRampToValueAtTime(0.62, now + 0.75);
  } else if (sound.bell) {
    nodes = createBellNodes(context, now, duration, sound, filter);
    gain.gain.linearRampToValueAtTime(0.34, now + 0.32);
  } else {
    nodes = createSequencedChordNodes(context, now, duration, sound, filter);
    const targetGain = sound.targetGain || (sound.fm ? 0.12 : sound.shimmer ? 0.11 : 0.15);
    gain.gain.linearRampToValueAtTime(
      targetGain,
      now + (sound.shimmer || sound.fm ? 1.4 : 0.85)
    );
  }

  if (duration > 1.2) {
    nodes = nodes.concat(
      createReflectiveMelodyNodes(context, now, duration, label, filter, sound)
    );
  }
  nodes = nodes.concat(
      createTemperatureLeadNodes(context, now, duration, label, sound, masterGain, 4, 0, 1)
    );
  nodes = nodes.concat(
    createTemperatureLeadNodes(
      context,
      now + Math.max(0.08, 0.5 - temperature * 0.22),
      duration,
      label === "Exhale" ? "Inhale" : label,
      sound,
      masterGain,
      2,
      1,
      0.72
    )
  );
  filter.connect(gain);
  gain.connect(masterGain);
  nodes.forEach((node) => {
    if (node.startAt) return;
    node.start(now);
  });

  if (activeSound) {
    activeSound.gain.gain.cancelScheduledValues(now);
    activeSound.gain.gain.setValueAtTime(activeSound.gain.gain.value, now);
    activeSound.gain.gain.linearRampToValueAtTime(
      0.0001,
      now + (sound.shimmer || sound.fm ? 2.2 : 1.6)
    );
    activeSound.nodes.forEach((node) => {
      try {
        node.stop(now + (sound.shimmer || sound.fm ? 2.35 : 1.75));
        if (node.modulator) node.modulator.stop(now + 2.35);
        if (node.wow) node.wow.stop(now + 2.35);
      } catch (error) {
        // Oscillator may already be stopped.
      }
    });
  }

  activeSound = { gain, nodes };
}

function createBellNodes(context, now, duration, sound, destination) {
  const nodes = [];
  const stepLength = Math.max(0.55, duration / sound.sequence.length);
  const partials = [
    { ratio: 1, level: 1 },
    { ratio: 2.01, level: 0.42 },
    { ratio: 3.76, level: 0.24 },
    { ratio: 5.18, level: 0.12 }
  ];

  sound.sequence.forEach((frequency, noteIndex) => {
    const startAt = now + noteIndex * stepLength;

    partials.forEach((partial, partialIndex) => {
      const oscillator = context.createOscillator();
      const partialGain = context.createGain();
      const peak = sound.bellGain * partial.level;

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency * partial.ratio, startAt);
      oscillator.detune.value = partialIndex === 0 ? 0 : partialIndex * 3;
      partialGain.gain.setValueAtTime(0.0001, startAt);
      partialGain.gain.linearRampToValueAtTime(peak, startAt + 0.018);
      partialGain.gain.exponentialRampToValueAtTime(
        0.0001,
        startAt + sound.bellDecay
      );
      oscillator.connect(partialGain);
      partialGain.connect(destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + sound.bellDecay + 0.08);
      oscillator.startAt = startAt;
      nodes.push(oscillator);
    });
  });

  return nodes;
}

function createGranularPianoNodes(context, now, duration, sound, destination) {
  const buffer = getReversedPianoBuffer(context);
  const nodes = [];
  const totalGrains = Math.max(4, Math.floor(duration / sound.grainRate));
  const audibleWindowEnd = Math.max(0.1, buffer.duration - sound.grainSize - 0.08);

  for (let index = 0; index < totalGrains; index += 1) {
    const progress = totalGrains === 1 ? 0 : index / (totalGrains - 1);
    const source = context.createBufferSource();
    const grainGain = context.createGain();
    const noteIndex = Math.min(
      sound.sequence.length - 1,
      Math.floor(progress * sound.sequence.length)
    );
    const startAt = Math.max(
      now + 0.012,
      now + index * sound.grainRate + (Math.random() * 0.035 - 0.0175)
    );
    const offset = Math.max(
      0.02,
      audibleWindowEnd - progress * 0.34 + (Math.random() * 0.08 - 0.04)
    );

    source.buffer = buffer;
    source.playbackRate.value = sound.sequence[noteIndex] / 220;
    source.detune.value = Math.random() * 8 - 4;
    grainGain.gain.setValueAtTime(0.0001, startAt);
    grainGain.gain.linearRampToValueAtTime(sound.density, startAt + 0.08);
    grainGain.gain.linearRampToValueAtTime(
      0.0001,
      startAt + sound.grainSize
    );
    source.connect(grainGain);
    grainGain.connect(destination);
    source.start(startAt, offset, sound.grainSize);
    source.stop(startAt + sound.grainSize + 0.05);
    source.startAt = startAt;
    nodes.push(source);
  }

  return nodes;
}

function schedulePreviewTimeout(callback, delay) {
  const timerId = setTimeout(callback, delay);
  previewTimeouts.push(timerId);
}

function getTechniqueSegments(technique) {
  const segments = [
    { label: "Inhale", scale: 1.15, duration: technique.inhale, glow: true },
    { label: "Hold", scale: 1.15, duration: technique.holdIn, glow: true },
    { label: "Exhale", scale: 0.88, duration: technique.exhale, glow: false },
    { label: "Pause", scale: 0.88, duration: technique.holdOut, glow: false }
  ];

  return segments.filter((segment) => segment.duration > 0);
}

function schedulePreviewCycle(technique, segments, startIndex, delayToNext) {
  let delay = Math.max(0, delayToNext);

  for (let offset = 1; offset < segments.length; offset += 1) {
    const segment = segments[(startIndex + offset) % segments.length];
    schedulePreviewTimeout(() => {
      setPreviewPhase(segment.label, segment.scale, segment.duration, segment.glow);
    }, delay);
    delay += segment.duration * 1000;
  }

  schedulePreviewTimeout(animatePreview, delay);
}

function animatePreview() {
  clearPreviewTimers();

  const technique = TECHNIQUES[techniqueSelect.value] || TECHNIQUES.focus;
  const segments = getTechniqueSegments(technique);
  const cycleDurationMs = getCycleDuration(technique);
  const origin = running && Number.isFinite(cycleStartedAt) && cycleStartedAt > 0
    ? cycleStartedAt
    : Date.now();
  const cycleElapsed =
    running && cycleDurationMs > 0
      ? ((Date.now() - origin) % cycleDurationMs + cycleDurationMs) % cycleDurationMs
      : 0;
  let elapsed = 0;
  let activeIndex = 0;

  segments.some((segment, index) => {
    const end = elapsed + segment.duration * 1000;
    if (cycleElapsed < end) {
      activeIndex = index;
      return true;
    }
    elapsed = end;
    return false;
  });

  const activeSegment = segments[activeIndex] || segments[0];
  const remainingMs = Math.max(0, elapsed + activeSegment.duration * 1000 - cycleElapsed);

  if (activeSegment) {
    setPreviewPhase(
      activeSegment.label,
      activeSegment.scale,
      Math.max(0.05, remainingMs / 1000),
      activeSegment.glow
    );
    schedulePreviewCycle(technique, segments, activeIndex, remainingMs);
  }
}

function getCycleDuration(technique) {
  return (
    technique.inhale +
    technique.holdIn +
    technique.exhale +
    technique.holdOut
  ) * 1000;
}

function restartPreviewLoop() {
  clearInterval(previewInterval);
  animatePreview();
}

function updateButtons() {
  toggleWidget.textContent = running ? "Show guide on this tab" : "Start floating guide";
  toggleWidget.disabled = false;
  stopWidget.disabled = !running;
  if (isExtensionRuntime && running) {
    clearLocalTickTimers();
    stopLocalSound();
  }
  if (running || soundEnabled || tickEnabled) {
    bindLocalAudioUnlock();
  } else {
    unbindLocalAudioUnlock();
    clearLocalTickTimers();
    stopLocalSound();
  }
  updateLocalDemoWidget();
}

function setGuideStatus(text) {
  if (guideStatus) guideStatus.textContent = text;
}

function canInjectIntoUrl(url = "") {
  return /^(https?|file):/i.test(url);
}

async function injectFloatingGuideIntoActiveTab() {
  if (
    !isExtensionRuntime ||
    typeof chrome === "undefined" ||
    !chrome.tabs ||
    !chrome.scripting
  ) {
    setGuideStatus("Preview mode shows the local demo window only.");
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    setGuideStatus("No active tab found for floating guide.");
    return;
  }

  if (!canInjectIntoUrl(tab.url)) {
    setGuideStatus("Open a normal website tab. Chrome pages cannot show widgets.");
    return;
  }

  try {
    const data = await chrome.storage.local.get({ [STORAGE_KEYS.activeTabId]: null });
    const previousTabId = Number(data[STORAGE_KEYS.activeTabId]);
    if (Number.isFinite(previousTabId) && previousTabId !== tab.id) {
      try {
        await chrome.tabs.get(previousTabId);
        setGuideStatus("Already running in another tab. Press Stop first.");
        return;
      } catch (error) {
        await chrome.storage.local.set({ [STORAGE_KEYS.activeTabId]: null });
      }
    }

    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["content.css"]
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });
    await chrome.storage.local.set({ [STORAGE_KEYS.activeTabId]: tab.id });
    await chrome.tabs.sendMessage(tab.id, { type: "breathsync-start-tab" });
    setGuideStatus("Floating guide sent to current tab.");
  } catch (error) {
    setGuideStatus("Could not inject here. Try a normal https:// webpage.");
  }
}

async function stopActiveFloatingGuideTab() {
  if (!isExtensionRuntime || typeof chrome === "undefined" || !chrome.tabs) return;

  const data = await chrome.storage.local.get({ [STORAGE_KEYS.activeTabId]: null });
  const tabId = Number(data[STORAGE_KEYS.activeTabId]);
  if (Number.isFinite(tabId)) {
    chrome.tabs.sendMessage(tabId, { type: "breathsync-stop-tab" }).catch(() => {});
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.activeTabId]: null });
}

function updateLocalDemoWidget() {
  if (isExtensionRuntime) return;

  let demo = document.getElementById("breathsync-local-demo");

  if (!demo) {
    demo = document.createElement("div");
    demo.id = "breathsync-local-demo";
    demo.innerHTML = `
      <span class="breathsync-widget-logo" aria-hidden="true"></span>
      <h2 id="breathsync-local-title">BreathSync</h2>
      <button id="breathsync-local-close" type="button" aria-label="Close guide">x</button>
      <button id="breathsync-local-mute" type="button" aria-label="Mute sound">Mute</button>
      <p id="breathsync-local-subtitle">Quiet regulation</p>
      <div id="breathsync-local-orb" aria-hidden="true"></div>
      <p id="breathsync-local-phase">Ready</p>
    `;
    document.body.appendChild(demo);
    bindLocalDemoControls(demo);
    applyLocalWidgetPosition(localWidgetX, localWidgetY);
  }

  const technique = TECHNIQUES[techniqueSelect.value] || TECHNIQUES.focus;
  const title = document.getElementById("breathsync-local-title");
  const subtitle = document.getElementById("breathsync-local-subtitle");
  const orb = document.getElementById("breathsync-local-orb");
  const phase = document.getElementById("breathsync-local-phase");

  if (!title || !subtitle || !orb || !phase) return;

  title.textContent = technique.label;
  subtitle.textContent = technique.subtitle;
  phase.textContent = running ? phaseLabel.textContent : "Ready";
  demo.hidden = !running;
  applyLocalMuteState();

  if (!running) {
    orb.style.transitionDuration = "1s";
    orb.style.transform = "scale(0.88)";
    orb.style.opacity = "1";
    orb.style.filter = "brightness(1)";
    return;
  }

  orb.style.transitionDuration = previewOrb.style.transitionDuration;
  orb.style.transform = previewOrb.style.transform;
  orb.style.opacity = previewOrb.style.opacity;
  orb.style.filter = previewOrb.style.filter;
}

function bindLocalDemoControls(demo) {
  const muteButton = document.getElementById("breathsync-local-mute");
  const closeButton = document.getElementById("breathsync-local-close");
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let widgetStartX = 0;
  let widgetStartY = 0;

  if (muteButton) {
    muteButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      muted = !muted;
      applyLocalMuteState();
      await storage.set({ [STORAGE_KEYS.muted]: muted });
    });
  }

  if (closeButton) {
    closeButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      running = false;
      updateButtons();
      await storage.set({ [STORAGE_KEYS.running]: false });
    });
  }

  demo.addEventListener("pointerdown", (event) => {
    if (event.target === muteButton || event.target === closeButton) return;
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    const rect = demo.getBoundingClientRect();
    widgetStartX = rect.left;
    widgetStartY = rect.top;
    demo.setPointerCapture(event.pointerId);
    demo.classList.add("breathsync-dragging");
  });

  demo.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const nextX = Math.max(8, Math.min(window.innerWidth - demo.offsetWidth - 8, widgetStartX + event.clientX - startX));
    const nextY = Math.max(8, Math.min(window.innerHeight - demo.offsetHeight - 8, widgetStartY + event.clientY - startY));
    demo.style.left = `${nextX}px`;
    demo.style.top = `${nextY}px`;
    demo.style.right = "auto";
    demo.style.bottom = "auto";
  });

  demo.addEventListener("pointerup", async (event) => {
    if (!dragging) return;
    dragging = false;
    demo.releasePointerCapture(event.pointerId);
    demo.classList.remove("breathsync-dragging");
    const rect = demo.getBoundingClientRect();
    localWidgetX = rect.left;
    localWidgetY = rect.top;
    await storage.set({
      [STORAGE_KEYS.widgetX]: rect.left,
      [STORAGE_KEYS.widgetY]: rect.top
    });
  });
}

function applyLocalMuteState() {
  const muteButton = document.getElementById("breathsync-local-mute");
  if (muteButton) {
    muteButton.textContent = muted ? "Unmute" : "Mute";
    muteButton.setAttribute("aria-pressed", String(muted));
  }
  if (muted) {
    clearLocalTickTimers();
    stopLocalSound();
    stopLocalAmbientPlayback();
  } else {
    applyLocalAmbientPlayback();
  }
}

function applyLocalWidgetPosition(x, y) {
  const demo = document.getElementById("breathsync-local-demo");
  if (!demo || !Number.isFinite(x) || !Number.isFinite(y)) return;
  const nextX = Math.max(8, Math.min(window.innerWidth - demo.offsetWidth - 8, x));
  const nextY = Math.max(8, Math.min(window.innerHeight - demo.offsetHeight - 8, y));
  demo.style.left = `${nextX}px`;
  demo.style.top = `${nextY}px`;
  demo.style.right = "auto";
  demo.style.bottom = "auto";
}

async function persistTechnique() {
  cycleStartedAt = Date.now();
  await storage.set({
    [STORAGE_KEYS.technique]: techniqueSelect.value,
    [STORAGE_KEYS.cycleStartedAt]: cycleStartedAt
  });
}

async function persistSound() {
  soundEnabled = soundToggle.checked;
  clearTimeout(paletteFadeTimer);
  if (soundEnabled) {
    if (!running || !Number.isFinite(cycleStartedAt) || cycleStartedAt <= 0) {
      cycleStartedAt = Date.now();
    }
    muted = false;
    setLocalMasterScale(0, 0.02);
    applyLocalMuteState();
    playFeedbackChime("enabled");
    await storage.set({
      [STORAGE_KEYS.cycleStartedAt]: cycleStartedAt,
      [STORAGE_KEYS.sound]: true,
      [STORAGE_KEYS.muted]: false
    });
    await ensureDurableAudioPlayback();
    restartPreviewLoop();
    paletteFadeTimer = window.setTimeout(() => {
      setLocalMasterScale(1, PALETTE_FADE_IN_SECONDS);
    }, 520);
  } else {
    stopLocalSound();
    await storage.set({ [STORAGE_KEYS.sound]: false });
  }
}

async function persistDarkMode() {
  darkModeEnabled = darkModeToggle.checked;
  applyDarkMode();

  await storage.set({
    [STORAGE_KEYS.darkMode]: darkModeEnabled
  });
}

async function persistSoundPreset() {
  currentSoundPreset = soundPreset.value;
  if (soundEnabled) {
    clearTimeout(techniqueTransitionTimer);
    setLocalMasterScale(0, 0.18);
    stopLocalSound();
    techniqueTransitionTimer = window.setTimeout(() => {
      restartPreviewLoop();
      setLocalMasterScale(1, 0.85);
    }, 420);
  }

  await storage.set({
    [STORAGE_KEYS.soundPreset]: currentSoundPreset
  });
}

async function persistAmbientEnabled() {
  ambientEnabled = ambientToggle.checked;
  fountainVolume = Number(fountainVolumeControl.value) / 100;
  rainVolume = Number(rainVolumeControl.value) / 100;
  kidsVolume = Number(kidsVolumeControl.value) / 100;
  if (
    ambientEnabled &&
    fountainVolume <= 0.001 &&
    rainVolume <= 0.001 &&
    kidsVolume <= 0.001
  ) {
    fountainVolume = DEFAULT_AMBIENT_VOLUME;
    rainVolume = DEFAULT_AMBIENT_VOLUME;
    kidsVolume = DEFAULT_AMBIENT_VOLUME;
  }
  if (ambientEnabled) {
    muted = false;
    applyLocalMuteState();
  } else {
    stopLocalAmbientPlayback();
  }
  applyAmbientVolumes();
  applyLocalAmbientPlayback();

  await storage.set({
    [STORAGE_KEYS.ambientEnabled]: ambientEnabled,
    [STORAGE_KEYS.fountainVolume]: fountainVolume,
    [STORAGE_KEYS.rainVolume]: rainVolume,
    [STORAGE_KEYS.kidsVolume]: kidsVolume,
    [STORAGE_KEYS.muted]: ambientEnabled ? false : muted
  });

  if (
    (soundEnabled || tickEnabled || ambientEnabled) &&
    isExtensionRuntime &&
    chrome.runtime
  ) {
    await startAmbientOffscreenPlayback();
  }
}

async function persistAmbientVolumes() {
  fountainVolume = Number(fountainVolumeControl.value) / 100;
  rainVolume = Number(rainVolumeControl.value) / 100;
  kidsVolume = Number(kidsVolumeControl.value) / 100;
  const hasAmbientVolume =
    ambientEnabled &&
    (fountainVolume > 0.001 || rainVolume > 0.001 || kidsVolume > 0.001);
  if (hasAmbientVolume) {
    muted = false;
    applyLocalMuteState();
  }
  applyAmbientVolumes();
  applyLocalAmbientPlayback();

  await storage.set({
    [STORAGE_KEYS.fountainVolume]: fountainVolume,
    [STORAGE_KEYS.rainVolume]: rainVolume,
    [STORAGE_KEYS.kidsVolume]: kidsVolume,
    [STORAGE_KEYS.muted]: hasAmbientVolume ? false : muted
  });

  if (
    (soundEnabled || tickEnabled || hasAmbientVolume) &&
    isExtensionRuntime &&
    chrome.runtime
  ) {
    await startAmbientOffscreenPlayback();
  }
}

async function persistVolume() {
  volumeTouched = true;
  soundVolume = Number(volumeControl.value) / 100;
  applyLocalVolume();

  await storage.set({
    [STORAGE_KEYS.volume]: soundVolume,
    [STORAGE_KEYS.volumeTouched]: true
  });
}

async function persistMasterVolume() {
  mixMasterVolume = Number(masterVolumeControl.value) / 100;
  applyMasterVolume();

  await storage.set({
    [STORAGE_KEYS.masterVolume]: mixMasterVolume
  });
}

async function persistTick() {
  tickEnabled = tickToggle.checked;
  if (!tickEnabled) clearLocalTickTimers();
  if (tickEnabled && running) restartPreviewLoop();

  await storage.set({
    [STORAGE_KEYS.tick]: tickEnabled
  });
}

async function persistTickVolume() {
  tickVolumeTouched = true;
  tickVolume = Number(tickVolumeControl.value) / 100;
  applyTickVolume();

  await storage.set({
    [STORAGE_KEYS.tickVolume]: tickVolume,
    [STORAGE_KEYS.tickVolumeTouched]: true
  });
}

async function persistTemperature() {
  temperature = Number(temperatureControl.value) / 100;
  applyTemperature();
  applyBinauralSpace();

  await storage.set({
    [STORAGE_KEYS.temperature]: temperature
  });
}

async function persistReverb() {
  reverbAmount = Number(reverbControl.value) / 100;
  applyReverb();

  await storage.set({
    [STORAGE_KEYS.reverb]: reverbAmount
  });
}

async function persistBinaural() {
  binauralEnabled = binauralToggle.checked;
  applyBinauralSpace();

  await storage.set({
    [STORAGE_KEYS.binaural]: binauralEnabled
  });
}

async function persistSpace() {
  spaceAmount = Number(spaceControl.value) / 100;
  applyBinauralSpace();

  await storage.set({
    [STORAGE_KEYS.space]: spaceAmount
  });
}

async function persistMidi() {
  midiEnabled = midiToggle.checked;
  if (midiEnabled) {
    setMidiStatus("MIDI setup tab handles output");
    setMidiDebug("Outputs: select IAC MIDI Driver Bus 1 in setup tab");
    openMidiPermissionPage("enable MIDI there");
  } else {
    allMidiNotesOff();
    setMidiStatus("MIDI off");
  }

  await storage.set({
    [STORAGE_KEYS.midi]: midiEnabled,
    [STORAGE_KEYS.midiOutput]: midiOutputId,
    [STORAGE_KEYS.midiOutputLabel]: midiOutputLabel
  });
}

async function persistMidiOutput() {
  openMidiPermissionPage("select MIDI output there");
}

function settleSliderMotion(control, delay = 260) {
  const activeTimer = sliderMotionTimers.get(control);
  if (activeTimer) window.clearTimeout(activeTimer);

  const timerId = window.setTimeout(() => {
    control.classList.remove("slider-active");
    sliderMotionTimers.delete(control);
  }, delay);

  sliderMotionTimers.set(control, timerId);
}

function markSliderMotion(control) {
  const activeTimer = sliderMotionTimers.get(control);
  if (activeTimer) window.clearTimeout(activeTimer);

  control.classList.add("slider-active");
  const timerId = window.setTimeout(() => {
    control.classList.remove("slider-active");
    sliderMotionTimers.delete(control);
  }, 640);

  sliderMotionTimers.set(control, timerId);
}

function bindSliderMotion(control) {
  control.addEventListener("pointerdown", () => markSliderMotion(control));
  control.addEventListener("input", () => markSliderMotion(control));
  control.addEventListener("pointerup", () => settleSliderMotion(control));
  control.addEventListener("pointercancel", () => settleSliderMotion(control));
  control.addEventListener("change", () => settleSliderMotion(control));
  control.addEventListener("blur", () => settleSliderMotion(control, 80));
}

sliderControls.forEach(bindSliderMotion);

techniqueSelect.addEventListener("change", async () => {
  await persistTechnique();
});

soundToggle.addEventListener("change", persistSound);
darkModeToggle.addEventListener("change", persistDarkMode);
soundPreset.addEventListener("change", persistSoundPreset);
ambientToggle.addEventListener("change", persistAmbientEnabled);
fountainVolumeControl.addEventListener("input", persistAmbientVolumes);
rainVolumeControl.addEventListener("input", persistAmbientVolumes);
kidsVolumeControl.addEventListener("input", persistAmbientVolumes);
volumeControl.addEventListener("input", persistVolume);
masterVolumeControl.addEventListener("input", persistMasterVolume);
temperatureControl.addEventListener("input", persistTemperature);
reverbControl.addEventListener("input", persistReverb);
binauralToggle.addEventListener("change", persistBinaural);
spaceControl.addEventListener("input", persistSpace);
tickToggle.addEventListener("change", persistTick);
tickVolumeControl.addEventListener("input", persistTickVolume);
midiToggle.addEventListener("change", persistMidi);
midiOutput.addEventListener("change", persistMidiOutput);
midiOutput.addEventListener("pointerdown", () => openMidiPermissionPage("select MIDI output there"));
midiTest.addEventListener("click", sendMidiTestNote);
openListen.addEventListener("click", openListenPage);

function playGuideStartAnimation() {
  document.body.classList.remove("guide-launching");
  void document.body.offsetWidth;
  document.body.classList.add("guide-launching");
  window.setTimeout(() => {
    document.body.classList.remove("guide-launching");
  }, 980);
}

toggleWidget.addEventListener("click", async () => {
  playGuideStartAnimation();
  running = true;
  soundEnabled = soundToggle.checked;
  currentSoundPreset = soundPreset.value;
  ambientEnabled = ambientToggle.checked;
  fountainVolume = Number(fountainVolumeControl.value) / 100;
  rainVolume = Number(rainVolumeControl.value) / 100;
  kidsVolume = Number(kidsVolumeControl.value) / 100;
  mixMasterVolume = Number(masterVolumeControl.value) / 100;
  soundVolume = Number(volumeControl.value) / 100;
  temperature = Number(temperatureControl.value) / 100;
  reverbAmount = Number(reverbControl.value) / 100;
  binauralEnabled = binauralToggle.checked;
  spaceAmount = Number(spaceControl.value) / 100;
  tickEnabled = tickToggle.checked;
  tickVolume = Number(tickVolumeControl.value) / 100;
  midiEnabled = midiToggle.checked;
  cycleStartedAt = Date.now();
  setLocalMasterScale(0, 0.02);
  playFeedbackChime("welcome");
  updateButtons();
  restartPreviewLoop();
  if (soundEnabled || tickEnabled) {
    setLocalMasterScale(1, PALETTE_FADE_IN_SECONDS);
  }

  await storage.set({
    [STORAGE_KEYS.running]: true,
    [STORAGE_KEYS.technique]: techniqueSelect.value,
    [STORAGE_KEYS.cycleStartedAt]: cycleStartedAt,
    [STORAGE_KEYS.sound]: soundEnabled,
    [STORAGE_KEYS.darkMode]: darkModeEnabled,
    [STORAGE_KEYS.soundPreset]: currentSoundPreset,
    [STORAGE_KEYS.ambientEnabled]: ambientEnabled,
    [STORAGE_KEYS.fountainVolume]: fountainVolume,
    [STORAGE_KEYS.rainVolume]: rainVolume,
    [STORAGE_KEYS.kidsVolume]: kidsVolume,
    [STORAGE_KEYS.masterVolume]: mixMasterVolume,
    [STORAGE_KEYS.volume]: soundVolume,
    [STORAGE_KEYS.volumeTouched]: volumeTouched,
    [STORAGE_KEYS.temperature]: temperature,
    [STORAGE_KEYS.reverb]: reverbAmount,
    [STORAGE_KEYS.binaural]: binauralEnabled,
    [STORAGE_KEYS.space]: spaceAmount,
    [STORAGE_KEYS.tick]: tickEnabled,
    [STORAGE_KEYS.tickVolume]: tickVolume,
    [STORAGE_KEYS.tickVolumeTouched]: tickVolumeTouched,
    [STORAGE_KEYS.midi]: midiEnabled,
    [STORAGE_KEYS.midiOutput]: midiOutputId,
    [STORAGE_KEYS.midiOutputLabel]: midiOutputLabel
  });
  await ensureDurableAudioPlayback();
  await injectFloatingGuideIntoActiveTab();
});

stopWidget.addEventListener("click", async () => {
  running = false;
  clearTimeout(techniqueTransitionTimer);
  updateButtons();
  await stopActiveFloatingGuideTab();

  await storage.set({
    [STORAGE_KEYS.running]: false
  });
  if (
    !soundEnabled &&
    !tickEnabled &&
    fountainVolume <= 0.001 &&
    rainVolume <= 0.001 &&
    kidsVolume <= 0.001
  ) {
    await closeDurableAudioPlayback();
  }
});

storage.onChanged((changes, area) => {
  if (area !== "local") return;

  if (changes[STORAGE_KEYS.technique]) {
    const nextTechnique = changes[STORAGE_KEYS.technique].newValue;
    if (TECHNIQUES[nextTechnique]) {
      techniqueSelect.value = nextTechnique;
      softRestartPreviewLoop();
    }
  }

  if (changes[STORAGE_KEYS.cycleStartedAt]) {
    cycleStartedAt = Number(changes[STORAGE_KEYS.cycleStartedAt].newValue);
    if (!Number.isFinite(cycleStartedAt)) cycleStartedAt = 0;
    restartPreviewLoop();
  }

  if (changes[STORAGE_KEYS.running]) {
    running = Boolean(changes[STORAGE_KEYS.running].newValue);
    updateButtons();
    if (running) restartPreviewLoop();
  }

  if (changes[STORAGE_KEYS.sound]) {
    soundEnabled = Boolean(changes[STORAGE_KEYS.sound].newValue);
    soundToggle.checked = soundEnabled;
    if (soundEnabled) bindLocalAudioUnlock();
    else stopLocalSound();
  }

  if (changes[STORAGE_KEYS.darkMode]) {
    darkModeEnabled = Boolean(changes[STORAGE_KEYS.darkMode].newValue);
    applyDarkMode();
  }

  if (changes[STORAGE_KEYS.soundPreset]) {
    currentSoundPreset = changes[STORAGE_KEYS.soundPreset].newValue || "tide";
    soundPreset.value = currentSoundPreset;
    if (soundEnabled) {
      clearTimeout(techniqueTransitionTimer);
      setLocalMasterScale(0, 0.18);
      stopLocalSound();
      techniqueTransitionTimer = window.setTimeout(() => {
        restartPreviewLoop();
        setLocalMasterScale(1, 0.85);
      }, 420);
    }
  }

  if (changes[STORAGE_KEYS.ambientEnabled]) {
    ambientEnabled = Boolean(changes[STORAGE_KEYS.ambientEnabled].newValue);
    applyAmbientVolumes();
    applyLocalAmbientPlayback();
  }

  if (
    changes[STORAGE_KEYS.fountainVolume] ||
    changes[STORAGE_KEYS.rainVolume] ||
    changes[STORAGE_KEYS.kidsVolume]
  ) {
    if (changes[STORAGE_KEYS.fountainVolume]) {
      fountainVolume = Number(changes[STORAGE_KEYS.fountainVolume].newValue);
      if (!Number.isFinite(fountainVolume)) fountainVolume = 0;
    }
    if (changes[STORAGE_KEYS.rainVolume]) {
      rainVolume = Number(changes[STORAGE_KEYS.rainVolume].newValue);
      if (!Number.isFinite(rainVolume)) rainVolume = 0;
    }
    if (changes[STORAGE_KEYS.kidsVolume]) {
      kidsVolume = Number(changes[STORAGE_KEYS.kidsVolume].newValue);
      if (!Number.isFinite(kidsVolume)) kidsVolume = 0;
    }
    applyAmbientVolumes();
  }

  if (changes[STORAGE_KEYS.ambientDebug]) {
    guideStatus.textContent = changes[STORAGE_KEYS.ambientDebug].newValue || guideStatus.textContent;
  }

  if (changes[STORAGE_KEYS.volume]) {
    soundVolume = Number(changes[STORAGE_KEYS.volume].newValue);
    if (!Number.isFinite(soundVolume)) soundVolume = 0.35;
    applyLocalVolume();
  }

  if (changes[STORAGE_KEYS.masterVolume]) {
    mixMasterVolume = Number(changes[STORAGE_KEYS.masterVolume].newValue);
    if (!Number.isFinite(mixMasterVolume)) mixMasterVolume = 0.5;
    applyMasterVolume();
  }

  if (changes[STORAGE_KEYS.temperature]) {
    temperature = Number(changes[STORAGE_KEYS.temperature].newValue);
    if (!Number.isFinite(temperature)) temperature = 0;
    applyTemperature();
    if (running) restartPreviewLoop();
  }

  if (changes[STORAGE_KEYS.reverb]) {
    reverbAmount = Number(changes[STORAGE_KEYS.reverb].newValue);
    if (!Number.isFinite(reverbAmount)) reverbAmount = 0.8;
    applyReverb();
  }

  if (changes[STORAGE_KEYS.binaural]) {
    binauralEnabled = Boolean(changes[STORAGE_KEYS.binaural].newValue);
    binauralToggle.checked = binauralEnabled;
    applyBinauralSpace();
  }

  if (changes[STORAGE_KEYS.space]) {
    spaceAmount = Number(changes[STORAGE_KEYS.space].newValue);
    if (!Number.isFinite(spaceAmount)) spaceAmount = 0.5;
    applyBinauralSpace();
  }

  if (changes[STORAGE_KEYS.tick]) {
    tickEnabled = Boolean(changes[STORAGE_KEYS.tick].newValue);
    tickToggle.checked = tickEnabled;
    if (!tickEnabled) clearLocalTickTimers();
  }

  if (changes[STORAGE_KEYS.tickVolume]) {
    tickVolume = Number(changes[STORAGE_KEYS.tickVolume].newValue);
    if (!Number.isFinite(tickVolume)) tickVolume = 0.35;
    applyTickVolume();
  }

  if (changes[STORAGE_KEYS.tickVolumeTouched]) {
    tickVolumeTouched = Boolean(changes[STORAGE_KEYS.tickVolumeTouched].newValue);
  }

  if (changes[STORAGE_KEYS.midi]) {
    midiEnabled = Boolean(changes[STORAGE_KEYS.midi].newValue);
    midiToggle.checked = midiEnabled;
    if (midiEnabled) renderMidiSetupHint();
    else {
      allMidiNotesOff();
      setMidiStatus("MIDI off");
      setMidiDebug("Outputs: enable MIDI notes out to scan");
    }
  }

  if (changes[STORAGE_KEYS.midiOutput]) {
    midiOutputId = changes[STORAGE_KEYS.midiOutput].newValue || "";
    renderMidiOutputSelection();
    if (midiEnabled) renderMidiSetupHint();
  }

  if (changes[STORAGE_KEYS.midiOutputLabel]) {
    midiOutputLabel = changes[STORAGE_KEYS.midiOutputLabel].newValue || "";
    renderMidiOutputSelection();
    if (midiEnabled && midiOutputLabel) {
      renderMidiSetupHint();
    }
  }

  if (changes[STORAGE_KEYS.muted]) {
    muted = Boolean(changes[STORAGE_KEYS.muted].newValue);
    applyLocalMuteState();
  }

  if (changes[STORAGE_KEYS.widgetX] || changes[STORAGE_KEYS.widgetY]) {
    if (changes[STORAGE_KEYS.widgetX]) {
      localWidgetX = Number(changes[STORAGE_KEYS.widgetX].newValue);
    }
    if (changes[STORAGE_KEYS.widgetY]) {
      localWidgetY = Number(changes[STORAGE_KEYS.widgetY].newValue);
    }
    applyLocalWidgetPosition(localWidgetX, localWidgetY);
  }
});

storage.get(
  {
    [STORAGE_KEYS.technique]: "focus",
    [STORAGE_KEYS.cycleStartedAt]: 0,
    [STORAGE_KEYS.launchDefaultsVersion]: "",
    [STORAGE_KEYS.running]: false,
    [STORAGE_KEYS.sound]: false,
    [STORAGE_KEYS.soundDefaultMigrated]: false,
    [STORAGE_KEYS.darkMode]: false,
    [STORAGE_KEYS.soundPreset]: "tide",
    [STORAGE_KEYS.ambientEnabled]: false,
    [STORAGE_KEYS.fountainVolume]: DEFAULT_AMBIENT_VOLUME,
    [STORAGE_KEYS.rainVolume]: DEFAULT_AMBIENT_VOLUME,
    [STORAGE_KEYS.kidsVolume]: DEFAULT_AMBIENT_VOLUME,
    [STORAGE_KEYS.ambientDebug]: "",
    [STORAGE_KEYS.masterVolume]: 0.5,
    [STORAGE_KEYS.volume]: 0.35,
    [STORAGE_KEYS.volumeTouched]: false,
    [STORAGE_KEYS.temperature]: 0,
    [STORAGE_KEYS.reverb]: 0.8,
    [STORAGE_KEYS.binaural]: false,
    [STORAGE_KEYS.space]: 0.5,
    [STORAGE_KEYS.tick]: false,
    [STORAGE_KEYS.tickVolume]: 0.35,
    [STORAGE_KEYS.tickVolumeTouched]: false,
    [STORAGE_KEYS.midi]: false,
    [STORAGE_KEYS.midiOutput]: "",
    [STORAGE_KEYS.midiOutputLabel]: "",
    [STORAGE_KEYS.muted]: false
  },
  (data) => {
    const savedTechnique = data[STORAGE_KEYS.technique];
    const shouldApplyLaunchDefaults =
      data[STORAGE_KEYS.launchDefaultsVersion] !== LAUNCH_DEFAULTS_VERSION;
    const shouldMigrateSoundDefault = !Boolean(data[STORAGE_KEYS.soundDefaultMigrated]);
    techniqueSelect.value =
      shouldApplyLaunchDefaults || !TECHNIQUES[savedTechnique] ? "focus" : savedTechnique;
    running = shouldApplyLaunchDefaults ? false : Boolean(data[STORAGE_KEYS.running]);
    cycleStartedAt = shouldApplyLaunchDefaults ? 0 : Number(data[STORAGE_KEYS.cycleStartedAt]);
    if (!Number.isFinite(cycleStartedAt)) cycleStartedAt = 0;
    soundEnabled =
      shouldApplyLaunchDefaults || shouldMigrateSoundDefault
        ? false
        : Boolean(data[STORAGE_KEYS.sound]);
    darkModeEnabled = shouldApplyLaunchDefaults
      ? false
      : Boolean(data[STORAGE_KEYS.darkMode]);
    currentSoundPreset = shouldApplyLaunchDefaults
      ? "tide"
      : data[STORAGE_KEYS.soundPreset] || "tide";
    ambientEnabled = shouldApplyLaunchDefaults
      ? false
      : Boolean(data[STORAGE_KEYS.ambientEnabled]);
    fountainVolume = shouldApplyLaunchDefaults
      ? DEFAULT_AMBIENT_VOLUME
      : Number(data[STORAGE_KEYS.fountainVolume]);
    if (!Number.isFinite(fountainVolume)) fountainVolume = DEFAULT_AMBIENT_VOLUME;
    rainVolume = shouldApplyLaunchDefaults
      ? DEFAULT_AMBIENT_VOLUME
      : Number(data[STORAGE_KEYS.rainVolume]);
    if (!Number.isFinite(rainVolume)) rainVolume = DEFAULT_AMBIENT_VOLUME;
    kidsVolume = shouldApplyLaunchDefaults
      ? DEFAULT_AMBIENT_VOLUME
      : Number(data[STORAGE_KEYS.kidsVolume]);
    if (!Number.isFinite(kidsVolume)) kidsVolume = DEFAULT_AMBIENT_VOLUME;
    volumeTouched = shouldApplyLaunchDefaults
      ? false
      : Boolean(data[STORAGE_KEYS.volumeTouched]);
    temperature = shouldApplyLaunchDefaults ? 0 : Number(data[STORAGE_KEYS.temperature]);
    if (!Number.isFinite(temperature)) temperature = 0;
    reverbAmount = shouldApplyLaunchDefaults ? 0.8 : Number(data[STORAGE_KEYS.reverb]);
    if (!Number.isFinite(reverbAmount)) reverbAmount = 0.8;
    binauralEnabled = shouldApplyLaunchDefaults ? false : Boolean(data[STORAGE_KEYS.binaural]);
    spaceAmount = shouldApplyLaunchDefaults ? 0.5 : Number(data[STORAGE_KEYS.space]);
    if (!Number.isFinite(spaceAmount)) spaceAmount = 0.5;
    mixMasterVolume = shouldApplyLaunchDefaults ? 0.5 : Number(data[STORAGE_KEYS.masterVolume]);
    if (!Number.isFinite(mixMasterVolume)) mixMasterVolume = 0.5;
    soundVolume = volumeTouched
      ? Number(data[STORAGE_KEYS.volume])
      : 0.35;
    if (!Number.isFinite(soundVolume)) soundVolume = 0.35;
    soundToggle.checked = soundEnabled;
    applyDarkMode();
    soundPreset.value = currentSoundPreset;
    applyAmbientVolumes();
    applyMasterVolume();
    applyLocalVolume();
    applyTemperature();
    applyReverb();
    binauralToggle.checked = binauralEnabled;
    applyBinauralSpace();
    tickEnabled = shouldApplyLaunchDefaults ? false : Boolean(data[STORAGE_KEYS.tick]);
    tickVolumeTouched = shouldApplyLaunchDefaults
      ? false
      : Boolean(data[STORAGE_KEYS.tickVolumeTouched]);
    tickVolume = tickVolumeTouched ? Number(data[STORAGE_KEYS.tickVolume]) : 0.35;
    if (!Number.isFinite(tickVolume)) tickVolume = 0.35;
    midiEnabled = shouldApplyLaunchDefaults ? false : Boolean(data[STORAGE_KEYS.midi]);
    midiOutputId = data[STORAGE_KEYS.midiOutput] || "";
    midiOutputLabel = data[STORAGE_KEYS.midiOutputLabel] || "";
    muted = shouldApplyLaunchDefaults ? false : Boolean(data[STORAGE_KEYS.muted]);
    tickToggle.checked = tickEnabled;
    applyTickVolume();
    midiToggle.checked = midiEnabled;
    renderMidiOutputSelection();
    if (midiEnabled) renderMidiSetupHint();
    else {
      setMidiStatus("MIDI off");
      setMidiDebug("Outputs: enable MIDI notes out to scan");
    }
    applyLocalMuteState();
    localWidgetX = Number(data[STORAGE_KEYS.widgetX]);
    localWidgetY = Number(data[STORAGE_KEYS.widgetY]);
    updateButtons();
    restartPreviewLoop();
    if (
      (soundEnabled ||
        (ambientEnabled &&
          (fountainVolume > 0.001 || rainVolume > 0.001 || kidsVolume > 0.001))) &&
      isExtensionRuntime &&
      chrome.runtime
    ) {
      chrome.runtime.sendMessage({ type: "breathsync-ensure-offscreen-audio" }).catch(() => {});
    }
    if (shouldApplyLaunchDefaults || shouldMigrateSoundDefault) {
      storage.set({
        [STORAGE_KEYS.launchDefaultsVersion]: LAUNCH_DEFAULTS_VERSION,
        [STORAGE_KEYS.running]: false,
        [STORAGE_KEYS.technique]: "focus",
        [STORAGE_KEYS.cycleStartedAt]: 0,
        [STORAGE_KEYS.sound]: false,
        [STORAGE_KEYS.soundDefaultMigrated]: true,
        [STORAGE_KEYS.darkMode]: false,
        [STORAGE_KEYS.soundPreset]: "tide",
        [STORAGE_KEYS.ambientEnabled]: false,
        [STORAGE_KEYS.fountainVolume]: DEFAULT_AMBIENT_VOLUME,
        [STORAGE_KEYS.rainVolume]: DEFAULT_AMBIENT_VOLUME,
        [STORAGE_KEYS.kidsVolume]: DEFAULT_AMBIENT_VOLUME,
        [STORAGE_KEYS.masterVolume]: 0.5,
        [STORAGE_KEYS.volume]: 0.35,
        [STORAGE_KEYS.volumeTouched]: false,
        [STORAGE_KEYS.temperature]: 0,
        [STORAGE_KEYS.reverb]: 0.8,
        [STORAGE_KEYS.binaural]: false,
        [STORAGE_KEYS.space]: 0.5,
        [STORAGE_KEYS.tick]: false,
        [STORAGE_KEYS.tickVolume]: 0.35,
        [STORAGE_KEYS.tickVolumeTouched]: false,
        [STORAGE_KEYS.midi]: false,
        [STORAGE_KEYS.midiOutput]: "",
        [STORAGE_KEYS.midiOutputLabel]: "",
        [STORAGE_KEYS.muted]: false
      });
    }
  }
);
