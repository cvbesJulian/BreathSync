(() => {
if (window.__breathsyncContentLoaded) return;
window.__breathsyncContentLoaded = true;
const BREATHSYNC_IS_OFFSCREEN_AUDIO = location.pathname.endsWith("offscreen.html");

const BREATHSYNC_STORAGE_KEYS = {
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
  temperature: "breathsyncTemperature",
  reverb: "breathsyncReverb",
  binaural: "breathsyncBinaural",
  space: "breathsyncSpace",
  tick: "breathsyncTick",
  tickVolume: "breathsyncTickVolume",
  tickVolumeTouched: "breathsyncTickVolumeTouched",
  midi: "breathsyncMidi",
  midiOutput: "breathsyncMidiOutput",
  activeTabId: "breathsyncActiveTabId",
  muted: "breathsyncMuted",
  widgetX: "breathsyncWidgetX",
  widgetY: "breathsyncWidgetY",
  followHarmony: "breathsyncFollowHarmony",
  followStrength: "breathsyncFollowStrength",
  harmonyState: "breathsyncHarmonyState"
};
const BREATHSYNC_PALETTE_FADE_IN_SECONDS = 1.5;

function breathsyncHasStorage() {
  return (
    typeof chrome !== "undefined" &&
    chrome.storage &&
    chrome.storage.local &&
    chrome.storage.onChanged
  );
}

function breathsyncHasRuntime() {
  return typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage;
}

const BREATHSYNC_TECHNIQUES = {
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

const BREATHSYNC_LAUNCH_DEFAULTS_VERSION = "2026-05-04-v8";
const BREATHSYNC_DEFAULT_AMBIENT_VOLUME = 0.15;
const BREATHSYNC_PALETTE_REFERENCE_VOLUME = 0.25;
const BREATHSYNC_PALETTE_REFERENCE_GAIN = 0.88;
const BREATHSYNC_PALETTE_LUFS_RANGE_DB = 5;
const BREATHSYNC_AMBIENT_CONFIG = {
  fountain: {
    url: "Sound_FX/Fountain.wav",
    duration: 64.884,
    crossfade: 3.2,
    trimStart: 2.4,
    trimEnd: 2.6,
    level: 1.87
  },
  rain: {
    url: "Sound_FX/Rain.wav",
    duration: 67.924,
    crossfade: 3.2,
    trimStart: 2.6,
    trimEnd: 3,
    level: 0.746
  },
  kids: {
    url: "Sound_FX/Kids_Playing.wav",
    duration: 66.337,
    crossfade: 2.8,
    trimStart: 2.8,
    trimEnd: 3.2,
    level: 0.547
  }
};

let breathsyncTechniqueKey = "focus";
let breathsyncCycleStartedAt = 0;
let breathsyncRunning = false;
let breathsyncSoundEnabled = false;
let breathsyncDarkModeEnabled = false;
let breathsyncSoundPreset = "tide";
let breathsyncAmbientEnabled = false;
let breathsyncMasterVolume = 0.5;
let breathsyncVolume = 0.35;
let breathsyncFountainVolume = 0;
let breathsyncRainVolume = 0;
let breathsyncKidsVolume = 0;
let breathsyncTemperature = 0;
let breathsyncFollowHarmony = false;
let breathsyncFollowStrength = 0.6;
let breathsyncHarmonyState = null;
let breathsyncReverbAmount = 0.8;
let breathsyncBinauralEnabled = false;
let breathsyncSpaceAmount = 0.5;
let breathsyncTickEnabled = false;
let breathsyncTickVolume = 0.35;
let breathsyncMidiEnabled = false;
let breathsyncMidiOutputId = "";
let breathsyncMuted = false;
let breathsyncMasterVolumeScale = 1;
let breathsyncMixOutputGain = null;
let breathsyncTechniqueTransitionTimer = null;
let breathsyncTimers = [];
let breathsyncTickTimers = [];
let breathsyncAudioContext = null;
let breathsyncMasterGain = null;
let breathsyncDryGain = null;
let breathsyncReverbGain = null;
let breathsyncReverbNode = null;
let breathsyncReverbDelay = null;
let breathsyncPingPongGain = null;
let breathsyncBinauralGain = null;
let breathsyncBinauralDelayLeft = null;
let breathsyncBinauralDelayRight = null;
let breathsyncBinauralPanLeft = null;
let breathsyncBinauralPanRight = null;
let breathsyncBinauralHrtfGain = null;
let breathsyncBinauralPanner = null;
let breathsyncActiveSound = null;
let breathsyncReversedPianoBuffer = null;
let breathsyncAmbientGain = null;
let breathsyncAmbientDirectGain = null;
let breathsyncAmbientBuffers = {};
let breathsyncAmbientBufferPromises = {};
let breathsyncAmbientBeds = {};
let breathsyncAmbientElements = {};
let breathsyncAmbientElementRampTimers = {};
let breathsyncMidiAccess = null;
let breathsyncMidiOut = null;
let breathsyncMidiNoteTimers = [];
let breathsyncMidiSendCount = 0;
let breathsyncMidiBridgeChannel = null;
let breathsyncTabEnabled = BREATHSYNC_IS_OFFSCREEN_AUDIO;
let breathsyncStartRequested = false;

function breathsyncClearTimers() {
  breathsyncTimers.forEach((timerId) => clearTimeout(timerId));
  breathsyncTimers = [];
}

function breathsyncClearTickTimers() {
  breathsyncTickTimers.forEach((timerId) => clearTimeout(timerId));
  breathsyncTickTimers = [];
}

function breathsyncFrequencyToMidiNote(frequency) {
  return Math.max(0, Math.min(127, Math.round(69 + 12 * Math.log2(frequency / 440))));
}

function breathsyncClearMidiTimers() {
  breathsyncMidiNoteTimers.forEach((timerId) => clearTimeout(timerId));
  breathsyncMidiNoteTimers = [];
}

async function breathsyncQueryMidiPermissionState() {
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

async function breathsyncRefreshMidiOutput() {
  breathsyncMidiAccess = null;
  breathsyncMidiOut = null;
  return null;
}

function breathsyncAllMidiNotesOff() {
  breathsyncClearMidiTimers();
  for (let channel = 0; channel < 16; channel += 1) {
    breathsyncSendRawMidi([0xb0 + channel, 123, 0]);
  }
}

function breathsyncSendBridgeMidi(message) {
  return false;
}

async function breathsyncEnsureMidiOutput() {
  if (!breathsyncMidiEnabled) return null;
  if (!breathsyncMidiOut) {
    await breathsyncRefreshMidiOutput();
  }
  if (breathsyncMidiOut && typeof breathsyncMidiOut.open === "function") {
    await breathsyncMidiOut.open();
  }
  return breathsyncMidiOut;
}

function breathsyncSendRawMidi(message) {
  return false;
}

function breathsyncScheduleMidiNote(frequency, startDelayMs, durationMs, velocity = 54) {
  if (!breathsyncMidiEnabled) return;

  const note = breathsyncFrequencyToMidiNote(frequency);
  const onTimer = setTimeout(() => {
    breathsyncSendRawMidi([0x90, note, velocity]);
  }, Math.max(0, startDelayMs));
  const offTimer = setTimeout(() => {
    breathsyncSendRawMidi([0x80, note, 0]);
  }, Math.max(0, startDelayMs + durationMs));

  breathsyncMidiNoteTimers.push(onTimer, offTimer);
}

function breathsyncScheduleTemperatureLeadMidi(
  label,
  duration,
  sound,
  octaveBase = 4,
  responseDelayMs = 0,
  velocityScale = 1
) {
  const amount = breathsyncTemperature;
  if (amount < 0.5 || !sound) return;

  const subdivision = breathsyncGetTemperatureLeadSubdivision(amount, octaveBase);
  const noteCount = Math.max(1, Math.ceil((duration - 0.08) / subdivision));

  for (let index = 0; index < noteCount; index += 1) {
    const isSteppedHighLead = octaveBase >= 4 && amount >= 0.9;
    const rhythmPush = amount > 0.72
      ? (Math.random() - 0.5) * subdivision * (isSteppedHighLead ? 0.12 : 0.38)
      : 0;
    const offset = Math.max(
      0.04,
      Math.min(duration - 0.06, index * subdivision + subdivision * 0.32 + rhythmPush)
    );
    const frequency = breathsyncGetTemperatureLeadFrequency(
      sound,
      duration,
      label,
      amount,
      index,
      offset,
      octaveBase
    );
    const noteLength = Math.max(45, Math.min(160, subdivision * 300));
    const velocity = Math.max(18, Math.round((octaveBase >= 4 ? 34 : 28) * velocityScale));

    breathsyncScheduleMidiNote(
      frequency,
      responseDelayMs + offset * 1000,
      noteLength,
      velocity
    );
  }
}

async function breathsyncSendMidiPhaseNotes(label, duration, sound, melodyNotes) {
  await breathsyncEnsureMidiOutput();
  if (!sound) return;

  breathsyncClearMidiTimers();
  const phaseMs = duration * 1000;
  const sequence = Array.isArray(sound.sequence) ? sound.sequence : [];

  if (sound.bell || sound.granular || !Array.isArray(sequence[0])) {
    const stepMs = Math.max(240, phaseMs / Math.max(1, sequence.length));
    sequence.forEach((frequency, index) => {
      breathsyncScheduleMidiNote(
        frequency,
        index * stepMs,
        Math.min(stepMs * 0.78, 900),
        48
      );
    });
  } else {
    const stepMs = Math.max(420, phaseMs / Math.max(1, sequence.length));
    sequence.forEach((chord, stepIndex) => {
      chord.forEach((frequency, voiceIndex) => {
        breathsyncScheduleMidiNote(
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
      breathsyncScheduleMidiNote(frequency, index * stepMs + 80, stepMs * 0.72, velocity);
    });
  }

  breathsyncScheduleTemperatureLeadMidi(label, duration, sound, 4, 0, 1);
  breathsyncScheduleTemperatureLeadMidi(
    label === "Exhale" ? "Inhale" : label,
    duration,
    sound,
    2,
    Math.max(80, (0.5 - breathsyncTemperature * 0.22) * 1000),
    0.72
  );
}

function breathsyncRoutePhaseMidi(label, duration) {
  return;
}

function breathsyncSchedule(callback, delay) {
  const timerId = setTimeout(callback, delay);
  breathsyncTimers.push(timerId);
}

function breathsyncGetWidget() {
  return document.getElementById("breathsync-widget");
}

function breathsyncCreateWidget() {
  if (breathsyncGetWidget()) return;
  if (!document.body) return;

  const widget = document.createElement("div");
  widget.id = "breathsync-widget";
  widget.className = "breathsync-hidden";
  widget.setAttribute("role", "status");
  widget.setAttribute("aria-live", "polite");

  widget.innerHTML = `
    <span class="breathsync-widget-logo" aria-hidden="true"></span>
    <h2 id="breathsync-title">BreathSync</h2>
    <button id="breathsync-close" type="button" aria-label="Close guide">x</button>
    <button id="breathsync-mute" type="button" aria-label="Mute sound">Mute</button>
    <p id="breathsync-subtitle">Quiet regulation</p>
    <div id="breathsync-orb" aria-hidden="true"></div>
    <p id="breathsync-phase">Ready</p>
  `;

  document.body.appendChild(widget);
  breathsyncBindWidgetControls(widget);
}

function breathsyncBindWidgetControls(widget) {
  const muteButton = document.getElementById("breathsync-mute");
  const closeButton = document.getElementById("breathsync-close");
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let widgetStartX = 0;
  let widgetStartY = 0;

  if (muteButton) {
    muteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      breathsyncMuted = !breathsyncMuted;
      breathsyncApplyMuteState();
      if (breathsyncHasStorage()) {
        chrome.storage.local.set({
          [BREATHSYNC_STORAGE_KEYS.muted]: breathsyncMuted
        });
      }
    });
  }

  if (closeButton) {
    closeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      breathsyncStopWidget();
      if (breathsyncHasStorage()) {
        chrome.storage.local.set({
          [BREATHSYNC_STORAGE_KEYS.running]: false,
          [BREATHSYNC_STORAGE_KEYS.activeTabId]: null
        });
      }
    });
  }

  widget.addEventListener("pointerdown", (event) => {
    if (event.target === muteButton || event.target === closeButton) return;

    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    const rect = widget.getBoundingClientRect();
    widgetStartX = rect.left;
    widgetStartY = rect.top;
    widget.setPointerCapture(event.pointerId);
    widget.classList.add("breathsync-dragging");
  });

  widget.addEventListener("pointermove", (event) => {
    if (!dragging) return;

    const nextX = Math.max(
      8,
      Math.min(window.innerWidth - widget.offsetWidth - 8, widgetStartX + event.clientX - startX)
    );
    const nextY = Math.max(
      8,
      Math.min(window.innerHeight - widget.offsetHeight - 8, widgetStartY + event.clientY - startY)
    );
    widget.style.left = `${nextX}px`;
    widget.style.top = `${nextY}px`;
    widget.style.right = "auto";
    widget.style.bottom = "auto";
  });

  widget.addEventListener("pointerup", (event) => {
    if (!dragging) return;

    dragging = false;
    widget.releasePointerCapture(event.pointerId);
    widget.classList.remove("breathsync-dragging");
    const rect = widget.getBoundingClientRect();
    if (breathsyncHasStorage()) {
      chrome.storage.local.set({
        [BREATHSYNC_STORAGE_KEYS.widgetX]: rect.left,
        [BREATHSYNC_STORAGE_KEYS.widgetY]: rect.top
      });
    }
  });
}

function breathsyncApplyMuteState() {
  const muteButton = document.getElementById("breathsync-mute");
  if (muteButton) {
    muteButton.textContent = breathsyncMuted ? "Unmute" : "Mute";
    muteButton.setAttribute("aria-pressed", String(breathsyncMuted));
  }

  if (breathsyncMuted) {
    breathsyncStopSound();
    breathsyncStopAmbientBeds();
    breathsyncStopAmbientElements();
    breathsyncClearTickTimers();
  } else if (breathsyncTabEnabled) {
    breathsyncApplyAmbientVolumes();
  }
}

function breathsyncApplyWidgetPosition(x, y) {
  const widget = breathsyncGetWidget();
  if (!widget || !Number.isFinite(x) || !Number.isFinite(y)) return;

  const nextX = Math.max(8, Math.min(window.innerWidth - widget.offsetWidth - 8, x));
  const nextY = Math.max(8, Math.min(window.innerHeight - widget.offsetHeight - 8, y));
  widget.style.left = `${nextX}px`;
  widget.style.top = `${nextY}px`;
  widget.style.right = "auto";
  widget.style.bottom = "auto";
}

function breathsyncApplyDarkMode() {
  const widget = breathsyncGetWidget();
  if (widget) {
    widget.classList.toggle("breathsync-dark", breathsyncDarkModeEnabled);
  }
}

function breathsyncSetPhase(label, scale, duration, glow) {
  const orb = document.getElementById("breathsync-orb");
  const phase = document.getElementById("breathsync-phase");

  if (!orb || !phase) return;

  phase.textContent = label;
  orb.style.transitionDuration = `${duration}s`;
  orb.style.transform = `scale(${scale})`;
  orb.style.opacity = label === "Exhale" ? "0.58" : "1";
  orb.style.filter = glow ? "brightness(1.04)" : "brightness(1)";
  breathsyncSetBinauralPosition(label);
  breathsyncRoutePhaseMidi(label, duration);
  if (BREATHSYNC_IS_OFFSCREEN_AUDIO || breathsyncTabEnabled) {
    breathsyncPlayPhaseSound(label, duration);
    breathsyncStartTickPattern(label, duration);
  }
}

function breathsyncEnsureAudio() {
  if (
    (!breathsyncRunning &&
      !((BREATHSYNC_IS_OFFSCREEN_AUDIO || breathsyncTabEnabled) && breathsyncHasAmbientVolume())) ||
    breathsyncMuted ||
    (!breathsyncSoundEnabled && !breathsyncTickEnabled && !breathsyncHasAmbientVolume())
  ) {
    return null;
  }

  if (!breathsyncAudioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;

    breathsyncAudioContext = new AudioContextClass();
    breathsyncMixOutputGain = breathsyncAudioContext.createGain();
    breathsyncMasterGain = breathsyncAudioContext.createGain();
    breathsyncDryGain = breathsyncAudioContext.createGain();
    breathsyncReverbGain = breathsyncAudioContext.createGain();
    breathsyncReverbDelay = breathsyncAudioContext.createDelay(0.2);
    breathsyncPingPongGain = breathsyncAudioContext.createGain();
    const breathsyncPingInput = breathsyncAudioContext.createGain();
    const breathsyncPingDelayLeft = breathsyncAudioContext.createDelay(1);
    const breathsyncPingDelayRight = breathsyncAudioContext.createDelay(1);
    const breathsyncPingFeedback = breathsyncAudioContext.createGain();
    const breathsyncPingPanLeft = breathsyncAudioContext.createStereoPanner();
    const breathsyncPingPanRight = breathsyncAudioContext.createStereoPanner();
    breathsyncBinauralGain = breathsyncAudioContext.createGain();
    breathsyncBinauralDelayLeft = breathsyncAudioContext.createDelay(0.05);
    breathsyncBinauralDelayRight = breathsyncAudioContext.createDelay(0.05);
    breathsyncBinauralPanLeft = breathsyncAudioContext.createStereoPanner();
    breathsyncBinauralPanRight = breathsyncAudioContext.createStereoPanner();
    breathsyncBinauralHrtfGain = breathsyncAudioContext.createGain();
    breathsyncBinauralPanner = breathsyncAudioContext.createPanner();
    breathsyncReverbNode = breathsyncAudioContext.createConvolver();

    breathsyncMixOutputGain.gain.value = Math.max(0, Math.min(1, breathsyncMasterVolume));
    breathsyncMasterGain.gain.value = breathsyncGetScaledMasterVolume();
    breathsyncDryGain.gain.value = 0.46;
    breathsyncReverbGain.gain.value = breathsyncGetReverbWetLevel();
    breathsyncReverbDelay.delayTime.value = 0.045;
    breathsyncPingPongGain.gain.value = 0.25;
    breathsyncPingDelayLeft.delayTime.value = 0.28;
    breathsyncPingDelayRight.delayTime.value = 0.42;
    breathsyncPingFeedback.gain.value = 0.26;
    breathsyncPingPanLeft.pan.value = -0.75;
    breathsyncPingPanRight.pan.value = 0.75;
    breathsyncApplyBinauralSpace();
    breathsyncReverbNode.buffer = breathsyncCreateLargeReverbImpulse(
      breathsyncAudioContext,
      breathsyncGetReverbDuration(),
      breathsyncGetReverbDecay()
    );

    breathsyncMasterGain.connect(breathsyncDryGain);
    breathsyncMasterGain.connect(breathsyncReverbDelay);
    breathsyncMasterGain.connect(breathsyncPingInput);
    breathsyncReverbDelay.connect(breathsyncReverbNode);
    breathsyncDryGain.connect(breathsyncMixOutputGain);
    breathsyncReverbNode.connect(breathsyncReverbGain);
    breathsyncReverbGain.connect(breathsyncMixOutputGain);
    breathsyncPingInput.connect(breathsyncPingDelayLeft);
    breathsyncPingDelayLeft.connect(breathsyncPingPanLeft);
    breathsyncPingDelayLeft.connect(breathsyncPingDelayRight);
    breathsyncPingDelayRight.connect(breathsyncPingPanRight);
    breathsyncPingDelayRight.connect(breathsyncPingFeedback);
    breathsyncPingFeedback.connect(breathsyncPingDelayLeft);
    breathsyncPingPanLeft.connect(breathsyncPingPongGain);
    breathsyncPingPanRight.connect(breathsyncPingPongGain);
    breathsyncPingPongGain.connect(breathsyncMixOutputGain);
    breathsyncMasterGain.connect(breathsyncBinauralDelayLeft);
    breathsyncMasterGain.connect(breathsyncBinauralDelayRight);
    breathsyncBinauralDelayLeft.connect(breathsyncBinauralPanLeft);
    breathsyncBinauralDelayRight.connect(breathsyncBinauralPanRight);
    breathsyncBinauralPanLeft.connect(breathsyncBinauralGain);
    breathsyncBinauralPanRight.connect(breathsyncBinauralGain);
    breathsyncBinauralGain.connect(breathsyncMixOutputGain);
    breathsyncBinauralPanner.panningModel = "HRTF";
    breathsyncBinauralPanner.distanceModel = "inverse";
    breathsyncBinauralPanner.refDistance = 1;
    breathsyncBinauralPanner.maxDistance = 10;
    breathsyncBinauralPanner.rolloffFactor = 0.65;
    breathsyncBinauralPanner.coneInnerAngle = 360;
    breathsyncBinauralPanner.coneOuterAngle = 360;
    breathsyncMasterGain.connect(breathsyncBinauralPanner);
    breathsyncBinauralPanner.connect(breathsyncBinauralHrtfGain);
    breathsyncBinauralHrtfGain.connect(breathsyncMixOutputGain);
    breathsyncMixOutputGain.connect(breathsyncAudioContext.destination);
  }

  if (breathsyncAudioContext.state === "suspended") {
    breathsyncAudioContext.resume().catch(() => {});
  }

  return breathsyncAudioContext;
}

function breathsyncEnsureAmbientAudio() {
  if (
    !(BREATHSYNC_IS_OFFSCREEN_AUDIO || breathsyncTabEnabled) ||
    breathsyncMuted ||
    !breathsyncHasAmbientVolume()
  ) {
    return null;
  }

  const context = breathsyncAudioContext || breathsyncEnsureAudio();
  if (!context) return null;

  if (!breathsyncAmbientGain) {
    breathsyncAmbientGain = context.createGain();
    breathsyncAmbientDirectGain = context.createGain();
    breathsyncAmbientGain.gain.value = 0.88;
    breathsyncAmbientDirectGain.gain.value = breathsyncBinauralEnabled ? 0.45 : 1;
    breathsyncAmbientGain.connect(breathsyncAmbientDirectGain);
    breathsyncAmbientDirectGain.connect(breathsyncMixOutputGain || context.destination);
    if (breathsyncBinauralDelayLeft && breathsyncBinauralDelayRight && breathsyncBinauralPanner) {
      breathsyncAmbientGain.connect(breathsyncBinauralDelayLeft);
      breathsyncAmbientGain.connect(breathsyncBinauralDelayRight);
      breathsyncAmbientGain.connect(breathsyncBinauralPanner);
    }
  }

  if (context.state === "suspended") {
    context.resume().catch(() => {});
  }

  return context;
}

function breathsyncGetScaledMasterVolume() {
  const volume = Math.max(0, Math.min(1, breathsyncVolume));
  if (volume <= 0.001) return 0;
  if (volume <= BREATHSYNC_PALETTE_REFERENCE_VOLUME) {
    return (
      BREATHSYNC_PALETTE_REFERENCE_GAIN *
      (volume / BREATHSYNC_PALETTE_REFERENCE_VOLUME) *
      breathsyncMasterVolumeScale
    );
  }

  const dbOffset =
    ((volume - BREATHSYNC_PALETTE_REFERENCE_VOLUME) /
      (1 - BREATHSYNC_PALETTE_REFERENCE_VOLUME)) *
    BREATHSYNC_PALETTE_LUFS_RANGE_DB;
  return (
    BREATHSYNC_PALETTE_REFERENCE_GAIN *
    10 ** (dbOffset / 20) *
    breathsyncMasterVolumeScale
  );
}

function breathsyncGetAmbientVolume(kind) {
  if (kind === "fountain") return breathsyncFountainVolume;
  if (kind === "rain") return breathsyncRainVolume;
  if (kind === "kids") return breathsyncKidsVolume;
  return 0;
}

function breathsyncHasAmbientVolume() {
  return (
    breathsyncAmbientEnabled &&
    !breathsyncMuted &&
    (breathsyncFountainVolume > 0.001 ||
      breathsyncRainVolume > 0.001 ||
      breathsyncKidsVolume > 0.001)
  );
}

function breathsyncApplyVolume() {
  if (breathsyncMasterGain && breathsyncAudioContext) {
    breathsyncMasterGain.gain.setTargetAtTime(
      breathsyncGetScaledMasterVolume(),
      breathsyncAudioContext.currentTime,
      0.08
    );
  }
  if (breathsyncMixOutputGain && breathsyncAudioContext) {
    breathsyncMixOutputGain.gain.setTargetAtTime(
      Math.max(0, Math.min(1, breathsyncMasterVolume)),
      breathsyncAudioContext.currentTime,
      0.08
    );
  }
}

function breathsyncGetReverbDuration() {
  return 1.2 + breathsyncReverbAmount * 7.2;
}

function breathsyncGetReverbDecay() {
  return 3.1 - breathsyncReverbAmount * 1.55;
}

function breathsyncGetReverbWetLevel() {
  return 0.08 + breathsyncReverbAmount * 0.86;
}

function breathsyncApplyReverb() {
  if (breathsyncAudioContext && breathsyncReverbNode && breathsyncReverbGain) {
    breathsyncReverbNode.buffer = breathsyncCreateLargeReverbImpulse(
      breathsyncAudioContext,
      breathsyncGetReverbDuration(),
      breathsyncGetReverbDecay()
    );
    breathsyncReverbGain.gain.setTargetAtTime(
      breathsyncGetReverbWetLevel(),
      breathsyncAudioContext.currentTime,
      0.1
    );
  }
}

function breathsyncApplyBinauralSpace() {
  if (
    breathsyncAudioContext &&
    breathsyncDryGain &&
    breathsyncBinauralGain &&
    breathsyncBinauralDelayLeft &&
    breathsyncBinauralDelayRight &&
    breathsyncBinauralPanLeft &&
    breathsyncBinauralPanRight &&
    breathsyncBinauralHrtfGain &&
    breathsyncBinauralPanner
  ) {
    const tempBoost = breathsyncBinauralEnabled
      ? breathsyncTemperature * breathsyncSpaceAmount * 0.25
      : 0;
    const effectiveSpace = Math.min(1, breathsyncSpaceAmount + tempBoost);
    const dryLevel = breathsyncBinauralEnabled ? 0.52 : 0.46;
    const ambientDirectLevel = breathsyncBinauralEnabled ? 0.45 : 1;
    const wet = breathsyncBinauralEnabled ? 0.08 + effectiveSpace * 0.28 : 0;
    const hrtfWet = breathsyncBinauralEnabled ? 0.12 + effectiveSpace * 0.38 : 0;
    const spread = breathsyncBinauralEnabled ? 0.35 + effectiveSpace * 0.75 : 0;
    breathsyncDryGain.gain.setTargetAtTime(
      dryLevel,
      breathsyncAudioContext.currentTime,
      0.12
    );
    if (breathsyncAmbientDirectGain) {
      breathsyncAmbientDirectGain.gain.setTargetAtTime(
        ambientDirectLevel,
        breathsyncAudioContext.currentTime,
        0.12
      );
    }
    breathsyncBinauralGain.gain.setTargetAtTime(
      wet,
      breathsyncAudioContext.currentTime,
      0.12
    );
    breathsyncBinauralHrtfGain.gain.setTargetAtTime(
      hrtfWet,
      breathsyncAudioContext.currentTime,
      0.12
    );
    breathsyncBinauralDelayLeft.delayTime.setTargetAtTime(
      0.006 + effectiveSpace * 0.02,
      breathsyncAudioContext.currentTime,
      0.12
    );
    breathsyncBinauralDelayRight.delayTime.setTargetAtTime(
      0.018 + effectiveSpace * 0.04,
      breathsyncAudioContext.currentTime,
      0.12
    );
    breathsyncBinauralPanLeft.pan.setTargetAtTime(
      -spread,
      breathsyncAudioContext.currentTime,
      0.12
    );
    breathsyncBinauralPanRight.pan.setTargetAtTime(
      spread,
      breathsyncAudioContext.currentTime,
      0.12
    );
    breathsyncSetBinauralPosition("Hold");
  }
}

function breathsyncSetBinauralPosition(label) {
  if (
    !breathsyncAudioContext ||
    !breathsyncBinauralEnabled ||
    !breathsyncBinauralPanner
  ) {
    return;
  }

  const effectiveSpace = Math.min(
    1,
    breathsyncSpaceAmount + breathsyncTemperature * breathsyncSpaceAmount * 0.25
  );
  const lateral = 0.55 + effectiveSpace * 1.65;
  const height = 0.12 + effectiveSpace * 0.55;
  const distance = 0.95 - effectiveSpace * 0.35;
  const x = label === "Inhale" ? -lateral : label === "Exhale" ? lateral : lateral * 0.46;
  const y = label === "Inhale" ? height : label === "Exhale" ? -height * 0.4 : height * 0.34;
  const z = -distance;

  breathsyncBinauralPanner.positionX.setTargetAtTime(
    x,
    breathsyncAudioContext.currentTime,
    0.35
  );
  breathsyncBinauralPanner.positionY.setTargetAtTime(
    y,
    breathsyncAudioContext.currentTime,
    0.35
  );
  breathsyncBinauralPanner.positionZ.setTargetAtTime(
    z,
    breathsyncAudioContext.currentTime,
    0.35
  );
}

function breathsyncPlayTick(label, progress, accent) {
  const context = breathsyncEnsureAudio();
  if (!context || !breathsyncMasterGain || !breathsyncTickEnabled || breathsyncMuted) return;

  const now = context.currentTime;
  const gain = context.createGain();
  const clockBody = context.createOscillator();
  const tickClick = context.createOscillator();
  const filter = context.createBiquadFilter();
  const peak = (accent ? 1.35 : 0.92) * breathsyncTickVolume;

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
  gain.connect(breathsyncMasterGain);
  clockBody.start(now);
  tickClick.start(now);
  clockBody.stop(now + 0.055);
  tickClick.stop(now + 0.035);
}

function breathsyncStartTickPattern(label, duration) {
  breathsyncClearTickTimers();
  if (!breathsyncRunning || !breathsyncTickEnabled) return;

  const interval = 1000;
  const ticks = Math.max(1, Math.floor(duration * 1000 / interval));

  for (let index = 0; index <= ticks; index += 1) {
    const progress = ticks === 0 ? 0 : index / ticks;
    const timerId = setTimeout(() => {
      breathsyncPlayTick(label, progress, index === 0);
    }, index * interval);
    breathsyncTickTimers.push(timerId);
  }
}

function breathsyncSetMasterScale(scale, fadeTime) {
  breathsyncMasterVolumeScale = scale;

  if (breathsyncMasterGain && breathsyncAudioContext) {
    breathsyncMasterGain.gain.setTargetAtTime(
      breathsyncGetScaledMasterVolume(),
      breathsyncAudioContext.currentTime,
      fadeTime
    );
  }
}

function breathsyncCreateLargeReverbImpulse(context, duration, decay) {
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
      const position = Math.floor(
        sampleRate * reflection * (channel === 0 ? 1 : 1.13)
      );
      if (position < length) {
        data[position] +=
          (0.28 / (reflectionIndex + 1)) * (channel === 0 ? 1 : -1);
      }
    });
  }

  return impulse;
}

function breathsyncCreateReversedPianoBuffer(context) {
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

function breathsyncGetReversedPianoBuffer(context) {
  if (!breathsyncReversedPianoBuffer) {
    breathsyncReversedPianoBuffer =
      breathsyncCreateReversedPianoBuffer(context);
  }

  return breathsyncReversedPianoBuffer;
}

function breathsyncCreateAmbientBuffer(context, kind) {
  const config = BREATHSYNC_AMBIENT_CONFIG[kind];
  const sampleRate = context.sampleRate;
  const length = Math.floor(sampleRate * config.duration);
  const buffer = context.createBuffer(2, length, sampleRate);
  const fadeSamples = Math.floor(sampleRate * 0.7);
  const chirps = [];

  if (kind === "kids") {
    for (let index = 0; index < 34; index += 1) {
      chirps.push({
        start: 0.8 + Math.random() * (config.duration - 1.7),
        length: 0.16 + Math.random() * 0.42,
        frequency: 520 + Math.random() * 920,
        sweep: 0.72 + Math.random() * 0.9,
        pan: Math.random() * 2 - 1,
        level: 0.05 + Math.random() * 0.08
      });
    }
  }

  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    let smooth = 0;
    let low = 0;
    let splash = 0;

    for (let index = 0; index < length; index += 1) {
      const time = index / sampleRate;
      const edgeFade = Math.min(1, index / fadeSamples, (length - index - 1) / fadeSamples);
      const stereo = channel === 0 ? 0.94 : 1.06;
      let value = 0;

      if (kind === "rain") {
        const noise = Math.random() * 2 - 1;
        smooth = smooth * 0.84 + noise * 0.16;
        value = (noise - smooth * 0.42) * 0.33;
        if (Math.random() < 0.0025) splash = 0.42 + Math.random() * 0.28;
        splash *= 0.986;
        value += (Math.random() * 2 - 1) * splash * 0.08;
      } else if (kind === "fountain") {
        const noise = Math.random() * 2 - 1;
        low = low * 0.985 + noise * 0.015;
        smooth = smooth * 0.68 + noise * 0.32;
        if (Math.random() < 0.004) splash = 0.35 + Math.random() * 0.5;
        splash *= 0.972;
        value =
          low * 0.7 +
          smooth * 0.18 +
          Math.sin(2 * Math.PI * (2.2 + low * 1.5) * time) * 0.055 +
          (Math.random() * 2 - 1) * splash * 0.13;
      } else {
        const distanceNoise = Math.random() * 2 - 1;
        low = low * 0.996 + distanceNoise * 0.004;
        value = low * 0.025;
        chirps.forEach((chirp) => {
          const chirpTime = time - chirp.start;
          if (chirpTime < 0 || chirpTime > chirp.length) return;
          const progress = chirpTime / chirp.length;
          const envelope = Math.sin(Math.PI * progress) ** 1.7;
          const panGain = channel === 0 ? (1 - chirp.pan) * 0.5 : (1 + chirp.pan) * 0.5;
          const frequency = chirp.frequency * (1 + progress * chirp.sweep * 0.22);
          const voice =
            Math.sin(2 * Math.PI * frequency * chirpTime) +
            Math.sin(2 * Math.PI * frequency * 1.52 * chirpTime) * 0.36;
          value += voice * envelope * chirp.level * panGain;
        });
      }

      data[index] = value * edgeFade * stereo;
    }
  }

  return buffer;
}

function breathsyncGetProceduralAmbientBuffer(context, kind) {
  if (!breathsyncAmbientBuffers[kind]) {
    breathsyncAmbientBuffers[kind] = breathsyncCreateAmbientBuffer(context, kind);
  }

  return breathsyncAmbientBuffers[kind];
}

async function breathsyncLoadAmbientBuffer(context, kind) {
  if (breathsyncAmbientBuffers[kind]) return breathsyncAmbientBuffers[kind];
  if (breathsyncAmbientBufferPromises[kind]) return breathsyncAmbientBufferPromises[kind];

  const config = BREATHSYNC_AMBIENT_CONFIG[kind];
  const url =
    typeof chrome !== "undefined" && chrome.runtime
      ? chrome.runtime.getURL(config.url)
      : config.url;

  breathsyncAmbientBufferPromises[kind] = fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error(`Could not load ${config.url}`);
      return response.arrayBuffer();
    })
    .then((arrayBuffer) => context.decodeAudioData(arrayBuffer))
    .then((buffer) => {
      breathsyncAmbientBuffers[kind] = buffer;
      return buffer;
    })
    .catch((error) => {
      breathsyncSetAmbientDebug(
        `Ambient sample failed: ${kind} (${error.message || "load failed"})`
      );
      return null;
    });

  return breathsyncAmbientBufferPromises[kind];
}

function breathsyncScheduleAmbientSource(kind, startAt) {
  const bed = breathsyncAmbientBeds[kind];
  const config = BREATHSYNC_AMBIENT_CONFIG[kind];
  if (!bed || !bed.running || !breathsyncAudioContext) return;
  if (!bed.buffer) return;

  const source = breathsyncAudioContext.createBufferSource();
  const envelope = breathsyncAudioContext.createGain();
  const trimStart = Math.min(config.trimStart || 0, Math.max(0, bed.buffer.duration - 1));
  const trimEnd = Math.min(config.trimEnd || 0, Math.max(0, bed.buffer.duration - trimStart - 1));
  const duration = Math.max(4, bed.buffer.duration - trimStart - trimEnd);
  const crossfade = Math.min(config.crossfade, Math.max(1.2, duration * 0.22));
  const now = breathsyncAudioContext.currentTime;
  const nextStart = startAt + duration - crossfade;
  const nextDelay = Math.max(0, (nextStart - now - 0.12) * 1000);

  source.buffer = bed.buffer;
  envelope.gain.setValueAtTime(0.0001, startAt);
  envelope.gain.linearRampToValueAtTime(1, startAt + crossfade);
  envelope.gain.setValueAtTime(1, startAt + duration - crossfade);
  envelope.gain.linearRampToValueAtTime(0.0001, startAt + duration);
  source.connect(envelope);
  envelope.connect(bed.output);
  try {
    source.start(startAt, trimStart, duration);
    source.stop(startAt + duration + 0.08);
  } catch (error) {
    breathsyncSetAmbientDebug(`Ambient schedule failed: ${kind} (${error.name || "start failed"})`);
    envelope.disconnect();
    return;
  }
  bed.sources.push(source);
  source.onended = () => {
    bed.sources = bed.sources.filter((item) => item !== source);
    envelope.disconnect();
  };

  const timerId = setTimeout(() => {
    bed.timers = bed.timers.filter((item) => item !== timerId);
    breathsyncScheduleAmbientSource(kind, nextStart);
  }, nextDelay);
  bed.timers.push(timerId);
}

function breathsyncStartAmbientBed(kind) {
  if (!breathsyncAudioContext || !breathsyncAmbientGain) return null;
  let bed = breathsyncAmbientBeds[kind];
  if (bed && bed.running) return bed;

  const output = bed && bed.output ? bed.output : breathsyncAudioContext.createGain();
  const isConnected = bed && bed.connected;
  output.gain.value = 0.0001;
  if (!isConnected) output.connect(breathsyncAmbientGain);
  bed = {
    output,
    connected: true,
    running: true,
    loading: false,
    buffer: bed ? bed.buffer : null,
    sources: [],
    timers: []
  };
  breathsyncAmbientBeds[kind] = bed;

  if (bed.buffer) {
    breathsyncScheduleAmbientSource(kind, breathsyncAudioContext.currentTime + 0.02);
  } else if (!bed.loading) {
    bed.loading = true;
    breathsyncLoadAmbientBuffer(breathsyncAudioContext, kind).then((buffer) => {
      bed.loading = false;
      if (!buffer) {
        breathsyncStopAmbientBed(kind);
        return;
      }
      bed.buffer = buffer;
      if (bed.running && breathsyncAudioContext) {
        breathsyncScheduleAmbientSource(kind, breathsyncAudioContext.currentTime + 0.02);
      }
    });
  }

  return bed;
}

function breathsyncStopAmbientBed(kind) {
  const bed = breathsyncAmbientBeds[kind];
  if (!bed) return;

  bed.running = false;
  bed.timers.forEach((timerId) => clearTimeout(timerId));
  bed.timers = [];

  if (breathsyncAudioContext) {
    const now = breathsyncAudioContext.currentTime;
    bed.output.gain.cancelScheduledValues(now);
    bed.output.gain.setTargetAtTime(0.0001, now, 0.18);
    bed.sources.forEach((source) => {
      try {
        source.stop(now + 0.8);
      } catch (error) {
        // Source may already be stopped.
      }
    });
  }
}

function breathsyncStopAmbientBeds() {
  Object.keys(breathsyncAmbientBeds).forEach(breathsyncStopAmbientBed);
}

function breathsyncGetAmbientUrl(kind) {
  const config = BREATHSYNC_AMBIENT_CONFIG[kind];
  return typeof chrome !== "undefined" && chrome.runtime
    ? chrome.runtime.getURL(config.url)
    : config.url;
}

function breathsyncSetAmbientDebug(text) {
  if (!BREATHSYNC_IS_OFFSCREEN_AUDIO || !breathsyncHasStorage()) return;
  chrome.storage.local.set({ breathsyncAmbientDebug: text }).catch(() => {});
}

function breathsyncEnsureAmbientElement(kind) {
  let element = breathsyncAmbientElements[kind];
  if (element) return element;

  element = new Audio(breathsyncGetAmbientUrl(kind));
  element.loop = true;
  element.preload = "auto";
  element.volume = 0;
  element.setAttribute("data-breathsync-ambient", kind);
  document.body.appendChild(element);
  breathsyncAmbientElements[kind] = element;
  return element;
}

function breathsyncRampAmbientElement(kind, targetVolume) {
  const element = breathsyncEnsureAmbientElement(kind);
  const startVolume = element.volume;
  const duration = 420;
  const startedAt = Date.now();

  clearInterval(breathsyncAmbientElementRampTimers[kind]);
  breathsyncAmbientElementRampTimers[kind] = setInterval(() => {
    const progress = Math.min(1, (Date.now() - startedAt) / duration);
    element.volume = startVolume + (targetVolume - startVolume) * progress;
    if (progress >= 1) {
      clearInterval(breathsyncAmbientElementRampTimers[kind]);
      delete breathsyncAmbientElementRampTimers[kind];
      if (targetVolume <= 0.001) {
        element.pause();
        element.currentTime = 0;
      }
    }
  }, 40);

  if (targetVolume > 0.001 && element.paused) {
    element
      .play()
      .then(() => breathsyncSetAmbientDebug(`Ambient playing: ${kind}`))
      .catch((error) => {
        breathsyncSetAmbientDebug(
          `Ambient blocked: ${kind} (${error.name || "play failed"})`
        );
      });
  }
}

function breathsyncStopAmbientElements() {
  Object.keys(breathsyncAmbientElements).forEach((kind) => {
    breathsyncRampAmbientElement(kind, 0);
  });
}

function breathsyncApplyAmbientElementVolumes() {
  if (!BREATHSYNC_IS_OFFSCREEN_AUDIO) return;

  if (!breathsyncHasAmbientVolume()) {
    breathsyncStopAmbientElements();
    return;
  }

  Object.keys(BREATHSYNC_AMBIENT_CONFIG).forEach((kind) => {
    const amount = breathsyncGetAmbientVolume(kind);
    const config = BREATHSYNC_AMBIENT_CONFIG[kind];
    breathsyncRampAmbientElement(
      kind,
      amount > 0.001 ? Math.min(1, amount * config.level) : 0
    );
  });
}

function breathsyncApplyAmbientVolumes() {
  if (!(BREATHSYNC_IS_OFFSCREEN_AUDIO || breathsyncTabEnabled)) return;

  if (!breathsyncHasAmbientVolume()) {
    breathsyncStopAmbientBeds();
    breathsyncStopAmbientElements();
    return;
  }

  const context = breathsyncEnsureAmbientAudio();
  if (!context || !breathsyncAmbientGain) return;

  Object.keys(BREATHSYNC_AMBIENT_CONFIG).forEach((kind) => {
    const amount = breathsyncGetAmbientVolume(kind);
    const config = BREATHSYNC_AMBIENT_CONFIG[kind];
    if (amount <= 0.001) {
      breathsyncStopAmbientBed(kind);
      return;
    }

    const bed = breathsyncStartAmbientBed(kind);
    if (!bed) return;
    bed.output.gain.setTargetAtTime(amount * config.level, context.currentTime, 0.24);
  });
}

function breathsyncGetPhaseSound(label) {
  if (breathsyncSoundPreset === "halo") {
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

  if (breathsyncSoundPreset === "aura") {
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

  if (breathsyncSoundPreset === "ivory") {
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

  if (breathsyncSoundPreset === "glock") {
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

  if (breathsyncSoundPreset === "meadow") {
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

  if (breathsyncSoundPreset === "saw") {
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

const BREATHSYNC_CONSONANT_SCALE = [
  73.42, 82.41, 92.5, 98, 110, 123.47, 138.59, 146.83, 164.81, 185,
  196, 220, 246.94, 277.18, 293.66, 329.63, 369.99, 392, 440, 493.88,
  554.37, 587.33, 659.25, 739.99, 783.99, 880, 987.77, 1108.73,
  1174.66
];

const BREATHSYNC_MAJOR_SCALE_STEPS = [0, 2, 4, 5, 7, 9, 11];
const BREATHSYNC_MINOR_SCALE_STEPS = [0, 2, 3, 5, 7, 8, 10];
const BREATHSYNC_NOTE_NAME_TO_PC = {
  C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5,
  "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11
};
const BREATHSYNC_FOLLOW_STALE_MS = 4000;

let breathsyncActiveScale = BREATHSYNC_CONSONANT_SCALE;

function breathsyncBuildScaleFromKey(rootPc, mode) {
  const steps = mode === "minor" ? BREATHSYNC_MINOR_SCALE_STEPS : BREATHSYNC_MAJOR_SCALE_STEPS;
  const baseMidi = 36 + rootPc;
  const scale = [];

  for (let octave = 0; octave < 5; octave += 1) {
    for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
      const midi = baseMidi + octave * 12 + steps[stepIndex];
      const frequency = 440 * 2 ** ((midi - 69) / 12);
      if (frequency >= 60 && frequency <= 1250) scale.push(frequency);
    }
  }

  return scale.length ? scale : BREATHSYNC_CONSONANT_SCALE;
}

function breathsyncGetFollowedScale() {
  if (!breathsyncFollowHarmony) return null;
  if (!(breathsyncFollowStrength > 0.05)) return null;

  const state = breathsyncHarmonyState;
  if (!state || typeof state.key !== "string") return null;
  if (
    !Number.isFinite(state.updatedAt) ||
    Date.now() - state.updatedAt > BREATHSYNC_FOLLOW_STALE_MS
  ) {
    return null;
  }

  const minConfidence = 0.85 - breathsyncFollowStrength * 0.45;
  if (!Number.isFinite(state.confidence) || state.confidence < minConfidence) return null;

  const rootPc = BREATHSYNC_NOTE_NAME_TO_PC[state.key];
  if (rootPc == null) return null;

  const mode = state.mode === "minor" ? "minor" : "major";
  return breathsyncBuildScaleFromKey(rootPc, mode);
}

function breathsyncUpdateActiveScale() {
  breathsyncActiveScale = breathsyncGetFollowedScale() || BREATHSYNC_CONSONANT_SCALE;
  return breathsyncActiveScale;
}

function breathsyncNearestScaleIndex(frequency) {
  let bestIndex = 0;
  let bestDistance = Infinity;

  breathsyncActiveScale.forEach((note, index) => {
    const distance = Math.abs(note - frequency);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function breathsyncGetDiatonicNoteFromIndex(index) {
  const nextIndex = Math.max(
    0,
    Math.min(breathsyncActiveScale.length - 1, index)
  );

  return breathsyncActiveScale[nextIndex];
}

function breathsyncBuildTemperatureChord(chord, amount, chordIndex) {
  if (!Array.isArray(chord) || chord.length === 0) return chord;

  let rootIndex = breathsyncNearestScaleIndex(chord[0]);
  if (rootIndex % 7 === 6) rootIndex += 1;

  const degree = rootIndex % 7;
  const chordTypes = [[0, 2, 4]];
  if (amount > 0.46 && degree !== 2) chordTypes.push([0, 1, 4]);
  if (amount > 0.72 && degree !== 3) chordTypes.push([0, 3, 4]);
  const triad = chordTypes[chordIndex % chordTypes.length];
  const intervals = amount < 0.22 ? [0, 4] : triad;

  return intervals.map((interval) => breathsyncGetDiatonicNoteFromIndex(rootIndex + interval));
}

function breathsyncApplyTemperatureToSequence(sequence, amount) {
  if (!Array.isArray(sequence)) return sequence;

  if (!Array.isArray(sequence[0])) {
    return sequence;
  }

  return sequence.map((chord, chordIndex) =>
    breathsyncBuildTemperatureChord(chord, amount, chordIndex)
  );
}

function breathsyncApplyTemperatureToSound(sound) {
  const amount = breathsyncTemperature;
  if (!sound) return sound;

  return {
    ...sound,
    sequence: breathsyncApplyTemperatureToSequence(sound.sequence, amount),
    filter: sound.filter + amount * 520,
    targetGain: sound.targetGain ? sound.targetGain * (1 - amount * 0.08) : sound.targetGain
  };
}

function breathsyncGetHighNoteDamping(frequency) {
  const normalized = Math.max(0, Math.min(1, (frequency - 440) / 734.66));
  return {
    gain: 1 - normalized * breathsyncTemperature * 0.32,
    cutoff: 2600 + breathsyncTemperature * 900 - normalized * breathsyncTemperature * 420
  };
}

function breathsyncGetOrnamentChord(sound, duration, offset, amount) {
  const sequence = Array.isArray(sound.sequence) ? sound.sequence : [];

  if (!sequence.length) return breathsyncBuildTemperatureChord([220], amount, 0);

  const stepLength = Math.max(0.45, duration / sequence.length);
  const chordIndex = Math.min(sequence.length - 1, Math.floor(offset / stepLength));
  const chord = sequence[chordIndex] || sequence[0];

  if (!Array.isArray(chord)) {
    return breathsyncBuildTemperatureChord([chord], amount, chordIndex);
  }

  return chord;
}

function breathsyncGetOrnamentFrequency(chord, index, label, amount, octaveMultiplier = 2) {
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

function breathsyncGetGenerativeScaleFrequency(chord, index, label, amount) {
  const topChordTone = Math.max(...chord);
  const rootIndex = breathsyncNearestScaleIndex(chord[0]);
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
  let note = breathsyncGetDiatonicNoteFromIndex(
    rootIndex + scaleOffsets[contour[(leap + freeLeap) % tempReach] % scaleOffsets.length]
  );

  while (note < Math.max(880, topChordTone * 2)) note *= 2;
  if (amount > 0.72 && index % 4 === 1) note *= 2;
  if (amount > 0.9 && index % 5 === 3) note *= 2;
  while (note > 4186) note /= 2;

  return note;
}

function breathsyncGetOrnamentMelodyNotes(sound, duration, label, amount, octaveMultiplier = 2) {
  if (amount < 0.5 || !sound) return [];

  const subdivision =
    octaveMultiplier === 4
      ? 1 - (amount - 0.5) * 1.5
      : 1.25 - (amount - 0.5) * 1.5;
  const noteCount = Math.max(1, Math.floor((duration - subdivision * 0.25) / subdivision));

  return Array.from({ length: noteCount }, (_, index) => {
    const offset = index * subdivision + subdivision * 0.5;
    const chord = breathsyncGetOrnamentChord(sound, duration, offset, amount);
    if (octaveMultiplier === 4) {
      return breathsyncGetGenerativeScaleFrequency(chord, index, label, amount);
    }
    return breathsyncGetOrnamentFrequency(chord, index, label, amount, octaveMultiplier);
  });
}

function breathsyncGetOrnamentOffset(index, subdivision, amount, duration) {
  const offsets = [0, -0.16, 0.12, 0.24, -0.08, 0.18];
  const jitter = amount > 0.7 ? offsets[index % offsets.length] * subdivision * amount : 0;
  return Math.max(0.05, Math.min(duration - 0.05, index * subdivision + subdivision * 0.5 + jitter));
}

function breathsyncCreateReflectiveMelodyNodes(context, now, duration, label, destination, sound) {
  const melodyNotes = breathsyncGetOrnamentMelodyNotes(
    sound,
    duration,
    label,
    breathsyncTemperature,
    2
  );
  const counterpointNotes = [];
  if (!melodyNotes.length && !counterpointNotes.length) return [];
  const melodySubdivision = 1.25 - (breathsyncTemperature - 0.5) * 1.5;
  const counterpointSubdivision = 1 - (breathsyncTemperature - 0.5) * 1.5;

  const createNode = (frequency, index, subdivision, offsetShift, levelScale, lengthScale, type) => {
    const offset =
      breathsyncGetOrnamentOffset(index, subdivision, breathsyncTemperature, duration) +
      offsetShift;
    const oscillator = context.createOscillator();
    const noteGain = context.createGain();
    const noteFilter = context.createBiquadFilter();
    const damping = breathsyncGetHighNoteDamping(frequency);
    const startAt = now + Math.min(duration - 0.05, offset);
    const noteLength = Math.max(0.055, Math.min(0.24, subdivision * 0.42 * lengthScale));
    const expressiveLevel = (0.009 + breathsyncTemperature * 0.018) * levelScale;

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
          0.92 + breathsyncTemperature * 0.28,
          0.32,
          "triangle"
        )
      )
    );
}

function breathsyncGetTemperatureLeadFrequency(
  sound,
  duration,
  label,
  amount,
  index,
  offset,
  octaveBase = 4
) {
  const chord = breathsyncGetOrnamentChord(sound, duration, offset, amount);
  const topChordTone = Math.max(...chord);
  const rootIndex = breathsyncNearestScaleIndex(chord[0]);
  const chordToneOffsets = [0, 2, 4, 7, 9, 12, 14];
  const scaleOffsets = [0, 1, 2, 4, 5, 7, 8, 9, 11, 12, 14, 16];
  const consonantOffsets = index % 4 === 0 ? chordToneOffsets : scaleOffsets;
  const direction = label === "Exhale" ? -1 : 1;
  const randomReach = Math.max(3, Math.round(3 + amount * (consonantOffsets.length - 3)));
  const randomStep = amount > 0.62 ? Math.floor(Math.random() * randomReach) : 0;
  const contourStep = direction > 0 ? index * 2 + randomStep : randomReach - 1 - ((index * 2 + randomStep) % randomReach);
  let note = breathsyncGetDiatonicNoteFromIndex(
    rootIndex + consonantOffsets[Math.abs(contourStep) % consonantOffsets.length]
  );

  while (note < Math.max(523.25 * (octaveBase / 2), topChordTone * octaveBase)) note *= 2;
  if (amount > 0.78 && index % 3 === 1) note *= 2;
  while (note > 4186) note /= 2;

  return note;
}

function breathsyncGetTemperatureLeadSubdivision(amount, octaveBase = 4) {
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

function breathsyncCreateTemperatureLeadNodes(
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
  const amount = breathsyncTemperature;
  if (amount < 0.5 || !sound || !destination) return [];

  const subdivision = breathsyncGetTemperatureLeadSubdivision(amount, octaveBase);
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
    const frequency = breathsyncGetTemperatureLeadFrequency(
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

function breathsyncStopSound() {
  breathsyncAllMidiNotesOff();
  if (!breathsyncActiveSound || !breathsyncAudioContext) return;

  const now = breathsyncAudioContext.currentTime;
  breathsyncActiveSound.gain.gain.cancelScheduledValues(now);
  breathsyncActiveSound.gain.gain.setTargetAtTime(0.0001, now, 0.45);
  breathsyncActiveSound.nodes.forEach((node) => {
    try {
      node.stop(now + 1.75);
      if (node.modulator) node.modulator.stop(now + 1.75);
      if (node.wow) node.wow.stop(now + 1.75);
    } catch (error) {
      // Oscillator may already be stopped.
    }
  });
  breathsyncActiveSound = null;
}

function breathsyncCreateSequencedChordNodes(context, now, duration, sound, destination) {
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
      const damping = breathsyncGetHighNoteDamping(frequency);
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

function breathsyncResumeAudio() {
  breathsyncStopSound();
}

function breathsyncBindAudioUnlock() {
  document.addEventListener("pointerdown", breathsyncResumeAudio, true);
  document.addEventListener("keydown", breathsyncResumeAudio, true);
}

function breathsyncUnbindAudioUnlock() {
  document.removeEventListener("pointerdown", breathsyncResumeAudio, true);
  document.removeEventListener("keydown", breathsyncResumeAudio, true);
}

function breathsyncFadeOutPreviousSound(now) {
  if (!breathsyncActiveSound) return;

  breathsyncActiveSound.gain.gain.cancelScheduledValues(now);
  breathsyncActiveSound.gain.gain.setValueAtTime(
    breathsyncActiveSound.gain.gain.value,
    now
  );
  breathsyncActiveSound.gain.gain.linearRampToValueAtTime(0.0001, now + 1.6);
  breathsyncActiveSound.nodes.forEach((node) => {
    try {
      node.stop(now + 1.75);
      if (node.modulator) node.modulator.stop(now + 1.75);
      if (node.wow) node.wow.stop(now + 1.75);
    } catch (error) {
      // Oscillator may already be stopped.
    }
  });
}

function breathsyncPlayPhaseSound(label, duration) {
  if (!breathsyncSoundEnabled || breathsyncMuted) return;

  const context = breathsyncEnsureAudio();
  if (!context || !breathsyncMasterGain) return;

  const now = context.currentTime;
  breathsyncUpdateActiveScale();
  const sound = breathsyncApplyTemperatureToSound(breathsyncGetPhaseSound(label));
  const gain = context.createGain();
  const filter = context.createBiquadFilter();
  let nodes;

  filter.type = "lowpass";
  filter.frequency.setValueAtTime(sound.filter, now);
  filter.Q.value = 0.18;
  gain.gain.setValueAtTime(0.0001, now);

  if (sound.granular) {
    nodes = breathsyncCreateGranularPianoNodes(
      context,
      now,
      duration,
      sound,
      filter
    );
    gain.gain.linearRampToValueAtTime(0.62, now + 0.75);
  } else if (sound.bell) {
    nodes = breathsyncCreateBellNodes(context, now, duration, sound, filter);
    gain.gain.linearRampToValueAtTime(0.34, now + 0.32);
  } else {
    nodes = breathsyncCreateSequencedChordNodes(context, now, duration, sound, filter);
    const targetGain = sound.targetGain || (sound.fm ? 0.12 : sound.shimmer ? 0.11 : 0.16);
    gain.gain.linearRampToValueAtTime(
      targetGain,
      now + (sound.shimmer || sound.fm ? 1.4 : 0.85)
    );
  }

  if (duration > 1.2) {
    nodes = nodes.concat(
      breathsyncCreateReflectiveMelodyNodes(
        context,
        now,
        duration,
        label,
        filter,
        sound
      )
    );
  }
  nodes = nodes.concat(
    breathsyncCreateTemperatureLeadNodes(
      context,
      now,
      duration,
      label,
      sound,
      breathsyncMasterGain,
      4,
      0,
      1
    )
  );
  nodes = nodes.concat(
    breathsyncCreateTemperatureLeadNodes(
      context,
      now + Math.max(0.08, 0.5 - breathsyncTemperature * 0.22),
      duration,
      label === "Exhale" ? "Inhale" : label,
      sound,
      breathsyncMasterGain,
      2,
      1,
      0.72
    )
  );
  filter.connect(gain);
  gain.connect(breathsyncMasterGain);

  nodes.forEach((node) => {
    if (node.startAt) return;
    node.start(now);
  });
  breathsyncFadeOutPreviousSound(now);
  breathsyncActiveSound = { gain, nodes };
  gain.gain.setTargetAtTime(
    0.0001,
    now + Math.max(0.6, duration - 0.28),
    0.22
  );
  nodes.forEach((node) => {
    try {
      node.stop(now + duration + 0.9);
      if (node.modulator) node.modulator.stop(now + duration + 0.9);
      if (node.wow) node.wow.stop(now + duration + 0.9);
    } catch (error) {
      // Oscillator may already have a stop time.
    }
  });
}

function breathsyncCreateBellNodes(context, now, duration, sound, destination) {
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

function breathsyncCreateGranularPianoNodes(context, now, duration, sound, destination) {
  const buffer = breathsyncGetReversedPianoBuffer(context);
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

function breathsyncSetTechniqueText(technique) {
  const title = document.getElementById("breathsync-title");
  const subtitle = document.getElementById("breathsync-subtitle");

  if (!title || !subtitle) return;

  title.textContent = technique.label;
  subtitle.textContent = technique.subtitle;
}

function breathsyncGetTechniqueSegments(technique) {
  const segments = [
    { label: "Inhale", scale: 1.16, duration: technique.inhale, glow: true },
    { label: "Hold", scale: 1.16, duration: technique.holdIn, glow: true },
    { label: "Exhale", scale: 0.86, duration: technique.exhale, glow: false },
    { label: "Pause", scale: 0.86, duration: technique.holdOut, glow: false }
  ];

  return segments.filter((segment) => segment.duration > 0);
}

function breathsyncGetCycleDurationMs(technique) {
  return breathsyncGetTechniqueSegments(technique).reduce(
    (total, segment) => total + segment.duration * 1000,
    0
  );
}

function breathsyncScheduleSyncedCycle(technique, segments, startIndex, delayToNext) {
  let delay = Math.max(0, delayToNext);

  for (let offset = 1; offset < segments.length; offset += 1) {
    const segment = segments[(startIndex + offset) % segments.length];
    breathsyncSchedule(() => {
      if (breathsyncRunning) {
        breathsyncSetPhase(segment.label, segment.scale, segment.duration, segment.glow);
      }
    }, delay);
    delay += segment.duration * 1000;
  }

  breathsyncSchedule(() => breathsyncRunCycle(), delay);
}

function breathsyncRunCycle() {
  if (!breathsyncRunning) return;

  const technique =
    BREATHSYNC_TECHNIQUES[breathsyncTechniqueKey] || BREATHSYNC_TECHNIQUES.focus;
  const segments = breathsyncGetTechniqueSegments(technique);
  const cycleDurationMs = breathsyncGetCycleDurationMs(technique);
  const origin = Number.isFinite(breathsyncCycleStartedAt) && breathsyncCycleStartedAt > 0
    ? breathsyncCycleStartedAt
    : Date.now();
  const cycleElapsed =
    cycleDurationMs > 0
      ? ((Date.now() - origin) % cycleDurationMs + cycleDurationMs) % cycleDurationMs
      : 0;
  let elapsed = 0;
  let activeIndex = 0;

  breathsyncClearTimers();
  breathsyncSetTechniqueText(technique);

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
    breathsyncSetPhase(
      activeSegment.label,
      activeSegment.scale,
      Math.max(0.05, remainingMs / 1000),
      activeSegment.glow
    );
    breathsyncScheduleSyncedCycle(technique, segments, activeIndex, remainingMs);
  }
}

function breathsyncStartWidget() {
  breathsyncCreateWidget();

  const widget = breathsyncGetWidget();
  if (!widget) return;

  widget.classList.remove("breathsync-hidden");
  breathsyncRunning = true;
  breathsyncStopSound();
  breathsyncClearTickTimers();
  breathsyncBindAudioUnlock();
  breathsyncRunCycle();
}

function breathsyncStopWidget() {
  const widget = breathsyncGetWidget();
  const orb = document.getElementById("breathsync-orb");
  const phase = document.getElementById("breathsync-phase");

  breathsyncRunning = false;
  clearTimeout(breathsyncTechniqueTransitionTimer);
  breathsyncClearTimers();
  breathsyncClearTickTimers();
  breathsyncStopSound();
  breathsyncStopAmbientBeds();
  breathsyncStopAmbientElements();
  breathsyncSetMasterScale(1, 0.08);
  breathsyncUnbindAudioUnlock();

  if (widget) widget.classList.add("breathsync-hidden");
  if (phase) phase.textContent = "Ready";
  if (orb) {
    orb.style.transitionDuration = "1s";
    orb.style.transform = "scale(0.88)";
    orb.style.opacity = "1";
    orb.style.filter = "brightness(1)";
  }
}

function breathsyncApplyState(data, softTechniqueChange = false) {
  const nextTechnique = data[BREATHSYNC_STORAGE_KEYS.technique];
  const nextCycleStartedAt = Number(data[BREATHSYNC_STORAGE_KEYS.cycleStartedAt]);
  const nextRunning = Boolean(data[BREATHSYNC_STORAGE_KEYS.running]);
  const nextSoundEnabled = Boolean(data[BREATHSYNC_STORAGE_KEYS.sound]);
  const nextDarkMode = Boolean(data[BREATHSYNC_STORAGE_KEYS.darkMode]);
  const nextSoundPreset = data[BREATHSYNC_STORAGE_KEYS.soundPreset] || "tide";
  const nextAmbientToggleEnabled = Boolean(data[BREATHSYNC_STORAGE_KEYS.ambientEnabled]);
  const nextMasterVolume = Number(data[BREATHSYNC_STORAGE_KEYS.masterVolume]);
  const nextVolume = Number(data[BREATHSYNC_STORAGE_KEYS.volume]);
  const nextVolumeTouched = Boolean(data[BREATHSYNC_STORAGE_KEYS.volumeTouched]);
  const nextFountainVolume = Number(data[BREATHSYNC_STORAGE_KEYS.fountainVolume]);
  const nextRainVolume = Number(data[BREATHSYNC_STORAGE_KEYS.rainVolume]);
  const nextKidsVolume = Number(data[BREATHSYNC_STORAGE_KEYS.kidsVolume]);
  const nextTemperature = Number(data[BREATHSYNC_STORAGE_KEYS.temperature]);
  const nextFollowHarmony = Boolean(data[BREATHSYNC_STORAGE_KEYS.followHarmony]);
  const nextFollowStrength = Number(data[BREATHSYNC_STORAGE_KEYS.followStrength]);
  const nextHarmonyState = data[BREATHSYNC_STORAGE_KEYS.harmonyState];
  const nextReverb = Number(data[BREATHSYNC_STORAGE_KEYS.reverb]);
  const nextBinaural = Boolean(data[BREATHSYNC_STORAGE_KEYS.binaural]);
  const nextSpace = Number(data[BREATHSYNC_STORAGE_KEYS.space]);
  const nextTickEnabled = Boolean(data[BREATHSYNC_STORAGE_KEYS.tick]);
  const nextTickVolume = Number(data[BREATHSYNC_STORAGE_KEYS.tickVolume]);
  const nextTickVolumeTouched = Boolean(
    data[BREATHSYNC_STORAGE_KEYS.tickVolumeTouched]
  );
  const nextMidiEnabled = Boolean(data[BREATHSYNC_STORAGE_KEYS.midi]);
  const nextMidiOutput = data[BREATHSYNC_STORAGE_KEYS.midiOutput] || "";
  const nextMuted = Boolean(data[BREATHSYNC_STORAGE_KEYS.muted]);
  const nextWidgetX = Number(data[BREATHSYNC_STORAGE_KEYS.widgetX]);
  const nextWidgetY = Number(data[BREATHSYNC_STORAGE_KEYS.widgetY]);
  const nextTechniqueKey = BREATHSYNC_TECHNIQUES[nextTechnique]
    ? nextTechnique
    : "focus";
  const wasRunning = breathsyncRunning;
  const previousAmbientEnabled = breathsyncHasAmbientVolume();
  const soundPresetChanged = breathsyncSoundPreset !== nextSoundPreset;
  const nextAmbientAudible =
    nextAmbientToggleEnabled &&
    !nextMuted &&
    ((Number.isFinite(nextFountainVolume) ? nextFountainVolume : 0) > 0.001 ||
      (Number.isFinite(nextRainVolume) ? nextRainVolume : 0) > 0.001 ||
      (Number.isFinite(nextKidsVolume) ? nextKidsVolume : 0) > 0.001);
  const temperatureChanged =
    Number.isFinite(nextTemperature) &&
    Math.abs(breathsyncTemperature - nextTemperature) > 0.001;
  const audioJustEnabled =
    (!breathsyncSoundEnabled && nextSoundEnabled) ||
    (!breathsyncTickEnabled && nextTickEnabled) ||
    (!previousAmbientEnabled && nextAmbientAudible);
  const midiJustEnabled = !breathsyncMidiEnabled && nextMidiEnabled;
  const engineJustEnabled = audioJustEnabled || midiJustEnabled;
  const nextEngineEnabled =
    nextSoundEnabled || nextTickEnabled || nextMidiEnabled || nextAmbientAudible;
  const shouldSoftBlend =
    softTechniqueChange &&
    breathsyncRunning &&
    (nextRunning || BREATHSYNC_IS_OFFSCREEN_AUDIO) &&
    breathsyncSoundEnabled &&
    nextSoundEnabled &&
    breathsyncTechniqueKey !== nextTechniqueKey;
  const shouldPresetBlend =
    soundPresetChanged &&
    breathsyncSoundEnabled &&
    nextSoundEnabled &&
    (breathsyncRunning || BREATHSYNC_IS_OFFSCREEN_AUDIO || breathsyncTabEnabled);
  const previousMidiEnabled = breathsyncMidiEnabled;
  const previousMidiOutputId = breathsyncMidiOutputId;

  breathsyncTechniqueKey = nextTechniqueKey;
  breathsyncCycleStartedAt = Number.isFinite(nextCycleStartedAt) ? nextCycleStartedAt : 0;
  breathsyncSoundEnabled = nextSoundEnabled;
  breathsyncDarkModeEnabled = nextDarkMode;
  breathsyncSoundPreset = nextSoundPreset;
  breathsyncAmbientEnabled = nextAmbientToggleEnabled;
  breathsyncFountainVolume = Number.isFinite(nextFountainVolume) ? nextFountainVolume : 0;
  breathsyncRainVolume = Number.isFinite(nextRainVolume) ? nextRainVolume : 0;
  breathsyncKidsVolume = Number.isFinite(nextKidsVolume) ? nextKidsVolume : 0;
  breathsyncTickEnabled = nextTickEnabled;
  breathsyncMidiEnabled = nextMidiEnabled;
  breathsyncMidiOutputId = nextMidiOutput;
  breathsyncMuted = nextMuted;
  breathsyncTemperature = Number.isFinite(nextTemperature)
    ? nextTemperature
    : 0;
  breathsyncFollowHarmony = nextFollowHarmony;
  breathsyncFollowStrength = Number.isFinite(nextFollowStrength) ? nextFollowStrength : 0.6;
  if (nextHarmonyState && typeof nextHarmonyState === "object") {
    breathsyncHarmonyState = nextHarmonyState;
  }
  breathsyncReverbAmount = Number.isFinite(nextReverb) ? nextReverb : 0.8;
  breathsyncBinauralEnabled = nextBinaural;
  breathsyncSpaceAmount = Number.isFinite(nextSpace) ? nextSpace : 0.5;
  breathsyncTickVolume =
    nextTickVolumeTouched && Number.isFinite(nextTickVolume)
      ? nextTickVolume
      : 0.35;
  breathsyncMasterVolume = Number.isFinite(nextMasterVolume) ? nextMasterVolume : 0.5;
  breathsyncVolume =
    nextVolumeTouched && Number.isFinite(nextVolume) ? nextVolume : 0.35;
  breathsyncApplyVolume();
  breathsyncApplyReverb();
  breathsyncApplyBinauralSpace();
  breathsyncApplyMuteState();
  if (breathsyncTabEnabled) breathsyncApplyAmbientVolumes();
  breathsyncApplyWidgetPosition(nextWidgetX, nextWidgetY);
  breathsyncApplyDarkMode();

  if (!breathsyncTabEnabled) {
    breathsyncStopWidget();
    return;
  }

  if (!breathsyncSoundEnabled) breathsyncStopSound();
  if (!nextAmbientAudible) {
    breathsyncStopAmbientBeds();
    breathsyncStopAmbientElements();
  }
  if (!breathsyncTickEnabled) breathsyncClearTickTimers();
  if (!breathsyncMidiEnabled) breathsyncAllMidiNotesOff();
  else if (
    BREATHSYNC_IS_OFFSCREEN_AUDIO &&
    (!previousMidiEnabled ||
      previousMidiOutputId !== breathsyncMidiOutputId ||
      !breathsyncMidiOut)
  ) {
    breathsyncRefreshMidiOutput();
  }

  if (shouldSoftBlend) {
    clearTimeout(breathsyncTechniqueTransitionTimer);
    breathsyncSetMasterScale(0.2, 0.18);
    breathsyncClearTimers();
    breathsyncStopSound();
    breathsyncTechniqueTransitionTimer = setTimeout(() => {
      breathsyncStartWidget();
      breathsyncSetMasterScale(1, 0.35);
    }, 420);
    return;
  }

  if (shouldPresetBlend) {
    clearTimeout(breathsyncTechniqueTransitionTimer);
    breathsyncSetMasterScale(0, 0.18);
    breathsyncStopSound();
    breathsyncTechniqueTransitionTimer = setTimeout(() => {
      breathsyncRunCycle();
      breathsyncSetMasterScale(1, 0.85);
    }, 420);
    return;
  }

  if (
    temperatureChanged &&
    breathsyncRunning &&
    nextEngineEnabled &&
    !engineJustEnabled
  ) {
    breathsyncRunCycle();
    return;
  }

  if (BREATHSYNC_IS_OFFSCREEN_AUDIO) {
    if (nextEngineEnabled && (!breathsyncRunning || engineJustEnabled)) {
      if (audioJustEnabled) breathsyncSetMasterScale(0, 0.02);
      breathsyncStartWidget();
      breathsyncApplyAmbientVolumes();
      breathsyncSetMasterScale(
        1,
        audioJustEnabled ? BREATHSYNC_PALETTE_FADE_IN_SECONDS : 0.12
      );
    } else if (!nextEngineEnabled) {
      breathsyncStopWidget();
    }
  } else {
    if (nextRunning && breathsyncStartRequested) {
      breathsyncStartRequested = false;
      if (audioJustEnabled) breathsyncSetMasterScale(0, 0.02);
      breathsyncStartWidget();
      breathsyncApplyAmbientVolumes();
      breathsyncSetMasterScale(
        1,
        audioJustEnabled ? BREATHSYNC_PALETTE_FADE_IN_SECONDS : 0.12
      );
    } else if (!nextRunning && breathsyncRunning) {
      breathsyncStopWidget();
    }
  }
}

function breathsyncSyncState(softTechniqueChange = false) {
  if (!breathsyncHasStorage()) return;

  chrome.storage.local.get(
    {
      [BREATHSYNC_STORAGE_KEYS.technique]: "focus",
      [BREATHSYNC_STORAGE_KEYS.cycleStartedAt]: 0,
      [BREATHSYNC_STORAGE_KEYS.launchDefaultsVersion]: BREATHSYNC_LAUNCH_DEFAULTS_VERSION,
      [BREATHSYNC_STORAGE_KEYS.running]: false,
      [BREATHSYNC_STORAGE_KEYS.sound]: false,
      [BREATHSYNC_STORAGE_KEYS.soundDefaultMigrated]: true,
      [BREATHSYNC_STORAGE_KEYS.darkMode]: false,
      [BREATHSYNC_STORAGE_KEYS.soundPreset]: "tide",
      [BREATHSYNC_STORAGE_KEYS.ambientEnabled]: false,
      [BREATHSYNC_STORAGE_KEYS.fountainVolume]: BREATHSYNC_DEFAULT_AMBIENT_VOLUME,
      [BREATHSYNC_STORAGE_KEYS.rainVolume]: BREATHSYNC_DEFAULT_AMBIENT_VOLUME,
      [BREATHSYNC_STORAGE_KEYS.kidsVolume]: BREATHSYNC_DEFAULT_AMBIENT_VOLUME,
      [BREATHSYNC_STORAGE_KEYS.masterVolume]: 0.5,
      [BREATHSYNC_STORAGE_KEYS.volume]: 0.35,
      [BREATHSYNC_STORAGE_KEYS.volumeTouched]: false,
      [BREATHSYNC_STORAGE_KEYS.temperature]: 0,
      [BREATHSYNC_STORAGE_KEYS.followHarmony]: false,
      [BREATHSYNC_STORAGE_KEYS.followStrength]: 0.6,
      [BREATHSYNC_STORAGE_KEYS.harmonyState]: null,
      [BREATHSYNC_STORAGE_KEYS.reverb]: 0.8,
      [BREATHSYNC_STORAGE_KEYS.binaural]: false,
      [BREATHSYNC_STORAGE_KEYS.space]: 0.5,
      [BREATHSYNC_STORAGE_KEYS.tick]: false,
      [BREATHSYNC_STORAGE_KEYS.tickVolume]: 0.35,
      [BREATHSYNC_STORAGE_KEYS.tickVolumeTouched]: false,
      [BREATHSYNC_STORAGE_KEYS.midi]: false,
      [BREATHSYNC_STORAGE_KEYS.midiOutput]: "",
      [BREATHSYNC_STORAGE_KEYS.muted]: false
    },
    (data) => breathsyncApplyState(data, softTechniqueChange)
  );
}

function breathsyncInit() {
  breathsyncCreateWidget();
  breathsyncSyncState();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", breathsyncInit, { once: true });
} else {
  breathsyncInit();
}

if (breathsyncHasStorage()) {
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  if (changes[BREATHSYNC_STORAGE_KEYS.followHarmony]) {
    breathsyncFollowHarmony = Boolean(changes[BREATHSYNC_STORAGE_KEYS.followHarmony].newValue);
  }
  if (changes[BREATHSYNC_STORAGE_KEYS.followStrength]) {
    const nextStrength = Number(changes[BREATHSYNC_STORAGE_KEYS.followStrength].newValue);
    breathsyncFollowStrength = Number.isFinite(nextStrength) ? nextStrength : 0.6;
  }
  if (changes[BREATHSYNC_STORAGE_KEYS.harmonyState]) {
    const nextHarmonyState = changes[BREATHSYNC_STORAGE_KEYS.harmonyState].newValue;
    breathsyncHarmonyState =
      nextHarmonyState && typeof nextHarmonyState === "object" ? nextHarmonyState : null;
  }

  const relevantChange =
    changes[BREATHSYNC_STORAGE_KEYS.running] ||
    changes[BREATHSYNC_STORAGE_KEYS.technique] ||
    changes[BREATHSYNC_STORAGE_KEYS.cycleStartedAt] ||
    changes[BREATHSYNC_STORAGE_KEYS.sound] ||
    changes[BREATHSYNC_STORAGE_KEYS.darkMode] ||
    changes[BREATHSYNC_STORAGE_KEYS.soundPreset] ||
    changes[BREATHSYNC_STORAGE_KEYS.ambientEnabled] ||
    changes[BREATHSYNC_STORAGE_KEYS.fountainVolume] ||
    changes[BREATHSYNC_STORAGE_KEYS.rainVolume] ||
    changes[BREATHSYNC_STORAGE_KEYS.kidsVolume] ||
    changes[BREATHSYNC_STORAGE_KEYS.masterVolume] ||
    changes[BREATHSYNC_STORAGE_KEYS.volume] ||
    changes[BREATHSYNC_STORAGE_KEYS.volumeTouched] ||
    changes[BREATHSYNC_STORAGE_KEYS.temperature] ||
    changes[BREATHSYNC_STORAGE_KEYS.reverb] ||
    changes[BREATHSYNC_STORAGE_KEYS.binaural] ||
    changes[BREATHSYNC_STORAGE_KEYS.space] ||
    changes[BREATHSYNC_STORAGE_KEYS.tick] ||
    changes[BREATHSYNC_STORAGE_KEYS.tickVolume] ||
    changes[BREATHSYNC_STORAGE_KEYS.tickVolumeTouched] ||
    changes[BREATHSYNC_STORAGE_KEYS.midi] ||
    changes[BREATHSYNC_STORAGE_KEYS.midiOutput] ||
    changes[BREATHSYNC_STORAGE_KEYS.muted] ||
    changes[BREATHSYNC_STORAGE_KEYS.widgetX] ||
    changes[BREATHSYNC_STORAGE_KEYS.widgetY];

  if (relevantChange) {
    breathsyncSyncState(Boolean(changes[BREATHSYNC_STORAGE_KEYS.technique]));
  }
});
}

if (breathsyncHasRuntime()) {
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return;

  if (message.type === "breathsync-restart-audio" && BREATHSYNC_IS_OFFSCREEN_AUDIO) {
    breathsyncTabEnabled = true;
    breathsyncSyncState();
    if (sendResponse) sendResponse({ ok: true });
    return true;
  }

  if (message.type === "breathsync-start-ambient-audio" && BREATHSYNC_IS_OFFSCREEN_AUDIO) {
    breathsyncTabEnabled = true;
    breathsyncMuted = false;
    breathsyncAmbientEnabled = Boolean(message.ambientEnabled);
    if (message.volumes) {
      breathsyncFountainVolume = Number(message.volumes.fountain) || 0;
      breathsyncRainVolume = Number(message.volumes.rain) || 0;
      breathsyncKidsVolume = Number(message.volumes.kids) || 0;
    }
    breathsyncApplyAmbientVolumes();
    if (sendResponse) sendResponse({ ok: true });
    return true;
  }

  if (message.type === "breathsync-start-tab") {
    breathsyncTabEnabled = true;
    breathsyncStartRequested = true;
    breathsyncSyncState();
    if (sendResponse) sendResponse({ ok: true });
    return true;
  }

  if (message.type === "breathsync-stop-tab") {
    breathsyncTabEnabled = false;
    breathsyncStopWidget();
    if (sendResponse) sendResponse({ ok: true });
    return true;
  }
});
}
})();
