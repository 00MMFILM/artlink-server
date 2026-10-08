const assert = require('node:assert/strict');
const { runInNewContext } = require('node:vm');
const handler = require('../api/practice.js');

const decode = value => value.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const ios = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)';
const android = 'Mozilla/5.0 (Linux; Android 14)';
let count = 0;
async function render(query, ua = ios) {
  const response = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = body; } };
  await handler({ url: '/practice?' + query, headers: { 'user-agent': ua } }, response);
  assert.equal(response.statusCode, 200);
  return response;
}
const base = new URLSearchParams({ source: 'actraw', mode: 'standard_speech', field: 'acting', m: 'ss-001', title: '기다려 줄래?', content: '너 & 나, "둘"이서 <다시> 이야기하자.' });

(async () => {
  for (const ua of [ios, android, 'desktop']) {
    const { body, headers } = await render(base.toString(), ua);
    const link = new URL(decode(body.match(/id="open-practice" href="([^"]+)"/)[1]));
    assert.equal(link.protocol, 'artlink:');
    assert.equal(link.hostname, 'practice');
    for (const key of ['source', 'mode', 'field', 'title', 'content']) assert.equal(link.searchParams.get(key), base.get(key));
    assert.equal(link.searchParams.get('sceneId'), 'actraw:ss-001');
    assert.equal(headers['Cache-Control'], 'no-store');
    assert.equal(headers['Referrer-Policy'], 'no-referrer');
    assert.match(body, /이 페이지로 돌아와/);
    assert.match(body, /녹음한 파일은 자동으로 옮겨지지/);
    assert.doesNotMatch(body, /maximum-scale/);
    const dataset = Object.fromEntries([...body.matchAll(/data-([a-z-]+)="([^"]*)"/g)]
      .map(m => [m[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), decode(m[2])]));
    let navigated = false;
    const location = {};
    Object.defineProperty(location, 'href', { set() { navigated = true; } });
    runInNewContext(body.match(/<script>([\s\S]*?)<\/script>/)[1], {
      window: { location }, document: { getElementById: () => ({ dataset }) },
      setTimeout() { throw new Error('Speech handoff must not schedule a redirect'); }, encodeURIComponent,
    });
    assert.equal(navigated, false);
    count++;
  }

  for (const suffix of [
    'source=actraw&m=ss-001&mode=evil',
    'source=external&m=ss-001&mode=standard_speech',
    'source=actraw&m=../private&mode=standard_speech',
    'source=actraw&m=ss-001&mode=standard_speech&mode=standard_speech',
    'source=actraw&source=external&m=ss-001&mode=standard_speech',
    'source=actraw&m=ss-001&field=music&mode=standard_speech',
    'source=actraw&mode=standard_speech',
    'source=actraw&m=ss-001&m=ss-002&mode=standard_speech',
  ]) {
    assert.doesNotMatch((await render(suffix)).body, /id="speech-handoff"/);
    count++;
  }
  const hostile = new URLSearchParams(base);
  hostile.set('title', '"></a><script>alert(1)</script>');
  hostile.set('content', '<img src=x onerror=alert(1)>');
  const html = (await render(hostile.toString())).body;
  assert(!html.includes(hostile.get('title')));
  assert(!html.includes(hostile.get('content')));
  const safeLink = new URL(decode(html.match(/id="open-practice" href="([^"]+)"/)[1]));
  assert.equal(safeLink.searchParams.get('content'), hostile.get('content'));
  console.log(`PASS ${count + 1} standard speech handoff scenarios; mobile/desktop, no automatic navigation, validation, escaping.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
