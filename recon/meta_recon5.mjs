// Round 5: type query → capture all <a href> in the typeahead dropdown
// (the "광고주" entries link to view_all_page_id=<numeric>). Then for each
// candidate, navigate and count active vs all KR ads.
import { chromium } from 'playwright';
import fs from 'node:fs';

const COMPETITORS = [
  '미래에셋증권',
  '삼성증권',
  '한국투자증권',
  'NH투자증권',
  'NH나무증권',
  'KB증권',
  '토스증권',
  '카카오페이증권',
  '키움증권',
];

function primedUrl(q) {
  const params = new URLSearchParams({ active_status: 'all', ad_type: 'all', country: 'KR', q, media_type: 'all' });
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
    'div[aria-label="필수 항목만 허용"]',
    'button:has-text("모든 쿠키 허용")',
    'button:has-text("Allow all cookies")',
    'button:has-text("필수 항목만 허용")',
  ]) {
    const b = page.locator(s).first();
    if (await b.count()) {
      await b.click({ timeout: 1500 }).catch(() => {});
      await page.waitForTimeout(400);
      break;
    }
  }
}

async function discover(page, q) {
  await page.goto(primedUrl(q), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await dismiss(page);
  await page.waitForTimeout(2500);

  const input = page.locator('input[type="search"]').first();
  await input.waitFor({ timeout: 12000 });
  await input.click({ delay: 50 });
  await input.fill('');
  await page.keyboard.type(q, { delay: 80 });
  await page.waitForTimeout(3500);

  return await page.evaluate(() => {
    // Collect every anchor in any visible UL/listbox area that contains "광고주"
    const ulCands = [...document.querySelectorAll('ul, [role="listbox"]')];
    const advertisers = [];
    for (const ul of ulCands) {
      const r = ul.getBoundingClientRect();
      if (r.width < 100 || r.height < 30) continue;
      const txt = ul.innerText || '';
      if (!/광고주|advertiser/i.test(txt)) continue;
      ul.querySelectorAll('a[href]').forEach((a) => {
        const m = a.href.match(/view_all_page_id=(\d+)/);
        if (m) {
          // Try to get a richer label from the anchor or its ancestor
          let label = (a.innerText || '').trim();
          let node = a;
          for (let i = 0; i < 3 && node; i++) {
            const t = (node.innerText || '').trim();
            if (t.length > label.length && t.length < 250) label = t;
            node = node.parentElement;
          }
          advertisers.push({ page_id: m[1], label: label.replace(/\s+/g, ' ').slice(0, 200) });
        }
      });
    }
    // Dedup by page_id
    const seen = new Set();
    const uniq = [];
    for (const a of advertisers) {
      if (!seen.has(a.page_id)) {
        seen.add(a.page_id);
        uniq.push(a);
      }
    }
    return uniq;
  });
}

async function countAds(page, pageId, activeOnly) {
  await page.goto(viewAllUrl(pageId, activeOnly), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3500);
  return await page.evaluate(() => {
    const text = document.body.innerText;
    const m = text.match(/결과\s*~?\s*([\d,]+)\s*개|약\s*([\d,]+)\s*개의\s*결과|~([\d,]+)\s*results?|([\d,]+)\s*results?/i);
    const total = m ? parseInt((m[1] || m[2] || m[3] || m[4]).replace(/,/g, ''), 10) : null;
    const heading = (document.querySelector('h1, h2')?.innerText || '').trim().slice(0, 100);
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
for (const q of COMPETITORS) {
  console.log(`\n=== ${q} ===`);
  const row = { query: q, advertisers: [] };
  try {
    const candidates = await discover(page, q);
    console.log(`  found ${candidates.length} advertiser candidate(s)`);
    for (const c of candidates) console.log(`    ${c.page_id}  ${c.label}`);

    // Verify the top 3 by counting ads
    for (const c of candidates.slice(0, 3)) {
      const active = await countAds(page, c.page_id, true);
      const all = await countAds(page, c.page_id, false);
      row.advertisers.push({ ...c, heading: active.heading, active_ads_kr: active.total, all_ads_kr: all.total });
      console.log(`    -> ${c.page_id}: heading="${active.heading}" active=${active.total} all=${all.total}`);
    }
  } catch (e) {
    console.log('  ERROR:', e.message);
    row.error = e.message;
  }
  out.push(row);
}

await browser.close();
fs.writeFileSync('meta_recon5_result.json', JSON.stringify(out, null, 2));
console.log('\nSaved meta_recon5_result.json');
