// Round 4: load a "primed" URL (q=) to make the search input visible,
// re-type the query to trigger the typeahead, capture dropdown DOM and
// any advertiser (Page) links revealed.
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
  '키움증권', // baseline reference (our client)
];

function primedUrl(q) {
  const params = new URLSearchParams({
    active_status: 'all',
    ad_type: 'all',
    country: 'KR',
    q,
    media_type: 'all',
    sort_data: '', // remove total_impressions sort
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

async function searchOne(page, q) {
  await page.goto(primedUrl(q), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await dismiss(page);
  await page.waitForTimeout(3000);

  const input = page.locator('input[type="search"]').first();
  await input.waitFor({ timeout: 15000 });
  await input.click({ delay: 80 });
  await input.fill('');
  await page.keyboard.type(q, { delay: 100 });
  await page.waitForTimeout(3500); // wait for typeahead

  // Inspect potential dropdown containers (Meta uses role=listbox or fixed-position popovers)
  const dropdown = await page.evaluate(() => {
    const visibles = [];
    document
      .querySelectorAll('div[role="listbox"], ul[role="listbox"], div[role="menu"], [aria-expanded="true"] + *, [aria-haspopup]')
      .forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 100 && r.height > 30) {
          visibles.push({ tag: el.tagName, text: el.innerText.slice(0, 600), html_snippet: el.innerHTML.slice(0, 800) });
        }
      });
    // Also grab any div containing the typed query that looks like a suggestion entry
    const queryTxt = (document.querySelector('input[type="search"]')?.value || '').trim();
    const matched = [];
    document.querySelectorAll('div,li,span').forEach((el) => {
      const t = el.innerText || '';
      if (queryTxt && t.length < 200 && t.includes(queryTxt) && /광고주|Page|페이지/.test(t)) {
        matched.push(t.trim().replace(/\s+/g, ' '));
      }
    });
    return { visibles, matched: [...new Set(matched)].slice(0, 12) };
  });

  // Capture the result count for the keyword search (already showing in main panel below the input)
  const resultsInfo = await page.evaluate(() => {
    const text = document.body.innerText;
    const m = text.match(/결과\s*~?\s*([\d,]+)\s*개|약\s*([\d,]+)\s*개의\s*결과|~([\d,]+)\s*results?|([\d,]+)\s*results?/i);
    const count = m ? parseInt((m[1] || m[2] || m[3] || m[4]).replace(/,/g, ''), 10) : null;
    // sample first 3 visible advertiser names from result cards (in the main feed, advertiser appears as <a> with role)
    const advertiserNames = [];
    document.querySelectorAll('a').forEach((a) => {
      const t = (a.innerText || '').trim();
      if (t && t.length < 60 && /^[A-Za-z가-힣0-9 ._-]+$/.test(t)) advertiserNames.push(t);
    });
    return { count, advertiserNames: [...new Set(advertiserNames)].slice(0, 20) };
  });

  return { dropdown, resultsInfo };
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
  try {
    const r = await searchOne(page, q);
    out.push({ query: q, ...r });
    console.log(`  keyword search results: ${r.resultsInfo.count}`);
    console.log(`  advertiser names in main feed (top 12):`);
    r.resultsInfo.advertiserNames.slice(0, 12).forEach((n) => console.log(`    ${n}`));
    console.log(`  typeahead dropdown candidates: ${r.dropdown.matched.length}`);
    r.dropdown.matched.forEach((m) => console.log(`    ${m}`));
    if (r.dropdown.visibles.length) {
      console.log(`  raw dropdown text (truncated):`);
      r.dropdown.visibles.forEach((v) => console.log(`    [${v.tag}] ${v.text.slice(0, 200).replace(/\s+/g, ' ')}`));
    }
  } catch (e) {
    console.log('  ERROR:', e.message);
    out.push({ query: q, error: e.message });
  }
}

await browser.close();
fs.writeFileSync('meta_recon4_result.json', JSON.stringify(out, null, 2));
console.log('\nSaved meta_recon4_result.json');
