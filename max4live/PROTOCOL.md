# BreathSync harmony bus protocol — v1

Single source of truth for how **BreathSync Listen** (analyzer, audio effect) talks to
**BreathSync Follow** (MIDI companion) and any other consumer. Both devices must be
implemented against this document; if a device and this document disagree, the device
is wrong.

## Transport

- Max messages via `[forward]` (analyzer) → `[receive]` (consumers).
- Bus names: `bs.harmony.bus1` … `bs.harmony.bus8`. Each device has a **Bus**
  parameter (`live.menu`, items "1".."8", default "1") selecting the suffix.
- **One analyzer per bus.** Any number of consumers may listen on a bus.
  Consumers should warn when they see two different `src` ids on one bus
  (interleaved streams = misconfiguration).
- Retargeting idioms (verified against Max 9 refpages):
  analyzer `sprintf send bs.harmony.bus%ld` → `[forward]`;
  consumer `sprintf set bs.harmony.bus%ld` → `[receive]`.
  (`$1` embedded inside a message-box symbol, e.g. `bus$1`, does NOT substitute —
  never use that form.)

## Message layers

### 1. State layer (throttled)

`state <json>` — the authoritative harmonyState. One Max symbol atom
(`JSON.stringify` output, no spaces). Schema v1:

```json
{
  "v": 1,
  "src": "013bstime",
  "key": "D",
  "mode": "minor",
  "scalePitchClasses": [2,4,5,7,9,10,0],
  "chordRoot": "A",
  "chordQuality": "min",
  "chordPitchClasses": [9,0,4],
  "leadNote": 69,
  "density": 1.25,
  "confidence": 0.78,
  "keyConfidence": 0.61,
  "updatedAt": 1751892000000
}
```

- `v` — protocol schema version (always `1` for this document).
- `src` — the analyzer's device-unique buffer name (the substituted `---` prefix
  id); used only for same-bus collision detection.
- `key`/`mode` — committed key root name (sharps) and `"major"|"minor"`, or `null`.
- `scalePitchClasses` — pitch classes of the committed key's scale, else `[]`.
- `chordRoot`/`chordQuality` — committed chord, or `null`.
  Qualities: `maj min dim aug sus2 sus4 maj7 min7 dom7`.
- `chordPitchClasses` — pitch classes of the committed chord, else `[]`.
- `leadNote` — median-filtered monophonic lead as a MIDI int, or `null`.
- `density` — note onsets/sec over a 4 s window (2 decimals).
- `confidence` — **chord** cosine score while a chord is displayed, else key
  score, else 0 (web-app semantics, kept for contract parity).
- `keyConfidence` — the committed key's Pearson score (0–1), 0 when no key.
  **Key-sync consumers must gate on this, not on `confidence`.**
- `updatedAt` — `Date.now()` at emission.

Companion field messages, emitted in the same burst for patcher-level consumers
(message-box/`route` friendly; not needed by JS consumers):
`key <sym|none>` · `mode <sym|none>` · `scalePitchClasses <int…>` (bare selector
when empty) · `chordRoot <sym|none>` · `chordQuality <sym|none>` ·
`chordPitchClasses <int…>` · `leadNote <int|-1>` · `density <float>` ·
`confidence <float>` · `keyConfidence <float>`.

**Cadence guarantee (differs from the web app — deliberate):** while the
analyzer's Listen toggle is on and Live's audio engine is running, a `state`
message is emitted **at least every 1 s** (heartbeat) and at most every 250 ms,
on-change or on heartbeat — **including during silence** (idle states carry
nulls/0). The web app suppresses writes during silence; the M4L port moves the
throttle/heartbeat outside the RMS gate so consumers can rely on liveness. This
is a transport-layer change only; analysis math and gating are identical to the
web app.

Staleness rule for consumers: no `state` for **3000 ms** (3 missed heartbeats)
⇒ analyzer is gone/off — release everything driven by it and show "stale".

### 2. Event layer (immediate, unthrottled, on-change only)

For musically tight consumers (MIDI). Never throttled, never repeated.

- `lead <midi|-1> <confidence>` — emitted the moment the median-filtered lead
  note changes or clears (−1). 60 ms detection granularity. `confidence` is the
  current overall confidence value (0–1), for velocity scaling.
- `chord <rootPc|-1> <quality|none> <score> <pc…>` — emitted on post-hysteresis
  chord **commit** and on chord **reset** (`chord -1 none 0.`). `rootPc` is the
  root pitch class 0–11; `pc…` are the chord's pitch classes.

### 3. Lifecycle layer

- `hello 1 <src>` — protocol version + instance id. Emitted on device load, on
  an `announce` message, and after a bus change (so late-joining or re-paired
  consumers can detect the analyzer without waiting for the heartbeat).
  Always followed immediately by a full `state` burst and, if applicable,
  current `lead`/`chord` events.

## Consumer rules (BreathSync Follow)

- Voice engine (note on/off) is driven **only** by `lead`/`chord` events.
- Key sync, displays, and staleness are driven **only** by `state`.
- `hello` resets link status; two distinct `src` values on one bus within a
  staleness window ⇒ show a collision warning.

## Implementation notes (Phase-0 verification results, 2026-07-07)

Verified against the local Max 9 installation (`/Applications/Max.app`):

1. **v8 `@embed` JSON shape** (from Max 9's shipped `v8.maxhelp`): a
   `[v8 <file.js> @embed 1]` newobj box serializes with box-level
   `"filename": "<file.js>"` and a sibling
   `"textfile": {"text": <full source>, "filename": "<file.js>", "flags": 1,
   "embed": 1, "autowatch": <0|1>}`. Un-embedded boxes have
   `textfile: {filename, flags: 0, embed: 0, autowatch}` and no `text` key.
   `build_amxd.py --embed` reproduces the embedded shape exactly.
2. **`live.thisdevice` outlets** (m4l-ref): outlet 0 = bang on load/init;
   outlet **1** = device enabled/disabled (1/0); outlet 2 = **preview mode** —
   NOT device on/off. Follow's disable-release path uses outlet 1.
3. **`receive`** accepts `set <name>`; **`forward`** accepts `send <name>`
   (max-ref, confirmed).
4. `---` substitution: object-box arguments only (including `v8` args →
   `jsarguments`); never in message boxes. Runtime form is a device-unique
   number prefix, e.g. `013bstime`.

Runtime-only checks (must be confirmed in Live 12.2+, see README test list):
`Buffer.peek` from `v8` with a `---`-substituted name passed via `jsarguments`;
exact Live 12 `scale_name` strings (assumed `"Major"`/`"Minor"` — Follow
verifies by read-back and reports rather than assuming).
