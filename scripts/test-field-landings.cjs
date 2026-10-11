// Offline artifact and handoff checks. Responsive rendering is checked separately
// in the app browser; this script makes no network requests and opens no browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { load } = require('cheerio');
const data = require('../data/practice-starters.json');
const root = path.resolve(__dirname, '../public');
const script = fs.readFileSync(path.join(root, 'launch/fields.js'), 'utf8');
const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
let scenarios = 0;
for (const lang of ['ko', 'en']) for (const [field, copy] of Object.entries(data)) {
  const route = `/launch/${lang === 'en' ? 'en/' : ''}${field}/`;
  const $ = load(fs.readFileSync(path.join(root, route, 'index.html'), 'utf8'));
  assert.equal($('h1').text(), copy[lang].title);
  assert.equal($('html').attr('lang'), lang);
  assert.equal($('link[rel=canonical]').attr('href'), 'https://art-link.kr' + route);
  assert.ok(sitemap.includes(`<loc>https://art-link.kr${route}</loc>`));
  assert.equal($('input[name=focus]').length, copy[lang].focus.length);
  const initial = $('#field-handoff').attr('href');
  // The no-JavaScript link must already retain the field, title, and prompts.
  const noJs = new URL(initial, 'https://art-link.kr');
  assert.equal(noJs.pathname, '/practice');
  assert.equal(noJs.searchParams.get('field'), field);
  assert.equal(noJs.searchParams.get('source'), 'field_' + field);
  assert.equal(noJs.searchParams.get('title'), copy[lang].title);
  copy[lang].prompts.forEach(p => assert.ok(noJs.searchParams.get('content').includes(p)));
  let selected = copy[lang].focus[0];
  const listeners = [];
  const link = { getAttribute: () => initial, href: initial };
  const document = {
    documentElement: { lang }, getElementById: () => link,
    querySelector: () => ({ value: selected }),
    querySelectorAll: () => copy[lang].focus.map(() => ({ addEventListener: (_event, fn) => listeners.push(fn) })),
  };
  vm.runInNewContext(script, { document, URL, location: { origin: 'https://art-link.kr' } });
  for (const goal of copy[lang].focus) {
    selected = goal; listeners.forEach(fn => fn());
    const next = new URL(link.href, 'https://art-link.kr');
    assert.equal(next.searchParams.get('field'), field);
    assert.equal(next.searchParams.get('content'), noJs.searchParams.get('content') + '\n' + (lang === 'ko' ? '이번에 확인할 점: ' : 'Focus for this practice: ') + goal);
  }
  for (const id of Object.keys(data)) assert.equal($(`nav a[href="/launch/${lang === 'en' ? 'en/' : ''}${id}/"]`).length, 1);
  const home = load(fs.readFileSync(path.join(root, `launch/${lang === 'en' ? 'en/' : ''}index.html`), 'utf8'));
  assert.equal(home(`.fields a[href="${route}"]`).length, 1);
  assert.equal($('script[src^="http"]').length, 0);
  scenarios++;
}
const appData = process.env.ARTLINK_APP_STARTERS || path.resolve(__dirname, '../../app/src/data/practice-starters.json');
if (fs.existsSync(appData)) assert.deepEqual(data, JSON.parse(fs.readFileSync(appData, 'utf8')));
console.log(`PASS ${scenarios} field/locale pages: metadata, sitemap, navigation, no-JS fallback, all goal handoffs, content parity when app fixture is available.`);
