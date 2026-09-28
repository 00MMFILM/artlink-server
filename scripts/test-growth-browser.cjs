// Run against preview-growth.cjs. Requires Playwright and a local Chrome install.
// No AI provider, production database or store submission is used.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4178';
const screenshots = process.env.SCREENSHOT_DIR;
(async () => {
  const browser = await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu']});
  let cases = 0;
  try {
    for(const lang of ['ko','en']) {
      const context = await browser.newContext({reducedMotion:'reduce'});
      const page = await context.newPage();
      const errors = [], external = [];
      page.on('pageerror', e=>errors.push(e.message));
      page.on('request', r=>{if(!r.url().startsWith(base))external.push(r.url());});
      const route = '/launch/' + (lang === 'en' ? 'en/' : '');
      await page.goto(base + route + '?s=instagram_bio');
      assert.equal(await page.locator('html').getAttribute('lang'),lang);
      assert.equal(await page.locator('h1').count(),1);
      assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'),'https://art-link.kr'+route);
      for(const width of [320,390,768,1440]) {
        await page.setViewportSize({width,height:900});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true,`${lang} at ${width}: no horizontal overflow`);
        cases++;
      }
      await page.setViewportSize({width:390,height:844});
      await page.locator('.hero a[href="#try"]').click();
      await page.locator('#next-line').click();
      assert.match(await page.locator('#line-output').textContent(),lang==='ko'?/내 차례/:/Your turn/);
      await page.locator('#next-line').click();
      assert.match(await page.locator('#line-output').textContent(),lang==='ko'?/네 컵/:/Your cup/);
      for(let i=0;i<4;i++) await page.locator('#next-line').click();
      assert.equal(await page.locator('#reflection').isVisible(),true);
      await page.locator('input[name="focus"]').nth(1).check();
      const focus = await page.locator('input[name="focus"]:checked').inputValue();
      const handoff = new URL(await page.locator('#practice-link').getAttribute('href'),base);
      assert.equal(handoff.pathname,'/practice');
      assert.equal(handoff.searchParams.get('source'),'landing');
      assert.equal(handoff.searchParams.get('field'),'acting');
      assert.ok(handoff.searchParams.get('content').includes(focus));
      assert.ok(handoff.searchParams.get('content').includes(lang==='ko'?'내 역할: A':'My role: A'));
      const bridge = await context.request.get(handoff.href);
      assert.equal(bridge.status(),200); assert.match(await bridge.text(),/id="practice-data"/);
      cases++;
      if(screenshots) {
        fs.mkdirSync(screenshots,{recursive:true});
        await page.locator('.demo-card').screenshot({path:path.join(screenshots,`demo-result-${lang}.png`)});
      }
      await page.locator('#restart').click();
      assert.equal(await page.locator('#reflection').isVisible(),false);
      assert.match(await page.locator('#line-output').textContent(),/1 \/ 4/);
      cases++;
      for(const platform of ['ios','android']) {
        const href = await page.locator(`[data-store="${platform}"]`).getAttribute('href');
        const url = new URL(href,base);
        assert.equal(url.searchParams.get('s'),'instagram_bio_footer');
        const res = await context.request.get(url.href,{maxRedirects:0});
        assert.equal(res.status(),302);
        assert.equal(new URL(res.headers().location).hostname,platform==='ios'?'apps.apple.com':'play.google.com');
        cases++;
      }
      const switchLink = await page.locator('[data-language-link]').first().getAttribute('href');
      assert.equal(new URL(switchLink,base).searchParams.get('s'),'instagram_bio');
      await page.locator('details summary').first().click();
      assert.equal(await page.locator('details').first().getAttribute('open'),'');
      for(const dest of ['/support/','/privacy/','/support/#terms','/sitemap.xml','/robots.txt']) assert.equal((await context.request.get(base+dest)).status(),200);
      assert.deepEqual(errors,[]); assert.deepEqual(external,[],'demo must not upload or contact external services');
      cases++;
      if(screenshots) {
        // Fresh pages avoid compositor artifacts after repeated viewport changes.
        for(const [label,width,height] of [['mobile',390,844],['desktop',1440,1000]]) {
          const capture = await browser.newPage({viewport:{width,height}});
          await capture.goto(base+route);
          await capture.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          await capture.screenshot({path:path.join(screenshots,`site-${label}-${lang}.png`),fullPage:true});
          await capture.close();
        }
      }
      await page.goto(base+route+'?s='+encodeURIComponent('private@email.example'));
      assert.equal(new URL(await page.locator('[data-store="ios"]').getAttribute('href'),base).searchParams.get('s'),`landing_${lang}_footer`);
      await context.close();
    }
    const noJS = await browser.newContext({javaScriptEnabled:false});
    const page = await noJS.newPage();await page.goto(base+'/launch/');
    assert.equal(await page.locator('#next-line').isVisible(),false);
    assert.equal(await page.locator('noscript').isVisible(),true);
    assert.ok(await page.locator('[data-store="ios"]').getAttribute('href'));
    await noJS.close();cases++;
    console.log(`PASS: ${cases} browser scenarios — KO/EN, 4 widths, rehearsal/reflection/replay, deep-link content, store redirects, campaign safety, legal links, no-JS, no external requests.`);
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
