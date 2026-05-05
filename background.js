const OFFSCREEN_URL = "offscreen.html";
let offscreenCreatePromise = null;

async function hasOffscreenDocument() {
  if (!chrome.runtime.getContexts) return false;

  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
  });

  return contexts.length > 0;
}

async function ensureOffscreenAudio() {
  if (await hasOffscreenDocument()) return;

  if (!offscreenCreatePromise) {
    offscreenCreatePromise = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: ["AUDIO_PLAYBACK"],
        justification: "Keep BreathSync audio running after popup closes."
      })
      .catch((error) => {
        if (
          error &&
          typeof error.message === "string" &&
          error.message.includes("Only a single offscreen document")
        ) {
          return;
        }
        throw error;
      })
      .finally(() => {
        offscreenCreatePromise = null;
      });
  }

  await offscreenCreatePromise;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function restartOffscreenAudio() {
  await ensureOffscreenAudio();

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await chrome.runtime.sendMessage({ type: "breathsync-restart-audio" });
      return;
    } catch (error) {
      if (attempt === 9) throw error;
      await wait(150);
    }
  }
}

async function startAmbientAudio(volumes, ambientEnabled = true) {
  await ensureOffscreenAudio();

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await chrome.runtime.sendMessage({
        type: "breathsync-start-ambient-audio",
        ambientEnabled,
        volumes
      });
      return;
    } catch (error) {
      if (attempt === 9) throw error;
      await wait(150);
    }
  }
}

async function closeOffscreenAudio() {
  if (await hasOffscreenDocument()) {
    await chrome.offscreen.closeDocument();
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return false;

  if (message.type === "breathsync-ensure-offscreen-audio") {
    ensureOffscreenAudio()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "breathsync-restart-offscreen-audio") {
    restartOffscreenAudio()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "breathsync-close-offscreen-audio") {
    closeOffscreenAudio()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "breathsync-start-ambient-offscreen") {
    startAmbientAudio(message.volumes || {}, Boolean(message.ambientEnabled))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  const audioRelevantChange =
    changes.breathsyncRunning ||
    changes.breathsyncSound ||
    changes.breathsyncTick ||
    changes.breathsyncAmbientEnabled ||
    changes.breathsyncFountainVolume ||
    changes.breathsyncRainVolume ||
    changes.breathsyncKidsVolume;

  if (audioRelevantChange) {
    chrome.storage.local
      .get({
        breathsyncRunning: false,
        breathsyncSound: false,
        breathsyncTick: false,
        breathsyncAmbientEnabled: false,
        breathsyncFountainVolume: 0,
        breathsyncRainVolume: 0,
        breathsyncKidsVolume: 0
      })
      .then((state) => {
        const ambientEnabled =
          Boolean(state.breathsyncAmbientEnabled) &&
          (Number(state.breathsyncFountainVolume) > 0.001 ||
            Number(state.breathsyncRainVolume) > 0.001 ||
            Number(state.breathsyncKidsVolume) > 0.001);

        if (state.breathsyncSound || state.breathsyncTick || ambientEnabled) {
          return restartOffscreenAudio();
        }

        return closeOffscreenAudio();
      })
      .catch(() => {});
  }
});
