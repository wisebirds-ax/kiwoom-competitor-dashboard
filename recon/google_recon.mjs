// Google Ads Transparency Center recon for 7 competitors + Kiwoom baseline.
// Approach: load page, type query, intercept SearchSuggestions RPC response,
// parse advertiser ID + ad-count range.
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

const PAGE = 'https://adstransparency.google.com/?region=KR';

async function query(page, q) {
  const responses = [];
  const onResp = async (resp) => {
    const u = resp.url();
    if (!/SearchSuggestions|SearchAdvertiserMatch/i.test(u)) return;
    try {
      const t = await resp.text();
      if (t && t.length > 5 && t.startsWith('{')) responses.push(t);
    } catch {}
  };
  page.on('response', onResp);

  // Clear input + type
  const input = page
    .locator('input[type="text"], input[role="combobox"], input[placeholder*="검색"], input[aria-label*="검색"]')
    .first();
  // The input only shows after page is rendered; clicking the search icon may be needed first
  // The screen has 'search' text - click body anywhere to focus and use keyboard
  await page.evaluate(() => {
    const i = document.querySelector('input');
    if (i) {
      i.value = '';
      i.dispatchEvent(new Event('input', { bubbles: true }));
      i.focus();
    }
  });
  await page.keyboard.type(q, { delay: 100 });
  await page.waitForTimeout(2500);

  page.off('response', onResp);
  return responses;
}

function parseSuggestions(jsonText) {
  let obj;
  try {
    obj = JSON.parse(jsonText);
  } catch {
    return [];
  }
  const arr = (obj && obj['1']) || [];
  const out = [];
  for (const item of arr) {
    const e = item['1'] || item;
    if (!e || typeof e !== 'object') continue;
    const name = e['1'];
    const id = e['2'];
    const region = e['3'];
    let min = null,
      max = null;
    if (e['4'] && e['4']['2']) {
      min = parseInt(e['4']['2']['1'], 10);
      max = parseInt(e['4']['2']['2'], 10);
    }
    if (id && /^AR/.test(id)) out.push({ name, advertiser_id: id, region, ads_min: min, ads_max: max });
  }
  return out;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  locale: 'ko-KR',
  viewport: { width: 1366, height: 900 },
});
const page = await ctx.newPage();
await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);

const out = [];
for (const q of COMPETITORS) {
  console.log(`\n=== ${q} ===`);
  const row = { query: q, candidates: [] };
  try {
    const responses = await query(page, q);
    let merged = [];
    for (const r of responses) merged = merged.concat(parseSuggestions(r));
    // Dedup by advertiser_id
    const seen = new Set();
    for (const c of merged) {
      if (!seen.has(c.advertiser_id)) {
        seen.add(c.advertiser_id);
        row.candidates.push(c);
      }
    }
    if (!row.candidates.length) {
      console.log('  ❌ NO Google Transparency advertiser found');
    } else {
      row.candidates.sort((a, b) => (b.ads_max || 0) - (a.ads_max || 0));
      for (const c of row.candidates) {
        const range = c.ads_min === c.ads_max ? `${c.ads_max}` : `${c.ads_min}-${c.ads_max}`;
        console.log(`  ${c.advertiser_id}  "${c.name}"  [${c.region}]  ads≈${range}`);
      }
    }
  } catch (e) {
    console.log('  ERROR:', e.message);
    row.error = e.message;
  }
  out.push(row);
}

await browser.close();
fs.writeFileSync('google_recon_result.json', JSON.stringify(out, null, 2));
console.log('\nSaved google_recon_result.json');
