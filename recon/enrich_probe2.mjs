// Smarter probe: capture ALL network requests during detail-page load.
// Look specifically for YouTube embed/video URLs that correspond to THIS creative.
import { chromium } from 'playwright';

const SAMPLES = [
  { firm: '토스', ar: 'AR06938601451455250433', cr: 'CR11356716661106278401' },
  { firm: '미래에셋', ar: 'AR11442509105290280961', cr: 'CR15752084349568155649' },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  locale: 'ko-KR',
  viewport: { width: 1280, height: 800 },
});
const page = await ctx.newPage();

for (const s of SAMPLES) {
  const urls = new Set();
  const ytIds = new Set();
  const handler = (req) => {
    const u = req.url();
    if (/youtube\.com|youtu\.be|googlevideo\.com|ytimg\.com|ytstatic\.com/i.test(u)) urls.add(u);
    const m = u.match(/(?:youtube\.com\/embed\/|youtu\.be\/|youtube\.com\/watch\?v=|youtube-nocookie\.com\/embed\/|ytimg\.com\/vi\/)([A-Za-z0-9_-]{8,15})/);
    if (m) ytIds.add(m[1]);
  };
  page.on('request', handler);

  await page.goto(`https://adstransparency.google.com/advertiser/${s.ar}/creative/${s.cr}?region=KR`, {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });
  // Wait for safeframe to fully load video
  await page.waitForTimeout(8000);
  page.off('request', handler);

  console.log(`\n=== ${s.firm} ${s.cr} ===`);
  console.log(`YouTube IDs discovered (${ytIds.size}):`, [...ytIds]);
  console.log(`YouTube/video URLs (${urls.size} samples):`);
  [...urls].slice(0, 12).forEach((u) => console.log(' -', u.slice(0, 180)));

  // Also dump all iframes nested 2 deep to look for actual src
  const allIframes = await page.evaluate(() => {
    function collect(doc, depth) {
      const out = [];
      doc.querySelectorAll('iframe').forEach((f) => {
        out.push({ depth, src: f.src });
        try {
          if (f.contentDocument) out.push(...collect(f.contentDocument, depth + 1));
        } catch {}
      });
      return out;
    }
    return collect(document, 0);
  });
  console.log('iframes (depth, src):');
  for (const f of allIframes) console.log(`  d=${f.depth}  ${f.src?.slice(0, 200) ?? '(no src)'}`);
}

await browser.close();
