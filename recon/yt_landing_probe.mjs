// Probe: try to extract landing URL from YouTube watch page description.
import { chromium } from 'playwright';

// Known YouTube IDs from earlier probes
const SAMPLES = [
  { firm: '토스', id: 'Yi_09vBzFIs' },
  { firm: '미래에셋', id: 'QSu3tgZ8TJc' },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  locale: 'ko-KR',
  viewport: { width: 1280, height: 900 },
});
const page = await ctx.newPage();

for (const s of SAMPLES) {
  console.log(`\n=== ${s.firm} youtube/${s.id} ===`);
  try {
    await page.goto(`https://www.youtube.com/watch?v=${s.id}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4500);
    const result = await page.evaluate(() => {
      // Look for description, title, links
      const title = document.title;
      const ogDesc = document.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';
      // Try the description JSON in ytInitialPlayerResponse
      let descFromInitial = '';
      let links = [];
      let isUnlisted = false;
      const html = document.documentElement.outerHTML;
      const m = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
      if (m) descFromInitial = JSON.parse('"' + m[1] + '"');
      const m2 = html.match(/"isUnlisted":(true|false)/);
      if (m2) isUnlisted = m2[1] === 'true';
      // Pull external links (non-google/yt) from description html
      const linkRe = /https?:\/\/[^"\s<>]+/g;
      const allUrls = new Set();
      [ogDesc, descFromInitial].forEach((t) => {
        const matches = t.match(linkRe) || [];
        for (const u of matches) if (!/(youtube\.com|youtu\.be|googl\.|google\.|gstatic|ytimg)/.test(u)) allUrls.add(u);
      });
      return { title, ogDesc, descFromInitial: descFromInitial.slice(0, 400), externalLinks: [...allUrls], isUnlisted };
    });
    console.log('title:', result.title);
    console.log('isUnlisted:', result.isUnlisted);
    console.log('og:description:', result.ogDesc.slice(0, 200));
    console.log('shortDescription (first 400):', result.descFromInitial);
    console.log('external links found:', result.externalLinks);
  } catch (e) {
    console.log('ERROR:', e.message);
  }
}

await browser.close();
