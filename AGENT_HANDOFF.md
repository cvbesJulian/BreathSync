# BreathSync Agent Handoff

Use this file when context window resets. Read this first, then inspect current files before editing.

## Mission

BreathSync is a vanilla Chrome Extension MV3 breathing companion.

Core idea:
- Minimal Aesop-inspired popup.
- Floating draggable breathing widget on webpages.
- Generative ambient audio tied to breath phases.
- Optional analogue clock tick.
- Optional MIDI note output to IAC Driver for Ableton Live.

No React, Vite, npm, bundlers, TypeScript, Tailwind, or external deps.

## File Map

- `manifest.json`: MV3 config + permissions. No global content script and no host permissions; popup injects `content.js`/`content.css` only after user clicks guide button using `activeTab`.
- `popup.html`: extension popup UI.
- `popup.css`: popup styling + local file-preview floating demo styling.
- `popup.js`: popup state, audio engine, MIDI UI/output, local `file://` preview widget.
- `content.js`: injected webpage floating widget, audio engine mirror, storage sync.
- `content.css`: floating widget styling on real webpages.
- `background.js`: MV3 service worker; creates/closes offscreen audio document.
- `offscreen.html`: hidden audio document; loads `content.js` as persistent audio engine.
- `breathsync_mvp.md`: original source spec.
- `listen.html` / `listen.css` / `listen.js`: instrument listening page (audio input capture + real-time melody/harmony analysis). See `LISTEN_FEATURE_PLAN.md`.
- `LISTEN_FEATURE_PLAN.md`: phased plan + status for the instrument listening feature (branch `midi-input`).

## Current Product State

Implemented:
- Technique selector: Focus, Relax, Sleep, Reset, Performance.
- Persistent running state via `chrome.storage.local`.
- Persistent technique, sound palette, volume, temperature, reverb, binaural, clock, mute, widget position.
- Persistent dark mode via `breathsyncDarkMode`.
- Floating widget:
  - injected into selected webpage only after `Start floating guide` / `Show guide on this tab`
  - draggable
  - translucent glass panel
  - small bottom-right mute
  - small top-right `x` close button
  - follows popup dark mode
  - orb phase animation
  - `CVBES LABS` micro-label only
- Popup footer:
  - `Developed by CVBES Labs 2026`
  - `Beta 0.1`
- Popup also has local `file://` preview widget for browser preview.
- Only one real webpage tab may own the floating widget at a time.
  - Active owner stored in `breathsyncActiveTabId`.
  - New tab activation is blocked with status until user presses Stop.

Audio:
- Web Audio only.
- Default volume: 25% unless user touched volume.
- Sound palette is off by default.
- One-time migration key `breathsyncSoundDefaultSilentMigrated` forces old installs to sound-off once.
- Enabling sound palette must not write `breathsyncSound=false` first; popup local state would flip off and cancel fade-in.
- Launch defaults migration key `breathsyncLaunchDefaultsVersion = 2026-05-03-v1`.
- Default launch properties:
  - Technique: Focus / Box breathing.
  - Relaxing phase sounds: off.
  - Sound palette: Tidal Pentatonic.
  - Volume: 25%.
  - Temperature: 0%.
  - Reverb: 80%.
  - Binaural surround: off.
  - 3D Space: 50%.
  - Analogue breath clock: off.
  - Clock Volume: 35%.
  - MIDI notes out: off.
  - Dark mode: off.
- Start plays short welcome chime even while palette is off.
- Enabling sound palette plays short confirmation chime, then fades palette in over 1.5 seconds.
- Checking `Relaxing phase sounds` must start sound independently from the floating guide `running` state.
- If `breathsyncMuted` was left true by the floating widget, checking `Relaxing phase sounds` now clears mute so the user is not stuck in a silent hidden state.
- Welcome chime intentionally very soft/slow attack; avoid Start volume spike.
- If sound is already enabled when Start is clicked, offscreen audio starts at zero master scale and fades in over 1.5 seconds to prevent launch spikes.
- Reverb slider controls convolution reverb size/decay.
- 25% ping-pong delay in mix.
- Binaural surround toggle + 3D space slider.
- Temperature slider controls consonant generative variation.
- Higher notes get quieter + darker low-pass.
- Reflective high-voice melodic layer added for expressive ambient feel.
- Palette list:
  - `Tidal Pentatonic`
  - `Halo Bloom`
  - `Aura FM`
  - `Ivory Drift`
  - `Silver Glocken`
  - `Tape Meadow`
  - `Selected Airworks`
- Brand logo assets:
  - Source image: `CVBES LOGO.png`
  - Generated transparent mask: `assets/cvbes-logo-mask.png`
  - Chrome extension icons: `assets/icon-16.png`, `assets/icon-32.png`, `assets/icon-48.png`, `assets/icon-128.png`; these are transparent breathing-sphere icons, generated from `assets/breathsync-icon-master.png`.
  - Popup, MIDI setup tab, and floating widget use CSS mask tinting so the logo follows the BreathSync stone/parchment palette and dark mode.

Clock:
- `Analogue breath clock` toggle.
- Clock volume slider.
- Non-transposing analogue tick.

MIDI:
- UI:
  - `MIDI notes out` checkbox
  - `MIDI output` select
  - `Test MIDI note`
  - status + debug lines
- Manifest permissions include:
  - `storage`
  - `midi`
  - `activeTab`
  - `scripting`
  - `tabs`
  - host permissions `<all_urls>`
- MIDI sends generated chord/melody notes independently from audio.
- Test note sends C3/C4-equivalent note on all 16 channels.
- `file://popup.html` cannot send MIDI. It should show blocked/file-preview status.
- Real MIDI must be tested from loaded extension popup, not in-app `file://`.
- Content scripts no longer request MIDI on every tab load.
- Content scripts never call `requestMIDIAccess`; MIDI permission/output scanning is popup-only to avoid per-tab permission prompts.

Listen (instrument analysis, branch `midi-input`):
- Opened from popup `Listen / analyze instrument` button (`openListenPage()` → `chrome.tabs.create` on `listen.html`).
- Analyze-and-display only: does NOT alter BreathSync's own audio/MIDI generation yet.
- Audio input via `getUserMedia` (mic/line); no new manifest permission needed for extension-page mic capture. AGC/noise-suppression/echo-cancel disabled.
- Device picker via `enumerateDevices`; selected input persisted to `breathsyncListenInputDevice`.
- Phase 0 (done): device picker, Start/Stop capture, RMS level meter, clean teardown.
- Phase 1 (done): autocorrelation monophonic pitch → note/octave/cents readout + tuning needle; median smoothing + noise gate.
- Phase 2 (done): FFT (8192) → 12-bin chroma (fast EMA for chords, slow EMA for key) → cosine chord-template match (maj/min/dim/aug/sus2/sus4/maj7/min7/dom7) with hysteresis + Krumhansl–Schmuckler key detection + 12-bar chroma visualization. Pitch autocorrelation runs on the first 2048 samples to stay cheap.
- Phase 3 (todo): confidence gating + throttled `harmonyState` write to storage as the hook for a future "follow external harmony" generation phase.
- Shares `breathsyncDarkMode` with the rest of the extension.

## Important Browser Reality

Chrome extension popup behavior:
- Popup closes when extension icon toggled or focus leaves. This is normal.
- Floating guide must live in content script on active webpage.
- Widget cannot be injected into:
  - `chrome://extensions`
  - Chrome Web Store
  - extension pages
  - protected internal browser pages
- Use normal `https://` webpage for widget tests.

Popup Start button behavior:
- If not running: starts running + injects widget into active tab.
- If already running: label should be `Show guide on this tab`; still injects into current active tab.

## Current Known Risk Areas

1. MIDI permission / IAC
   - If status says `Outputs: blocked (NotAllowedError)`, browser context blocked Web MIDI.
   - Most likely from `file://` preview.
   - Test only from real extension popup.
   - Avoid adding `requestMIDIAccess` in content init/storage sync; it causes repeated permission popups.

2. Audio
   - Popup phase audio must not be gated by floating guide `running`; the sound checkbox owns palette playback.
   - Content widget audio may need page click due browser autoplay policy.
   - `resumeLocalAudio` and content `breathsyncResumeAudio` exist for user gesture resume.

3. Floating widget
- Injection now uses `chrome.scripting.executeScript`.
- `content.js` has guard `window.__breathsyncContentLoaded`.
- If widget missing, check current tab URL first.
- If status says running in another tab, press Stop first or close stale tab.
- Do not restore manifest `content_scripts` or `<all_urls>` host permissions; that makes widget behavior feel global.

## Verification Commands

Run after edits:

```sh
node --check popup.js
node --check content.js
node --check listen.js
python3 -m json.tool manifest.json
```

Manual extension test:

1. Open `chrome://extensions`.
2. Reload BreathSync unpacked extension.
3. Open normal `https://` webpage.
4. Click BreathSync extension icon.
5. Click `Start floating guide`.
6. Confirm widget appears bottom-right, draggable, mute works.
7. Confirm popup audio starts.
8. For MIDI:
   - macOS Audio MIDI Setup: enable IAC Driver.
   - Ableton: Track input from IAC Driver, Monitor `In` or arm track.
   - Extension popup: enable MIDI, select IAC, press `Test MIDI note`.
   - Watch MIDI status/debug send count.

## Next Development Tasks

High priority:
- Validate real extension popup MIDI in Chrome with IAC Driver. If blocked, investigate Chrome Web MIDI permission model for MV3 popup.
- Add stronger status copy:
  - real selected port name/id
  - send count
  - blocked reason
  - current tab injection result
- Consider moving long-lived audio/MIDI scheduler to an offscreen document if popup closure breaks desired routing.

Medium:
- Add explicit `Refresh MIDI outputs` button.
- Add MIDI channel selector.
- Add MIDI velocity control.
- Add MIDI note range/octave control.
- Add Ableton setup mini-checklist in popup, hidden under details.
- Add BPM sync architecture placeholder.

Low:
- Refactor duplicated audio code between popup/content.
- Add constants module impossible in current no-bundler content-script setup unless using duplicated vanilla files.
- Improve mobile widget dimensions.

## Architecture Notes

State source:
- `chrome.storage.local` keys defined at top of `popup.js` and `content.js`.
- Keep key names mirrored.

Audio source:
- Offscreen document handles continuous audible sound so audio survives popup close.
- Popup asks background for `breathsync-restart-offscreen-audio` after sound toggle/storage write so offscreen starts immediately, not only via storage race.
- Start now awaits the background offscreen restart before the popup can finish closing, so audio survives popup minimization.
- Popup preview audio is suppressed while the real extension guide is running; active tab/offscreen owns playback so clicking popup away cannot kill the heard source.
- Popup + injected guide spheres share `breathsyncCycleStartedAt`; both compute current phase from same timestamp instead of independent timers.
- Temperature: harmony is 2 voices near 0%, then consonant diatonic triads only. Sus colors are gated away from semitone/tritone cases. Detached high melody appears after 50%, uses only current chord tones at +1/+2 octaves, and densifies toward 1/16 at 100%.
- Temperature changes resync current phase immediately so melody/voice-count changes are audible without waiting for the next breath phase.
- Beyond 50% Temperature, audio has two detached upper lines: 4th voice at +1 octave from chord tones; 5th voice is freer scale-consonant counterpoint at high register (roughly 880-3520Hz), offbeat and faster toward 1/16 density near 100%.
- 5th voice counterpoint is now audibly separate: scale-safe random leaps above 64% temp, brighter triangle timbre, open high filter, higher cap around 4186Hz, and stronger gain.
- Workaround for high voice audibility: separate temperature lead bus bypasses shared phase filter/gain and connects to master with bandpass filter at note frequency. It starts above 50%, reaches 1/16-ish density at 100%, and uses scale-safe random leaps.
- High temp lead gain reduced; old extra high counterpoint in shared melody bus disabled. A new lower response line uses the same temp lead engine one octave lower, delayed/offbeat, at 72% of lead gain.
- Highest temperature lead now uses stepped rhythmic density in final 10%: 90-92.5% = 1/2 notes, 92.5-95% = 1/4, 95-97.5% = 1/8, 97.5-100% = 1/16. Lower response voice keeps previous smoother rhythm.
- MIDI permission/routing: popup no longer owns Web MIDI. It opens `midi-permission.html`, and that setup tab is the only page that calls `navigator.requestMIDIAccess()` and sends notes to IAC. This avoids popup/offscreen permission crashes.
- MIDI scheduler lives in `midi-permission.js`; it watches storage (`running`, `sound`, `technique`, `cycleStartedAt`, `temperature`, `midi`) and generates harmony, reflective melody, high lead, and lower response directly to selected MIDI output. It streams when either the floating guide is running or the sound palette is enabled. Keep setup tab open while routing to Ableton.
- Setup tab stores both `breathsyncMidiOutput` and `breathsyncMidiOutputLabel`; popup mirrors the selected driver label in its MIDI output field, but clicking the field still opens setup for actual selection.
- MIDI setup tab has `Scan MIDI outputs`; debug text now says whether it needs permission, is scanning, found no outputs, or found IAC. Popup no longer shows stale `Outputs: none scanned`.
- Popup Start must not overwrite `breathsyncMidiOutput`; setup tab owns the selected output id. Scheduler status now says what blocks continuous MIDI flow: select output, enable MIDI notes out, or start floating guide.
- Avoid raw MIDI through `chrome.runtime.sendMessage` or `BroadcastChannel`; prior bridge/flood paths could crash MV3 and make Chrome block/reload the extension.
- Popup only plays short feedback chimes and local `file://` preview audio.
- Webpage content widget must not call its own Web Audio phase/tick playback; avoid double/cacophony.
- Widget mute writes `breathsyncMuted`; offscreen/popup storage listeners silence main output.
- `content.js` checks `BREATHSYNC_IS_OFFSCREEN_AUDIO`; only `offscreen.html` path plays phase/tick audio.
- Offscreen `breathsyncApplyState` must not call `breathsyncStartWidget()` on every storage change; only first run or sound-enabled transition. Otherwise phases restart/latch.
- Webpage content `breathsyncApplyState` must not open widget from storage `running=true`; only message `breathsync-start-tab` sets `breathsyncStartRequested=true`. Otherwise sound toggle can pop widget.
- Phase sound has auto fade/stop near phase end to avoid held-note latch if next phase scheduling fails.
- Main chord engine now uses `createSequencedChordNodes` / `breathsyncCreateSequencedChordNodes`: one short envelope per chord step. Do not return to long oscillators with stepped frequency; that caused final-note latch.

MIDI source:
- Popup can request Web MIDI by user gesture.
- Content scripts never request Web MIDI.
- MIDI sends note-on/note-off timers from phase transitions, independent from audio.

Do not:
- Add dependencies.
- Replace with React.
- Break `file://popup.html` preview fallback.
- Remove Aesop-inspired calm editorial visual language.
- Use exact artist cloning language; keep “inspired emotional lane / original palette.”
