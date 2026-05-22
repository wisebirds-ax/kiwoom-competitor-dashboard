// Probe Meta Ad Library public page for one competitor (KB, 28 active KR ads).
// Goal: figure out the cleanest selector path to extract per-ad data.
import { chromium } from 'playwright';
import fs from 'node:fs';

const PAGE_ID = '526540400777484'; // KB증권
const url = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=KR&view_all_page_id=${PAGE_ID}&media_type=all`;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  locale: 'ko-KR',
  viewport: { width: 1366, height: 900 },
});
const page = await ctx.newPage();

// Capture all RPC/GraphQL responses to look for structured ad data
let i = 0;
page.on('response', async (resp) => {
  const u = resp.url();
  if (!/facebook\.com\/(api\/graphql|ads\/library\/async)/i.test(u)) return;
  try {
    const t = await resp.text();
    if (!t || t.length < 100) return;
    if (!/\d{8,}/.test(t)) return; // only ones with numeric IDs
    fs.writeFileSync(`meta_scrape_${i++}.txt`, `URL: ${u}\nLEN: ${t.length}\n---\n${t.slice(0, 80000)}`);
  } catch {}
});

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);

// Dismiss cookie banner if present
for (const sel of ['div[aria-label="모든 쿠키 허용"]', 'div[aria-label="필수 항목만 허용"]', 'button:has-text("Allow all cookies")']) {
  const b = page.locator(sel).first();
  if (await b.count()) { await b.click({ timeout: 1500 }).catch(() => {}); break; }
}
await page.waitForTimeout(2000);

// Scroll to bottom 3 times to trigger lazy loading
for (let s = 0; s < 4; s++) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(2500);
}

// Inspect DOM: find all unique 'ad cards' and what they contain
const dom = await page.evaluate(() => {
  // Each ad card has "라이브러리 ID:" text
  const cards = [];
  // Find the smallest unique ancestor of every "라이브러리 ID" text node
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const idNodes = [];
  let n;
  while ((n = walker.nextNode())) {
    if (/라이브러리 ID/.test(n.textContent || '')) idNodes.push(n);
  }
  for (const t of idNodes.slice(0, 4)) {
    // Walk up to find the card container
    let el = t.parentElement;
    for (let i = 0; i < 12 && el; i++) {
      const txt = el.innerText || '';
      if (txt.includes('라이브러리 ID') && txt.includes('게재 시작') && txt.length < 3000) {
        cards.push({
          full_text: txt.replace(/\s+/g, ' ').slice(0, 1500),
          imgs: [...el.querySelectorAll('img')].map((i) => i.src).filter((s) => s && !s.startsWith('data:')).slice(0, 4),
          videos: [...el.querySelectorAll('video, source')].map((v) => v.src || v.currentSrc).filter(Boolean).slice(0, 4),
          links: [...el.querySelectorAll('a[href]')].map((a) => ({ href: a.href, text: a.innerText.trim().slice(0, 60) })).filter((a) => /^https?:/.test(a.href)).slice(0, 8),
        });
        break;
      }
      el = el.parentElement;
    }
  }
  // Count library IDs visible
  const allMatches = (document.body.innerText.match(/라이브러리 ID:\s*\d+/g) || []).length;
  return { sample_cards: cards, library_id_count: allMatches };
});

console.log('library_id_count:', dom.library_id_count);
console.log('\nfirst 4 cards inspected:\n');
for (const c of dom.sample_cards) {
  console.log('--- CARD ---');
  console.log('TEXT:', c.full_text.slice(0, 500));
  console.log('IMGS:', c.imgs);
  console.log('VIDEOS:', c.videos);
  console.log('LINKS:', c.links.slice(0, 5));
  console.log();
}

await page.screenshot({ path: 'meta_scrape_full.png', fullPage: true });
await browser.close();
console.log('saved meta_scrape_full.png and meta_scrape_<i>.txt files');
