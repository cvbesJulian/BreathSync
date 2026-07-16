// JS port of nextchord/features.py — bit-exact tokenization for the Max device.
// Driven entirely by model_config.json (features block). Pad id 0 reserved;
// real ids start at 1. Must match Python; verified by test_parity.mjs.

export const GLOBAL_SLOTS = ["CLS", "MODE", "METER", "PREVCHORD", "PREVFUNC", "WLEN", "HYPER", "GRIDPOS"];
export const N_GLOBALS = GLOBAL_SLOTS.length;
export const NOTE_FEATS = ["pc", "octave", "dt", "dur", "phase", "downbeat", "bar_offset"];

// Python's round() is round-half-to-even; JS Math.round is round-half-up.
function pyRound(x) {
  const frac = x - Math.floor(x);
  if (Math.abs(frac - 0.5) < 1e-9) {
    const f = Math.floor(x);
    return (f % 2 === 0) ? f : f + 1;
  }
  return Math.round(x);
}

// bisect_right: number of edges <= x  (edges ascending)
function bisectRight(edges, x) {
  let lo = 0, hi = edges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (x < edges[mid]) hi = mid; else lo = mid + 1;
  }
  return lo;
}

export function makeSpec(featuresConfig) {
  const f = featuresConfig;
  const meterIndex = new Map(f.meters.map((m, i) => [m, i]));
  const wlenIndex = new Map(f.lengths_bars.map((L, i) => [Math.round(L * 1e4) / 1e4, i]));
  const sources = f.sources || null;   // combined models: trailing SOURCE slot
  return {
    sources,
    sourceIndex: sources ? new Map(sources.map((s, i) => [s, i])) : null,
    nGlobals: f.global_slots ? f.global_slots.length : N_GLOBALS,
    octaveBase: f.octave_base,
    octaveBuckets: f.octave_buckets,
    phaseBins: f.phase_bins,
    maxBarOffset: f.max_bar_offset,
    maxNotes: f.max_notes,
    dtEdges: f.dt_edges,
    durEdges: f.dur_edges,
    meters: f.meters,
    meterIndex,
    wlenIndex,
    lengthsBars: f.lengths_bars,
    noteCard: f.note_card,
    globalCard: f.global_card,
  };
}

export function octaveId(spec, pitch) {
  let b = Math.floor((pitch - spec.octaveBase) / 12);
  b = Math.max(0, Math.min(spec.octaveBuckets - 1, b));
  return b + 1;
}
export function dtId(spec, dt) { return bisectRight(spec.dtEdges, dt) + 1; }
export function durId(spec, dur) { return bisectRight(spec.durEdges, dur) + 1; }
export function phaseId(spec, onsetInBar, bpb) {
  const b = ((pyRound(onsetInBar / bpb * spec.phaseBins) % spec.phaseBins) + spec.phaseBins) % spec.phaseBins;
  return b + 1;
}

// ctx: { mode:"maj"|"min", meter, prevClass, prevFunc, wlenBars, hyper, grid,
//        source? }  — source only for combined models (spec.sources set);
//        unknown/absent source encodes as 0 (the trained Auto-genre slot).
export function encodeGlobals(spec, ctx) {
  const meterId = (spec.meterIndex.has(pyRound(ctx.meter)) ? spec.meterIndex.get(pyRound(ctx.meter)) : -1) + 1;
  const key = Math.round(ctx.wlenBars * 1e4) / 1e4;
  const wlenId = (spec.wlenIndex.has(key) ? spec.wlenIndex.get(key) : 0) + 1;
  const ids = [
    0,                                     // CLS
    ctx.mode === "maj" ? 0 : 1,            // MODE
    meterId,                               // METER (0 = unknown)
    ctx.prevClass + 1,                     // PREVCHORD
    ctx.prevFunc + 1,                      // PREVFUNC
    wlenId,                                // WLEN
    ctx.hyper + 1,                         // HYPER
    ctx.grid + 1,                          // GRIDPOS
  ];
  if (spec.sources) {
    ids.push(ctx.source && spec.sourceIndex.has(ctx.source)
      ? spec.sourceIndex.get(ctx.source) + 1 : 0);  // SOURCE (0 = auto)
  }
  return ids;
}

// notes: [{pitch, onset, dur, onsetInBar, beatsPerBar}] with onset absolute; t = decision beat.
export function encodeNotes(spec, notes, t, maskNotes = false) {
  const streams = {};
  for (const k of NOTE_FEATS) streams[k] = [];
  if (maskNotes) return streams;
  for (const n of notes) {
    streams.pc.push((((n.pitch % 12) + 12) % 12) + 1);
    streams.octave.push(octaveId(spec, n.pitch));
    streams.dt.push(dtId(spec, t - n.onset));
    streams.dur.push(durId(spec, n.dur));
    streams.phase.push(phaseId(spec, n.onsetInBar, n.beatsPerBar));
    streams.downbeat.push((Math.abs(n.onsetInBar) < 1e-6 ? 1 : 0) + 1);
    const bo = Math.min(spec.maxBarOffset, Math.floor((t - n.onset) / Math.max(1e-6, n.beatsPerBar)));
    streams.bar_offset.push(bo + 1);
  }
  return streams;
}
