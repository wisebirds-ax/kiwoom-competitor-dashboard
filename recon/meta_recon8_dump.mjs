// Dump raw typeahead responses for one query so we can study the JSON structure.
import { chromium } from 'playwright';
import fs from 'node:fs';

const q = '토스증권';
const url = `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=KR&q=${encodeURIComponent(q)}&media_type=all`;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  locale: 'ko-KR',
  viewport: { width: 1366, height: 900 },
});
const page = await ctx.newPage();

let idx = 0;
page.on('response', async (resp) => {
  const u = resp.url();
  if (!/ads\/library|graphql|advertisers/i.test(u)) return;
  try {
    const body = await resp.text();
    if (body.length < 100) return;
    if (!body.includes('page_id') && !body.includes(q)) return;
    fs.writeFileSync(`dump_${idx++}.txt`, `URL: ${u}\nLEN: ${body.length}\n---\n${body}`);
  } catch {}
});

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
const input = page.locator('input[type="search"]').first();
await input.waitFor({ timeout: 12000 });
await input.click();
await input.fill('');
await page.keyboard.type(q, { delay: 100 });
await page.waitForTimeout(5000);

await browser.close();
console.log('dumped', idx, 'files');
