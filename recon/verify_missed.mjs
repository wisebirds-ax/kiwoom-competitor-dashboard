// Visit a missed video ad detail page manually; does the YouTube embed actually fire?
import { chromium } from 'playwright';

const cases = [
  { firm: '삼성', ar: 'AR11621934095679881217', cr: 'CR11866457329849335809' },
  { firm: '삼성', ar: 'AR11621934095679881217', cr: 'CR17043327509325676545' },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  locale: 'ko-KR',
  viewport: { width: 1280, height: 800 },
});
const page = await ctx.newPage();

for (const c of cases) {
  console.log(`\n=== ${c.firm} ${c.cr} ===`);
  const ytIds = new Set();
  let firstAt = null;
  const t0 = Date.now();
  page.on('request', (req) => {
    const u = req.url();
    const m = u.match(/youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{8,15})/);
    if (m) {
      ytIds.add(m[1]);
      if (!firstAt) firstAt = Date.now() - t0;
    }
  });
  try {
    await page.goto(`https://adstransparency.google.com/advertiser/${c.ar}/creative/${c.cr}?region=KR`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(25000); // long wait to give ample time
    const visibleText = (await page.evaluate(() => document.body.innerText.slice(0, 800))).replace(/\s+/g, ' ');
    console.log('first YouTube embed at', firstAt, 'ms; ytIds:', [...ytIds]);
    console.log('text:', visibleText.slice(0, 400));
  } catch (e) {
    console.log('ERROR:', e.message);
  }
  page.removeAllListeners('request');
}

await browser.close();
