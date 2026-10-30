const { createClient } = require('@supabase/supabase-js');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { decode } = require('./speech-check');
const { measure } = require('./_speechSignal');
const { compare, clean } = require('./_speechContour');
const { transcribe } = require('./_speechTranscript');
const MAX_BYTES = 1400000; // Two base64 files plus JSON remain below Vercel's body limit.
const directory = path.join(__dirname, '../public/speech-coach/v1');
async function catalog() { return JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8')); }
async function builtin(id) {
  const drill = (await catalog()).drills.find(d => d.id === id);
  if (!drill) throw Error('INVALID_INPUT');
  const audio = await fs.readFile(path.join(directory, drill.id + '.mp3'));
  if (crypto.createHash('sha256').update(audio).digest('hex') !== drill.sha256) throw Error('UNAVAILABLE');
  return { ...drill, audio };
}
function audio(value) {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_BYTES / 3) * 4 || value.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw Error('INVALID_AUDIO');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length < 44 || bytes.length > MAX_BYTES) throw Error('INVALID_AUDIO');
  return bytes;
}
async function ready(env, client) {
  if (!env.OPENAI_API_KEY || (!client && (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY))) return false;
  try {
    const db = client || createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    // NULL identity/request must be rejected before any write. This distinguishes
    // an installed, callable quota function from a missing migration/permission.
    const query = db.rpc('artlink_speech_limit', { p_user: null, p_request: null, p_action: 'reserve' });
    const result = await (query.abortSignal ? query.abortSignal(AbortSignal.timeout(4000)) : query);
    return result.error?.message === 'LOGIN_REQUIRED';
  } catch { return false; }
}
function makeHandler({ env = process.env, client, decoder = decode, transcription = transcribe, loadBuiltin = builtin, loadCatalog = catalog } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const send = (code, body) => res.status(code).json(body);
    if (req.method === 'GET') {
      try { return send(200, { version: 1, available: await ready(env, client), maxSeconds: 30, maxBytes: MAX_BYTES,
        drills: (await loadCatalog()).drills.map(({ id, text, version, kind, sha256, duration, url }) => ({ id, text, version, kind, sha256, duration, url })) }); }
      catch { return send(503, { error: 'UNAVAILABLE' }); }
    }
    if (req.method !== 'POST') return send(405, { error: 'METHOD_NOT_ALLOWED' });
    const origin = req.headers.origin;
    if (origin && !['https://art-link.kr', 'https://www.art-link.kr', `https://${env.VERCEL_URL}`].includes(origin)) return send(403, { error: 'ORIGIN_DENIED' });
    const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) return send(401, { error: 'LOGIN_REQUIRED' });
    if (!env.OPENAI_API_KEY || (!client && (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY))) return send(503, { error: 'UNAVAILABLE' });
    let b, attemptBytes, targetBytes;
    try {
      b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!b || b.consent !== true || typeof b.reference !== 'string' || b.reference.length > 160 || clean(b.reference).length < 4
        || /[^가-힣\s.,!?…“”‘’'"·]/u.test(b.reference)
        || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(b.requestId || '')) throw Error();
      if (b.drillId) { if (!/^[a-z-]{1,30}$/.test(b.drillId) || b.targetAudio !== undefined || typeof b.targetHash !== 'string') throw Error(); }
      else { if (b.targetConsent !== true) throw Error(); targetBytes = audio(b.targetAudio); }
      attemptBytes = audio(b.audio);
      if (targetBytes?.equals(attemptBytes)) return send(400, { error: 'SAME_RECORDING' });
    } catch { return send(400, { error: 'INVALID_INPUT' }); }
    const db = client || createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    let user, reserved = false;
    const limit = async action => {
      const r = await db.rpc('artlink_speech_limit', { p_user: user.id, p_request: b.requestId, p_action: action });
      if (r.error) throw Error(/SPEECH_LIMIT|SPEECH_BUSY/.exec(r.error.message)?.[0] || 'UNAVAILABLE');
      return r.data;
    };
    try {
      const auth = await db.auth.getUser(token); user = auth.data?.user;
      if (auth.error || !user || user.is_anonymous) return send(401, { error: 'LOGIN_REQUIRED' });
      let drill;
      if (b.drillId) {
        drill = await loadBuiltin(b.drillId);
        if (drill.text !== b.reference.trim() || drill.sha256 !== b.targetHash) return send(409, { error: 'REFERENCE_CHANGED' });
        targetBytes = drill.audio;
      }
      await limit('reserve'); reserved = true;
      let targetPcm, attemptPcm;
      try { [targetPcm, attemptPcm] = await Promise.all([decoder(targetBytes), decoder(attemptBytes)]); }
      catch { throw Error('INVALID_AUDIO'); }
      const targetSignal = measure(targetPcm), attemptSignal = measure(attemptPcm);
      if (targetSignal.warnings.length || attemptSignal.warnings.length) throw Error('RECORD_AGAIN');
      const [targetTranscript, attemptTranscript] = await Promise.all([
        drill ? Promise.resolve(drill.transcript) : transcription(targetPcm, { env }), transcription(attemptPcm, { env })
      ]);
      const result = compare({ reference: b.reference.trim(), targetPcm, attemptPcm, targetTranscript, attemptTranscript });
      const quota = await limit('complete'); reserved = false;
      return send(200, { version: 1, reference: b.reference.trim(), targetHash: crypto.createHash('sha256').update(targetBytes).digest('hex'),
        targetKind: drill ? 'ai-generated' : 'user-selected', ...result, quota });
    } catch (e) {
      if (reserved) { try { await limit('release'); } catch {} }
      const errors = ['INVALID_AUDIO', 'DURATION_LIMIT', 'RECORD_AGAIN', 'SPEECH_LIMIT', 'SPEECH_BUSY'];
      return send(['SPEECH_LIMIT', 'SPEECH_BUSY'].includes(e.message) ? 429 : errors.includes(e.message) ? 400 : 503,
        { error: errors.includes(e.message) ? e.message : 'UNAVAILABLE' });
    }
  };
}
module.exports = makeHandler();
module.exports.makeHandler = makeHandler;
