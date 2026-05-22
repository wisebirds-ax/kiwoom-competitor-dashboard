// Probe: walk up to find a "card" element that contains BOTH the libId AND a video.
import { chromium } from 'playwright';

const PAGE_ID = '170679759615120'; // 미래에셋
const url = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=KR&view_all_page_id=${PAGE_ID}&media_type=all`;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  locale: 'ko-KR',
  viewport: { width: 1366, height: 1100 },
});
const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded' });
for (const sel of ['div[aria-label="모든 쿠키 허용"]', 'div[aria-label="필수 항목만 허용"]']) {
  const b = page.locator(sel).first();
  if (await b.count()) { await b.click({ timeout: 1500 }).catch(() => {}); break; }
}
await page.waitForTimeout(8000);
for (let i = 0; i < 4; i++) { await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(2000); }

// Approach: for each video, walk up until find ancestor containing "라이브러리 ID:" text
const result = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('video').forEach((v) => {
    let el = v;
    for (let i = 0; i < 30 && el; i++, el = el.parentElement) {
      const t = el.innerText || '';
      const m = t.match(/라이브러리 ID:\s*(\d+)/);
      if (m) {
        out.push({ libId: m[1], steps_up: i, videoSrc: v.src.slice(0, 100), poster: v.poster?.slice(0, 100) });
        break;
      }
    }
  });
  // Also: do cards (the libId containers in our scraper) overlap with video elements by bounding box?
  const cards = [];
  document.querySelectorAll('div').forEach((el) => {
    const t = el.innerText || '';
    if (!/라이브러리 ID:/.test(t)) return;
    if (t.split('라이브러리 ID:').length - 1 !== 1) return;
    if (t.length < 80 || t.length > 4000) return;
    const m = t.match(/라이브러리 ID:\s*(\d+)/);
    if (!m) return;
    const r = el.getBoundingClientRect();
    cards.push({ libId: m[1], left: r.left, top: r.top, width: r.width, height: r.height, area: r.width * r.height });
  });
  // dedup, prefer largest area per libId
  const map = new Map();
  for (const c of cards) {
    const p = map.get(c.libId);
    if (!p || c.area > p.area) map.set(c.libId, c);
  }
  const videoBoxes = [];
  document.querySelectorAll('video').forEach((v) => {
    const r = v.getBoundingClientRect();
    videoBoxes.push({ left: r.left, top: r.top, width: r.width, height: r.height, src: v.src.slice(0, 80), poster: v.poster?.slice(0, 80) });
  });
  return { videoMatches: out, cards: [...map.values()].slice(0, 5), videoBoxes: videoBoxes.slice(0, 5) };
});

console.log('video → libId matches (via DOM ancestor walk):');
for (const m of result.videoMatches) console.log(' ', m);
console.log('\ntop 5 cards (libId, position):');
for (const c of result.cards) console.log(' ', c);
console.log('\ntop 5 videos (position):');
for (const v of result.videoBoxes) console.log(' ', v);

await browser.close();
