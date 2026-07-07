# BreathSync — Follow External Harmony (Generation) Plan

Branch (proposed): `follow-harmony` (cut from `midi-input`)

Status: **v1.1.0 shipped a first slice** — key-only following on the **audio path**
(`content.js` offscreen + `popup.js` preview). MIDI-out, chord biasing, and lead
alignment remain future work. This sits on top of the analyze-only Listen feature
(see `LISTEN_FEATURE_PLAN.md`).

## Implemented in v1.1.0 (audio-output branch)

- Decisions: **key-only** following, **audio output first** (MIDI-out untouched).
- New storage keys: `breathsyncFollowHarmony` (bool, default false),
  `breathsyncFollowStrength` (0–1, default 0.6). Both mirrored in `popup.js` and
  `content.js`; consumers also read `breathsyncHarmonyState`.
- Harmony bridge (mirrored in `content.js` + `popup.js`):
  - `buildScaleFromKey(rootPc, mode)` generates a proper 7-per-octave diatonic scale
    (major/natural-minor) spanning ~60–1250 Hz.
  - `getFollowedScale()` returns that scale only when following is on, state is fresh
    (`updatedAt` within 4 s), and `confidence >= 0.85 − strength·0.45` (strength lowers
    the bar / makes following more eager). Otherwise `null`.
  - `updateActiveScale()` swaps the active scale used by `nearestScaleIndex` /
    `getDiatonicNoteFromIndex`; it is called at the **start of each phase sound build**
    (`breathsyncPlayPhaseSound` / `playLocalPhaseSound`), so following switches at breath
    phase boundaries (no mid-phase retunes).
- `harmonyState` and follow-key changes are applied to live caches in `storage.onChanged`
  **without** forcing a phase/cycle restart (avoids ~4 Hz restarts and MV3 issues).
- Popup UI: **Follow external harmony (key)** toggle + **Follow strength** slider +
  status line ("Following D minor from instrument" / waiting / off).
- Default off + staleness/low-confidence fallback → byte-for-byte the old palette.
- MIDI-out scheduler (`midi-permission.js`) intentionally **unchanged** (still internal
  palette).

## Goal

Make BreathSync's own generative output **react to** the harmony/melody detected from an
external instrument. Today the Listen page produces `breathsyncHarmonyState` in
`chrome.storage.local` but nothing consumes it. This phase wires that state into the
generators so BreathSync **harmonizes with** the external instrument instead of always
playing its fixed internal palette — gated behind a toggle and a strength control, and
defaulting to today's behavior when off / unavailable.

## Current generation architecture (grounded)

There are **three parallel generators**, all built on the same music-theory helpers,
duplicated per file (no bundler, per `AGENT_HANDOFF.md`):

| Generator | File | Notes |
|---|---|---|
| Audio synth (audible) | `content.js` (offscreen doc) | `BREATHSYNC_CONSONANT_SCALE` (~line 1630), `breathsyncCreateSequencedChordNodes` (~1990) |
| Popup preview synth | `popup.js` | `CONSONANT_SCALE` (~1370), `buildTemperatureChord` (~1401), `getPhaseSound` (~1051), `createSequencedChordNodes` (~1725) |
| MIDI-out scheduler | `midi-permission.js` | `MIDI_CONSONANT_SCALE`, `buildTemperatureChord`, `getPhaseSound`, `getTemperatureLeadFrequency` |

How harmony is currently produced (identical logic in each file):

1. Each breath phase has a `getPhaseSound(label)` returning a `sequence` of seed chords
   (arrays of frequencies).
2. `buildTemperatureChord(chord, amount, chordIndex)`:
   - `rootIndex = nearestScaleIndex(chord[0])` — snap the seed to the fixed scale.
   - `degree = rootIndex % 7`, then stack scale-degree triads (`[0,2,4]`, with sus/7
     colors as temperature rises).
   - Map back with `getDiatonicNoteFromIndex(rootIndex + interval)`.
3. Everything resolves against a **fixed frequency set** (`*_CONSONANT_SCALE`, ~A natural
   minor / pentatonic-ish spanning ~73–1175 Hz).

**Key insight:** all pitch content flows through `*_CONSONANT_SCALE` +
`buildTemperatureChord`. If we make the scale and chord selection **key/chord-aware**,
every generator follows external harmony with minimal surface area.

## Input contract: `breathsyncHarmonyState`

Produced by `listen.js` (Phase 3), written throttled to `chrome.storage.local`:

```json
{
  "key": "D", "mode": "minor",
  "scalePitchClasses": [2,4,5,7,9,10,0],
  "chordRoot": "A", "chordQuality": "min", "chordPitchClasses": [9,0,4],
  "leadNote": 74, "density": 2.3,
  "confidence": 0.81, "updatedAt": 1720000000000
}
```

- **Staleness**: `updatedAt` lets consumers detect a closed/stopped Listen page. If older
  than `HARMONY_STALE_MS` (e.g. 3–5 s), ignore and fall back to the internal palette.
- **Idle state**: Listen writes a zeroed state (confidence 0) on silence/stop.

## Design: the Harmony Bridge

A small, duplicated helper module (`harmony-follow` logic) added to each generator file.
Two knobs drive it, both from storage:

- `breathsyncFollowHarmony` (bool) — master on/off.
- `breathsyncFollowStrength` (0–1) — how strongly external harmony overrides the palette.

### 1. Key-aware scale (primary lever)

Replace the fixed `*_CONSONANT_SCALE` with a scale **generated from the detected key**
when following is active and confident:

- `buildScaleFromKey(rootPitchClass, mode)` → a proper 7-notes-per-octave diatonic scale
  (major = `[0,2,4,5,7,9,11]`, natural minor = `[0,2,3,5,7,8,10]`) spanning the same
  register as today (~73–1175 Hz), anchored so `rootPitchClass` sits near the low octave.
- Bonus: a real 7-per-octave scale makes the existing `rootIndex % 7` degree logic in
  `buildTemperatureChord` *more* correct than the current irregular array.
- The active scale becomes `blend(internalScale, followedScale, strength)` — at
  `strength = 0` it's today's palette; at `1` it's fully the detected key. (Blend is a
  selection/interpolation of the scale used per note, not a literal frequency average.)

### 2. Chord biasing (secondary lever)

When a chord is detected with good confidence, bias the per-step triad toward
`chordPitchClasses` instead of the generic scale-degree triad:

- "Chord lock": voice the detected chord's pitch classes in the phase's current register
  (respecting inhale/exhale contour + high-note damping already in place).
- Strength scales how often/strongly we snap to chord tones vs. the scale-degree triad.

### 3. Melodic lead alignment (tertiary lever)

The temperature lead / reflective melody (`getTemperatureLeadFrequency`, high voices):

- Constrain lead note choices to the followed scale.
- Optional **call/response**: use `leadNote` as a target the exhale lead resolves toward
  or shadows — tied to breath phase (a musical "answer"). Off by default; a stretch.

### 4. Confidence gating + smoothing (required for musicality)

- Only adopt a new key/chord when `confidence >= FOLLOW_MIN_CONFIDENCE` and state is fresh.
- **Change at phase boundaries**, not mid-phase: latch a "target harmony" and only switch
  the active key/chord at the next inhale/exhale transition, so retunes never jar.
- Hysteresis on key changes (keys should change rarely); chords may change per phase.
- Ramp/crossfade rather than hard-switch where feasible.

## Consumers & integration points

Update all three generators identically (mirrored duplication, matching current pattern):

1. `midi-permission.js` — easiest to prototype first; already reads storage and has the
   scheduler + `buildTemperatureChord` + lead functions. Add harmony-state read + bridge.
2. `content.js` (offscreen, audible) — the real audio path; add the same bridge to
   `breathsyncCreateSequencedChordNodes` and the scale/chord helpers.
3. `popup.js` — preview synth; same bridge (keep parity so the popup preview matches).

State plumbing:
- Each consumer reads `breathsyncHarmonyState`, `breathsyncFollowHarmony`,
  `breathsyncFollowStrength` from `chrome.storage.local` and watches `storage.onChanged`
  (they already do this for other keys). No new messaging channels (avoid the MV3
  flood/crash paths called out in `AGENT_HANDOFF.md`).

## New UI + storage keys

- Popup: **"Follow external harmony"** toggle + **strength** slider, near the Listen
  button. Mirror status text ("Following D minor from instrument" / "Listening page
  closed — using palette").
- Storage keys (mirror names across `popup.js`, `content.js`, `midi-permission.js`):
  - `breathsyncFollowHarmony` (bool, default false)
  - `breathsyncFollowStrength` (0–1, default ~0.6)
- Persisted + migration entry consistent with existing launch-defaults pattern.

## Feedback-loop safety (critical)

Unlike the MIDI-in idea, **audio input cannot cleanly self-exclude** BreathSync's own
output, so runaway is a real risk:

1. **Acoustic bleed**: if the mic hears BreathSync's own speakers, following its own
   output creates a self-reinforcing loop. Guidance + guardrails:
   - Recommend an **instrument/line input** (audio interface), or **headphones**, not
     open speakers. Surface this in the Listen/Follow UI.
2. **MIDI round-trip**: BreathSync → Ableton → audio → mic → follow → BreathSync → …
   - Separate the monitored source from BreathSync's return path.
3. **Rate limiting / damping** (in-app, always on when following):
   - Phase-boundary-only switching + confidence hysteresis + max key-change rate.
   - Prefer **following key (slow)** over chasing **every chord (fast)** by default; make
     chord-chasing opt-in via higher strength.
4. **Staleness fallback**: if `harmonyState` is stale/idle/low-confidence → revert to the
   internal palette automatically.
5. **Default off**, behind the toggle; ships on a branch.

## MV3 / process considerations

- `harmonyState` is produced only while the **Listen tab is open and listening** (it's a
  normal extension page holding the mic + DSP). Consumers must treat "no fresh state" as
  the normal, common case (fall back gracefully).
- Audible generation runs in the **offscreen document** (`content.js`); it reads storage
  like today. No new permissions expected.
- Future optional refactor (out of scope): move analysis into the offscreen doc so
  following works without a visible Listen tab. Larger change; note only.

## Phased sub-plan

- **F0 — Bridge scaffolding** (DONE, v1.1.0): follow toggle + strength slider + storage
  keys + staleness handling + status copy.
- **F2 — Key-aware scale in audio** (DONE, v1.1.0): `content.js` + `popup.js` parity,
  phase-boundary switching.
- **F1 — Key-aware scale in MIDI-out** (TODO): apply the same bridge in
  `midi-permission.js`; validate against Ableton by ear.
- **F3 — Chord biasing** (TODO): chord lock toward `chordPitchClasses` across generators.
- **F4 — Lead alignment** (TODO): constrain lead to followed scale; optional
  call/response using `leadNote`.
- **F5 — Polish** (TODO): smoothing/crossfades, deeper safety guardrails.

Each sub-phase: implement → `node --check` → manual test → commit → tag → push
(same cadence as Phases 0–3).

## Risks / open decisions

1. **Follow granularity default**: key-only (safer, less runaway) vs. key + chord
   (more responsive). Recommend key-only default, chord via strength.
2. **Register/voicing**: keep current inhale/exhale contour + damping, or re-voice to
   detected chord inversions? Recommend keep contour first, revisit.
3. **Blend semantics**: strength as scale-selection probability vs. crossfade of two
   renderings. Recommend selection/quantize-to-followed-scale with strength gating.
4. **Where to prototype**: MIDI-out first (fastest to hear in Ableton) vs. audio first.
   Recommend MIDI-out first.
5. **Duplication vs. refactor**: accept mirrored duplication (current norm) or first
   extract shared harmony helpers. Recommend accept duplication to avoid a risky refactor.

## Rollback / safety

- Feature is **default-off** and fully bypassed when `breathsyncFollowHarmony` is false or
  state is stale/low-confidence — byte-for-byte today's behavior.
- Developed on a dedicated branch; each sub-phase tagged for easy revert.
```
