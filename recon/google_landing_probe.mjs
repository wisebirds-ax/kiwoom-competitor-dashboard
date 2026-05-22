// Probe: where does the landing URL appear in the Google ad detail page?
// We trace network requests for googleads click trackers, and look at the
// rendered DOM (safeframe and outside) for any anchor pointing to a non-google domain.
import { chromium } from 'playwright';

const SAMPLES = [
  // KB video ad (from logs); video creative
  { firm: '미래에셋', ar: 'AR11442509105290280961', cr: 'CR15752084349568155649' },
  // toss video
  { firm: '토스', ar: 'AR06938601451455250433', cr: 'CR11356716661106278401' },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  locale: 'ko-KR',
  viewport: { width: 1280, height: 900 },
});
const page = await ctx.newPage();

for (const s of SAMPLES) {
  const trackers = new Set();
  const adurls = new Set();
  const otherUrls = new Set();
  const handler = (req) => {
    const u = req.url();
    // Look for googleads / doubleclick / click trackers
    if (/doubleclick\.net|googleads\.g|googlesyndication\.com\/(?:r\/|click|aclk)/.test(u)) {
      trackers.add(u.slice(0, 300));
      // Parse adurl param
      try {
        const url = new URL(u);
        for (const k of ['adurl', 'url', 'click_url', 'final_url', 'dest']) {
          const v = url.searchParams.get(k);
          if (v && /^https?:/.test(v)) adurls.add(v);
        }
      } catch {}
    }
    // Look for ANY external requests (not google/youtube/fbcdn)
    if (/^https?:\/\/(?!.*(?:google|youtube|gstatic|ytimg|fbcdn|facebook|googleads|googlesyndication|doubleclick))/.test(u)) {
      otherUrls.add(u.slice(0, 300));
    }
  };
  page.on('request', handler);

  await page.goto(`https://adstransparency.google.com/advertiser/${s.ar}/creative/${s.cr}?region=KR`, {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });
  await page.waitForTimeout(10000); // give safeframe extra time

  // Also try to read all anchors in nested same-origin iframes
  const anchors = await page.evaluate(() => {
    function walk(doc, out, depth = 0) {
      doc.querySelectorAll('a[href]').forEach((a) => {
        if (/^https?:/.test(a.href) && !/(?:google|youtube|gstatic|adstransparency)/.test(a.href)) {
          out.push({ depth, href: a.href, text: (a.innerText || '').trim().slice(0, 60) });
        }
      });
      doc.querySelectorAll('iframe').forEach((f) => {
        try { if (f.contentDocument) walk(f.contentDocument, out, depth + 1); } catch {}
      });
    }
    const out = [];
    walk(document, out, 0);
    return out;
  });

  page.off('request', handler);
  console.log(`\n=== ${s.firm} ${s.cr} ===`);
  console.log(`tracker calls (sample):`);
  [...trackers].slice(0, 5).forEach((u) => console.log(' -', u.slice(0, 220)));
  console.log(`\nADURL params extracted (${adurls.size}):`);
  for (const u of adurls) console.log(' →', u);
  console.log(`\nNon-google anchors (${anchors.length}):`);
  for (const a of anchors.slice(0, 8)) console.log(` d=${a.depth} ${a.text}  →  ${a.href}`);
  console.log(`\nOther external URLs (${otherUrls.size}, sample):`);
  [...otherUrls].slice(0, 8).forEach((u) => console.log(' -', u));
}

await browser.close();
