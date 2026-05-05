const MIDI_STORAGE_KEYS = {
  midi: "breathsyncMidi",
  midiOutput: "breathsyncMidiOutput",
  midiOutputLabel: "breathsyncMidiOutputLabel",
  running: "breathsyncRunning",
  technique: "breathsyncTechnique",
  cycleStartedAt: "breathsyncCycleStartedAt",
  sound: "breathsyncSound",
  soundPreset: "breathsyncSoundPreset",
  temperature: "breathsyncTemperature",
  darkMode: "breathsyncDarkMode"
};

const MIDI_TECHNIQUES = {
  focus: { inhale: 4, holdIn: 4, exhale: 4, holdOut: 4 },
  relax: { inhale: 4, holdIn: 7, exhale: 8, holdOut: 0 },
  sleep: { inhale: 5, holdIn: 0, exhale: 7, holdOut: 0 },
  reset: { inhale: 2, holdIn: 0, exhale: 6, holdOut: 0 },
  performance: { inhale: 3, holdIn: 0, exhale: 3, holdOut: 0 }
};

const MIDI_CONSONANT_SCALE = [
  73.42, 82.41, 92.5, 98, 110, 123.47, 138.59, 146.83, 164.81, 185,
  196, 220, 246.94, 277.18, 293.66, 329.63, 369.99, 392, 440, 493.88,
  554.37, 587.33, 659.25, 739.99, 783.99, 880, 987.77, 1108.73,
  1174.66
];

const enableMidiButton = document.getElementById("enableMidi");
const midiOutputSelect = document.getElementById("midiOutput");
const scanMidiButton = document.getElementById("scanMidi");
const testMidiButton = document.getElementById("testMidi");
const openSettingsButton = document.getElementById("openSettings");
const darkModeToggle = document.getElementById("darkModeToggle");
const midiStatus = document.getElementById("midiStatus");
const midiDebug = document.getElementById("midiDebug");

let midiAccess = null;
let midiOut = null;
let selectedOutputId = "";
let selectedOutputLabel = "";
let sendCount = 0;
let lastDebugUpdate = 0;
let schedulerRunning = false;
let schedulerSoundEnabled = false;
let schedulerTechniqueKey = "focus";
let schedulerCycleStartedAt = 0;
let schedulerTemperature = 0;
let schedulerMidiEnabled = false;
let schedulerTimers = [];
let darkModeEnabled = false;

function setStatus(text) {
  midiStatus.textContent = text;
}

function setDebug(text) {
  midiDebug.textContent = text;
}

function setBusy(isBusy) {
  enableMidiButton.disabled = isBusy;
  scanMidiButton.disabled = isBusy;
  testMidiButton.disabled = isBusy;
}

function applyDarkMode() {
  document.body.classList.toggle("dark-mode", darkModeEnabled);
  if (darkModeToggle) darkModeToggle.checked = darkModeEnabled;
}

async function persistDarkMode() {
  darkModeEnabled = darkModeToggle.checked;
  applyDarkMode();

  await chrome.storage.local.set({
    [MIDI_STORAGE_KEYS.darkMode]: darkModeEnabled
  });
}

function frequencyToMidiNote(frequency) {
  return Math.max(0, Math.min(127, Math.round(69 + 12 * Math.log2(frequency / 440))));
}

function nearestScaleIndex(frequency) {
  let bestIndex = 0;
  let bestDistance = Infinity;

  MIDI_CONSONANT_SCALE.forEach((note, index) => {
    const distance = Math.abs(note - frequency);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function getDiatonicNoteFromIndex(index) {
  return MIDI_CONSONANT_SCALE[Math.max(0, Math.min(MIDI_CONSONANT_SCALE.length - 1, index))];
}

function clearSchedulerTimers() {
  schedulerTimers.forEach((timerId) => clearTimeout(timerId));
  schedulerTimers = [];
}

function allNotesOff() {
  for (let channel = 0; channel < 16; channel += 1) {
    sendRawMidi([0xb0 + channel, 123, 0], true);
  }
}

function scheduleTimer(callback, delayMs) {
  const timerId = setTimeout(callback, Math.max(0, delayMs));
  schedulerTimers.push(timerId);
}

function getSchedulerBlockReason() {
  if (!midiOut) return "select a MIDI output first";
  if (!schedulerMidiEnabled) return "enable MIDI notes out in BreathSync";
  if (!schedulerRunning && !schedulerSoundEnabled) return "start the guide or enable sound palette";
  return "";
}

function getTechniqueSegments() {
  const technique = MIDI_TECHNIQUES[schedulerTechniqueKey] || MIDI_TECHNIQUES.focus;
  return [
    { label: "Inhale", duration: technique.inhale },
    { label: "Hold", duration: technique.holdIn },
    { label: "Exhale", duration: technique.exhale },
    { label: "Pause", duration: technique.holdOut }
  ].filter((segment) => segment.duration > 0);
}

function getCycleDurationMs(segments) {
  return segments.reduce((total, segment) => total + segment.duration * 1000, 0);
}

function getPhaseSound(label) {
  if (label === "Inhale") {
    return {
      sequence: [
        [146.83, 220, 293.66],
        [164.81, 246.94, 329.63],
        [185, 293.66, 369.99],
        [220, 329.63, 440]
      ]
    };
  }

  if (label === "Hold") {
    return { sequence: [[185, 220, 293.66]] };
  }

  if (label === "Exhale") {
    return {
      sequence: [
        [220, 329.63, 440],
        [185, 293.66, 369.99],
        [164.81, 246.94, 329.63],
        [146.83, 220, 293.66]
      ]
    };
  }

  return { sequence: [[73.42, 146.83, 220]] };
}

function buildTemperatureChord(chord, amount, chordIndex) {
  if (!Array.isArray(chord) || !chord.length) return chord;

  let rootIndex = nearestScaleIndex(chord[0]);
  if (rootIndex % 7 === 6) rootIndex += 1;

  const degree = rootIndex % 7;
  const chordTypes = [[0, 2, 4]];
  if (amount > 0.46 && degree !== 2) chordTypes.push([0, 1, 4]);
  if (amount > 0.72 && degree !== 3) chordTypes.push([0, 3, 4]);
  const intervals = amount < 0.22 ? [0, 4] : chordTypes[chordIndex % chordTypes.length];

  return intervals.map((interval) => getDiatonicNoteFromIndex(rootIndex + interval));
}

function applyTemperatureToSound(sound) {
  const amount = schedulerTemperature;
  const sequence = Array.isArray(sound.sequence)
    ? sound.sequence.map((chord, index) =>
        Array.isArray(chord) ? buildTemperatureChord(chord, amount, index) : chord
      )
    : [];

  return { ...sound, sequence };
}

function getOrnamentChord(sound, duration, offset, amount) {
  const sequence = Array.isArray(sound.sequence) ? sound.sequence : [];
  if (!sequence.length) return buildTemperatureChord([220], amount, 0);

  const stepLength = Math.max(0.45, duration / sequence.length);
  const chordIndex = Math.min(sequence.length - 1, Math.floor(offset / stepLength));
  const chord = sequence[chordIndex] || sequence[0];
  return Array.isArray(chord) ? chord : buildTemperatureChord([chord], amount, chordIndex);
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

function getTemperatureLeadFrequency(sound, duration, label, amount, index, offset, octaveBase = 4) {
  const chord = getOrnamentChord(sound, duration, offset, amount);
  const topChordTone = Math.max(...chord);
  const rootIndex = nearestScaleIndex(chord[0]);
  const chordToneOffsets = [0, 2, 4, 7, 9, 12, 14];
  const scaleOffsets = [0, 1, 2, 4, 5, 7, 8, 9, 11, 12, 14, 16];
  const consonantOffsets = index % 4 === 0 ? chordToneOffsets : scaleOffsets;
  const direction = label === "Exhale" ? -1 : 1;
  const randomReach = Math.max(3, Math.round(3 + amount * (consonantOffsets.length - 3)));
  const randomStep = amount > 0.62 ? Math.floor(Math.random() * randomReach) : 0;
  const contourStep =
    direction > 0
      ? index * 2 + randomStep
      : randomReach - 1 - ((index * 2 + randomStep) % randomReach);
  let note = getDiatonicNoteFromIndex(
    rootIndex + consonantOffsets[Math.abs(contourStep) % consonantOffsets.length]
  );

  while (note < Math.max(523.25 * (octaveBase / 2), topChordTone * octaveBase)) note *= 2;
  if (amount > 0.78 && index % 3 === 1) note *= 2;
  while (note > 4186) note /= 2;

  return note;
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

function fillOutputSelect(outputs) {
  midiOutputSelect.innerHTML = '<option value="">Select IAC MIDI Driver</option>';

  outputs.forEach((output) => {
    const option = document.createElement("option");
    option.value = output.id;
    option.textContent = output.name || "MIDI output";
    midiOutputSelect.appendChild(option);
  });

  const iacOutput = outputs.find((output) => /iac|driver|bus/i.test(output.name || ""));
  selectedOutputId = outputs.some((output) => output.id === selectedOutputId)
    ? selectedOutputId
    : iacOutput
      ? iacOutput.id
      : outputs[0]
        ? outputs[0].id
        : "";

  midiOutputSelect.value = selectedOutputId;
  midiOut = outputs.find((output) => output.id === selectedOutputId) || null;
  selectedOutputLabel = midiOut ? midiOut.name || midiOut.id : "";
}

async function scanMidiOutputs(requestPermission = false) {
  setStatus("Scanning MIDI outputs...");
  setDebug("Outputs: scanning...");

  if (!("requestMIDIAccess" in navigator)) {
    setStatus("Web MIDI unavailable in this browser.");
    setDebug("Outputs: Web MIDI API missing");
    return false;
  }

  const permissionState = await queryMidiPermissionState();
  if (!requestPermission && permissionState !== "granted" && !midiAccess) {
    setStatus("MIDI needs Chrome permission.");
    setDebug("Outputs: press Enable MIDI access to scan");
    return false;
  }

  try {
    if (!midiAccess) {
      midiAccess = await navigator.requestMIDIAccess();
      midiAccess.onstatechange = () => scanMidiOutputs(false);
    }

    const outputs = Array.from(midiAccess.outputs.values());
    fillOutputSelect(outputs);
    setDebug(
      outputs.length
        ? `Outputs: ${outputs.map((output) => output.name || output.id).join(", ")}`
        : "Outputs: none"
    );

    if (!outputs.length) {
      setStatus("No MIDI outputs found. Enable IAC Driver, then try again.");
      setDebug("Outputs: none detected. In macOS Audio MIDI Setup, enable IAC Driver and turn Device is online on.");
      return true;
    }

    if (midiOut && typeof midiOut.open === "function") {
      await midiOut.open();
    }

    setStatus(`MIDI ready: ${midiOut.name || "selected output"}`);
    await chrome.storage.local.set({
      [MIDI_STORAGE_KEYS.midi]: true,
      [MIDI_STORAGE_KEYS.midiOutput]: selectedOutputId,
      [MIDI_STORAGE_KEYS.midiOutputLabel]: selectedOutputLabel
    });
    syncSchedulerFromStorage();
    return true;
  } catch (error) {
    midiAccess = null;
    midiOut = null;
    const errorName = error.name || "MIDI error";
    const errorMessage = error.message ? `: ${error.message}` : "";
    setStatus("Chrome still blocks MIDI permission.");
    setDebug(`Outputs: blocked (${errorName})${errorMessage}`);
    await chrome.storage.local.set({
      [MIDI_STORAGE_KEYS.midi]: false,
      [MIDI_STORAGE_KEYS.midiOutput]: selectedOutputId,
      [MIDI_STORAGE_KEYS.midiOutputLabel]: selectedOutputLabel
    });
    syncSchedulerFromStorage();
    return false;
  }
}

function sendRawMidi(message, forceDebug = false) {
  if (!midiOut) return false;

  try {
    midiOut.send(message);
    sendCount += 1;
    const now = Date.now();
    if (forceDebug || sendCount % 32 === 0 || now - lastDebugUpdate > 1200) {
      lastDebugUpdate = now;
      setDebug(
        `Selected: ${midiOut.name || midiOut.id} | State: ${midiOut.state || "unknown"} | Sends: ${sendCount}`
      );
    }
    return true;
  } catch (error) {
    setStatus(`MIDI send failed: ${error.message || error.name || "unknown error"}`);
    return false;
  }
}

function scheduleMidiNote(frequency, startDelayMs, durationMs, velocity = 54) {
  if (!schedulerMidiEnabled || !midiOut) return;

  const note = frequencyToMidiNote(frequency);
  scheduleTimer(() => sendRawMidi([0x90, note, velocity]), startDelayMs);
  scheduleTimer(() => sendRawMidi([0x80, note, 0]), startDelayMs + durationMs);
}

function scheduleTemperatureLeadMidi(
  label,
  duration,
  sound,
  phaseStartMs,
  octaveBase = 4,
  responseDelayMs = 0,
  velocityScale = 1
) {
  const amount = schedulerTemperature;
  if (amount < 0.5 || !sound) return;

  const subdivision = getTemperatureLeadSubdivision(amount, octaveBase);
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
    const frequency = getTemperatureLeadFrequency(
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

    scheduleMidiNote(
      frequency,
      phaseStartMs + responseDelayMs + offset * 1000,
      noteLength,
      velocity
    );
  }
}

function scheduleReflectiveMelodyMidi(label, duration, sound, phaseStartMs) {
  const amount = schedulerTemperature;
  if (amount < 0.5 || !sound || duration <= 1.2) return;

  const subdivision = 1.25 - (amount - 0.5) * 1.5;
  const noteCount = Math.max(1, Math.floor((duration - subdivision * 0.25) / subdivision));

  for (let index = 0; index < noteCount; index += 1) {
    const offset = index * subdivision + subdivision * 0.5;
    const chord = getOrnamentChord(sound, duration, offset, amount);
    const topChordTone = Math.max(...chord);
    const highChordTones = chord
      .map((note) => note * 2)
      .filter((note) => note > topChordTone && note <= topChordTone * 4)
      .sort((left, right) => left - right);
    const ordered = label === "Exhale" ? highChordTones.slice().reverse() : highChordTones;
    const spread = Math.max(1, Math.min(ordered.length, Math.ceil(1 + amount * (ordered.length - 1))));
    const frequency = ordered[index % spread] || topChordTone * 2;

    scheduleMidiNote(frequency, phaseStartMs + offset * 1000, Math.min(420, subdivision * 720), 32);
  }
}

function schedulePhaseMidi(label, duration, phaseStartMs = 0) {
  const sound = applyTemperatureToSound(getPhaseSound(label));
  const sequence = Array.isArray(sound.sequence) ? sound.sequence : [];
  const phaseMs = duration * 1000;

  sequence.forEach((chord, stepIndex) => {
    const notes = Array.isArray(chord) ? chord : [chord];
    const stepMs = Math.max(420, phaseMs / Math.max(1, sequence.length));
    notes.forEach((frequency, voiceIndex) => {
      scheduleMidiNote(
        frequency,
        phaseStartMs + stepIndex * stepMs,
        Math.min(stepMs * 0.9, phaseMs - stepIndex * stepMs),
        voiceIndex === 0 ? 50 : 42
      );
    });
  });

  scheduleReflectiveMelodyMidi(label, duration, sound, phaseStartMs);
  scheduleTemperatureLeadMidi(label, duration, sound, phaseStartMs, 4, 0, 1);
  scheduleTemperatureLeadMidi(
    label === "Exhale" ? "Inhale" : label,
    duration,
    sound,
    phaseStartMs,
    2,
    Math.max(80, (0.5 - schedulerTemperature * 0.22) * 1000),
    0.72
  );
}

function runMidiCycle() {
  const blockReason = getSchedulerBlockReason();
  if (blockReason) {
    setStatus(`MIDI ready: ${blockReason}`);
    return;
  }

  const segments = getTechniqueSegments();
  const cycleDurationMs = getCycleDurationMs(segments);
  const origin = Number.isFinite(schedulerCycleStartedAt) && schedulerCycleStartedAt > 0
    ? schedulerCycleStartedAt
    : Date.now();
  const cycleElapsed =
    cycleDurationMs > 0
      ? ((Date.now() - origin) % cycleDurationMs + cycleDurationMs) % cycleDurationMs
      : 0;
  let elapsed = 0;
  let activeIndex = 0;

  clearSchedulerTimers();

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
  let delay = 0;

  schedulePhaseMidi(activeSegment.label, Math.max(0.05, remainingMs / 1000), delay);
  delay += remainingMs;

  for (let offset = 1; offset < segments.length; offset += 1) {
    const segment = segments[(activeIndex + offset) % segments.length];
    schedulePhaseMidi(segment.label, segment.duration, delay);
    delay += segment.duration * 1000;
  }

  scheduleTimer(runMidiCycle, delay);
  setStatus(`MIDI flowing to ${midiOut.name || "selected output"}`);
}

function updateSchedulerState(data) {
  schedulerMidiEnabled = Boolean(data[MIDI_STORAGE_KEYS.midi]);
  schedulerRunning = Boolean(data[MIDI_STORAGE_KEYS.running]);
  schedulerSoundEnabled = Boolean(data[MIDI_STORAGE_KEYS.sound]);
  schedulerTechniqueKey = MIDI_TECHNIQUES[data[MIDI_STORAGE_KEYS.technique]]
    ? data[MIDI_STORAGE_KEYS.technique]
    : "focus";
  schedulerCycleStartedAt = Number(data[MIDI_STORAGE_KEYS.cycleStartedAt]);
  if (!Number.isFinite(schedulerCycleStartedAt)) schedulerCycleStartedAt = 0;
  schedulerTemperature = Number(data[MIDI_STORAGE_KEYS.temperature]);
  if (!Number.isFinite(schedulerTemperature)) schedulerTemperature = 0;

  clearSchedulerTimers();
  allNotesOff();

  runMidiCycle();
}

function syncSchedulerFromStorage() {
  chrome.storage.local.get(
    {
      [MIDI_STORAGE_KEYS.midi]: false,
      [MIDI_STORAGE_KEYS.running]: false,
      [MIDI_STORAGE_KEYS.sound]: false,
      [MIDI_STORAGE_KEYS.technique]: "focus",
      [MIDI_STORAGE_KEYS.cycleStartedAt]: 0,
      [MIDI_STORAGE_KEYS.temperature]: 0
    },
    updateSchedulerState
  );
}

async function sendTestNote() {
  if (!midiOut) {
    const available = await scanMidiOutputs(false);
    if (!available || !midiOut) return;
  }

  for (let channel = 0; channel < 16; channel += 1) {
    sendRawMidi([0x90 + channel, 60, 96]);
  }

  setTimeout(() => {
    for (let channel = 0; channel < 16; channel += 1) {
      sendRawMidi([0x80 + channel, 60, 0]);
    }
  }, 650);

  setStatus(`Sent test note to ${midiOut.name || "selected output"}`);
  syncSchedulerFromStorage();
}

enableMidiButton.addEventListener("click", async () => {
  setBusy(true);
  setStatus("Asking Chrome for MIDI permission...");
  await scanMidiOutputs(true);
  setBusy(false);
});

scanMidiButton.addEventListener("click", async () => {
  setBusy(true);
  await scanMidiOutputs(true);
  setBusy(false);
});

midiOutputSelect.addEventListener("change", async () => {
  selectedOutputId = midiOutputSelect.value;
  midiOut = midiAccess
    ? Array.from(midiAccess.outputs.values()).find((output) => output.id === selectedOutputId) || null
    : null;
  selectedOutputLabel = midiOut ? midiOut.name || midiOut.id : "";

  await chrome.storage.local.set({
    [MIDI_STORAGE_KEYS.midi]: Boolean(midiOut),
    [MIDI_STORAGE_KEYS.midiOutput]: midiOut ? selectedOutputId : "",
    [MIDI_STORAGE_KEYS.midiOutputLabel]: selectedOutputLabel
  });
  setStatus(midiOut ? `MIDI ready: ${midiOut.name || "selected output"}` : "No output selected.");
  syncSchedulerFromStorage();
});

testMidiButton.addEventListener("click", sendTestNote);
darkModeToggle.addEventListener("change", persistDarkMode);

openSettingsButton.addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://settings/content/midiDevices" });
});

chrome.storage.local.get(
  {
    [MIDI_STORAGE_KEYS.midiOutput]: "",
    [MIDI_STORAGE_KEYS.midiOutputLabel]: "",
    [MIDI_STORAGE_KEYS.midi]: false,
    [MIDI_STORAGE_KEYS.running]: false,
    [MIDI_STORAGE_KEYS.sound]: false,
    [MIDI_STORAGE_KEYS.technique]: "focus",
    [MIDI_STORAGE_KEYS.cycleStartedAt]: 0,
    [MIDI_STORAGE_KEYS.temperature]: 0,
    [MIDI_STORAGE_KEYS.darkMode]: false
  },
  async (data) => {
    darkModeEnabled = Boolean(data[MIDI_STORAGE_KEYS.darkMode]);
    applyDarkMode();
    selectedOutputId = data[MIDI_STORAGE_KEYS.midiOutput] || "";
    selectedOutputLabel = data[MIDI_STORAGE_KEYS.midiOutputLabel] || "";
    const permissionState = await queryMidiPermissionState();
    if (permissionState === "granted") {
      await scanMidiOutputs(false);
    } else if (permissionState === "denied") {
      setStatus("Chrome has denied MIDI for this extension.");
      setDebug("Outputs: open Chrome MIDI settings, allow MIDI, then return here");
    } else {
      setStatus("MIDI needs Chrome permission.");
      setDebug("Outputs: press Enable MIDI access to scan");
    }
    updateSchedulerState(data);
  }
);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  if (changes[MIDI_STORAGE_KEYS.darkMode]) {
    darkModeEnabled = Boolean(changes[MIDI_STORAGE_KEYS.darkMode].newValue);
    applyDarkMode();
  }

  const relevantChange =
    changes[MIDI_STORAGE_KEYS.midi] ||
    changes[MIDI_STORAGE_KEYS.running] ||
    changes[MIDI_STORAGE_KEYS.sound] ||
    changes[MIDI_STORAGE_KEYS.technique] ||
    changes[MIDI_STORAGE_KEYS.cycleStartedAt] ||
    changes[MIDI_STORAGE_KEYS.temperature];

  if (relevantChange) syncSchedulerFromStorage();
});
