// Navigate to a single Google advertiser page and capture the RPC responses
// that list the ads (with creative metadata). Target: 토스증권 (smaller volume, easier to inspect).
import { chromium } from 'playwright';
import fs from 'node:fs';

const ADV_ID = 'AR06938601451455250433'; // 토스증권 주식회사
const url = `https://adstransparency.google.com/advertiser/${ADV_ID}?region=KR`;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  locale: 'ko-KR',
  viewport: { width: 1366, height: 900 },
});
const page = await ctx.newPage();

let i = 0;
const summary = [];
page.on('response', async (resp) => {
  const u = resp.url();
  if (!/adstransparency\.google\.com\/anji|adstransparency\.google\.com\/.*\/rpc/i.test(u)) return;
  try {
    const body = await resp.text();
    if (!body || body.length < 50 || body.startsWith('<!')) return;
    const fname = `gd_${i++}_${(u.match(/rpc\/(\w+\/\w+)/) || [])[1]?.replace('/', '_') || 'unknown'}.txt`;
    fs.writeFileSync(fname, `URL: ${u}\nLEN: ${body.length}\n---\n${body.slice(0, 60000)}`);
    summary.push({ idx: i - 1, url: u, len: body.length, file: fname });
  } catch {}
});

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(7000);

// Scroll to trigger lazy loading of more ads
for (let s = 0; s < 4; s++) {
  await page.evaluate(() => window.scrollBy(0, 2000));
  await page.waitForTimeout(2000);
}

await page.screenshot({ path: 'gd_screen.png', fullPage: true });
const txt = (await page.evaluate(() => document.body.innerText)).slice(0, 2000);
console.log('--- visible text (first 2000) ---');
console.log(txt);
console.log('\n--- captured RPC files ---');
summary.forEach((s) => console.log(`  [${s.idx}] ${s.file}  len=${s.len}  ${s.url}`));

await browser.close();
