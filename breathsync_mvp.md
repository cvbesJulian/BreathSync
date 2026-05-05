# BreathSync — Chrome Extension Frontend MVP

## Goal

Build a minimalist Chrome Extension for guided breathing during daily work, browsing, coding, music production, and creative focus.

Visual direction:
- Aesop-inspired
- Editorial
- Minimal
- Warm neutral palette
- No gamified UI
- Calm, premium, silent by default

Core interaction:
A floating breathing orb expands and contracts to guide the user’s breath.

---

## Chrome Extension Architecture

Use Manifest V3.

Chrome extension files:

```txt
breathsync/
├── manifest.json
├── popup.html
├── popup.css
├── popup.js
├── content.js
└── content.css

---

manifest.json:

{
  "name": "BreathSync",
  "description": "Minimal guided breathing for focus, calm, sleep, and creative work.",
  "version": "1.0.0",
  "manifest_version": 3,
  "action": {
    "default_popup": "popup.html",
    "default_title": "BreathSync"
  },
  "permissions": ["storage"],
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "css": ["content.css"]
    }
  ]
}

---

Breathing Techniques:

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

---
popup.html

<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>BreathSync</title>
  <link rel="stylesheet" href="popup.css" />
</head>
<body>
  <main class="app">
    <header class="header">
      <p class="eyebrow">BreathSync</p>
      <h1>Regulate your state.</h1>
      <p class="intro">
        A quiet breathing companion for focus, calm, sleep, and creative work.
      </p>
    </header>

    <section class="controls">
      <label for="technique">Technique</label>
      <select id="technique">
        <option value="focus">Focus — Box breathing</option>
        <option value="relax">Relax — 4-7-8</option>
        <option value="sleep">Sleep — Slow breathing</option>
        <option value="reset">Reset — Physiological sigh</option>
        <option value="performance">Performance — Rhythmic breathing</option>
      </select>
    </section>

    <section class="preview">
      <div class="orb" id="previewOrb"></div>
      <p id="phaseLabel">Ready</p>
    </section>

    <section class="actions">
      <button id="toggleWidget">Start floating guide</button>
      <button id="stopWidget" class="secondary">Stop</button>
    </section>
  </main>

  <script src="popup.js"></script>
</body>
</html>

---
:root {
  --bg: #f7f4ee;
  --panel: #ede8df;
  --text: #2e2a26;
  --muted: #7a7067;
  --line: #d8d0c4;
  --accent: #9b9388;
  --accent-dark: #5f584f;
  --orb: #c8bba9;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  width: 340px;
  min-height: 520px;
  background: var(--bg);
  color: var(--text);
  font-family: Georgia, "Times New Roman", serif;
}

.app {
  padding: 28px;
}

.header {
  border-bottom: 1px solid var(--line);
  padding-bottom: 22px;
}

.eyebrow {
  margin: 0 0 18px;
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--muted);
}

h1 {
  margin: 0;
  font-size: 32px;
  line-height: 0.95;
  font-weight: 400;
}

.intro {
  margin: 18px 0 0;
  font-family: Arial, sans-serif;
  font-size: 13px;
  line-height: 1.6;
  color: var(--muted);
}

.controls {
  margin-top: 26px;
}

label {
  display: block;
  margin-bottom: 10px;
  font-family: Arial, sans-serif;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
}

select {
  width: 100%;
  padding: 13px 14px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--text);
  font-family: Arial, sans-serif;
  font-size: 14px;
}

.preview {
  display: grid;
  place-items: center;
  margin: 34px 0;
}

.orb {
  width: 112px;
  height: 112px;
  border-radius: 999px;
  background:
    radial-gradient(circle at 35% 30%, #e4d8ca, var(--orb) 65%, #9b8f80);
  box-shadow:
    0 20px 60px rgba(46, 42, 38, 0.12),
    inset 0 0 30px rgba(255, 255, 255, 0.35);
  transform: scale(0.88);
  transition: transform 4s ease-in-out, opacity 1s ease;
}

#phaseLabel {
  margin-top: 24px;
  font-family: Arial, sans-serif;
  font-size: 12px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
}

.actions {
  display: grid;
  gap: 10px;
}

button {
  width: 100%;
  padding: 14px;
  border: 1px solid var(--accent-dark);
  background: var(--accent-dark);
  color: var(--bg);
  font-family: Arial, sans-serif;
  font-size: 13px;
  cursor: pointer;
}

button.secondary {
  background: transparent;
  color: var(--accent-dark);
}

---
popup.js:

const techniqueSelect = document.getElementById("technique");
const toggleWidget = document.getElementById("toggleWidget");
const stopWidget = document.getElementById("stopWidget");
const previewOrb = document.getElementById("previewOrb");
const phaseLabel = document.getElementById("phaseLabel");

const TECHNIQUES = {
  focus: { label: "Focus", inhale: 4, holdIn: 4, exhale: 4, holdOut: 4 },
  relax: { label: "Relax", inhale: 4, holdIn: 7, exhale: 8, holdOut: 0 },
  sleep: { label: "Sleep", inhale: 5, holdIn: 0, exhale: 7, holdOut: 0 },
  reset: { label: "Reset", inhale: 2, holdIn: 0, exhale: 6, holdOut: 0 },
  performance: { label: "Performance", inhale: 3, holdIn: 0, exhale: 3, holdOut: 0 }
};

let previewTimeout;

function animatePreview() {
  clearTimeout(previewTimeout);

  const technique = TECHNIQUES[techniqueSelect.value];

  phaseLabel.textContent = "Inhale";
  previewOrb.style.transitionDuration = `${technique.inhale}s`;
  previewOrb.style.transform = "scale(1.15)";

  previewTimeout = setTimeout(() => {
    phaseLabel.textContent = "Exhale";
    previewOrb.style.transitionDuration = `${technique.exhale}s`;
    previewOrb.style.transform = "scale(0.88)";
  }, technique.inhale * 1000);
}

techniqueSelect.addEventListener("change", async () => {
  await chrome.storage.local.set({
    breathsyncTechnique: techniqueSelect.value
  });

  animatePreview();
});

toggleWidget.addEventListener("click", async () => {
  await chrome.storage.local.set({
    breathsyncRunning: true,
    breathsyncTechnique: techniqueSelect.value
  });
});

stopWidget.addEventListener("click", async () => {
  await chrome.storage.local.set({
    breathsyncRunning: false
  });
});

chrome.storage.local.get(
  ["breathsyncTechnique", "breathsyncRunning"],
  (data) => {
    if (data.breathsyncTechnique) {
      techniqueSelect.value = data.breathsyncTechnique;
    }

    animatePreview();
  }
);

setInterval(animatePreview, 14000);

---
content.css:

#breathsync-widget {
  position: fixed;
  right: 28px;
  bottom: 28px;
  z-index: 2147483647;
  width: 190px;
  padding: 18px;
  background: rgba(247, 244, 238, 0.92);
  backdrop-filter: blur(18px);
  border: 1px solid rgba(216, 208, 196, 0.85);
  box-shadow: 0 24px 80px rgba(46, 42, 38, 0.16);
  color: #2e2a26;
  font-family: Georgia, "Times New Roman", serif;
}

#breathsync-widget.hidden {
  display: none;
}

#breathsync-orb {
  width: 86px;
  height: 86px;
  margin: 12px auto 18px;
  border-radius: 999px;
  background:
    radial-gradient(circle at 35% 30%, #e7dccf, #c8bba9 68%, #9b8f80);
  box-shadow:
    0 18px 50px rgba(46, 42, 38, 0.2),
    inset 0 0 30px rgba(255, 255, 255, 0.35);
  transform: scale(0.88);
  transition-property: transform, opacity, filter;
  transition-timing-function: ease-in-out;
}

#breathsync-phase {
  margin: 0;
  text-align: center;
  font-family: Arial, sans-serif;
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #7a7067;
}

#breathsync-title {
  margin: 0;
  text-align: center;
  font-size: 18px;
  font-weight: 400;
}

#breathsync-subtitle {
  margin: 6px 0 0;
  text-align: center;
  font-family: Arial, sans-serif;
  font-size: 11px;
  color: #7a7067;
}

---

content.js:

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
    subtitle: "Rhythmic breathing",
    inhale: 3,
    holdIn: 0,
    exhale: 3,
    holdOut: 0
  }
};

let currentTechnique = "focus";
let running = false;
let phaseTimeout = null;

function createWidget() {
  if (document.getElementById("breathsync-widget")) return;

  const widget = document.createElement("div");
  widget.id = "breathsync-widget";
  widget.className = "hidden";

  widget.innerHTML = `
    <h2 id="breathsync-title">BreathSync</h2>
    <p id="breathsync-subtitle">Quiet regulation</p>
    <div id="breathsync-orb"></div>
    <p id="breathsync-phase">Ready</p>
  `;

  document.body.appendChild(widget);
}

function setPhase(label, scale, duration, glow = false) {
  const orb = document.getElementById("breathsync-orb");
  const phase = document.getElementById("breathsync-phase");

  if (!orb || !phase) return;

  phase.textContent = label;
  orb.style.transitionDuration = `${duration}s`;
  orb.style.transform = `scale(${scale})`;
  orb.style.filter = glow ? "brightness(1.04)" : "brightness(1)";
}

function runCycle() {
  if (!running) return;

  const technique = TECHNIQUES[currentTechnique];
  const title = document.getElementById("breathsync-title");
  const subtitle = document.getElementById("breathsync-subtitle");

  title.textContent = technique.label;
  subtitle.textContent = technique.subtitle;

  setPhase("Inhale", 1.16, technique.inhale, true);

  let elapsed = technique.inhale * 1000;

  phaseTimeout = setTimeout(() => {
    if (technique.holdIn > 0) {
      setPhase("Hold", 1.16, technique.holdIn, true);
    }
  }, elapsed);

  elapsed += technique.holdIn * 1000;

  phaseTimeout = setTimeout(() => {
    setPhase("Exhale", 0.86, technique.exhale, false);
  }, elapsed);

  elapsed += technique.exhale * 1000;

  phaseTimeout = setTimeout(() => {
    if (technique.holdOut > 0) {
      setPhase("Pause", 0.86, technique.holdOut, false);
    }
  }, elapsed);

  elapsed += technique.holdOut * 1000;

  phaseTimeout = setTimeout(runCycle, elapsed);
}

function startWidget() {
  const widget = document.getElementById("breathsync-widget");
  widget.classList.remove("hidden");

  clearTimeout(phaseTimeout);
  running = true;
  runCycle();
}

function stopWidget() {
  const widget = document.getElementById("breathsync-widget");
  const phase = document.getElementById("breathsync-phase");
  const orb = document.getElementById("breathsync-orb");

  running = false;
  clearTimeout(phaseTimeout);

  if (widget) widget.classList.add("hidden");
  if (phase) phase.textContent = "Ready";
  if (orb) orb.style.transform = "scale(0.88)";
}

function syncState() {
  chrome.storage.local.get(
    ["breathsyncRunning", "breathsyncTechnique"],
    (data) => {
      currentTechnique = data.breathsyncTechnique || "focus";

      if (data.breathsyncRunning) {
        startWidget();
      } else {
        stopWidget();
      }
    }
  );
}

createWidget();
syncState();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  syncState();
});

---

UX Behavior

Popup

The popup is for selection and control.

Chrome popups close when the user clicks outside them, so the breathing guide should not depend on the popup staying open. The persistent visual guide must live in the content script injected into the page.

Floating widget

The floating widget is the daily-use interface.

It should be:

* Small
* Non-invasive
* Always visible only when activated
* Bottom-right by default
* No sound by default
* Visually soft
* Low cognitive load

⸻

Visual System

Best diagram choice

Use an expanding and contracting orb.

Reason:
It maps directly to the physical sensation of breathing.

* Expanding orb = inhale
* Still orb = hold
* Contracting orb = exhale

This is better than a static diagram because it reduces the need to count.

---
END
