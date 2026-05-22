// Round 7: intercept Ad Library typeahead network responses (search_advertisers / GraphQL),
// extract numeric Page IDs directly from the JSON payloads.
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

function extractAdvertisersFromBody(body, query) {
  // Find every page object that matches the queried name; Facebook's typeahead
  // payload typically includes "page_id":"...","name":"...","verified_status":..., etc.
  const advertisers = [];
  const seen = new Set();

  // Pattern A: {"page_id":"...", ..., "name":"..."} or similar; we'll grab page IDs near a name
  // Strategy: find every page_id and try to find a nearby name (within +-300 chars).
  const idRe = /"page_id"\s*:\s*"?(\d{6,20})"?/g;
  let m;
  while ((m = idRe.exec(body)) !== null) {
    const id = m[1];
    if (seen.has(id)) continue;
    const start = Math.max(0, m.index - 600);
    const end = Math.min(body.length, m.index + 600);
    const window = body.slice(start, end);
    const nameM = window.match(/"name"\s*:\s*"([^"]{1,80})"/);
    const verifiedM = window.match(/"verification"\s*:\s*"([^"]+)"/);
    const followersM = window.match(/"followerCount"\s*:\s*(\d+)|"follower_count"\s*:\s*(\d+)/);
    advertisers.push({
      page_id: id,
      name: nameM ? nameM[1] : null,
      verification: verifiedM ? verifiedM[1] : null,
      followers: followersM ? parseInt(followersM[1] || followersM[2], 10) : null,
    });
    seen.add(id);
  }
  // Also try Pattern B: page IDs as raw numerics adjacent to query string occurrences
  return advertisers;
}

async function discoverViaNetwork(page, q) {
  const captured = [];

  const onResponse = async (resp) => {
    const url = resp.url();
    if (!/ads\/library|graphql|search_advertisers/i.test(url)) return;
    try {
      const ct = resp.headers()['content-type'] || '';
      if (!/json|javascript|text/.test(ct)) return;
      const text = await resp.text().catch(() => '');
      if (!text || text.length < 50) return;
      // Only keep responses that mention our query string OR have multiple page_id matches
      if (text.includes(q) || (text.match(/"page_id"/g) || []).length >= 1) {
        captured.push({ url, text_len: text.length, body: text });
      }
    } catch {}
  };
  page.on('response', onResponse);

  await page.goto(primedUrl(q), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await dismiss(page);
  await page.waitForTimeout(2500);

  const input = page.locator('input[type="search"]').first();
  await input.waitFor({ timeout: 12000 });
  await input.click({ delay: 50 });
  await input.fill('');
  await page.keyboard.type(q, { delay: 100 });
  await page.waitForTimeout(4500);

  page.off('response', onResponse);

  // Pick the most relevant captured body (contains the query) and extract advertisers
  let merged = [];
  for (const r of captured) {
    merged = merged.concat(extractAdvertisersFromBody(r.body, q));
  }
  const seen = new Set();
  const out = [];
  for (const a of merged) {
    if (a.page_id && !seen.has(a.page_id)) {
      seen.add(a.page_id);
      out.push(a);
    }
  }
  return { captured_responses: captured.length, advertisers: out };
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
  const row = { query: q };
  try {
    const r = await discoverViaNetwork(page, q);
    row.captured = r.captured_responses;
    row.advertisers = r.advertisers;
    console.log(`  captured ${r.captured_responses} network bodies; ${r.advertisers.length} advertiser candidates`);
    for (const a of r.advertisers.slice(0, 5)) console.log(`    ${a.page_id}  name="${a.name}" followers=${a.followers}`);

    // Score and pick best: must contain the firm name in `name` field
    const matches = r.advertisers.filter((a) => a.name && a.name.replace(/\s/g, '').includes(q.replace(/\s/g, '')));
    matches.sort((a, b) => (b.followers || 0) - (a.followers || 0));
    row.best_match = matches[0] || null;
    if (row.best_match) {
      const pid = row.best_match.page_id;
      const active = await countAds(page, pid, true);
      const all = await countAds(page, pid, false);
      row.best_match.heading = active.heading;
      row.best_match.active_ads_kr = active.total;
      row.best_match.all_ads_kr = all.total;
      console.log(`  → BEST page_id=${pid}  heading="${active.heading}"  active=${active.total}  all=${all.total}`);
    } else {
      console.log('  → no advertiser exactly matching the firm name');
    }
  } catch (e) {
    console.log('  ERROR:', e.message);
    row.error = e.message;
  }
  out.push(row);
}

await browser.close();
fs.writeFileSync('meta_recon7_result.json', JSON.stringify(out, null, 2));
console.log('\nSaved meta_recon7_result.json');
