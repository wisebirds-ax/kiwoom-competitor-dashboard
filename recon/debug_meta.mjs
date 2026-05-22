import { chromium } from 'playwright';
import fs from 'node:fs';

const q = '토스증권';
const url = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=KR&q=${encodeURIComponent(q)}&media_type=all`;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  locale: 'ko-KR',
  viewport: { width: 1366, height: 900 },
});
const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);

const title = await page.title();
const url_final = page.url();
const visibleText = (await page.evaluate(() => document.body.innerText)).slice(0, 2000);
const html_len = (await page.content()).length;
await page.screenshot({ path: 'debug_meta.png', fullPage: true });
fs.writeFileSync('debug_meta.html', await page.content());

console.log('title:', title);
console.log('url_final:', url_final);
console.log('html length:', html_len);
console.log('--- visible text (first 2000 chars) ---');
console.log(visibleText);

await browser.close();
