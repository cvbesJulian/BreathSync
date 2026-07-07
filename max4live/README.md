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
5. **Key Sync** (default **off**): when enabled, a detected key that stays
   stable for **Key Hold** seconds at ≥ **Key Conf** confidence sets Live's
   song Root Note + Scale. Note: every scale change lands in Live's undo
   history (a Live API limitation) — the device rate-limits to at most one
   change per 10 s and never rewrites an unchanged key.

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
