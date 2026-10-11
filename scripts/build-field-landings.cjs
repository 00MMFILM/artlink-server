// Same editorial source as app/src/data/practice-starters.json; parity is checked before handoff.
const fs = require('node:fs');
const path = require('node:path');
const data = require('../data/practice-starters.json');
const root = path.resolve(__dirname, '../public');
const escape = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const urlFor = (field, lang) => `/launch/${lang === 'en' ? 'en/' : ''}${field}/`;
const urls = [];
for (const [field, translations] of Object.entries(data)) for (const lang of ['ko','en']) {
  const c = translations[lang], ko = lang === 'ko', url = urlFor(field, lang);
  const note = c.prompts.map(p=>`${p}:\n`).join('\n');
  const href = '/practice?' + new URLSearchParams({field,source:'field_'+field,title:c.title,content:note});
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(c.name)} · ArtLink</title><meta name="description" content="${escape(c.intro)}"><link rel="canonical" href="https://art-link.kr${url}">${['ko','en'].map(l=>`<link rel="alternate" hreflang="${l}" href="https://art-link.kr${urlFor(field,l)}">`).join('')}<link rel="stylesheet" href="/launch/fields.css"></head><body>
  <a class="skip" href="#main">${ko?'본문으로 이동':'Skip to content'}</a><header><a class="brand" href="/launch/${ko?'':'en/'}">ArtLink<span> / ${escape(c.name)}</span></a><a href="${urlFor(field,ko?'en':'ko')}">${ko?'English':'한국어'}</a></header>
  <main id="main"><section class="hero"><p class="eyebrow">YOUR PRACTICE, YOUR FIELD</p><h1>${escape(c.title)}</h1><p class="intro">${escape(c.intro)}</p><a class="button" href="#start">${ko?'연습 목표 하나 고르기':'Choose one practice goal'} ↓</a></section>
  <section class="grid" id="start"><div><p class="eyebrow">01 / ${ko?'준비할 것':'WHAT TO BRING'}</p><h2>${ko?'잘 쓴 설명보다,<br>구체적인 고민 하나.':'One specific question<br>is enough to start.'}</h2><ol>${c.prompts.map(p=>`<li>${escape(p)}</li>`).join('')}</ol><p class="notice">${escape(c.notice)}</p></div>
  <div class="card"><p class="eyebrow">02 / ${ko?'이번에 확인할 점':'YOUR FOCUS'}</p><h2>${ko?'어디부터 볼까요?':'Where shall we start?'}</h2><fieldset><legend>${ko?'목표 하나 선택':'Select one goal'}</legend>${c.focus.map((focus,i)=>`<label><input type="radio" name="focus" value="${escape(focus)}" ${i===0?'checked':''}> <span>${escape(focus)}</span></label>`).join('')}</fieldset><a id="field-handoff" class="button" href="${escape(href)}">${ko?'이 목표로 앱에서 기록하기':'Use this goal in an app note'} →</a><noscript><p>${ko?'앱에서 목표를 직접 적어주세요.':'Enter your chosen goal in the app.'}</p></noscript><p class="small">${ko?'앱 설치 후에는 이 페이지로 돌아와 다시 눌러주세요. 자료는 앱에서 첨부하며, AI 피드백은 노트에서 직접 요청합니다.':'After installing, return here and tap again. Attach material in the app and request AI feedback from your note.'}</p><p class="small">${ko?'AI 피드백에는 무료 이용 한도가 있습니다. 실제 한도와 구독 가격은 앱에서 확인하세요.':'AI feedback has free usage limits. Check current limits and subscription prices in the app.'}</p></div></section>
  <section><p class="eyebrow">03 / ${ko?'다음 연습으로':'RETURN TO PRACTICE'}</p><h2>${field==='art'?(ko?'수정한 작품을,<br>원본 옆에 놓아보세요.':'See your revised work<br>beside the original.'):(ko?'피드백에서 한 가지를 골라,<br>다음 버전으로.':'Choose one thing from your feedback.<br>Make your next version.')}</h2><p class="intro">${field==='art'?(ko?'사진에서 살펴볼 영역을 고르고 수정본을 남겨주세요. 원본을 보관하면서 두 작품을 나란히 비교할 수 있습니다.':'Select an area to examine and save a revision. Keep the original and compare both works side by side.'):(ko?'수정할 점을 선택하고 다음 기록을 남겨주세요. 이전 기록과 함께 무엇을 시도했는지 돌아볼 수 있습니다.':'Choose what to change and save your next entry. Use your previous note to reflect on what you tried.')}</p></section>
  <nav aria-label="${ko?'다른 예술 분야':'Other art forms'}">${Object.entries(data).map(([id,v])=>`<a href="${urlFor(id,lang)}" ${id===field?'aria-current="page"':''}>${escape(v[lang].name)}</a>`).join('')}</nav></main><footer><a href="/privacy/">${ko?'개인정보처리방침':'Privacy'}</a><a href="/support/">${ko?'고객지원':'Support'}</a><p>ArtLink · ${ko?'예술가의 연습이 이어지는 곳':'A place to keep practicing'}</p></footer><script src="/launch/fields.js" defer></script></body></html>`;
  const dest = path.join(root,url,'index.html'); fs.mkdirSync(path.dirname(dest),{recursive:true}); fs.writeFileSync(dest,html); urls.push(url);
}
const sitemap = path.join(root,'sitemap.xml');
// Idempotently preserve existing entries and replace only these generated field URLs.
let xml = fs.readFileSync(sitemap,'utf8');
for(const url of urls) {
 const loc = 'https://art-link.kr'+url;
 if(!xml.includes(`<loc>${loc}</loc>`)) xml=xml.replace('</urlset>',`  <url><loc>${loc}</loc></url>\n</urlset>`);
}
fs.writeFileSync(sitemap,xml);
console.log(`Generated ${urls.length} field landing pages (KO/EN).`);
