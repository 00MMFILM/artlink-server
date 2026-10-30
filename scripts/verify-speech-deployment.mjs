// Opt-in release verification. Uses synthetic originals and a disposable account.
// Credentials remain in memory/stdin. No emails are sent; cleanup is mandatory.
import { createRequire } from 'node:module';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');
const url = new URL(process.env.SPEECH_VERIFY_URL || 'https://art-link.kr');
if (process.env.RUN_SPEECH_DEPLOY_VERIFY !== '1' || url.protocol !== 'https:' ||
    !(url.hostname === 'art-link.kr' || /^artlink-server-[a-z0-9]+-00mmfilms-projects\.vercel\.app$/.test(url.hostname))) {
  throw Error('Explicit opt-in and an ArtLink deployment URL are required');
}
const authOptions = { persistSession: false, autoRefreshToken: false };
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: authOptions });
const login = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: authOptions });
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artlink-deploy-check-'));
const results = { url: url.origin, syntheticOnly: true, checks: [], cleanedUp: false };
let userId, token;
async function request(route, body, bearer) {
  if (url.hostname === 'art-link.kr') {
    const r = await fetch(new URL(route, url), { method: body ? 'POST' : 'GET',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(90000) });
    return { status: r.status, body: await r.json() };
  }
  const payload = path.join(dir, 'request.json');
  if (body) await fs.writeFile(payload, JSON.stringify(body), { mode: 0o600 });
  const args = ['curl', route, '--deployment', url.origin, '--', '--silent', '--show-error', '--max-time', '90', '--config', '-', '--write-out', '\n%{http_code}'];
  if (body) args.push('--request', 'POST', '--header', 'Content-Type: application/json', '--data-binary', `@${payload}`);
  const raw = await new Promise((resolve, reject) => {
    const child = spawn('vercel', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', b => { out += b; });
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(out) : reject(Error(`Vercel request failed (${code})`)));
    child.stdin.end(bearer ? `header = "Authorization: Bearer ${bearer}"\n` : '');
  });
  const split = raw.lastIndexOf('\n');
  return { status: Number(raw.slice(split + 1)), body: JSON.parse(raw.slice(0, split)) };
}
async function count() {
  const r = await db.from('artlink_speech_usage').select('request_id', { count: 'exact', head: true }).eq('user_id', userId);
  assert.equal(r.error, null); return r.count;
}
const check = (name, details = {}) => { results.checks.push({ name, ...details }); console.log(JSON.stringify({ pass: name, ...details })); };
try {
  const catalog = await request('/api/speech-compare');
  assert.equal(catalog.status, 200); assert.equal(catalog.body.available, true);
  check('catalog_ready', { drills: catalog.body.drills.length });
  const drill = catalog.body.drills.find(d => d.id === 'closing'); assert.ok(drill);
  const root = new URL('../public/speech-coach/v1/', import.meta.url);
  const source = new URL('closing.mp3', root);
  const takePath = path.join(dir, 'take.m4a');
  await promisify(execFile)(require('ffmpeg-static'), ['-nostdin', '-loglevel', 'error', '-i', source.pathname,
    '-af', 'atempo=0.85', '-ac', '1', '-ar', '44100', '-c:a', 'aac', takePath]);
  const take = (await fs.readFile(takePath)).toString('base64');
  const body = extra => ({ consent: true, requestId: crypto.randomUUID(), reference: drill.text,
    drillId: drill.id, targetHash: drill.sha256, audio: take, ...extra });
  assert.equal((await request('/api/speech-compare', body())).status, 401);
  assert.equal((await request('/api/speech-compare', body(), 'invalid-test-token')).status, 401);
  check('missing_and_invalid_login_rejected');
  const email = `speech-release-${crypto.randomUUID()}@example.invalid`;
  const password = crypto.randomBytes(32).toString('base64url');
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true,
    user_metadata: { release_verification: true, synthetic_audio_only: true } });
  assert.equal(created.error, null); userId = created.data.user.id;
  const signedIn = await login.auth.signInWithPassword({ email, password });
  assert.equal(signedIn.error, null); token = signedIn.data.session.access_token;
  assert.equal(signedIn.data.user.id, userId); check('real_user_login');
  const member = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY,
    { auth: authOptions, global: { headers: { Authorization: `Bearer ${token}` } } });
  assert.ok((await member.from('artlink_speech_usage').select('request_id')).error);
  assert.ok((await member.rpc('artlink_speech_limit', { p_user: userId, p_request: crypto.randomUUID(), p_action: 'reserve' })).error);
  check('member_cannot_read_or_change_quota_directly');
  assert.equal((await request('/api/speech-compare', body({ consent: false }), token)).status, 400);
  assert.equal(await count(), 0); check('consent_required_without_charge');
  const bad = await request('/api/speech-compare', body({ audio: Buffer.alloc(100).toString('base64') }), token);
  assert.equal(bad.status, 400); assert.equal(await count(), 0); check('invalid_audio_releases_quota');
  const good = await request('/api/speech-compare', body(), token);
  assert.equal(good.status, 200, JSON.stringify(good.body)); assert.equal(good.body.status, 'compared');
  assert.equal(good.body.quota.used, 1); assert.equal(good.body.coverage.compared, 3);
  check('builtin_aac_real_asr', { status: good.body.status, coverage: good.body.coverage });
  const customBody = body({ targetAudio: (await fs.readFile(source)).toString('base64'), targetConsent: true });
  delete customBody.drillId; delete customBody.targetHash;
  const custom = await request('/api/speech-compare', customBody, token);
  assert.equal(custom.status, 200, JSON.stringify(custom.body)); assert.equal(custom.body.status, 'compared');
  assert.equal(custom.body.targetKind, 'user-selected'); assert.equal(custom.body.quota.used, 2);
  check('custom_reference_real_asr', { coverage: custom.body.coverage });
  const mismatch = await request('/api/speech-compare', body({ audio: (await fs.readFile(new URL('meeting.mp3', root))).toString('base64') }), token);
  assert.equal(mismatch.status, 200); assert.equal(mismatch.body.status, 'text_uncertain');
  assert.deepEqual(mismatch.body.suggestions, []); check('different_words_produce_no_correction');
  // Fill only this disposable account's last two slots without unnecessary paid ASR.
  for (let i = 0; i < 2; i++) {
    const id = crypto.randomUUID();
    for (const action of ['reserve', 'complete']) assert.equal((await db.rpc('artlink_speech_limit',
      { p_user: userId, p_request: id, p_action: action })).error, null);
  }
  const limited = await request('/api/speech-compare', body(), token);
  assert.equal(limited.status, 429); assert.equal(limited.body.error, 'SPEECH_LIMIT');
  assert.equal(await count(), 5); check('sixth_request_blocked');
} finally {
  if (userId) {
    const deleted = await db.auth.admin.deleteUser(userId);
    assert.equal(deleted.error, null, 'Disposable test account cleanup failed');
    assert.equal(await count(), 0, 'Account deletion did not cascade usage cleanup');
    results.cleanedUp = true; check('test_account_and_usage_removed');
  }
  await fs.rm(dir, { recursive: true, force: true });
  if (process.env.SPEECH_VERIFY_OUTPUT) await fs.writeFile(process.env.SPEECH_VERIFY_OUTPUT, JSON.stringify(results, null, 2));
}
