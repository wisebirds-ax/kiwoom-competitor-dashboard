// Probe one Meta video ad to understand how the video is rendered.
import { chromium } from 'playwright';

const PAGE_ID = '170679759615120'; // 미래에셋, has several video ads
const url = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=KR&view_all_page_id=${PAGE_ID}&media_type=all`;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  locale: 'ko-KR',
  viewport: { width: 1366, height: 1100 },
});
const page = await ctx.newPage();
const videoRequests = [];
page.on('request', (req) => {
  const u = req.url();
  if (/\.mp4|\.m4v|\.webm|\.m3u8|video|fbcdn.net\/v\/t42/.test(u)) videoRequests.push(u.slice(0, 200));
});

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
for (const sel of ['div[aria-label="모든 쿠키 허용"]', 'div[aria-label="필수 항목만 허용"]']) {
  const b = page.locator(sel).first();
  if (await b.count()) { await b.click({ timeout: 1500 }).catch(() => {}); break; }
}
await page.waitForTimeout(8000);

// Scroll
for (let i = 0; i < 4; i++) { await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(2000); }

// Find video element with surrounding context
const data = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('video').forEach((v, i) => {
    if (i >= 4) return;
    out.push({
      src: v.src,
      currentSrc: v.currentSrc,
      poster: v.poster,
      preload: v.preload,
      sources: [...v.querySelectorAll('source')].map((s) => ({ src: s.src, type: s.type })),
      // Look at parent for context (which library_id?)
      parentText: (() => {
        let p = v.parentElement;
        for (let k = 0; k < 10 && p; k++, p = p.parentElement) {
          const t = (p.innerText || '').replace(/\s+/g, ' ');
          if (/라이브러리 ID/.test(t)) return t.slice(0, 400);
        }
        return null;
      })(),
    });
  });
  return out;
});

console.log('found video tags:', data.length);
for (const v of data) {
  console.log('---');
  console.log('src:', v.src);
  console.log('currentSrc:', v.currentSrc);
  console.log('poster:', v.poster?.slice(0, 200));
  console.log('sources:', v.sources);
  console.log('parent libId:', v.parentText?.match(/라이브러리 ID:\s*(\d+)/)?.[1]);
}
console.log('\nvideo network reqs (sample):');
videoRequests.slice(0, 12).forEach((u) => console.log(' -', u));

// Also inspect: is there a play button overlay on video cards, and what does clicking it do?
const playable = await page.evaluate(() => {
  // Look for any video parent that has a "play" overlay
  const out = [];
  document.querySelectorAll('video').forEach((v) => {
    const wrapper = v.closest('div')?.closest('div');
    out.push({ wrapper_tag: wrapper?.tagName, wrapper_class: wrapper?.className.slice(0, 60), video_has_controls: v.controls });
  });
  return out;
});
console.log('\nvideo wrappers:', playable.slice(0, 3));

await browser.close();
