// Meta Ad Library reconnaissance for Korean securities firms
// - Search by Korean name → discover candidate Page IDs from result links
// - For each Page ID, load view_all_page_id and count active ads in KR
import { chromium } from 'playwright';
import fs from 'node:fs';

const COMPETITORS = [
  { key: 'mirae', name_kr: '미래에셋증권', aliases: ['미래에셋'] },
  { key: 'samsung', name_kr: '삼성증권', aliases: [] },
  { key: 'kis', name_kr: '한국투자증권', aliases: ['한투'] },
  { key: 'nh', name_kr: 'NH투자증권', aliases: ['NH나무', 'NH나무증권'] },
  { key: 'kb', name_kr: 'KB증권', aliases: [] },
  { key: 'toss', name_kr: '토스증권', aliases: ['Toss Securities'] },
  { key: 'kakaopay', name_kr: '카카오페이증권', aliases: [] },
];

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function searchUrl(q) {
  const params = new URLSearchParams({
    active_status: 'active',
    ad_type: 'all',
    country: 'KR',
    q,
    media_type: 'all',
  });
  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

function pageUrl(pageId) {
  const params = new URLSearchParams({
    active_status: 'active',
    ad_type: 'all',
    country: 'KR',
    view_all_page_id: pageId,
    media_type: 'all',
  });
  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

async function dismissCookieBanner(page) {
  try {
    const sel = ['button:has-text("모든 쿠키 허용")', 'button:has-text("Allow all cookies")', 'button:has-text("Allow")', 'button:has-text("필수 항목만 허용")', 'button:has-text("Decline optional cookies")'];
    for (const s of sel) {
      const btn = page.locator(s).first();
      if (await btn.count()) {
        await btn.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(700);
        break;
      }
    }
  } catch {}
}

async function searchAndExtract(page, query) {
  await page.goto(searchUrl(query), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await dismissCookieBanner(page);
  await page.waitForTimeout(3500); // SPA hydration

  // Extract Page IDs from rendered HTML. Meta surfaces them in view_all_page_id links and in JSON props.
  const data = await page.evaluate(() => {
    const html = document.documentElement.outerHTML;
    const ids = new Set();
    // pattern 1: view_all_page_id=<id>
    for (const m of html.matchAll(/view_all_page_id=(\d{6,20})/g)) ids.add(m[1]);
    // pattern 2: "page_id":"<id>"
    for (const m of html.matchAll(/"page_id"\s*:\s*"?(\d{6,20})"?/g)) ids.add(m[1]);
    // pattern 3: \"pageID\":\"<id>\"
    for (const m of html.matchAll(/pageID["'\\:]+(\d{6,20})/g)) ids.add(m[1]);

    // pull a "X results" count if visible
    const text = document.body.innerText;
    let totalResults = null;
    const m1 = text.match(/약\s*([\d,]+)\s*개의\s*결과/);
    const m2 = text.match(/([\d,]+)\s*results?/i);
    if (m1) totalResults = parseInt(m1[1].replace(/,/g, ''), 10);
    else if (m2) totalResults = parseInt(m2[1].replace(/,/g, ''), 10);

    // pull page names that appear near the ID links (best-effort)
    const namesByLink = [];
    document.querySelectorAll('a[href*="view_all_page_id="]').forEach((a) => {
      const m = a.href.match(/view_all_page_id=(\d+)/);
      if (m) namesByLink.push({ id: m[1], text: (a.innerText || '').trim().slice(0, 80) });
    });

    return { ids: [...ids], totalResults, namesByLink };
  });

  return data;
}

async function countActiveAdsForPage(page, pageId) {
  await page.goto(pageUrl(pageId), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await dismissCookieBanner(page);
  await page.waitForTimeout(3500);
  const out = await page.evaluate(() => {
    const text = document.body.innerText;
    let total = null;
    const m1 = text.match(/약\s*([\d,]+)\s*개의\s*결과/);
    const m2 = text.match(/([\d,]+)\s*results?/i);
    if (m1) total = parseInt(m1[1].replace(/,/g, ''), 10);
    else if (m2) total = parseInt(m2[1].replace(/,/g, ''), 10);
    // Try to read the page name from heading
    const h1 = document.querySelector('h1, h2');
    const heading = h1 ? h1.innerText.trim().slice(0, 100) : null;
    return { total, heading };
  });
  return out;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent: UA,
  locale: 'ko-KR',
  viewport: { width: 1366, height: 900 },
});
const page = await ctx.newPage();

const results = [];
for (const c of COMPETITORS) {
  const row = { ...c, candidates: [], active_ads_by_page: {} };
  console.log(`\n=== ${c.name_kr} ===`);
  try {
    const s = await searchAndExtract(page, c.name_kr);
    row.search_total_results = s.totalResults;
    row.candidates = s.namesByLink.slice(0, 12);
    row.unique_ids = [...new Set(row.candidates.map((x) => x.id))];
    console.log(`  search results: ${s.totalResults}`);
    console.log(`  candidate Page IDs (top 8):`);
    for (const x of row.candidates.slice(0, 8)) console.log(`    ${x.id}  ${x.text.replace(/\s+/g, ' ')}`);

    // Validate top 3 candidates by counting active ads
    for (const id of row.unique_ids.slice(0, 3)) {
      const v = await countActiveAdsForPage(page, id);
      row.active_ads_by_page[id] = v;
      console.log(`  page ${id}: heading="${v.heading}" active_ads=${v.total}`);
    }
  } catch (err) {
    row.error = err.message;
    console.log(`  ERROR: ${err.message}`);
  }
  results.push(row);
}

await browser.close();

fs.writeFileSync('meta_recon_result.json', JSON.stringify(results, null, 2));
console.log('\nSaved meta_recon_result.json');
