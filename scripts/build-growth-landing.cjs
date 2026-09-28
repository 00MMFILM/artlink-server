// One content source for the Korean, English and default-host landing pages.
// Run: node scripts/build-growth-landing.cjs
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../public');
const copy = {
  ko: {
    title: '아트링크 — 다음 연습이 달라지는 예술 AI 피드백',
    description: '혼자 하는 연습에도 다음이 보이도록. 한국어·영어 대사 연습, AI 피드백, 다시 연습한 기록을 아트링크에서 이어가세요.',
    skip: '본문으로 이동', nav: ['연습 맛보기', '사용 방법', '자주 묻는 질문'], download: '앱 다운로드',
    eyebrow: '혼자 연습하는 예술가를 위해', heading: '오늘의 연습에서,<br><em>다음 한 걸음으로.</em>',
    lead: '대사를 읽고, 피드백에서 바꿀 점 하나를 고르고, 다시 연습하세요. 아트링크가 그 과정을 이어줍니다.',
    try: '설치 없이 대사 읽어보기', app: '앱에서 내 연습 시작', small: '웹 예시는 가입 없이 · AI 피드백은 앱에서',
    tag: '현역 배우가 직접 만든 예술 AI 피드백',
    demoKicker: '01 / 짧은 장면으로 시작', demoTitle: '다음 대사를,<br>어떻게 건넬까요?',
    demoDesc: '내 역할은 A. 상대의 말을 읽고 내 대사를 소리 내어 읽어보세요. 아래는 아트링크가 만든 연습용 예시입니다.',
    scene: '문 앞에서', situation: '떠나려는 친구에게 마지막으로 건네는 말. 붙잡고 싶지만, 이유를 솔직하게 말하기는 어렵습니다.',
    lines: [['B', '나 이제 가야 해.'], ['A', '잠깐만. 아직 네 컵이 여기 있잖아.'], ['B', '다음에 가져갈게.'], ['A', '그 다음이 언제인데?']],
    role: '내 역할 A', count: '대사', reveal: '내 대사 보기', next: '다음 대사', finish: '다음 연습 정하기', restart: '처음부터 읽기',
    yourTurn: '내 차례입니다. 어떤 말로 붙잡을지 먼저 떠올려 보세요.',
    focusTitle: '다음에는 무엇을 바꿔볼까요?',
    focuses: ['대답을 서두르지 않고 상대의 말을 듣기', '친구를 붙잡으려는 의도를 더 분명히 하기', '같은 대사를 다른 방식으로 건네기'],
    focusHelp: '한 가지를 골라 같은 장면을 다시 읽어보세요.',
    demoDisclaimer: '이 예시는 녹음하거나 AI로 평가하지 않습니다. 선택한 연습 목표만 이 화면에서 사용합니다.',
    handoff: '이 장면으로 앱에서 기록하기', handoffHint: '앱 설치 후에는 이 페이지로 돌아와 다시 눌러주세요. 웹에서 읽은 내용이 자동 저장되지는 않습니다.',
    handoffTitle: '문 앞에서 — 대사 연습', contextLabel: '장면', roleLabel: '내 역할: A', focusLabel: '다음 연습 목표',
    howTitle: '피드백을 읽고 끝내지 않도록.', howSub: '한 번의 평가보다, 다음 연습으로 이어지는 흐름을 만듭니다.',
    steps: [ ['연습하기', '한국어·영어 장면을 고르거나 내 대본을 준비하세요. 상대역 읽기와 녹음으로 시작할 수 있습니다.'], ['하나 고르기', '앱에 내 연습을 남기고 AI 피드백을 받으세요. 다음에 시도할 점을 직접 선택합니다.'], ['다시 해보기', '선택한 목표로 다시 연습하고 이전 기록과 비교하세요. 홈에서 하던 연습으로 돌아갈 수 있습니다.'] ],
    artsTitle: '연기에서 시작해,<br>내가 하는 예술로.', artsDesc: '음악·미술·무용·문학·영화도 분야에 맞춰 기록하고 피드백을 받을 수 있습니다. 대사 연습실은 연기·영화 연습을 위한 공간입니다.',
    arts: ['연기', '음악', '미술', '무용', '문학', '영화'],
    opportunityTitle: '발견한 공고가<br>실제 지원까지 이어지도록.', opportunityDesc: '공고에서 원문과 지원 방법을 확인하고, 앱에서 필요한 연습과 준비 기록을 남기세요. 지원은 공고의 공식 접수처에서 진행합니다.',
    opportunitySteps: ['원문 확인', '지원 방법 확인', '앱에서 준비'], opportunityNote: '인스타그램에서 본 공고는 해당 스토리의 개별 공고 링크로 확인하세요. 공고마다 마감·지역·지원 조건이 다릅니다.',
    faqTitle: '시작하기 전에 궁금한 것들.',
    faqs: [
      ['무료로 쓸 수 있나요?', '앱은 무료로 다운로드할 수 있습니다. AI 피드백에는 이용 한도가 있고, 구독과 추가 이용 상품이 있습니다. 현재 한도·가격·갱신 조건은 앱의 이용량 안내와 결제 화면에서 확인할 수 있습니다.'],
      ['영어 대사도 연습할 수 있나요?', '대사 연습실에서 한국어·영어 장면을 선택하고, 피드백 언어도 한국어·영어 중 고를 수 있습니다. 영어 대사를 한국어로 복기하는 연습도 가능합니다.'],
      ['AI가 발음이나 연기 실력을 채점하나요?', '녹음 피드백은 전사된 대사와 입력한 맥락을 바탕으로 합니다. 발음·억양 점수를 제공하지 않으며 합격이나 실력 향상을 보장하지 않습니다. 영상 피드백도 제공된 자료에서 확인 가능한 내용을 바탕으로 참고하세요.'],
      ['연습한 내용은 공개되나요?', '연습 노트를 저장하는 것과 커뮤니티에 게시하는 것은 별개의 동작입니다. AI 분석을 요청하면 필요한 자료가 분석 서비스로 전송됩니다. 자세한 처리·보관 내용은 개인정보처리방침을 확인해 주세요.']
    ],
    finalTitle: '다음 연습은,<br>바꿀 점 하나와 함께.', finalDesc: '지금 준비 중인 장면, 작품, 노트로 시작하세요.',
    support: '고객지원', privacy: '개인정보처리방침', terms: '이용약관', contact: '문의', footer: '예술가의 연습이 이어지는 곳.',
  },
  en: {
    title: 'ArtLink — AI feedback for your next practice',
    description: 'Rehearse English and Korean scenes, choose one thing to work on from AI feedback, and return for another take. Practice with ArtLink.',
    skip: 'Skip to content', nav: ['Try a scene', 'How it works', 'Questions'], download: 'Get the app',
    eyebrow: 'FOR ARTISTS WHO PRACTICE ON THEIR OWN', heading: 'One practice.<br><em>A next step.</em>',
    lead: 'Run your lines. Pick one thing to work on from your feedback. Try another take. ArtLink connects the steps.',
    try: 'Try a scene in your browser', app: 'Start my practice in the app', small: 'No account for this demo · AI feedback in the app',
    tag: 'Built by a working actor',
    demoKicker: '01 / START WITH A SHORT SCENE', demoTitle: 'What will you<br>say next?',
    demoDesc: 'You play A. Read your partner’s line, then say yours aloud. This is an original practice example written for ArtLink.',
    scene: 'At the door', situation: 'Your friend is about to leave. You want them to stay, but telling them why is harder than you expected.',
    lines: [['B', 'I should get going.'], ['A', 'Wait. Your cup is still here.'], ['B', 'I’ll get it next time.'], ['A', 'When is next time?']],
    role: 'YOU PLAY A', count: 'Line', reveal: 'Reveal my line', next: 'Next line', finish: 'Choose a next step', restart: 'Read it again',
    yourTurn: 'Your turn. Think of how you want to ask them to stay.',
    focusTitle: 'What would you try next?', focuses: ['Listen before rushing into my reply', 'Make my intention to keep them here clearer', 'Try a different way of delivering the same words'],
    focusHelp: 'Pick one thing, then read the scene again.',
    demoDisclaimer: 'This demo does not record or evaluate you with AI. Your chosen practice goal is used only on this page.',
    handoff: 'Use this scene in an app note', handoffHint: 'After installing, return to this page and tap again. Reading this demo does not automatically save an app note.',
    handoffTitle: 'At the door — rehearsal', contextLabel: 'Scene', roleLabel: 'My role: A', focusLabel: 'Next practice goal',
    howTitle: 'Feedback is a place to start.', howSub: 'Build a practice you can return to, one choice at a time.',
    steps: [['Rehearse', 'Choose an English or Korean scene, or bring your own script. Start with partner lines and a recording.'], ['Choose one thing', 'Capture your practice in the app and request AI feedback. Choose what you want to try next.'], ['Take it further', 'Practice with that intention and compare with your previous note. Return to your next take from Home.']],
    artsTitle: 'Start with a scene.<br>Bring your art.', artsDesc: 'Keep practice notes and request feedback for music, visual art, dance, writing and film too. The rehearsal studio is designed for acting and film scenes.',
    arts: ['Acting', 'Music', 'Visual art', 'Dance', 'Writing', 'Film'],
    opportunityTitle: 'From an opportunity<br>to your preparation.', opportunityDesc: 'Check the original listing and application instructions, then prepare in the app. Submit through the official contact or form in the listing.',
    opportunitySteps: ['Read the source', 'Check how to apply', 'Prepare in the app'], opportunityNote: 'Most current listings are in Korean. Check language, location, deadline and eligibility in each original listing.',
    faqTitle: 'A few things before you start.',
    faqs: [
      ['Is ArtLink free?', 'The app is free to download. AI feedback has usage limits, with subscriptions and additional usage products available. Check the current allowances, prices and renewal terms in the app before purchasing.'],
      ['Can I rehearse in English?', 'The studio includes English and Korean scenes. Choose English or Korean feedback separately from the script language, so you can reflect in the language you prefer.'],
      ['Does AI grade my accent or acting ability?', 'Recording feedback uses transcribed words and the context you provide. It does not score pronunciation or accent, or guarantee an audition result. Treat video feedback as suggestions grounded in the material provided.'],
      ['Is my practice public?', 'Saving a practice note and posting to the community are separate actions. Requesting AI analysis sends the necessary material to analysis services. Read the privacy policy for processing and retention details.']
    ],
    finalTitle: 'Bring one thing<br>to your next practice.', finalDesc: 'Start with the scene, work or note you are already preparing.',
    support: 'Support', privacy: 'Privacy', terms: 'Terms', contact: 'Contact', footer: 'A place to keep practicing.',
  },
};
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function render(lang) {
  const c = copy[lang], url = `https://art-link.kr/launch${lang === 'en' ? '/en/' : '/'}`;
  const app = `/app?s=landing_${lang}`, stores = (place) => `<div class="store-links"><a data-store="ios" data-source="${place}" href="${app}_${place}&amp;platform=ios">App Store <span aria-hidden="true">↗</span></a><a data-store="android" data-source="${place}" href="${app}_${place}&amp;platform=android">Google Play <span aria-hidden="true">↗</span></a></div>`;
  const data = JSON.stringify({lang, scene:c.scene, situation:c.situation, lines:c.lines, count:c.count, reveal:c.reveal, next:c.next, finish:c.finish, yourTurn:c.yourTurn, handoffTitle:c.handoffTitle, roleLabel:c.roleLabel, contextLabel:c.contextLabel, focusLabel:c.focusLabel}).replace(/</g,'\\u003c');
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(c.title)}</title><meta name="description" content="${esc(c.description)}">
<link rel="canonical" href="${url}"><link rel="alternate" hreflang="ko" href="https://art-link.kr/launch/"><link rel="alternate" hreflang="en" href="https://art-link.kr/launch/en/"><link rel="alternate" hreflang="x-default" href="https://art-link.kr/launch/">
<meta property="og:title" content="${esc(c.title)}"><meta property="og:description" content="${esc(c.description)}"><meta property="og:url" content="${url}"><meta property="og:type" content="website"><meta property="og:locale" content="${lang === 'ko' ? 'ko_KR' : 'en_US'}"><meta name="theme-color" content="#f7f6f2">
<link rel="stylesheet" href="/launch/growth.css"><script src="/launch/growth.js" defer></script></head><body>
<a class="skip" href="#main">${c.skip}</a>
<header><a class="wordmark" href="/launch/" aria-label="ArtLink"><span class="mark">a</span>artlink<span class="wordmark-dot">.</span></a><nav aria-label="${lang === 'ko' ? '주 메뉴' : 'Main navigation'}"><a href="#try">${c.nav[0]}</a><a href="#how">${c.nav[1]}</a><a href="#faq">${c.nav[2]}</a></nav><div class="header-end"><a data-language-link href="${lang === 'ko' ? '/launch/en/' : '/launch/'}" lang="${lang === 'ko' ? 'en' : 'ko'}">${lang === 'ko' ? 'English' : '한국어'}</a><a class="button small" href="#download">${c.download}</a></div></header>
<main id="main"><section class="hero wrap"><div class="hero-copy"><p class="eyebrow">${c.eyebrow}</p><h1>${c.heading}</h1><p class="lead">${c.lead}</p><a class="button" href="#try">${c.try} <span aria-hidden="true">↗</span></a><a class="text-link" href="#download">${c.app} <span aria-hidden="true">→</span></a><p class="fine">${c.small}</p><p class="creator">${c.tag}</p></div><div class="scene-cover" aria-hidden="true"><div class="cover-top">ARTLINK / PRACTICE NOTES <span>01—03</span></div><div class="cover-script"><span class="scene-label">${c.scene}</span><p>${esc(c.lines[0][1])}</p><p class="my-line">${esc(c.lines[1][1])}</p><div class="pencil-line"></div></div><div class="cover-bottom"><span>REHEARSE.<br>REFLECT.<br><em>REPEAT.</em></span><span class="cover-symbol">a<span>↗</span></span></div></div></section>
<section class="demo-section" id="try"><div class="wrap demo-grid"><div><p class="eyebrow">${c.demoKicker}</p><h2>${c.demoTitle}</h2><p class="section-desc">${c.demoDesc}</p><p class="fine">${c.demoDisclaimer}</p></div><div class="demo-card"><div class="demo-top"><span>${c.role}</span><a data-language-link href="${lang === 'ko' ? '/launch/en/#try' : '/launch/#try'}">${lang === 'ko' ? 'English scene ↗' : '한국어 장면 ↗'}</a></div><h3>${c.scene}</h3><p class="situation">${c.situation}</p><div id="scene-reader"><div id="line-output" aria-live="polite" aria-atomic="true"><p class="counter">${c.count} 1 / 4 · B</p><p class="spoken-line">${esc(c.lines[0][1])}</p></div><button id="next-line" class="button" hidden>${c.next} →</button><noscript><p>${esc(c.lines[1][1])}</p><p>${esc(c.lines[2][1])}</p><p>${esc(c.lines[3][1])}</p></noscript></div><div id="reflection" hidden><h4 tabindex="-1" id="focus-heading">${c.focusTitle}</h4><p>${c.focusHelp}</p><fieldset><legend class="sr-only">${c.focusTitle}</legend>${c.focuses.map((f,i)=>`<label class="focus-choice"><input type="radio" name="focus" value="${esc(f)}"${i===0?' checked':''}><span>${f}</span></label>`).join('')}</fieldset><button id="restart" class="button secondary">${c.restart} ↺</button><a id="practice-link" class="button" href="/practice?field=acting&amp;source=landing">${c.handoff} ↗</a><p class="fine">${c.handoffHint}</p></div></div></div></section>
<section class="wrap section" id="how"><p class="eyebrow">02 / THE PRACTICE LOOP</p><h2>${c.howTitle}</h2><p class="section-desc">${c.howSub}</p><div class="steps">${c.steps.map((s,i)=>`<article><span class="step-num">0${i+1}</span><h3>${s[0]}</h3><p>${s[1]}</p></article>`).join('')}</div></section>
<section class="wrap split section"><div><p class="eyebrow">YOUR PRACTICE, YOUR FIELD</p><h2>${c.artsTitle}</h2></div><div><p class="section-desc">${c.artsDesc}</p><div class="fields">${c.arts.map(a=>`<span>${a}</span>`).join('')}</div></div></section>
<section class="wrap opportunities"><div><p class="eyebrow">03 / OPPORTUNITIES</p><h2>${c.opportunityTitle}</h2></div><div><p>${c.opportunityDesc}</p><ol>${c.opportunitySteps.map(s=>`<li>${s}</li>`).join('')}</ol><p class="fine">${c.opportunityNote}</p><a class="text-link" href="#download">${c.download} →</a></div></section>
<section class="wrap section faq" id="faq"><h2>${c.faqTitle}</h2><div>${c.faqs.map(f=>`<details><summary>${f[0]}<span aria-hidden="true">+</span></summary><p>${f[1]}</p></details>`).join('')}</div></section>
<section class="download-section" id="download"><div class="wrap"><p class="eyebrow">YOUR NEXT TAKE STARTS HERE</p><h2>${c.finalTitle}</h2><p>${c.finalDesc}</p>${stores('footer')}<p class="fine">${c.small}</p></div></section></main>
<footer class="wrap"><a class="wordmark" href="/launch/">artlink.</a><p>${c.footer}</p><div><a href="/support/">${c.support}</a><a href="/privacy/">${c.privacy}</a><a href="/support/#terms">${c.terms}</a><a href="mailto:lcy1152@naver.com">${c.contact}</a></div><small>© 2026 ArtLink</small></footer>
<script id="scene-data" type="application/json">${data}</script>
</body></html>\n`;
}
for (const [file, lang] of [['launch/index.html','ko'],['launch/en/index.html','en'],['index.html','ko']]) {
  const dest = path.join(root,file); fs.mkdirSync(path.dirname(dest), {recursive:true}); fs.writeFileSync(dest, render(lang));
}
