// Probe: visit several creative detail pages of different formats and
// figure out the cleanest extraction recipe.
import { chromium } from 'playwright';

const SAMPLES = [
  // VIDEO from 토스 (we already inspected this)
  { firm: '토스', ar: 'AR06938601451455250433', cr: 'CR11356716661106278401', expectFormat: 'video' },
  // mirae has mixed formats — pick one of each
  { firm: '미래에셋', ar: 'AR11442509105290280961', cr: null }, // pick from advertiser page
];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  locale: 'ko-KR',
  viewport: { width: 1280, height: 800 },
});
const page = await ctx.newPage();

async function extract(ar, cr) {
  const url = `https://adstransparency.google.com/advertiser/${ar}/creative/${cr}?region=KR`;
  // Intercept GetCreativeById which has structured fields
  const responses = [];
  const onResp = async (resp) => {
    if (!/LookupService\/GetCreativeById/.test(resp.url())) return;
    try {
      const t = await resp.text();
      if (t && t.startsWith('{')) responses.push(t);
    } catch {}
  };
  page.on('response', onResp);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(5500);
  page.off('response', onResp);

  // From DOM: collect YouTube video IDs from i.ytimg.com URLs, and "광고비 제공: X"
  const dom = await page.evaluate(() => {
    const text = document.body.innerText;
    const agencyM = text.match(/광고비 제공:\s*([^\n\r]+)/);
    const formatM = text.match(/형식:\s*([^\n\r]+)/);
    const lastShownM = text.match(/마지막 게재일:\s*([^\n\r]+)/);
    const allYtIds = new Set();
    document.querySelectorAll('img[src*="i.ytimg.com"]').forEach((i) => {
      const m = i.src.match(/i\.ytimg\.com\/vi\/([A-Za-z0-9_-]{8,15})\//);
      if (m) allYtIds.add(m[1]);
    });
    // The CURRENT ad's video should be the most prominent — usually the first big image
    const mainImg = document.querySelector('img[src*="i.ytimg.com"]');
    const mainYt = mainImg ? (mainImg.src.match(/i\.ytimg\.com\/vi\/([A-Za-z0-9_-]+)\//) || [])[1] : null;
    // Any landing-page anchors (excluded by safeframe usually)
    const iframes = [...document.querySelectorAll('iframe')].map((f) => f.src).filter((s) => s && /tpc\.googlesyndication/.test(s));
    return {
      agency: agencyM ? agencyM[1].trim() : null,
      format: formatM ? formatM[1].trim() : null,
      last_shown: lastShownM ? lastShownM[1].trim() : null,
      main_youtube_id: mainYt,
      all_youtube_ids: [...allYtIds],
      safeframe_count: iframes.length,
    };
  });
  return { url, dom, gotCreativeBody: responses[0]?.slice(0, 1200) };
}

// First, get one creative_id for 미래에셋 from the advertiser page to test image/text formats
await page.goto(`https://adstransparency.google.com/advertiser/AR11442509105290280961?region=KR`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);
const someCrIds = await page.evaluate(() =>
  [...document.querySelectorAll('a[href*="/creative/CR"]')]
    .map((a) => a.href.match(/\/creative\/(CR\d+)\?/)?.[1])
    .filter(Boolean)
    .slice(0, 6)
);
console.log('미래에셋 creative ids (sample):', someCrIds);
SAMPLES[1].cr = someCrIds[0];

for (const s of SAMPLES) {
  if (!s.cr) {
    console.log(`SKIP ${s.firm} (no cr)`);
    continue;
  }
  const r = await extract(s.ar, s.cr);
  console.log(`\n=== ${s.firm} ${s.cr} ===`);
  console.log(r.dom);
  if (r.gotCreativeBody) console.log('GetCreativeById head:', r.gotCreativeBody);
}

await browser.close();
