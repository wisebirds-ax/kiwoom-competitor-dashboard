// Probe2: pull the full rendered HTML, look for JSON-encoded ad data inline
import { chromium } from 'playwright';
import fs from 'node:fs';

const PAGE_ID = '526540400777484'; // KB
const url = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=KR&view_all_page_id=${PAGE_ID}&media_type=all`;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  locale: 'ko-KR',
  viewport: { width: 1366, height: 1200 },
});
const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(7000);

for (const sel of ['div[aria-label="모든 쿠키 허용"]', 'div[aria-label="필수 항목만 허용"]']) {
  const b = page.locator(sel).first();
  if (await b.count()) { await b.click({ timeout: 1500 }).catch(() => {}); break; }
}
await page.waitForTimeout(2000);

// Aggressive scroll
for (let s = 0; s < 5; s++) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(2200);
}

const html = await page.content();
fs.writeFileSync('meta_kb_full.html', html);
console.log('html len:', html.length);

// Walk up more aggressively from each "라이브러리 ID" to find a real card container
const cards = await page.evaluate(() => {
  // Find every element whose innerText starts with "라이브러리 ID"-like pattern
  const result = [];
  // Strategy: any node whose innerText contains exactly one "라이브러리 ID" mention is a card
  document.querySelectorAll('div').forEach((el) => {
    const t = el.innerText || '';
    const idMatches = t.match(/라이브러리 ID:\s*(\d+)/g);
    if (!idMatches || idMatches.length !== 1) return;
    if (t.length < 80 || t.length > 3000) return;
    if (!/게재 시작/.test(t)) return;
    result.push({
      lib_id: t.match(/라이브러리 ID:\s*(\d+)/)?.[1],
      start_text: t.match(/(\d{4}\. \d+\. \d+\.에 게재 시작함)/)?.[1],
      txt: t.replace(/\s+/g, ' ').slice(0, 1200),
      box_width: el.offsetWidth,
      box_height: el.offsetHeight,
      imgs: [...el.querySelectorAll('img')].map((i) => i.src).filter((s) => s && !s.startsWith('data:')).slice(0, 6),
      videos: [...el.querySelectorAll('video, source')].map((v) => v.src || v.currentSrc).filter(Boolean).slice(0, 4),
      iframes: [...el.querySelectorAll('iframe')].map((f) => f.src).slice(0, 3),
      links: [...el.querySelectorAll('a[href]')].map((a) => ({ href: a.href, text: a.innerText.trim().slice(0, 60) })).filter((a) => /^https?:/.test(a.href) && !/facebook\.com\/help|facebook\.com\/policies/.test(a.href)).slice(0, 8),
    });
  });
  // dedup by lib_id, prefer the LARGEST box (most ancestral = card)
  const map = new Map();
  for (const r of result) {
    const prev = map.get(r.lib_id);
    if (!prev || (r.box_width * r.box_height) > (prev.box_width * prev.box_height)) {
      map.set(r.lib_id, r);
    }
  }
  return [...map.values()];
});

console.log(`\nfound ${cards.length} unique cards`);
for (const c of cards.slice(0, 3)) {
  console.log('\n--- CARD', c.lib_id, '---');
  console.log('start:', c.start_text);
  console.log('size:', c.box_width, 'x', c.box_height);
  console.log('imgs:', c.imgs.length, c.imgs.slice(0, 3));
  console.log('videos:', c.videos);
  console.log('iframes:', c.iframes);
  console.log('links:', c.links);
  console.log('TEXT:', c.txt.slice(0, 600));
}

await browser.close();
