// One-time original practice material. Run with OPENAI_API_KEY in the environment.
// Does not overwrite an existing reference set or send user recordings.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { decode } = require('../api/speech-check');
const { measure } = require('../api/_speechSignal');
const { transcribe } = require('../api/_speechTranscript');
const { align } = require('../api/_speechContour');
async function main() {
  if (!process.env.OPENAI_API_KEY) throw Error('OPENAI_API_KEY required in environment');
  const dir = path.join(__dirname, '../public/speech-coach/v1');
  try { await fs.access(path.join(dir, 'manifest.json')); throw Error('Reference set already exists; create a new version instead.'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  await fs.mkdir(dir, { recursive: true });
  const drills = [
    { id: 'closing', text: '오늘은 여기까지 이야기할게요.' },
    { id: 'steady', text: '지금은 천천히 말해도 괜찮아요.' },
    { id: 'meeting', text: '내일 다시 만나서 이야기해요.' }
  ];
  for (const drill of drills) {
    const file = path.join(dir, drill.id + '.mp3');
    let audio;
    try { audio = await fs.readFile(file); }
    catch (e) {
      if (e.code !== 'ENOENT') throw e;
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(45000), body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: 'marin', input: drill.text,
          instructions: 'Read only the given Korean sentence, once. Use calm, natural contemporary Seoul Korean, a comfortable conversational pace, and a gentle declarative ending. No introduction, music, dramatic character, or exaggerated accent.', response_format: 'mp3' })
      });
      if (!response.ok) throw Error('TTS request failed: ' + response.status);
      audio = Buffer.from(await response.arrayBuffer()); await fs.writeFile(file, audio, { flag: 'wx' });
    }
    const pcm = await decode(audio), signal = measure(pcm), transcript = await transcribe(pcm);
    if (signal.warnings.length || !align(drill.text, transcript, signal.duration)) throw Error('Reference needs review: ' + drill.id);
    Object.assign(drill, { version: 'v1', kind: 'ai-generated', model: 'gpt-4o-mini-tts', voice: 'marin',
      sha256: crypto.createHash('sha256').update(audio).digest('hex'), duration: signal.duration,
      url: '/speech-coach/v1/' + drill.id + '.mp3', transcript });
    console.log('Generated and transcript-checked:', drill.id, signal.duration, 'seconds');
  }
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ version: 1, notice: 'AI-generated practice voices. Not certified standard pronunciation or a dialect benchmark.', drills }, null, 2) + '\n', { flag: 'wx' });
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
