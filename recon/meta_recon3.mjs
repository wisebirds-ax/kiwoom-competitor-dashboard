// Round 3: type into the search input and pick the "광고주" (advertiser) match
// from the dropdown autocomplete; capture redirected view_all_page_id.
import { chromium } from 'playwright';
import fs from 'node:fs';

const COMPETITORS = [
  { key: 'mirae', name_kr: '미래에셋증권' },
  { key: 'samsung', name_kr: '삼성증권' },
  { key: 'kis', name_kr: '한국투자증권' },
  { key: 'nh', name_kr: 'NH투자증권' },
  { key: 'nh_namu', name_kr: 'NH나무증권' },
  { key: 'kb', name_kr: 'KB증권' },
  { key: 'toss', name_kr: '토스증권' },
  { key: 'kakaopay', name_kr: '카카오페이증권' },
  { key: 'kiwoom', name_kr: '키움증권' }, // baseline reference (our own client)
];

const HOME = 'https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=KR&media_type=all';

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

async function searchAdvertisers(page, q) {
  await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await dismiss(page);
  await page.waitForTimeout(2000);

  // The input has placeholder "키워드 또는 광고주로 검색"
  const input = page.locator('input[placeholder*="키워드"]').first();
  await input.waitFor({ timeout: 10000 });
  await input.click();
  await input.fill('');
  await page.keyboard.type(q, { delay: 80 });
  await page.waitForTimeout(2500); // typeahead

  // Collect dropdown options: best-effort grab of role=option / listitem texts
  const options = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('[role="option"], [role="listitem"], li').forEach((el) => {
      const t = (el.innerText || '').trim();
      if (t && t.length < 200) out.push(t.replace(/\s+/g, ' '));
    });
    // dedupe while preserving order
    return [...new Set(out)];
  });

  // Click the first dropdown option that looks like an advertiser (Page).
  // The advertiser entries usually show "Page" / "광고주" label or a verified icon.
  // We'll click options matching the query text and not equal to the raw "keyword" suggestion.
  let advertiserChosen = null;
  const candidates = page.locator('[role="option"], [role="listitem"]');
  const count = await candidates.count();
  for (let i = 0; i < count; i++) {
    const t = (await candidates.nth(i).innerText().catch(() => '')) || '';
    const compact = t.replace(/\s+/g, ' ').trim();
    if (!compact) continue;
    // skip pure-keyword suggestion lines (Meta phrases them like 「토스증권에 대한 결과 보기」)
    if (/^"?.+에 대한 결과 보기|search for "/i.test(compact)) continue;
    // pick the first which contains the query and looks like a page entry
    if (compact.includes(q)) {
      await candidates.nth(i).click({ timeout: 4000 }).catch(() => {});
      advertiserChosen = compact;
      break;
    }
  }

  // Wait for navigation or url change
  await page.waitForTimeout(4500);
  const finalUrl = page.url();
  const m = finalUrl.match(/view_all_page_id=(\d+)/);
  const pageId = m ? m[1] : null;

  // Count active + all KR ads
  let active = null;
  let all = null;
  let heading = null;
  if (pageId) {
    // active count (already loaded if URL had active=all by default? we force active)
    const u1 = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=KR&view_all_page_id=${pageId}&media_type=all`;
    await page.goto(u1, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3500);
    ({ total: active, heading } = await page.evaluate(() => {
      const text = document.body.innerText;
      const heading = (document.querySelector('h1, h2')?.innerText || '').trim().slice(0, 100);
      const m1 = text.match(/결과\s*~?\s*([\d,]+)\s*개/);
      const m2 = text.match(/약\s*([\d,]+)\s*개의\s*결과/);
      const m3 = text.match(/~([\d,]+)\s*results?/i);
      const m4 = text.match(/([\d,]+)\s*results?/i);
      const m = m1 || m2 || m3 || m4;
      return { total: m ? parseInt(m[1].replace(/,/g, ''), 10) : null, heading };
    }));
    const u2 = `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=KR&view_all_page_id=${pageId}&media_type=all`;
    await page.goto(u2, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3500);
    all = await page.evaluate(() => {
      const text = document.body.innerText;
      const m1 = text.match(/결과\s*~?\s*([\d,]+)\s*개/);
      const m2 = text.match(/약\s*([\d,]+)\s*개의\s*결과/);
      const m3 = text.match(/~([\d,]+)\s*results?/i);
      const m4 = text.match(/([\d,]+)\s*results?/i);
      const m = m1 || m2 || m3 || m4;
      return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
    });
  }

  return {
    dropdown_options: options.slice(0, 12),
    chosen: advertiserChosen,
    page_id: pageId,
    page_heading: heading,
    active_ads_kr: active,
    all_ads_kr: all,
  };
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
  console.log(`\n=== ${c.name_kr} ===`);
  try {
    const r = await searchAdvertisers(page, c.name_kr);
    const row = { ...c, ...r };
    out.push(row);
    console.log(JSON.stringify(r, null, 2));
  } catch (err) {
    out.push({ ...c, error: err.message });
    console.log('ERROR:', err.message);
  }
}

await browser.close();
fs.writeFileSync('meta_recon3_result.json', JSON.stringify(out, null, 2));
console.log('\nSaved meta_recon3_result.json');
