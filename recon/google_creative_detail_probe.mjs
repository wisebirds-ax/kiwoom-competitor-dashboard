// Try the creative detail page within Google Ads Transparency Center
import { chromium } from 'playwright';
import fs from 'node:fs';

const AR = 'AR06938601451455250433';
const CR = 'CR11356716661106278401';
const url = `https://adstransparency.google.com/advertiser/${AR}/creative/${CR}?region=KR`;

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
  if (!/adstransparency\.google\.com\/anji|adstransparency\.google\.com\/.*\/rpc/i.test(u)) return;
  try {
    const body = await resp.text();
    if (!body || body.length < 50 || body.startsWith('<!')) return;
    const tag = (u.match(/rpc\/(\w+\/\w+)/) || [])[1]?.replace('/', '_') || 'unknown';
    fs.writeFileSync(`gdc_${i++}_${tag}.txt`, `URL: ${u}\nLEN: ${body.length}\n---\n${body.slice(0, 50000)}`);
  } catch {}
});

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(7000);

const result = await page.evaluate(() => {
  const text = document.body.innerText.slice(0, 2500);
  const imgs = [...document.querySelectorAll('img')].map((i) => i.src).filter((s) => s && !s.startsWith('data:')).slice(0, 10);
  const videos = [...document.querySelectorAll('video, source')].map((v) => v.src || v.currentSrc).filter(Boolean).slice(0, 8);
  const anchors = [...document.querySelectorAll('a[href]')].map((a) => ({ href: a.href, text: a.innerText.trim() })).filter((a) => /^https?:/.test(a.href)).slice(0, 20);
  const iframes = [...document.querySelectorAll('iframe')].map((f) => f.src).slice(0, 5);
  return { text, imgs, videos, anchors, iframes };
});

console.log('--- text ---\n' + result.text);
console.log('\n--- imgs ---');
result.imgs.forEach((s) => console.log(' -', s.slice(0, 160)));
console.log('\n--- videos ---');
result.videos.forEach((s) => console.log(' -', s.slice(0, 160)));
console.log('\n--- anchors ---');
result.anchors.forEach((a) => console.log(' -', a.text.slice(0, 60), '→', a.href.slice(0, 160)));
console.log('\n--- iframes ---');
result.iframes.forEach((s) => console.log(' -', s.slice(0, 160)));
console.log('\n--- captured rpc files ---');
const files = require('node:fs').readdirSync('.').filter((n) => n.startsWith('gdc_'));
files.forEach((f) => console.log(' -', f));

await page.screenshot({ path: 'gdc_screen.png', fullPage: true });
await browser.close();
