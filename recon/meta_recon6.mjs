// Round 6 — pragmatic path:
// 1) Type query into Ad Library; capture handles (@xxx) from typeahead text.
// 2) Visit https://www.facebook.com/<handle> and pull numeric Page ID from rendered HTML.
// 3) For each Page ID: count active vs all KR ads via view_all_page_id.
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

async function getHandles(page, q) {
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
    const handles = [];
    const seen = new Set();
    // Look at every visible UL/LI in the typeahead area
    document.querySelectorAll('ul, [role="listbox"]').forEach((ul) => {
      const r = ul.getBoundingClientRect();
      if (r.width < 100) return;
      const txt = ul.innerText || '';
      if (!/광고주|advertiser/i.test(txt)) return;
      // Each LI corresponds to one advertiser. Extract:
      //   "<displayName> @<handle> · <N>명이 팔로우합니다 · <Category>"
      ul.querySelectorAll('li').forEach((li) => {
        const t = (li.innerText || '').replace(/\s+/g, ' ').trim();
        const m = t.match(/^(.+?)\s+@([A-Za-z0-9._-]+)\s*·/);
        if (m) {
          const [, name, handle] = m;
          if (!seen.has(handle)) {
            seen.add(handle);
            handles.push({ name: name.trim().slice(0, 80), handle, raw: t.slice(0, 200) });
          }
        }
      });
    });
    return handles;
  });
}

async function resolveHandleToPageId(page, handle) {
  // Use the Ad Library search by adding the handle as q; on the result page,
  // typeahead returns the same handle, but the typed match navigates via JS.
  // Instead, hit https://www.facebook.com/<handle>/ which redirects to the public profile.
  const url = `https://www.facebook.com/${handle}/`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    const html = await page.content();
    // Multiple patterns where Facebook reveals the page_id
    const patterns = [
      /"pageID"\s*:\s*"(\d{6,20})"/,
      /"page_id"\s*:\s*"?(\d{6,20})"?/,
      /entity_id["'\\:]+(\d{6,20})/,
      /content="fb:\/\/page\/(\d{6,20})/,
      /fb:\/\/page\/?\?id=(\d{6,20})/,
      /\/profile\.php\?id=(\d{6,20})/,
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m) return m[1];
    }
  } catch {}
  return null;
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
  const row = { query: q, candidates: [] };
  try {
    const handles = await getHandles(page, q);
    if (!handles.length) {
      console.log('  no handle in typeahead — likely no advertiser Page exists');
      out.push(row);
      continue;
    }
    console.log('  handles:');
    for (const h of handles) console.log(`    @${h.handle}  "${h.name}"  — ${h.raw}`);
    for (const h of handles.slice(0, 3)) {
      const pid = await resolveHandleToPageId(page, h.handle);
      const candidate = { ...h, page_id: pid };
      if (pid) {
        const active = await countAds(page, pid, true);
        const all = await countAds(page, pid, false);
        candidate.heading = active.heading;
        candidate.active_ads_kr = active.total;
        candidate.all_ads_kr = all.total;
        console.log(`    → page_id=${pid} heading="${active.heading}" active=${active.total} all=${all.total}`);
      } else {
        console.log(`    → @${h.handle}: could not resolve numeric Page ID`);
      }
      row.candidates.push(candidate);
    }
  } catch (e) {
    console.log('  ERROR:', e.message);
    row.error = e.message;
  }
  out.push(row);
}

await browser.close();
fs.writeFileSync('meta_recon6_result.json', JSON.stringify(out, null, 2));
console.log('\nSaved meta_recon6_result.json');
