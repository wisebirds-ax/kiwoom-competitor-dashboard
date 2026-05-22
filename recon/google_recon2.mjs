// Retry Google Transparency recon with multiple name variants per firm
import { chromium } from 'playwright';
import fs from 'node:fs';

const COMPETITORS = [
  { key: 'mirae', name: '미래에셋증권', aliases: ['미래에셋', 'Mirae Asset Securities'] },
  { key: 'samsung', name: '삼성증권', aliases: ['Samsung Securities'] },
  { key: 'kis', name: '한국투자증권', aliases: ['한국투자', 'Korea Investment'] },
  { key: 'nh', name: 'NH투자증권', aliases: ['NH투자', '엔에이치투자증권', '엔에이치투자', '농협투자증권', '나무증권', 'NH나무증권'] },
  { key: 'kb', name: 'KB증권', aliases: ['KB Securities', 'KB세큐리티즈', '케이비증권', '주식회사 KB증권', '(주)KB증권'] },
  { key: 'toss', name: '토스증권', aliases: ['Toss Securities', '토스'] },
  { key: 'kakaopay', name: '카카오페이증권', aliases: ['카카오페이', 'KakaoPay Securities', '카카오페이 증권'] },
  { key: 'kiwoom', name: '키움증권', aliases: ['Kiwoom'] },
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

function isSecuritiesMatch(name, firm) {
  if (!name) return false;
  const n = name.replace(/\s/g, '');
  // require both 증권 (or "Securities") AND a brand token
  const brandTokens = firm.replace(/증권/g, '').split(/[ ]+/).filter(Boolean);
  const hasSecurities = /증권|securities/i.test(n);
  const hasBrand = brandTokens.some((t) => n.toLowerCase().includes(t.toLowerCase()));
  return hasSecurities && hasBrand;
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
for (const c of COMPETITORS) {
  console.log(`\n=== ${c.name} ===`);
  const queries = [c.name, ...c.aliases];
  const merged = new Map();
  for (const q of queries) {
    const responses = await typeAndCapture(page, q);
    for (const r of responses) {
      for (const cand of parseSuggestions(r)) {
        // Only keep KR + securities-name matches
        if (cand.region !== 'KR') continue;
        if (!isSecuritiesMatch(cand.name, c.name)) continue;
        if (!merged.has(cand.advertiser_id)) merged.set(cand.advertiser_id, { ...cand, matched_via: q });
      }
    }
  }
  const list = [...merged.values()];
  list.sort((a, b) => (b.ads_max || 0) - (a.ads_max || 0));
  const totalMin = list.reduce((s, x) => s + (x.ads_min || 0), 0);
  const totalMax = list.reduce((s, x) => s + (x.ads_max || 0), 0);
  console.log(`  ${list.length} matching securities advertisers; total ads ≈ ${totalMin}-${totalMax}`);
  for (const x of list) {
    const r = x.ads_min === x.ads_max ? `${x.ads_max}` : `${x.ads_min}-${x.ads_max}`;
    console.log(`    ${x.advertiser_id}  "${x.name}"  ads≈${r}  (matched via "${x.matched_via}")`);
  }
  out.push({ ...c, candidates: list, total_min: totalMin, total_max: totalMax });
}

await browser.close();
fs.writeFileSync('google_recon2_result.json', JSON.stringify(out, null, 2));
console.log('\nSaved google_recon2_result.json');
