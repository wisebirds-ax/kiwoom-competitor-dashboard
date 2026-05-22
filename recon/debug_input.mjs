import { chromium } from 'playwright';
import fs from 'node:fs';

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  locale: 'ko-KR',
  viewport: { width: 1366, height: 900 },
});
const page = await ctx.newPage();

// Try the keyword search URL (which DID render results earlier)
const url = `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=KR&q=test&media_type=all`;
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5500);

const inputs = await page.evaluate(() =>
  [...document.querySelectorAll('input, [contenteditable="true"]')].map((el) => ({
    tag: el.tagName,
    type: el.getAttribute('type'),
    placeholder: el.getAttribute('placeholder'),
    aria: el.getAttribute('aria-label'),
    role: el.getAttribute('role'),
    name: el.getAttribute('name'),
    visible: !!(el.offsetParent || el.getClientRects().length),
  }))
);
console.log('inputs:');
inputs.forEach((i, k) => console.log(k, JSON.stringify(i)));

await page.screenshot({ path: 'debug_input.png', fullPage: false });
await browser.close();
