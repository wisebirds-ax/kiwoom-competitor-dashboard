// Verify the null cases by visiting the view_all_page_id page directly and
// reading both the "결과 X개" text AND the count of ad cards rendered.
import { chromium } from 'playwright';
import fs from 'node:fs';

const TARGETS = [
  { name: '한국투자증권', page_id: '306222562786526' },
  { name: 'NH투자증권', page_id: '130795396974886' },
  { name: '토스증권', page_id: '103399848375983' },
  // sanity check one that worked
  { name: 'KB증권', page_id: '526540400777484' },
];

function url(pageId, activeOnly) {
  const p = new URLSearchParams({
    active_status: activeOnly ? 'active' : 'all',
    ad_type: 'all',
    country: 'KR',
    view_all_page_id: pageId,
    media_type: 'all',
  });
  return `https://www.facebook.com/ads/library/?${p.toString()}`;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  locale: 'ko-KR',
  viewport: { width: 1366, height: 900 },
});
const page = await ctx.newPage();

for (const t of TARGETS) {
  for (const active of [true, false]) {
    await page.goto(url(t.page_id, active), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);
    const res = await page.evaluate(() => {
      const text = document.body.innerText;
      const m = text.match(/결과\s*~?\s*([\d,]+)\s*개|약\s*([\d,]+)\s*개의\s*결과|~([\d,]+)\s*results?|([\d,]+)\s*results?/i);
      const count_from_text = m ? parseInt((m[1] || m[2] || m[3] || m[4]).replace(/,/g, ''), 10) : null;
      // Count ad cards by looking for distinct 'library ID' markers
      const idMatches = text.match(/라이브러리 ID:\s*\d+/g) || text.match(/Library ID:\s*\d+/g) || [];
      const heading = (document.querySelector('h1, h2')?.innerText || '').trim().slice(0, 100);
      // Check for "no results" message
      const empty = /결과 없음|No results|광고가 없습니다|운영 중인 광고가 없습니다|광고를 찾을 수 없습니다/i.test(text);
      return { count_from_text, ad_card_count: idMatches.length, heading, empty, snippet: text.slice(0, 300) };
    });
    console.log(`${t.name} active=${active}: text_count=${res.count_from_text} ad_cards=${res.ad_card_count} empty=${res.empty} heading="${res.heading}"`);
    if (res.empty) console.log(`  snippet: ${res.snippet.replace(/\s+/g, ' ').slice(0, 250)}`);
  }
  console.log();
}

await browser.close();
