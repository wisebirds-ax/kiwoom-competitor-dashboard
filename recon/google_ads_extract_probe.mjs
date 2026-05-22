// Parse SearchCreatives response + render one preview to extract real creative details
import fs from 'node:fs';
import { chromium } from 'playwright';

const body = fs.readFileSync('gd_1_SearchService_SearchCreatives.txt', 'utf8').split('---\n').pop();
const obj = JSON.parse(body);
const list = obj['1'] || [];
console.log('# creatives in this page:', list.length);

const FORMAT_NAMES = { 1: 'TEXT', 2: 'IMAGE', 3: 'VIDEO', 4: 'DISPLAY', 5: 'NATIVE' };

const parsed = list.map((c) => ({
  advertiser_id: c['1'],
  creative_id: c['2'],
  format: c['4'],
  format_name: FORMAT_NAMES[c['4']] || `UNKNOWN(${c['4']})`,
  first_shown_unix: parseInt(c['6']?.['1'], 10),
  last_shown_unix: parseInt(c['7']?.['1'], 10),
  advertiser_name: c['12'],
  preview_url: c['3']?.['1']?.['4'],
}));

console.log('\n--- first 3 parsed creatives ---');
for (const p of parsed.slice(0, 3)) {
  console.log({
    ...p,
    first_shown_iso: p.first_shown_unix ? new Date(p.first_shown_unix * 1000).toISOString() : null,
    last_shown_iso: p.last_shown_unix ? new Date(p.last_shown_unix * 1000).toISOString() : null,
    preview_url_short: p.preview_url ? p.preview_url.slice(0, 130) + '...' : null,
  });
}

// Run-duration calc
console.log('\n--- run duration stats (days) ---');
const days = parsed.map((p) => (p.last_shown_unix - p.first_shown_unix) / 86400).filter(Number.isFinite);
days.sort((a, b) => a - b);
console.log('min:', days[0]?.toFixed(1), 'median:', days[Math.floor(days.length / 2)]?.toFixed(1), 'max:', days[days.length - 1]?.toFixed(1));
console.log('format mix:', parsed.reduce((m, p) => ((m[p.format_name] = (m[p.format_name] || 0) + 1), m), {}));

// Try rendering one preview to extract copy/CTA/landing URL
const sample = parsed.find((p) => p.preview_url);
if (!sample) {
  console.log('\n(no preview url to test)');
  process.exit(0);
}
console.log('\n--- rendering preview of', sample.creative_id, '---');

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
});
const page = await ctx.newPage();

const networkUrls = [];
page.on('request', (req) => {
  const u = req.url();
  if (/\.(png|jpe?g|webp|gif|mp4|webm|mov|json)(\?|$)/i.test(u) || /landing|click|track/i.test(u)) {
    networkUrls.push({ method: req.method(), url: u.slice(0, 200), type: req.resourceType() });
  }
});

await page.goto(sample.preview_url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(2000);

const result = await page.evaluate(() => {
  const txt = document.body.innerText.slice(0, 1000);
  const imgs = [...document.querySelectorAll('img')].map((i) => i.src).filter(Boolean).slice(0, 8);
  const videos = [...document.querySelectorAll('video, source')].map((v) => v.src || v.currentSrc).filter(Boolean).slice(0, 8);
  const anchors = [...document.querySelectorAll('a[href]')].map((a) => a.href).slice(0, 12);
  const iframes = [...document.querySelectorAll('iframe')].map((f) => f.src).slice(0, 5);
  return { txt, imgs, videos, anchors, iframes, body_html_len: document.body.innerHTML.length };
});

console.log('text:', result.txt.replace(/\s+/g, ' '));
console.log('imgs:', result.imgs);
console.log('videos:', result.videos);
console.log('anchors:', result.anchors);
console.log('iframes:', result.iframes);
console.log('network resource samples (first 15):');
networkUrls.slice(0, 15).forEach((n) => console.log(' -', n.method, n.type, n.url));
await page.screenshot({ path: 'gd_preview.png' });
await browser.close();
