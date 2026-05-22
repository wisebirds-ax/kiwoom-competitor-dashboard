// Final pass for the 3 stubborn cases — drop strict "must contain 증권" filter
// and list every KR-region advertiser surfaced by every alias.
import { chromium } from 'playwright';
import fs from 'node:fs';

const HARD_CASES = [
  { name: 'NH투자증권', queries: ['NH투자증권', 'NH투자', '나무증권', 'NH나무증권', 'NH NAMUH', 'NH', '농협투자', '농협증권', '엔에이치투자', '엔에이치증권', 'nhqv'] },
  { name: 'KB증권', queries: ['KB증권', 'KB Securities', '케이비증권', 'KB세큐리티즈', 'kbsec', 'KB금융', '주식회사 케이비증권', '(주)KB증권', 'KBM Plus', 'M-able'] },
  { name: '카카오페이증권', queries: ['카카오페이증권', '카카오페이 증권', '카카오페이', '카페이증권', 'KakaoPay Securities', '카카오 페이 증권', 'kakaopaysec'] },
];

const PAGE = 'https://adstransparency.google.com/?region=KR';

async function typeAndCapture(page, q) {
  const responses = [];
  const onResp = async (resp) => {
    if (!/SearchSuggestions|SearchAdvertiserMatch/i.test(resp.url())) return;
    try {
      const t = await resp.text();
      if (t && t.startsWith('{')) responses.push(t);
    } catch {}
  };
  page.on('response', onResp);

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
for (const c of HARD_CASES) {
  console.log(`\n=== ${c.name} (no name filter, KR only) ===`);
  const merged = new Map();
  for (const q of c.queries) {
    const responses = await typeAndCapture(page, q);
    for (const r of responses) {
      for (const cand of parseSuggestions(r)) {
        if (cand.region !== 'KR') continue;
        const k = cand.advertiser_id;
        if (!merged.has(k)) merged.set(k, { ...cand, matched_via: q });
      }
    }
    console.log(`  query="${q}" → captured ${responses.length} responses`);
  }
  const list = [...merged.values()].sort((a, b) => (b.ads_max || 0) - (a.ads_max || 0));
  console.log(`\n  ${list.length} unique KR advertisers across all aliases:`);
  for (const x of list.slice(0, 25)) {
    const r = x.ads_min === x.ads_max ? `${x.ads_max}` : `${x.ads_min}-${x.ads_max}`;
    console.log(`    ${x.advertiser_id}  "${x.name}"  ads≈${r}  (via "${x.matched_via}")`);
  }
  out.push({ ...c, candidates: list });
}

await browser.close();
fs.writeFileSync('google_recon3_result.json', JSON.stringify(out, null, 2));
console.log('\nSaved google_recon3_result.json');
