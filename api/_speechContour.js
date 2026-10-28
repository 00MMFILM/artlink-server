// Acoustic comparison, not a dialect classifier. Independent YIN implementation:
// de Cheveigne & Kawahara (2002), doi:10.1121/1.1458024.
const RATE = 8000, HOP = 160, WINDOW = 320, MIN = 16, MAX = 123;
const round = n => Math.round(n * 100) / 100;
const median = values => { const a = [...values].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
const clean = s => typeof s === 'string' ? s.normalize('NFC').replace(/[^가-힣]/g, '') : '';

function contour(pcm) {
  if (!Buffer.isBuffer(pcm) || pcm.length < 12800 || pcm.length > 960000) throw Error('DURATION_LIMIT');
  // Average adjacent samples before downsampling 16 kHz mono PCM to 8 kHz.
  const audio = new Float64Array(Math.floor(pcm.length / 4));
  for (let i = 0; i < audio.length; i++) audio[i] = (pcm.readInt16LE(i * 4) + pcm.readInt16LE(i * 4 + 2)) / 65536;
  const frames = [];
  for (let start = 0; start + WINDOW + MAX < audio.length; start += HOP) {
    let energy = 0; for (let j = 0; j < WINDOW; j++) energy += audio[start + j] ** 2;
    const frame = { time: round((start + WINDOW / 2) / RATE), hz: null, confidence: 0 };
    if (10 * Math.log10(Math.max(energy / WINDOW, 1e-12)) > -45) {
      const diff = new Float64Array(MAX + 1), normalized = new Float64Array(MAX + 1); let total = 0;
      for (let lag = 1; lag <= MAX; lag++) {
        for (let j = 0; j < WINDOW; j++) diff[lag] += (audio[start + j] - audio[start + j + lag]) ** 2;
        total += diff[lag]; normalized[lag] = total ? diff[lag] * lag / total : 1;
      }
      for (let lag = MIN; lag < MAX; lag++) {
        if (normalized[lag] < 0.15) {
          while (lag + 1 < MAX && normalized[lag + 1] < normalized[lag]) lag++;
          const left = normalized[lag - 1], center = normalized[lag], right = normalized[lag + 1];
          const denominator = 2 * (2 * center - left - right);
          const period = lag + (denominator ? (right - left) / denominator : 0);
          const hz = RATE / period;
          if (hz >= 65 && hz <= 500) { frame.hz = hz; frame.confidence = round(1 - center); }
          break;
        }
      }
    }
    frames.push(frame);
  }
  // Suppress isolated octave errors; do not fill unvoiced gaps with fake pitch.
  const smoothed = frames.map((f, i) => {
    if (!f.hz) return f;
    const near = frames.slice(Math.max(0, i - 2), i + 3).filter(x => x.hz).map(x => x.hz);
    const local = median(near);
    return near.length >= 3 && Math.abs(12 * Math.log2(f.hz / local)) > 7 ? { ...f, hz: null, confidence: 0 } : f;
  });
  const mid = median(smoothed.filter(f => f.hz).map(f => f.hz));
  return { frames: smoothed.map(f => ({ ...f, hz: f.hz ? round(f.hz) : null, semitones: f.hz ? round(12 * Math.log2(f.hz / mid)) : null })),
    voicedSeconds: round(smoothed.filter(f => f.hz).length * HOP / RATE) };
}

function align(reference, transcript, duration) {
  const expected = clean(reference);
  if (expected.length < 4 || clean(transcript?.text) !== expected) return null;
  if (!Array.isArray(transcript.segments) || !transcript.segments.length || transcript.segments.some(s =>
    !Number.isFinite(s.avg_logprob) || s.avg_logprob < -1 || !Number.isFinite(s.no_speech_prob) || s.no_speech_prob > 0.6)) return null;
  if (!Array.isArray(transcript.words) || !transcript.words.length || transcript.words.length > 100) return null;
  let offset = 0, previousEnd = 0; const words = [];
  for (const w of transcript.words) {
    const value = clean(w.word);
    if (!value || !Number.isFinite(w.start) || !Number.isFinite(w.end) || w.start < previousEnd - 0.02 || w.start < 0 || w.end <= w.start || w.end > duration + 0.05) return null;
    words.push({ start: w.start, end: Math.min(w.end, duration), from: offset, to: offset + value.length });
    offset += value.length; previousEnd = w.end;
  }
  if (transcript.words.map(w => clean(w.word)).join('') !== expected) return null;
  offset = 0;
  const parts = reference.trim().split(/\s+/).filter(s => clean(s));
  return parts.map(word => {
    const from = offset, to = offset += clean(word).length;
    const matches = words.filter(w => w.from < to && w.to > from);
    // Merged recognition tokens cannot provide an independent word boundary.
    if (!matches.length || matches[0].from !== from || matches.at(-1).to !== to) return null;
    return { word, start: matches[0].start, end: matches.at(-1).end };
  });
}

function wordShape(frames, interval) {
  const selected = frames.filter(f => f.time >= interval.start && f.time <= interval.end);
  const voiced = selected.filter(f => f.hz);
  if (voiced.length < 6 || voiced.length / Math.max(1, selected.length) < 0.35) return null;
  const edge = Math.max(2, Math.floor(voiced.length / 3));
  const head = median(voiced.slice(0, edge).map(f => f.hz)), tail = median(voiced.slice(-edge).map(f => f.hz));
  return { change: round(12 * Math.log2(tail / head)),
    curve: Array.from({ length: 12 }, (_, i) => {
      const from = interval.start + (interval.end - interval.start) * i / 12;
      const to = interval.start + (interval.end - interval.start) * (i + 1) / 12;
      const points = selected.filter(f => f.time >= from && f.time < to && f.hz).map(f => f.semitones);
      return points.length ? round(median(points)) : null;
    }) };
}

function compare({ reference, targetPcm, attemptPcm, targetTranscript, attemptTranscript }) {
  const targetWords = align(reference, targetTranscript, targetPcm.length / 32000);
  const attemptWords = align(reference, attemptTranscript, attemptPcm.length / 32000);
  if (!targetWords || !attemptWords) return { status: 'text_uncertain', segments: [], suggestions: [], reason: 'Read the exact same line without music or another speaker.' };
  const target = contour(targetPcm), attempt = contour(attemptPcm);
  if (target.voicedSeconds < 0.4 || attempt.voicedSeconds < 0.4) return { status: 'pitch_uncertain', segments: [], suggestions: [] };
  const total = ws => { const a = ws.filter(Boolean); return a.length ? a.at(-1).end - a[0].start : 0; };
  const targetSpan = total(targetWords), attemptSpan = total(attemptWords);
  if (targetSpan <= 0 || attemptSpan <= 0) return { status: 'text_uncertain', segments: [], suggestions: [] };
  const segments = targetWords.flatMap((tw, i) => {
    const aw = attemptWords[i]; if (!tw || !aw) return [];
    const ts = wordShape(target.frames, tw), as = wordShape(attempt.frames, aw);
    if (!ts || !as || tw.end - tw.start < 0.15 || aw.end - aw.start < 0.15) return [];
    const pitchDelta = round(as.change - ts.change);
    const durationRatio = round(((aw.end - aw.start) / attemptSpan) / ((tw.end - tw.start) / targetSpan));
    return [{ index: i, word: tw.word, target: { start: round(tw.start), end: round(tw.end), ...ts },
      attempt: { start: round(aw.start), end: round(aw.end), ...as }, pitchDelta, durationRatio }];
  });
  if (!segments.length) return { status: 'pitch_uncertain', segments: [], suggestions: [] };
  // These thresholds flag an acoustic difference to rehearse, never right/wrong dialect.
  const suggestions = segments.filter(s => Math.abs(s.pitchDelta) >= 2.5 || s.durationRatio >= 1.4 || s.durationRatio <= 0.7)
    .sort((a, b) => Math.abs(b.pitchDelta) - Math.abs(a.pitchDelta)).slice(0, 3).map(s => ({
      index: s.index, focus: Math.abs(s.pitchDelta) >= 2.5 ? 'pitch' : 'timing',
      direction: Math.abs(s.pitchDelta) >= 2.5 ? (s.pitchDelta > 0 ? 'less_rise' : 'more_rise') : (s.durationRatio > 1 ? 'shorter' : 'longer')
    }));
  return { status: 'compared', method: 'word-timestamps-yin-v1', segments, suggestions,
    coverage: { compared: segments.length, total: targetWords.length },
    targetVoicedSeconds: target.voicedSeconds, attemptVoicedSeconds: attempt.voicedSeconds };
}
module.exports = { contour, align, compare, clean };
