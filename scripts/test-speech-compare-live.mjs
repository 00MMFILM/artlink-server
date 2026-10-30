// Opt-in integration check using only original AI-generated practice recordings.
// Real HTTP, PostgreSQL quota, ffmpeg and OpenAI ASR; authentication is a test
// double. This is not a human dialect-accuracy or production-auth evaluation.
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
if (process.env.RUN_LIVE_SPEECH_TEST !== '1' || !process.env.OPENAI_API_KEY) throw Error('Explicit live-test opt-in and existing API credential required');
const require = createRequire(import.meta.url), { PGlite } = require(process.env.PGLITE_TEST_MODULE || '@electric-sql/pglite');
const { makeHandler } = require('../api/speech-compare'), { decode } = require('../api/speech-check'), { compare } = require('../api/_speechContour');
const root = new URL('../public/speech-coach/v1/', import.meta.url);
const catalog = JSON.parse(await fs.readFile(new URL('manifest.json', root), 'utf8'));
const output = { warning: 'Synthetic speech only. Real ASR/ffmpeg/PostgreSQL, test-double authentication. Not human accent validation.', checks: [] };
for (const d of catalog.drills) {
  const pcm = await decode(await fs.readFile(new URL(d.id + '.mp3', root)));
  const self = compare({ reference: d.text, targetPcm: pcm, attemptPcm: pcm, targetTranscript: d.transcript, attemptTranscript: d.transcript });
  assert.equal(self.status, 'compared'); assert.equal(self.suggestions.length, 0);
  output.checks.push({ kind: 'reference_self', id: d.id, coverage: self.coverage, voicedSeconds: self.targetVoicedSeconds });
}
const db = new PGlite(), user = '00000000-0000-4000-8000-000000000001';
await db.exec('create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);grant usage on schema public,auth to service_role;');
await db.query('insert into auth.users values($1)', [user]);
await db.exec(await fs.readFile(new URL('../migrations/2026-10-28-speech-check.sql', import.meta.url), 'utf8'));
await db.exec('set role service_role');
const handler = makeHandler({ client: { auth: { getUser: async token => token === 'local-only' ? { data: { user: { id: user } } } : { error: {} } },
  rpc: async (_, p) => {
    try { return { data: (await db.query('select public.artlink_speech_limit($1,$2,$3) r', [p.p_user, p.p_request, p.p_action])).rows[0].r }; }
    catch (e) { return { error: { message: e.message } }; }
  }
} });
const server = http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  req.body = JSON.parse(body || '{}'); res.status = s => { res.statusCode = s; return res; }; res.json = b => res.end(JSON.stringify(b));
  await handler(req, res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artlink-coach-test-'));
try {
  const original = await fs.readFile(new URL('closing.mp3', root)), input = path.join(dir, 'input.mp3'), slower = path.join(dir, 'slower.m4a');
  await fs.writeFile(input, original, { mode: 0o600 });
  await promisify(execFile)(require('ffmpeg-static'), ['-nostdin', '-loglevel', 'error', '-i', input, '-af', 'atempo=0.85', '-ac', '1', '-ar', '44100', '-c:a', 'aac', '-y', slower]);
  const take = await fs.readFile(slower), d = catalog.drills.find(d => d.id === 'closing');
  const capabilities = await (await fetch(`http://127.0.0.1:${server.address().port}/`)).json();
  assert.equal(capabilities.available, true);
  assert.equal((await db.query('select count(*)::int n from public.artlink_speech_usage')).rows[0].n, 0);
  output.checks.push({ kind: 'readiness_probe_does_not_write', available: capabilities.available });
  const call = async body => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`, { method: 'POST', headers: { Authorization: 'Bearer local-only', 'Content-Type': 'application/json' },
      body: JSON.stringify({ consent: true, requestId: crypto.randomUUID(), reference: d.text, ...body }) });
    assert.equal(response.status, 200); return response.json();
  };
  const builtin = await call({ audio: take.toString('base64'), drillId: d.id, targetHash: d.sha256 });
  assert.equal(builtin.status, 'compared'); assert.equal(builtin.quota.used, 1);
  output.checks.push({ kind: 'builtin_real_asr_aac', result: builtin });
  const custom = await call({ audio: take.toString('base64'), targetAudio: original.toString('base64'), targetConsent: true });
  assert.equal(custom.status, 'compared'); assert.equal(custom.targetKind, 'user-selected'); assert.equal(custom.quota.used, 2);
  output.checks.push({ kind: 'custom_two_real_transcriptions', result: custom });
  const mismatch = await call({ audio: (await fs.readFile(new URL('meeting.mp3', root))).toString('base64'), drillId: d.id, targetHash: d.sha256 });
  assert.equal(mismatch.status, 'text_uncertain'); assert.deepEqual(mismatch.suggestions, []); assert.equal(mismatch.quota.used, 3);
  output.checks.push({ kind: 'different_spoken_words_abstain', result: mismatch });
  await db.exec('reset role'); const columns = (await db.query("select column_name from information_schema.columns where table_name='artlink_speech_usage' order by ordinal_position")).rows.map(r => r.column_name);
  assert.deepEqual(columns, ['user_id', 'request_id', 'created_at', 'complete']);
  output.checks.push({ kind: 'database_usage_only', columns });
  if (process.env.SPEECH_TEST_OUTPUT) await fs.writeFile(process.env.SPEECH_TEST_OUTPUT, JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output.checks.map(c => ({ kind: c.kind, id: c.id, status: c.result?.status, coverage: c.coverage || c.result?.coverage, suggestions: c.result?.suggestions.length })), null, 2));
  console.log('PASS real speech comparison integration (synthetic recordings; no human accuracy claim)');
} finally { await new Promise(r => server.close(r)); await db.close(); await fs.rm(dir, { recursive: true, force: true }); }
