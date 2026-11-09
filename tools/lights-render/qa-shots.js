// Page QA screenshots in a private headless Chromium (doesn't touch the shared browser profile).
// usage: node qa-shots.js <page url> <out prefix> <item ids comma> <views comma>   (serve the repo first: python3 -m http.server)
// Writes phone + desktop shots: the default picks, then every listed item on, each view, warm and multi.
const { chromium } = require('/home/rzy/browser/node_modules/playwright');
const [url, prefix, runsArg, viewsArg] = process.argv.slice(2);
const runs = runsArg.split(','), views = viewsArg.split(',');
(async () => {
  const browser = await chromium.launch(); const errs = []; const out = [];
  for (const [vw, vh, tag, dpr] of [[390, 844, 'phone', 3], [1100, 1000, 'desk', 1]]) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(url + '?q=' + tag);
    await page.waitForSelector('#pic canvas.ready', { timeout: 30000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${prefix}-${tag}-default.png` }); out.push(`${prefix}-${tag}-default.png`);
    out.push(`default total (${tag}): ${await page.locator('#barTot').textContent()}`);
    for (const pal of ['warm', 'multi']) {
      const h = encodeURIComponent(JSON.stringify({ on: runs, sz: {}, r: pal }));
      await page.goto(url + '?q=' + tag + pal + '#p=' + h);
      await page.waitForSelector('#pic canvas.ready', { timeout: 30000 });
      for (const v of views) {
        await page.locator(`.views button[data-view="${v}"]`).click(); await page.waitForTimeout(1500);
        const p = `${prefix}-${tag}-${v}-${pal}.png`; await page.locator('#pic').screenshot({ path: p }); out.push(p);
      }
    }
    await ctx.close();
  }
  await browser.close();
  console.log(out.join('\n')); console.log('errors:', JSON.stringify(errs));
})();
