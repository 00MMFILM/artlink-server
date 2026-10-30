const test = require('node:test'), assert = require('node:assert/strict');
const { contour, align, compare } = require('./api/_speechContour');
const { transcribe } = require('./api/_speechTranscript');
const { makeHandler } = require('./api/speech-compare');
const { wav } = require('./api/_speechSignal');
const text = '오늘은 천천히 말해요.';
function sample({ factor = 1, speed = 1, raised = -1, gain = 0.25 } = {}) {
  const duration = 3 / speed, pcm = Buffer.alloc(Math.round(duration * 16000) * 2); let phase = 0;
  for (let i = 0; i < pcm.length / 2; i++) {
    const t = i / 16000 * speed, word = Math.floor(t), x = t - word;
    const hz = (raised === word ? 160 + 100 * x : 240 - 80 * x) * factor;
    phase += 2 * Math.PI * hz / 16000;
    const envelope = x > 0.1 && x < 0.9 ? Math.min(1, (x - 0.1) / 0.03, (0.9 - x) / 0.03) : 0;
    pcm.writeInt16LE(Math.round(32767 * gain * envelope * (Math.sin(phase) + 0.2 * Math.sin(phase * 2))), i * 2);
  }
  const words = text.split(' ').map((word, i) => ({ word, start: (i + 0.1) / speed, end: (i + 0.9) / speed }));
  return { pcm, transcript: { text, words, segments: [{ avg_logprob: -0.2, no_speech_prob: 0.01 }] } };
}
const run = (target = sample(), attempt = sample()) => compare({ reference: text, targetPcm: target.pcm, attemptPcm: attempt.pcm, targetTranscript: target.transcript, attemptTranscript: attempt.transcript });
test('pitch follows known changing harmonic signal and preserves unvoiced gaps', () => {
  const r = contour(sample().pcm); assert.ok(r.voicedSeconds > 2 && r.voicedSeconds < 2.7);
  const f = r.frames.find(f => f.time === 0.5); assert.ok(Math.abs(f.hz - 200) < 6);
  assert.ok(r.frames.some(f => f.hz === null));
});
test('silence and deterministic white noise do not become voiced curves', () => {
  assert.equal(contour(Buffer.alloc(64000)).voicedSeconds, 0);
  let seed = 17; const b = Buffer.alloc(64000);
  for (let i = 0; i < b.length; i += 2) { seed = (seed * 1664525 + 1013904223) >>> 0; b.writeInt16LE(Math.floor((seed / 2 ** 32 - 0.5) * 18000), i); }
  assert.equal(contour(b).voicedSeconds, 0);
});
test('voice pitch range and microphone gain alone do not trigger coaching', () => {
  const r = run(sample(), sample({ factor: 1.45, gain: 0.12 }));
  assert.equal(r.status, 'compared'); assert.equal(r.suggestions.length, 0); assert.equal(r.segments.length, 3);
});
test('a known rising segment is flagged against the falling target at the corresponding word', () => {
  const r = run(sample(), sample({ raised: 1 }));
  assert.equal(r.status, 'compared'); assert.deepEqual(r.suggestions, [{ index: 1, focus: 'pitch', direction: 'less_rise' }]);
  assert.equal(r.segments[1].word, '천천히'); assert.ok(r.segments[1].pitchDelta > 6);
  assert.deepEqual([r.segments[1].attempt.start, r.segments[1].attempt.end], [1.1, 1.9]);
});
test('uniformly slower delivery is aligned by word and does not label every word too long', () => {
  const r = run(sample(), sample({ speed: 0.7 })); assert.equal(r.status, 'compared');
  assert.ok(r.segments.every(s => Math.abs(s.durationRatio - 1) < 0.02)); assert.equal(r.suggestions.length, 0);
});
test('different text, uncertain recognition, and invalid boundaries suppress coaching', () => {
  for (const mutate of [r => { r.text = '다른 문장입니다.'; }, r => { r.segments[0].avg_logprob = -2; },
    r => { r.segments[0].no_speech_prob = 0.9; }, r => { r.words[0].start = NaN; },
    r => { r.words[0].end = 12; }, r => { r.words[1].start = 0; }, r => { r.words = []; }]) {
    const a = sample(); mutate(a.transcript); const r = run(sample(), a);
    assert.equal(r.status, 'text_uncertain'); assert.equal(r.suggestions.length, 0);
  }
});
test('ASR merged words are skipped rather than inventing syllable timings', () => {
  const s = sample(); s.transcript.words = [{ word: text.replaceAll(' ', ''), start: 0.1, end: 2.9 }];
  assert.deepEqual(align(text, s.transcript, 3), [null, null, null]);
  assert.equal(run(s, sample()).status, 'text_uncertain');
});
test('transcription requests timestamps but never supplies a reference prompt', async () => {
  let options; await transcribe(sample().pcm, { env: { OPENAI_API_KEY: 'test' }, fetcher: async (_, o) => { options = o; return { ok: true, json: async () => sample().transcript }; } });
  assert.equal(options.body.get('model'), 'whisper-1'); assert.equal(options.body.get('prompt'), null);
  assert.deepEqual(options.body.getAll('timestamp_granularities[]'), ['word', 'segment']);
});
const request = () => ({ audio: wav(sample().pcm).toString('base64'), reference: text,
  drillId: 'closing', targetHash: 'hash', consent: true, requestId: '11111111-1111-4111-8111-111111111111' });
function fixture({ failQuota, noUser, decoder, transcription, env } = {}) {
  const actions = []; let decodes = 0, transcriptions = 0;
  const handler = makeHandler({ env: env || { OPENAI_API_KEY: 'test' },
    client: { auth: { getUser: async () => ({ data: { user: noUser ? null : { id: 'trusted' } } }) },
      rpc: async (_, p) => { actions.push(p.p_action); return failQuota && p.p_action === 'reserve' ? { error: { message: 'SPEECH_LIMIT' } } : { data: { used: 1, limit: 5 } }; } },
    decoder: async b => { decodes++; return decoder ? decoder(b) : sample().pcm; },
    transcription: async () => { transcriptions++; return transcription ? transcription() : sample().transcript; },
    loadBuiltin: async () => ({ text, sha256: 'hash', audio: wav(sample().pcm), transcript: sample().transcript }) });
  const call = async (body = request(), headers = { authorization: 'Bearer test' }) => {
    let status, result; await handler({ method: 'POST', headers, body }, { setHeader() {}, status(s) { status = s; return this; }, json(r) { result = r; } });
    return { status, result };
  };
  return { call, actions, counts: () => ({ decodes, transcriptions }) };
}
test('API uses auth and quota before decoding or external calls', async () => {
  const s = fixture(); assert.equal((await s.call(request(), {})).status, 401); assert.equal(s.counts().decodes, 0);
  assert.equal((await fixture({ noUser: true }).call()).status, 401);
  const limited = fixture({ failQuota: true }); assert.equal((await limited.call()).status, 429); assert.equal(limited.counts().decodes, 0);
});
test('API checks exact catalog reference and version before charging', async () => {
  const s = fixture(); assert.equal((await s.call({ ...request(), targetHash: 'stale' })).status, 409); assert.deepEqual(s.actions, []);
  assert.equal((await s.call({ ...request(), reference: '다른 문장입니다.' })).status, 409);
});
test('API requires consent for uploaded reference and prevents comparing the same bytes', async () => {
  const body = request(); delete body.drillId; delete body.targetHash; body.targetAudio = body.audio;
  assert.equal((await fixture().call(body)).status, 400);
  assert.equal((await fixture().call({ ...body, targetConsent: true })).result.error, 'SAME_RECORDING');
});
test('API fails closed on unavailable provider and releases failed decode/transcription reservations', async () => {
  assert.equal((await fixture({ env: {} }).call()).status, 503);
  for (const options of [{ decoder: () => { throw Error(); } }, { transcription: () => { throw Error(); } }]) {
    const s = fixture(options); assert.ok((await s.call()).status >= 400); assert.deepEqual(s.actions, ['reserve', 'release']);
  }
});
test('bad recording quality does not trigger transcription', async () => {
  const s = fixture({ decoder: () => Buffer.alloc(64000) }); assert.equal((await s.call()).result.error, 'RECORD_AGAIN');
  assert.equal(s.counts().transcriptions, 0); assert.deepEqual(s.actions, ['reserve', 'release']);
});
test('built-in reference reuses its checked transcript and returns time-grounded comparison', async () => {
  const s = fixture(); const r = await s.call(); assert.equal(r.status, 200); assert.equal(r.result.status, 'compared');
  assert.equal(s.counts().transcriptions, 1); assert.deepEqual(s.actions, ['reserve', 'complete']);
});
test('nonmatching spoken text returns no correction suggestions', async () => {
  const s = fixture({ transcription: () => ({ ...sample().transcript, text: '다른 문장입니다.' }) });
  const r = await s.call(); assert.equal(r.status, 200); assert.equal(r.result.status, 'text_uncertain'); assert.deepEqual(r.result.suggestions, []);
});
test('catalog advertises analysis only after a non-writing DB readiness probe', async () => {
  for (const [message, available] of [['LOGIN_REQUIRED', true], ['Could not find the function', false], ['permission denied', false]]) {
    let result, probed;
    const handler = makeHandler({ env: { OPENAI_API_KEY: 'test' }, loadCatalog: async () => ({ drills: [] }),
      client: { rpc: async (_, p) => { probed = p; return { error: { message } }; } } });
    await handler({ method: 'GET' }, { setHeader() {}, status(s) { assert.equal(s, 200); return this; }, json(body) { result = body; } });
    assert.equal(result.available, available); assert.equal(probed.p_user, null); assert.equal(probed.p_request, null);
  }
});
test('catalog keeps reference listening available without provider or database configuration', async () => {
  let result; const handler = makeHandler({ env: {}, loadCatalog: async () => ({ drills: [{ id: 'closing', text }] }) });
  await handler({ method: 'GET' }, { setHeader() {}, status() { return this; }, json(body) { result = body; } });
  assert.equal(result.available, false); assert.equal(result.drills.length, 1);
});
