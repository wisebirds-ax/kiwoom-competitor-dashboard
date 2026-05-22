// Final round: intercept the GraphQL typeahead response, parse JSON, pick the
// best advertiser match (name contains firm), then count active vs all KR ads.
import { chromium } from 'playwright';
import fs from 'node:fs';

const COMPETITORS = [
  '미래에셋증권',
  '삼성증권',
  '한국투자증권',
  'NH투자증권',
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

function extractPageResults(bodyText) {
  // Meta's GraphQL may return one or more JSON documents concatenated with newlines;
  // safest to scan for `"page_results":[ ... ]` blocks and parse each as JSON array.
  const results = [];
  let i = 0;
  while ((i = bodyText.indexOf('"page_results":', i)) !== -1) {
    let p = bodyText.indexOf('[', i);
    if (p === -1) break;
    // walk forward counting brackets, respecting strings
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let j = p; j < bodyText.length; j++) {
      const ch = bodyText[j];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '[') depth++;
      else if (ch === ']') {
        depth--;
        if (depth === 0) { end = j; break; }
      }
    }
    if (end === -1) break;
    try {
      const arr = JSON.parse(bodyText.slice(p, end + 1));
      results.push(...arr);
    } catch {}
    i = end + 1;
  }
  return results;
}

async function discover(page, q) {
  const captured = [];
  const onResp = async (resp) => {
    const u = resp.url();
    if (!/graphql|ads\/library/i.test(u)) return;
    try {
      const t = await resp.text();
      if (!t || !t.includes('typeahead_suggestions')) return;
      captured.push(t);
    } catch {}
  };
  page.on('response', onResp);

  await page.goto(primedUrl(q), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await dismiss(page);
  await page.waitForTimeout(2500);

  const input = page.locator('input[type="search"]').first();
  await input.waitFor({ timeout: 12000 });
  await input.click({ delay: 50 });
  await input.fill('');
  await page.keyboard.type(q, { delay: 100 });
  await page.waitForTimeout(4500);

  page.off('response', onResp);

  const seen = new Set();
  const pages = [];
  for (const body of captured) {
    for (const r of extractPageResults(body)) {
      if (!r || !r.page_id || seen.has(r.page_id)) continue;
      seen.add(r.page_id);
      pages.push({
        page_id: r.page_id,
        name: r.name ?? null,
        page_alias: r.page_alias ?? null,
        category: r.category ?? null,
        ig_username: r.ig_username ?? null,
        ig_followers: r.ig_followers ?? null,
        ig_verification: r.ig_verification ?? null,
        entity_type: r.entity_type ?? null,
        page_is_deleted: r.page_is_deleted ?? null,
        verification: r.verification ?? null,
      });
    }
  }
  return pages;
}

function pickBest(candidates, firm) {
  const norm = (s) => (s || '').replace(/[\s.·_-]/g, '').toLowerCase();
  const target = norm(firm);
  const scored = candidates.map((c) => {
    const n = norm(c.name);
    const a = norm(c.page_alias);
    let score = 0;
    if (n === target) score += 100;
    else if (n.includes(target)) score += 50;
    else if (target.includes(n) && n.length >= 4) score += 20;
    if (a && (a.includes('securities') || a.includes('증권'))) score += 5;
    if (c.verification && c.verification.toLowerCase().includes('verified')) score += 10;
    if ((c.ig_followers || 0) > 1000) score += Math.min(20, Math.log10(c.ig_followers));
    return { ...c, _score: score };
  });
  scored.sort((a, b) => b._score - a._score);
  return scored;
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
  const row = { query: q, candidates: [], best: null };
  try {
    const cands = await discover(page, q);
    if (!cands.length) {
      console.log('  ❌ NO advertiser page surfaced — firm likely does not run Meta ads in KR');
      out.push(row);
      continue;
    }
    const ranked = pickBest(cands, q);
    row.candidates = ranked.slice(0, 5);
    console.log('  top candidates:');
    for (const c of row.candidates) console.log(`    [score=${c._score}] page_id=${c.page_id} name="${c.name}" alias=@${c.page_alias} cat=${c.category} ig_followers=${c.ig_followers}`);

    const best = ranked[0];
    const active = await countAds(page, best.page_id, true);
    const all = await countAds(page, best.page_id, false);
    row.best = { ...best, heading: active.heading, active_ads_kr: active.total, all_ads_kr: all.total };
    console.log(`  → BEST page_id=${best.page_id} heading="${active.heading}" active=${active.total}  all=${all.total}`);
  } catch (e) {
    console.log('  ERROR:', e.message);
    row.error = e.message;
  }
  out.push(row);
}

await browser.close();
fs.writeFileSync('meta_recon_final.json', JSON.stringify(out, null, 2));
console.log('\nSaved meta_recon_final.json');
