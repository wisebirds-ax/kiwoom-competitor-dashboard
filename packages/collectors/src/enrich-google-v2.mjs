// Google ad enricher v2
// Strategy per ad:
//   1. Visit transparency page
//   2. Wait up to MAX_YT_WAIT_MS for YouTube embed request
//   3. If YouTube found → thumbnail = https://i.ytimg.com/vi/{id}/hqdefault.jpg
//   4. If not found → screenshot .creative-container element → save JPEG → thumbnail = /thumbs/{id}.jpg
//   Skips format=1 (text) ads — no visual content.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { openDb } from '@kcd/db';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const THUMBS_DIR = path.join(ROOT, 'packages/dashboard/public/thumbs');
fs.mkdirSync(THUMBS_DIR, { recursive: true });

const CONCURRENCY = parseInt(process.env.ENRICH_CONCURRENCY ?? '4', 10);
const MAX_YT_WAIT_MS = parseInt(process.env.YT_WAIT_MS ?? '15000', 10);
const PAGE_TIMEOUT_MS = 50000;
const SCREENSHOT_WAIT_MS = parseInt(process.env.SHOT_WAIT_MS ?? '15000', 10);
const POST_EMBED_GRACE_MS = 400;

const onlyKeyArg = process.argv.find((a) => a.startsWith('--only='));
const onlyKey = onlyKeyArg ? onlyKeyArg.split('=')[1] : null;
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;
const forceArg = process.argv.includes('--force');
// --screenshot-only: skip YouTube detection, go straight to screenshot for remaining
const screenshotOnlyArg = process.argv.includes('--screenshot-only');

const db = openDb();
const where = [`channel='google'`, `json_extract(raw,'$.format') != '1'`, `json_extract(raw,'$.format') != 1`];
const params = [];
if (onlyKey) { where.push(`competitor_key=?`); params.push(onlyKey); }
if (!forceArg) where.push(`(thumbnail_url IS NULL OR thumbnail_url = '')`);

const sql = `
  SELECT id, external_id, competitor_key,
         json_extract(raw,'$.advertiser_id') AS advertiser_id,
         json_extract(raw,'$.format') AS fmt
  FROM ad
  WHERE ${where.join(' AND ')}
  ORDER BY ad_last_shown_at DESC
  ${limit ? `LIMIT ${limit}` : ''}
`;
const todo = db.prepare(sql).all(...params);
console.log(`[enrichv2] ${todo.length} ads to process (concurrency=${CONCURRENCY})`);
if (!todo.length) { db.close(); process.exit(0); }

const updateAd = db.prepare(`
  UPDATE ad SET
    thumbnail_url = COALESCE(@thumbnail_url, thumbnail_url),
    video_urls    = COALESCE(@video_urls, video_urls),
    ad_agency     = COALESCE(@ad_agency, ad_agency),
    landing_url   = COALESCE(@landing_url, landing_url)
  WHERE id = @id
`);

async function fetchYoutubeLanding(ytId) {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${ytId}&hl=ko`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    let desc = '';
    const m = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
    if (m) { try { desc = JSON.parse('"' + m[1] + '"'); } catch {} }
    const appM = desc.match(/VENDOR_GOOGLE_MARKET:([\w.]+)/);
    if (appM) return `https://play.google.com/store/apps/details?id=${appM[1]}`;
    const iosM = desc.match(/VENDOR_APPLE_STORE:([\d]+)/);
    if (iosM) return `https://apps.apple.com/app/id${iosM[1]}`;
    const urls = (desc.match(/https?:\/\/[^\s"'<>]+/g) || []).filter((u) => !/(youtube\.com|youtu\.be|google\.com|gstatic\.com|ytimg\.com)/.test(u));
    if (urls.length) return urls[0];
    return null;
  } catch { return null; }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  locale: 'ko-KR',
  viewport: { width: 1280, height: 900 },
});

async function processOne(page, item) {
  const pageUrl = `https://adstransparency.google.com/advertiser/${item.advertiser_id}/creative/${item.external_id}?region=KR`;
  let firstYtId = null;
  let resolveEmbed;
  const embedFound = new Promise((r) => (resolveEmbed = r));

  const onReq = (req) => {
    const u = req.url();
    const m = u.match(/youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{8,15})/);
    if (m && !firstYtId) { firstYtId = m[1]; resolveEmbed(); }
  };

  if (!screenshotOnlyArg) page.on('request', onReq);

  try {
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
  } catch {
    page.off('request', onReq);
    return null;
  }

  // Read agency + format text
  let agency = null;
  const metaRead = async () => {
    try {
      const t = await page.evaluate(() => document.body.innerText);
      const m1 = t.match(/광고비 제공:\s*([^\n\r]+)/);
      if (m1) agency = m1[1].trim();
    } catch {}
  };

  let thumbnail_url = null;
  let video_urls = null;
  let landing_url = null;

  if (!screenshotOnlyArg) {
    // Phase 1: wait for YouTube embed
    await Promise.race([embedFound, page.waitForTimeout(MAX_YT_WAIT_MS)]);
    page.off('request', onReq);

    if (firstYtId) {
      await page.waitForTimeout(POST_EMBED_GRACE_MS);
      await metaRead();
      thumbnail_url = `https://i.ytimg.com/vi/${firstYtId}/hqdefault.jpg`;
      video_urls = JSON.stringify([{ kind: 'youtube', id: firstYtId, embed: `https://www.youtube.com/embed/${firstYtId}` }]);
      landing_url = await fetchYoutubeLanding(firstYtId);
      return { id: item.id, thumbnail_url, video_urls, ad_agency: agency, landing_url };
    }
  } else {
    page.off('request', onReq);
    await page.waitForTimeout(SCREENSHOT_WAIT_MS);
    await metaRead();
  }

  // Phase 2: screenshot fallback (no YouTube embed found, or --screenshot-only)
  if (!firstYtId) {
    // After 45s YouTube wait the page is already rendered; just a small extra grace
    if (!screenshotOnlyArg) await page.waitForTimeout(2000);

    try {
      // Find the first .creative-container with actual ad dimensions (not hidden placeholders)
      const firstPass = await page.evaluate(() => {
        for (const el of document.querySelectorAll('.creative-container')) {
          const r = el.getBoundingClientRect();
          if (r.width >= 200 && r.width <= 800 && r.height >= 150 && r.height <= 900) {
            return { scrollY: r.top + window.scrollY - 50 };
          }
        }
        return null;
      });

      if (firstPass) {
        await page.evaluate(y => window.scrollTo(0, y), firstPass.scrollY);
        await page.waitForTimeout(400);

        // Re-read coordinates after scroll to get current viewport position
        const rect = await page.evaluate(() => {
          for (const el of document.querySelectorAll('.creative-container')) {
            const r = el.getBoundingClientRect();
            if (r.width >= 200 && r.width <= 800 && r.height >= 150 && r.height <= 900) {
              return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
            }
          }
          return null;
        });

        if (rect) {
          const screenshotPath = path.join(THUMBS_DIR, `${item.external_id}.jpg`);
          await page.screenshot({ path: screenshotPath, type: 'jpeg', quality: 80, clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h } });
          thumbnail_url = `/thumbs/${item.external_id}.jpg`;
        }
      }
    } catch { /* skip on error */ }

    if (!agency) await metaRead();
  }

  return { id: item.id, thumbnail_url, video_urls, ad_agency: agency, landing_url };
}

let done = 0;
let ytCount = 0;
let shotCount = 0;
const start = Date.now();
let lastLog = Date.now();

async function worker() {
  const page = await ctx.newPage();
  while (true) {
    const item = todo.shift();
    if (!item) break;
    try {
      const upd = await processOne(page, item);
      if (upd) {
        updateAd.run(upd);
        if (upd.video_urls) ytCount++;
        else if (upd.thumbnail_url) shotCount++;
      }
    } catch { /* swallow */ }
    done++;
    if (Date.now() - lastLog > 10000) {
      const rate = done / ((Date.now() - start) / 1000);
      const remaining = todo.length;
      const eta = remaining > 0 ? Math.round(remaining / rate / 60) + ' min' : '-';
      console.log(`[enrichv2] done=${done}  pending=${remaining}  yt=${ytCount}  shot=${shotCount}  rate=${rate.toFixed(2)}/s  ETA=${eta}`);
      lastLog = Date.now();
    }
  }
  await page.close();
}

const workers = [];
for (let i = 0; i < CONCURRENCY; i++) workers.push(worker());
await Promise.all(workers);

await browser.close();

const haveThumb = db.prepare(`SELECT COUNT(*) AS n FROM ad WHERE channel='google' AND thumbnail_url IS NOT NULL`).get();
const elapsed = Math.round((Date.now() - start) / 1000);
console.log(`\n[enrichv2] complete in ${elapsed}s`);
console.log(`[enrichv2] total thumbnails in DB: ${haveThumb.n}  (yt=${ytCount} new, screenshot=${shotCount} new this run)`);
db.close();
