import { chromium } from 'playwright';
import fs from 'node:fs';

const q = '토스증권';
const url = `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=KR&q=${encodeURIComponent(q)}&search_type=page&media_type=all`;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  locale: 'ko-KR',
  viewport: { width: 1366, height: 900 },
});
const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);
await page.screenshot({ path: 'debug_meta2.png', fullPage: true });
fs.writeFileSync('debug_meta2.html', await page.content());

console.log('url_final:', page.url());
console.log('--- visible text (first 3000 chars) ---');
console.log((await page.evaluate(() => document.body.innerText)).slice(0, 3000));

console.log('\n--- href samples containing view_all_page_id ---');
const hrefs = await page.evaluate(() =>
  [...document.querySelectorAll('a')]
    .map((a) => a.href)
    .filter((h) => /view_all_page_id|ads\/library/.test(h))
    .slice(0, 30)
);
hrefs.forEach((h) => console.log(' -', h));

console.log('\n--- all anchor inner texts (first 30) ---');
const labels = await page.evaluate(() =>
  [...document.querySelectorAll('a')].map((a) => a.innerText.trim()).filter(Boolean).slice(0, 30)
);
labels.forEach((l) => console.log(' -', l.slice(0, 100)));

await browser.close();
