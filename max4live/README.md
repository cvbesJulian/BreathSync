# BreathSync — Max for Live devices

Two Max for Live devices that port the BreathSync web app's **Listen** feature
(real-time pitch + chord + key detection, see `../listen.js`) into Ableton Live
and put the results to work:

| Device | Type | Track | What it does |
|---|---|---|---|
| **BreathSync Listen** | Audio effect (`aaaa`) | Audio | Analyzes the track's audio: melody note/octave/cents with tuning needle, chord (9 qualities), key (Krumhansl–Schmuckler), 12-bin chroma display. Passes audio through untouched. Broadcasts results on a harmony bus. |
| **BreathSync Follow** | MIDI effect (`mmmm`) | MIDI | Consumes a harmony bus and plays it: follows the detected lead note and/or chord as live MIDI notes, and can optionally sync Live's song **Scale/Root** to the detected key. |

Analysis math is kept **byte-identical** to the web app (same constants,
thresholds, chord templates, key profiles, hysteresis). The device-to-device
contract is documented in [PROTOCOL.md](PROTOCOL.md) — that file is the single
source of truth for the bus messages.

## Requirements

- **Ableton Live 12.2 or newer** (bundles Max 9 — the devices use the `v8`
  JavaScript object, which does not exist in Max 8 / Live ≤ 12.1).
- Key Sync additionally needs Live 12's song-scale API (present in 12.x).

## Install / use

1. Drop `BreathSync Listen/BreathSync Listen.amxd` on the **audio track** you
   want to analyze (guitar, keys, a resampled bus…). The devices are built
   self-contained (scripts embedded), so the `.amxd` files can be copied
   anywhere on their own.
2. Drop `BreathSync Follow/BreathSync Follow.amxd` on a **MIDI track** with an
   instrument after it. Arm/monitor as usual.
3. Make sure both devices show the same **Bus** number (default 1). Follow's
   status flips from "waiting for analyzer" to "linked".
4. Follow's **Mode**: Off / Lead (follow the detected melody) / Chord (sound the
   committed chord) / Both. **Min Dur** suppresses flapping on fast playing.
   **Wait Mode / Wait Bars** make Follow listen before joining: when the
   transport starts it stays silent for **Wait Bars** bars (default 4), or in
   **Clip** mode for one full pass of the longest playing session clip (falls
   back to Wait Bars if nothing is playing), then joins on whatever harmony is
   sounding. The countdown shows in the status display; it re-arms every time
   the transport starts. With the transport stopped there are no bars to
   count, so Follow plays immediately (jam mode); set Wait Mode to Off for the
   old always-on behavior. Bar math is done in beats, so tempo changes during
   the wait are handled; only note output is gated — Key Sync keeps its own
   slower gates.
5. **Key Sync** (default **off**): when enabled, a detected key that stays
   stable for **Key Hold** seconds at ≥ **Key Conf** confidence sets Live's
   song Root Note + Scale. Note: every scale change lands in Live's undo
   history (a Live API limitation) — the device rate-limits to at most one
   change per 10 s and never rewrites an unchanged key.

## Performing

Follow adds a **Perform** panel of 11 live-playable parameters (timing/groove,
voicing, and performance switches). They are designed for a hardware control
surface — an Akai MPK Mini Plus today, a MIDI foot controller later. The panel
sits to the right of the existing controls, widening the device window to
**624 × 169 px**; the left column is unchanged.

**Every default is a musical no-op.** With Quantize/Gate off, Strum/Human/Spread
at 0, Chance at 100, Voices at 4, and Hold/Kill off, Follow emits exactly the
same MIDI byte stream as before — the Perform panel only bites when you turn
something up.

| Param | Range | Default | What it does |
|---|---|---|---|
| **Quantize** | Off, 1/16, 1/8, 1/8T, 1/4, 1/2, 1 Bar | Off | Snaps note *changes* to the next grid boundary of the chosen division, so joins and chord changes land on the beat. |
| **Gate** | Off, 1/4, 1/8, 1/8T, 1/16, 1/16T | Off | Rhythmically re-strikes the **chord** on every grid division (a pumping/arp feel). Chord-only — the lead melody always sustains. |
| **Gate Len** | 5–100 % | 50 | Length of each gated chord note as a fraction of the gate interval (staccato → legato). Only matters when Gate is on. |
| **Chance** | 0–100 % | 100 | Probability that each physical note-on actually sounds. Adds sparseness/stutter. |
| **Spread** | 0–3 | 0 | Octave-spread voicing width. 0 = close voicing; higher stages lift alternating chord tones up an octave. |
| **Voices** | 1–4 | 4 | Chord-tone budget. 4 = full chord, 3 = drop the 5th (shell), 2 = root + defining tone, 1 = root only (bass follower). |
| **Strum** | 0–60 ms | 0 | Staggers newly added chord tones low→high, `n × strum` ms apart. 0 = simultaneous block chord. |
| **Human** | 0–100 % | 0 | Humanizes timing and velocity: adds an on-delay in `[0, 20 ms × h]` and velocity `± round(12 × h)`. |
| **Hold** | off / on | off | Freezes the current harmony — the sounding notes keep ringing while incoming events are ignored for output (caches still track underneath). |
| **Kill** | off / on | off | Instantly mutes all output and cancels every scheduled note. Tracking continues; turning it off re-strikes from the live source. |
| **Re-Wait** | trigger | — | Re-arms the wait-N-bars countdown (see **Wait Mode**) from the current transport position. No-op when stopped. |

### The rules that matter

- **Precedence (strongest first): Panic/delete → device off → Kill → stale →
  Wait gate.** Whatever is higher wins. In particular **Kill beats Hold**
  (a killed device is silent even while holding), and the Wait gate is the
  weakest — anything above it can override the "still waiting to join" state.
- **Hold survives staleness.** If the analyzer goes quiet while Hold is on, the
  frozen pad keeps ringing (status reads *stale hold*) instead of releasing.
  Hold also survives transport stop/start and Re-Wait. A **Panic** clears the
  frozen snapshot (it freezes silence). Changing Mode, Channel, Octave, Spread,
  or Voices re-voices the held content in place.
- **Releases are never quantized.** Stopping (`lead -1`, chord reset), Kill,
  disabling the device, staleness, and Mode-off all release *immediately* — only
  note *changes* ride the grid. So Quantize never leaves a note hanging past its
  cue.
- **Chance never gates a note-off.** A skipped note advances the logical voice
  state as if it had played; only the on-byte is suppressed, so there are no
  stuck notes and refcounts stay correct.
- **Transport stopped = jam mode.** Quantize and Gate bypass while the transport
  is stopped (there is no grid to ride) — Follow plays with plain sustain
  semantics, same as always.

### Momentary vs. latching (foot pedals & pads)

**Hold** and **Kill** are *level-based* (0/1), not edge-triggered. That gives you
both feels for free from a single parameter:

- **Momentary** — MIDI-map a control that sends **CC value 127 on press, 0 on
  release** (a Live MIDI-mapped foot pedal, or an MPK pad in *momentary* mode).
  Hold/Kill is then active only while you hold the pedal/pad down.
- **Latching** — the on-screen toggle, or an MPK pad in *toggle* mode, flips the
  state and leaves it there until pressed again.

### Akai MPK Mini Plus map

Set the MPK's knobs to send CC and MIDI-map each to the parameter below (Live's
**MIDI Map Mode**, click the widget, wiggle the knob). Pads A1–A3 use the pad's
*momentary* mode so Kill/Hold/Re-Wait act while held; put the same three pads on
**Bank B** in *toggle* mode for latching copies.

| Control | Maps to |
|---|---|
| **K1** | Gate |
| **K2** | Gate Len |
| **K3** | Chance |
| **K4** | Strum |
| **K5** | Spread |
| **K6** | Voices |
| **K7** | Human |
| **K8** | Velocity *(existing base-velocity dial)* |
| **Pad A1** (momentary) | Kill |
| **Pad A2** (momentary) | Hold |
| **Pad A3** (momentary) | Re-Wait |
| **Bank B pads 1–3** (toggle) | Kill / Hold / Re-Wait, latching |

Quantize is left off the knob map by default — it's a set-and-forget menu you
pick once for a section rather than sweep live.

### In-Live performance checklist

Spot-check these once in a real set; they exercise the runtime edges the
headless tests can't reach:

1. **Quantized join** — Quantize 1/4 at 120 BPM: a new chord snaps onto the beat
   instead of the moment you played it.
2. **Gate at a loop brace** — Gate 1/16 over a 1-bar loop; watch a MIDI monitor
   at the loop wrap for doubled or dropped strikes (loop-wrap grid timing is the
   #1 thing to eyeball).
3. **Tempo ramp under Gate = 1 Bar**, and a **4/4 → 3/4 meter change** under the
   same — the grid should re-align without hung chords.
4. **Pedal-mapped Kill/Hold** — momentary feel: sound stops/freezes on press,
   resumes on release, with no stuck notes.
5. **Hold through staleness** — freeze a pad, mute the source; the pad keeps
   ringing (status *stale hold*), and toggling Hold off releases cleanly.
6. **CPU sanity** — run ~8 instances and confirm timing stays tight under load.

## Building from source

The `.amxd` containers are built by the packager (stdlib-only Python):

```sh
python3 max4live/build_amxd.py \
  "max4live/BreathSync Listen/bs.listen.maxpat" \
  "max4live/BreathSync Listen/BreathSync Listen.amxd" \
  --type audio --embed "max4live/BreathSync Listen/bs.listen.js"

python3 max4live/build_amxd.py \
  "max4live/BreathSync Follow/bs.follow.maxpat" \
  "max4live/BreathSync Follow/BreathSync Follow.amxd" \
  --type midi --embed "max4live/BreathSync Follow/bs.follow.js"
```

`--embed` copies the script source into the patcher (`v8 @embed`), which is
what makes the `.amxd` self-contained. The packager also validates the patch
graph and several M4L pitfalls (no `---` in message boxes, unique parameter
names, presentation bounds) and refuses to build on violations.

Headless tests (no Live needed — Node stubs the Max globals):

```sh
node max4live/test/listen.harness.mjs   # synthesized audio → pitch/chord/key/heartbeat assertions
node max4live/test/follow.harness.mjs   # fake bus events → MIDI byte + key-sync assertions
```

## In-Live test checklist (quick pass)

1. 440 Hz sine into Listen → "A4 · 440.0 Hz · in tune"; Follow (Lead) plays A4
   on its track within ~60 ms.
2. C–E–G pad → Listen shows "C maj"; Follow (Chord) holds C3/E3/G3; moving to
   A minor changes only the differing notes (common tones sustain).
3. Mute the source → Follow releases within ~Min Dur; Listen keeps emitting
   idle heartbeats (Follow stays "linked", not "stale").
4. Delete either device mid-note → no hung notes.
5. Key Sync on + 60 s F-minor vamp → Live's Control Bar scale becomes F Minor
   once, with no repeated undo entries while the key stays stable.
6. Two pairs on buses 1 and 2 → no crosstalk.

## Known limitations

- **96 kHz sessions**: the pitch window is fixed at 2048 *samples* for parity
  with the web app, so at 96 kHz the lowest detectable pitch rises to ~47 Hz
  and low-octave chroma smears slightly. 44.1/48 kHz behave like the web app.
- **One analyzer per bus.** Two analyzers on the same bus interleave their
  streams; Follow shows a "bus collision" warning when it detects this.
- **Key Sync and undo**: unavoidable Live API behavior — see above.
- Live < 12.2: devices will not load (Max 8 has no `v8` object). Key Sync
  degrades gracefully to "unavailable" if the song-scale API is missing.

## Files

```
max4live/
├── PROTOCOL.md                  # bus contract v1 (authoritative)
├── build_amxd.py                # .amxd packager + validators
├── BreathSync Listen/
│   ├── bs.listen.js             # v8 analysis engine (port of ../listen.js)
│   ├── bs.listen.maxpat         # device patch
│   └── BreathSync Listen.amxd   # built device
├── BreathSync Follow/
│   ├── bs.follow.js             # v8 voice engine + key sync
│   ├── bs.follow.maxpat         # device patch
│   └── BreathSync Follow.amxd   # built device
└── test/
    ├── listen.harness.mjs       # headless analyzer tests
    └── follow.harness.mjs       # headless follow tests
```
