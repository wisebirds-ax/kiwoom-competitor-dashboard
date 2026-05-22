// Probe Google Ads Transparency Center to understand URL + API structure.
import { chromium } from 'playwright';
import fs from 'node:fs';

const q = '삼성증권';
const search = `https://adstransparency.google.com/?query=${encodeURIComponent(q)}&region=KR`;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  locale: 'ko-KR',
  viewport: { width: 1366, height: 900 },
});
const page = await ctx.newPage();

let i = 0;
page.on('response', async (resp) => {
  const u = resp.url();
  if (!/adstransparency\.google\.com|googleadservices|googleapis\.com/i.test(u)) return;
  const ct = resp.headers()['content-type'] || '';
  if (!/json|javascript|text/.test(ct)) return;
  try {
    const body = await resp.text();
    if (!body || body.length < 50) return;
    if (!body.includes(q) && !/advertiser/i.test(body)) return;
    fs.writeFileSync(`gads_${i++}.txt`, `URL: ${u}\nLEN: ${body.length}\n---\n${body.slice(0, 30000)}`);
  } catch {}
});

await page.goto(search, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(7000);

await page.screenshot({ path: 'gads_screen.png', fullPage: true });
console.log('final url:', page.url());
console.log('title:', await page.title());
const txt = (await page.evaluate(() => document.body.innerText)).slice(0, 2000);
console.log('--- visible text ---');
console.log(txt);

console.log('--- anchors that look like advertiser links ---');
const anchors = await page.evaluate(() =>
  [...document.querySelectorAll('a')].map((a) => a.href).filter((h) => /advertiser/i.test(h)).slice(0, 15)
);
anchors.forEach((h) => console.log(' -', h));

await browser.close();
console.log('dumped', i, 'response files');
