const { createClient } = require('@supabase/supabase-js');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { measure } = require('./_speechSignal');
const provider = require('./_speechProvider');
const MAX_BYTES = 2 * 1024 * 1024;
async function decode(buffer) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artlink-speech-'));
  try {
    const input = path.join(dir, 'input'), output = path.join(dir, 'audio.pcm');
    await fs.writeFile(input, buffer, { mode: 0o600 });
    // No user URL or shell command. Block external protocols and playlists;
    // cap decoded length, output size, CPU threads and execution time.
    await promisify(execFile)(require('ffmpeg-static'), ['-nostdin', '-hide_banner', '-loglevel', 'error',
      '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,mp3,wav,ogg,flac,aac',
      '-threads', '1', '-i', input, '-map', '0:a:0', '-vn', '-t', '31', '-ac', '1', '-ar', '16000', '-f', 's16le', '-y', output],
      { timeout: 15000, maxBuffer: 256 * 1024 });
    return await fs.readFile(output);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
function makeHandler({ env = process.env, client, decoder = decode, assessor = provider.assess } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const send = (code, body) => res.status(code).json(body);
    if (req.method === 'GET') return send(200, { version: 1, maxSeconds: 30, maxBytes: MAX_BYTES, limit: 5,
      pronunciation: provider.configured(env), locales: ['ko-KR', 'en-US'] });
    if (req.method !== 'POST') return send(405, { error: 'METHOD_NOT_ALLOWED' });
    const origin = req.headers.origin;
    if (origin && !['https://art-link.kr', 'https://www.art-link.kr', `https://${env.VERCEL_URL}`].includes(origin)) return send(403, { error: 'ORIGIN_DENIED' });
    const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) return send(401, { error: 'LOGIN_REQUIRED' });
    if (!client && (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY)) return send(503, { error: 'UNAVAILABLE' });
    let b;
    try {
      b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!b || !['ko-KR', 'en-US'].includes(b.locale) || typeof b.reference !== 'string' || !b.reference.trim() || b.reference.length > 400
        || b.consent !== true || typeof b.audio !== 'string' || b.audio.length > Math.ceil(MAX_BYTES / 3) * 4
        || !/^[A-Za-z0-9+/]+={0,2}$/.test(b.audio) || b.audio.length % 4
        || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(b.requestId || '')) throw Error();
    } catch { return send(400, { error: 'INVALID_INPUT' }); }
    const bytes = Buffer.from(b.audio, 'base64');
    if (bytes.length > MAX_BYTES || bytes.length < 44) return send(400, { error: 'INVALID_AUDIO' });
    const db = client || createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    let user, reserved = false;
    const limit = async action => {
      const r = await db.rpc('artlink_speech_limit', { p_user: user.id, p_request: b.requestId, p_action: action });
      if (r.error) throw Error(/SPEECH_LIMIT|SPEECH_BUSY/.exec(r.error.message)?.[0] || 'UNAVAILABLE');
      return r.data;
    };
    try {
      const auth = await db.auth.getUser(token);
      user = auth.data?.user;
      if (auth.error || !user || user.is_anonymous) return send(401, { error: 'LOGIN_REQUIRED' });
      await limit('reserve'); reserved = true;
      let pcm;
      try { pcm = await decoder(bytes); } catch { throw Error('INVALID_AUDIO'); }
      const signal = measure(pcm);
      let pronunciation = { status: provider.configured(env) ? 'needs_recording' : 'unavailable', words: [] };
      if (!signal.warnings.length && provider.configured(env)) {
        try { pronunciation = await assessor({ pcm, reference: b.reference.trim(), locale: b.locale, duration: signal.duration, env }); }
        catch { pronunciation = { status: 'failed', words: [] }; }
      }
      const quota = await limit('complete'); reserved = false;
      return send(200, { version: 1, locale: b.locale, reference: b.reference.trim(), signal, pronunciation, quota });
    } catch (e) {
      // Finish quota cleanup before ending a serverless response.
      if (reserved && user) { try { await limit('release'); } catch {} }
      const code = ['SPEECH_LIMIT', 'SPEECH_BUSY'].includes(e.message) ? 429 : ['INVALID_AUDIO','DURATION_LIMIT'].includes(e.message) ? 400 : 503;
      return send(code, { error: ['SPEECH_LIMIT','SPEECH_BUSY','INVALID_AUDIO','DURATION_LIMIT'].includes(e.message) ? e.message : 'UNAVAILABLE' });
    }
  };
}
module.exports = makeHandler();
module.exports.makeHandler = makeHandler;
module.exports.decode = decode;
