const { wav } = require('./_speechSignal');
async function transcribe(pcm, { env = process.env, fetcher = fetch } = {}) {
  if (!env.OPENAI_API_KEY) throw Error('TRANSCRIPTION_UNAVAILABLE');
  const body = new FormData();
  body.append('file', new Blob([wav(pcm)], { type: 'audio/wav' }), 'recording.wav');
  body.append('model', 'whisper-1'); body.append('language', 'ko'); body.append('response_format', 'verbose_json');
  body.append('timestamp_granularities[]', 'word'); body.append('timestamp_granularities[]', 'segment');
  // No reference prompt: do not bias recognition into accepting a different sentence.
  const response = await fetcher('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body, signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw Error('TRANSCRIPTION_UNAVAILABLE');
  return response.json();
}
module.exports = { transcribe };
