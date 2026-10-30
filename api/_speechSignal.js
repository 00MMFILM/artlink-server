// Deterministic measurements of decoded 16 kHz mono PCM. These are not
// pronunciation, speech-recognition or regional-accent judgments.
const RATE = 16000;
const round = n => Math.round(n * 100) / 100;
function measure(pcm) {
  const count = Math.floor(pcm.length / 2), duration = count / RATE;
  if (duration < 0.4 || duration > 30) throw Error('DURATION_LIMIT');
  const frames = [], size = 320;
  let sum = 0, peak = 0, clipped = 0;
  for (let start = 0; start < count; start += size) {
    let energy = 0;
    const end = Math.min(count, start + size);
    for (let i = start; i < end; i++) {
      const sample = pcm.readInt16LE(i * 2) / 32768;
      energy += sample * sample; peak = Math.max(peak, Math.abs(sample));
      if (Math.abs(sample) >= 0.99) clipped++;
    }
    sum += energy;
    frames.push({ start: start / RATE, end: end / RATE, db: 10 * Math.log10(Math.max(energy / (end - start), 1e-12)) });
  }
  const rmsDb = 10 * Math.log10(Math.max(sum / count, 1e-12));
  const ordered = frames.map(f => f.db).sort((a, b) => a - b);
  const high = ordered[Math.floor((ordered.length - 1) * 0.9)];
  // A relative threshold with a fixed floor: this detects quiet intervals,
  // not breathing or linguistically correct pauses. Background noise can mask them.
  const threshold = Math.max(-50, Math.min(-30, high - 22));
  const quiet = []; let open = null;
  for (const f of frames) {
    if (f.db < threshold) { if (open === null) open = f.start; }
    else if (open !== null) { if (f.start - open >= 0.3) quiet.push({ start: round(open), end: round(f.start) }); open = null; }
  }
  if (open !== null && duration - open >= 0.3) quiet.push({ start: round(open), end: round(duration) });
  const warnings = [];
  if (peak < 0.001) warnings.push('NO_SIGNAL');
  else if (rmsDb < -40) warnings.push('LOW_LEVEL');
  if (clipped / count > 0.005) warnings.push('CLIPPING');
  return { duration: round(duration), rmsDb: round(rmsDb), peakDb: round(20 * Math.log10(Math.max(peak, 1e-6))),
    clippedPercent: round(clipped / count * 100), quiet, warnings, thresholdDb: round(threshold),
    envelope: frames.filter((_, i) => i % 5 === 0).map(f => ({ time: round(f.start), db: round(f.db) })) };
}
function wav(pcm) {
  const h = Buffer.alloc(44); h.write('RIFF'); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
module.exports = { measure, wav, RATE };
