import { chromium } from 'playwright';
import fs from 'node:fs';

const q = '삼성증권';
const url = `https://adstransparency.google.com/?region=KR`;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  locale: 'ko-KR',
  viewport: { width: 1366, height: 900 },
});
const page = await ctx.newPage();

const captured = [];
page.on('response', async (resp) => {
  const u = resp.url();
  if (!/adstransparency\.google\.com/i.test(u)) return;
  const ct = resp.headers()['content-type'] || '';
  if (/\.(js|css|png|jpe?g|svg|woff)/.test(u)) return;
  try {
    const b = await resp.text();
    if (!b || b.length < 50 || b.startsWith('<!')) return;
    captured.push({ url: u, len: b.length, body_head: b.slice(0, 500) });
    if (captured.length <= 8) fs.writeFileSync(`gads2_${captured.length - 1}.txt`, `URL: ${u}\nLEN: ${b.length}\n---\n${b.slice(0, 60000)}`);
  } catch {}
});

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);

// Inspect inputs
const inputs = await page.evaluate(() =>
  [...document.querySelectorAll('input, [contenteditable="true"]')].map((el) => ({
    tag: el.tagName,
    type: el.getAttribute('type'),
    placeholder: el.getAttribute('placeholder'),
    aria: el.getAttribute('aria-label'),
    role: el.getAttribute('role'),
    visible: !!(el.offsetParent || el.getClientRects().length),
  }))
);
console.log('inputs:', JSON.stringify(inputs, null, 2));

// Try the most likely input
const input = page
  .locator('input[type="text"], input[role="combobox"], input[placeholder*="검색"], input[aria-label*="검색"]')
  .first();
await input.waitFor({ timeout: 10000 });
await input.click();
await input.fill('');
await page.keyboard.type(q, { delay: 100 });
await page.waitForTimeout(3000);

console.log('\nafter typing url:', page.url());
console.log('\ncaptured responses:', captured.length);
captured.forEach((c, i) => console.log(`  [${i}] len=${c.len} ${c.url.slice(0, 140)}`));

// Press Enter to submit
await page.keyboard.press('Enter');
await page.waitForTimeout(5500);

console.log('\nafter enter url:', page.url());
console.log('captured after enter:', captured.length);
captured.slice(-5).forEach((c, i) => console.log(`  [${captured.length - 5 + i}] len=${c.len} ${c.url.slice(0, 140)}`));

console.log('\n--- visible text after enter (first 1500) ---');
console.log((await page.evaluate(() => document.body.innerText)).slice(0, 1500));

await page.screenshot({ path: 'gads2_screen.png', fullPage: true });
await browser.close();
