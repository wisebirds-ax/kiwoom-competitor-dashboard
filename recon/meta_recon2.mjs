// Round 2: Use advertiser (page) search and parse rendered DOM properly.
import { chromium } from 'playwright';
import fs from 'node:fs';

const COMPETITORS = [
  { key: 'mirae', name_kr: '미래에셋증권' },
  { key: 'samsung', name_kr: '삼성증권' },
  { key: 'kis', name_kr: '한국투자증권' },
  { key: 'nh', name_kr: 'NH투자증권' },
  { key: 'kb', name_kr: 'KB증권' },
  { key: 'toss', name_kr: '토스증권' },
  { key: 'kakaopay', name_kr: '카카오페이증권' },
];

function pageSearchUrl(q) {
  const params = new URLSearchParams({
    active_status: 'all',
    ad_type: 'all',
    country: 'KR',
    q,
    search_type: 'page',
    media_type: 'all',
  });
  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

function viewAllUrl(pageId, activeOnly) {
  const params = new URLSearchParams({
    active_status: activeOnly ? 'active' : 'all',
    ad_type: 'all',
    country: 'KR',
    view_all_page_id: pageId,
    media_type: 'all',
  });
  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

async function dismiss(page) {
  for (const s of [
    'div[aria-label="모든 쿠키 허용"]',
    'button:has-text("모든 쿠키 허용")',
    'button:has-text("Allow all cookies")',
    'button:has-text("필수 항목만 허용")',
    'div[aria-label="필수 항목만 허용"]',
  ]) {
    const b = page.locator(s).first();
    if (await b.count()) {
      await b.click({ timeout: 1500 }).catch(() => {});
      await page.waitForTimeout(600);
      break;
    }
  }
}

async function searchAdvertisers(page, q) {
  await page.goto(pageSearchUrl(q), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await dismiss(page);
  await page.waitForTimeout(5000);
  // Scroll to force-load lazy content
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(1500);

  return await page.evaluate(() => {
    const html = document.documentElement.outerHTML;
    const ids = new Set();
    for (const m of html.matchAll(/view_all_page_id=(\d{6,20})/g)) ids.add(m[1]);
    for (const m of html.matchAll(/"page_id"\s*:\s*"?(\d{6,20})"?/g)) ids.add(m[1]);

    // Try to read advertiser cards by their link href
    const cards = [];
    document.querySelectorAll('a[href*="view_all_page_id="]').forEach((a) => {
      const m = a.href.match(/view_all_page_id=(\d+)/);
      if (!m) return;
      // get nearest enclosing element text as label
      let el = a;
      let label = '';
      for (let i = 0; i < 4 && el; i++) {
        const t = (el.innerText || '').trim();
        if (t.length > label.length) label = t;
        el = el.parentElement;
      }
      cards.push({ id: m[1], label: label.replace(/\s+/g, ' ').slice(0, 140) });
    });

    return { ids: [...ids], cards };
  });
}

async function countAds(page, pageId, activeOnly) {
  await page.goto(viewAllUrl(pageId, activeOnly), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await dismiss(page);
  await page.waitForTimeout(4500);
  return await page.evaluate(() => {
    const text = document.body.innerText;
    const heading = (document.querySelector('h1, h2')?.innerText || '').trim().slice(0, 100);
    let total = null;
    const m1 = text.match(/결과\s*~?\s*([\d,]+)\s*개/);
    const m2 = text.match(/약\s*([\d,]+)\s*개의\s*결과/);
    const m3 = text.match(/~([\d,]+)\s*results?/i);
    const m4 = text.match(/([\d,]+)\s*results?/i);
    const m = m1 || m2 || m3 || m4;
    if (m) total = parseInt(m[1].replace(/,/g, ''), 10);
    return { total, heading };
  });
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  locale: 'ko-KR',
  viewport: { width: 1366, height: 900 },
});
const page = await ctx.newPage();

const out = [];
for (const c of COMPETITORS) {
  console.log(`\n=== ${c.name_kr} (advertiser search) ===`);
  const row = { ...c, candidates: [] };
  try {
    const s = await searchAdvertisers(page, c.name_kr);
    const top = [];
    const seen = new Set();
    for (const card of s.cards) {
      if (seen.has(card.id)) continue;
      seen.add(card.id);
      top.push(card);
      if (top.length >= 6) break;
    }
    row.candidates = top;
    console.log(`  unique advertiser IDs: ${top.length}`);
    for (const card of top) console.log(`    ${card.id}  ${card.label}`);

    // Validate top 3 candidates
    for (const card of top.slice(0, 3)) {
      const active = await countAds(page, card.id, true);
      const all = await countAds(page, card.id, false);
      card.active_ads_kr = active.total;
      card.all_ads_kr = all.total;
      card.heading = active.heading || all.heading;
      console.log(`    -> id=${card.id} heading="${card.heading}" active=${active.total} all=${all.total}`);
    }
  } catch (err) {
    row.error = err.message;
    console.log(`  ERROR: ${err.message}`);
  }
  out.push(row);
}

await browser.close();
fs.writeFileSync('meta_recon2_result.json', JSON.stringify(out, null, 2));
console.log('\nSaved meta_recon2_result.json');
