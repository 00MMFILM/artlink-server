const { wav } = require('./_speechSignal');
const score = n => Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
function configured(env) {
  return env.SPEECH_SCORING_ENABLED === 'true' && !!env.AZURE_SPEECH_KEY && /^[a-z][a-z0-9]{1,40}$/.test(env.AZURE_SPEECH_REGION || '');
}
function normalize(body, locale, duration) {
  if (body?.RecognitionStatus !== 'Success' || !Array.isArray(body.NBest) || !body.NBest[0]) return { status: 'unrecognized', words: [] };
  const best = body.NBest[0], confidence = best.Confidence;
  if (!Number.isFinite(confidence) || confidence < 0.6 || !Array.isArray(best.Words)) return { status: 'uncertain', words: [] };
  const words = best.Words.slice(0, 150).flatMap(w => {
    const start = w.Offset / 1e7, end = (w.Offset + w.Duration) / 1e7;
    if (typeof w.Word !== 'string' || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end > duration + 0.1) return [];
    const detail = w.PronunciationAssessment || w;
    return [{ word: w.Word.slice(0, 100), start, end, accuracy: score(detail.AccuracyScore),
      issue: ['Mispronunciation', 'Omission', 'Insertion'].includes(detail.ErrorType) ? detail.ErrorType : null }];
  });
  if (!words.length) return { status: 'uncertain', words: [] };
  const detail = best.PronunciationAssessment || best;
  return { status: 'assessed', locale, confidence, words, accuracy: score(detail.AccuracyScore),
    fluency: score(detail.FluencyScore), completeness: score(detail.CompletenessScore),
    // Never expose Korean prosody even if a malformed upstream response includes it.
    prosody: locale === 'en-US' ? score(detail.ProsodyScore) : null, model: 'azure-pronunciation' };
}
async function assess({ pcm, reference, locale, duration, env, fetcher = fetch }) {
  if (!configured(env)) return { status: 'unavailable', words: [] };
  const params = { ReferenceText: reference, GradingSystem: 'HundredMark', Granularity: 'Phoneme',
    Dimension: 'Comprehensive', EnableMiscue: true, EnableProsodyAssessment: locale === 'en-US' };
  const response = await fetcher(`https://${env.AZURE_SPEECH_REGION}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${locale}&format=detailed`, {
    method: 'POST', signal: AbortSignal.timeout(20000), headers: {
      'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
      'Ocp-Apim-Subscription-Key': env.AZURE_SPEECH_KEY,
      'Pronunciation-Assessment': Buffer.from(JSON.stringify(params)).toString('base64')
    }, body: wav(pcm)
  });
  if (!response.ok) throw Error('PROVIDER_UNAVAILABLE');
  return normalize(await response.json(), locale, duration);
}
module.exports = { configured, assess, normalize };
