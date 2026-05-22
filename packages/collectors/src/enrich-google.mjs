// Per-ad enrichment: visit each Google ad's creative detail page,
// capture YouTube video ID, agency, last-shown text. Runs N pages in parallel.
import { chromium } from 'playwright';
import { openDb } from '@kcd/db';

const CONCURRENCY = parseInt(process.env.ENRICH_CONCURRENCY ?? '4', 10);
const PER_PAGE_TIMEOUT_MS = 35000;
const MAX_WAIT_MS = 25000; // hard cap on per-ad wait (Google can take 12s+ under load)
const POST_EMBED_GRACE_MS = 600;

const onlyKeyArg = process.argv.find((a) => a.startsWith('--only='));
const onlyKey = onlyKeyArg ? onlyKeyArg.split('=')[1] : null;
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;
const forceArg = process.argv.includes('--force');

const db = openDb();
const where = [`channel='google'`];
const params = [];
if (onlyKey) { where.push(`competitor_key=?`); params.push(onlyKey); }
// Default: enrich anything missing EITHER thumbnail OR landing URL.
// `--force` reprocesses everything regardless.
if (!forceArg) where.push(`(thumbnail_url IS NULL OR thumbnail_url = '' OR landing_url IS NULL OR landing_url = '')`);

const sql = `
  SELECT id, external_id, competitor_key,
         json_extract(raw, '$.advertiser_id') AS advertiser_id
  FROM ad
  WHERE ${where.join(' AND ')}
  ORDER BY ad_last_shown_at DESC
  ${limit ? `LIMIT ${limit}` : ''}
`;
const todo = db.prepare(sql).all(...params);
console.log(`[enrich] ${todo.length} ads to enrich`);
if (!todo.length) process.exit(0);

const updateAd = db.prepare(`
  UPDATE ad SET
    thumbnail_url = COALESCE(@thumbnail_url, thumbnail_url),
    image_urls    = COALESCE(@image_urls, image_urls),
    video_urls    = COALESCE(@video_urls, video_urls),
    ad_agency     = COALESCE(@ad_agency, ad_agency),
    copy_text     = COALESCE(@copy_text, copy_text),
    landing_url   = COALESCE(@landing_url, landing_url)
  WHERE id = @id
`);

// Fetch a YouTube watch page and try to extract the landing URL from
// description (preferred) or an Universal App Campaign package marker.
async function fetchYoutubeLanding(ytId) {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${ytId}&hl=ko`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    // 1) Try shortDescription
    let desc = '';
    const m = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
    if (m) {
      try { desc = JSON.parse('"' + m[1] + '"'); } catch {}
    }
    // 2) Universal App Campaign signature → Play Store URL
    const appM = desc.match(/VENDOR_GOOGLE_MARKET:([\w.]+)/);
    if (appM) return `https://play.google.com/store/apps/details?id=${appM[1]}`;
    // 3) iOS App marker
    const iosM = desc.match(/VENDOR_APPLE_STORE:([\d]+)/);
    if (iosM) return `https://apps.apple.com/app/id${iosM[1]}`;
    // 4) External URL in description
    const urls = (desc.match(/https?:\/\/[^\s"'<>]+/g) || []).filter((u) => !/(youtube\.com|youtu\.be|google\.com|gstatic\.com|ytimg\.com)/.test(u));
    if (urls.length) return urls[0];
    return null;
  } catch {
    return null;
  }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  locale: 'ko-KR',
  viewport: { width: 1280, height: 800 },
});

async function processOne(page, item) {
  const url = `https://adstransparency.google.com/advertiser/${item.advertiser_id}/creative/${item.external_id}?region=KR`;
  let firstYtId = null;
  let resolveEmbed;
  const embedFound = new Promise((r) => (resolveEmbed = r));

  const onReq = (req) => {
    const u = req.url();
    const m = u.match(/youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{8,15})/);
    if (m && !firstYtId) {
      firstYtId = m[1];
      resolveEmbed();
    }
  };
  page.on('request', onReq);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PER_PAGE_TIMEOUT_MS });
  } catch {
    page.off('request', onReq);
    return null;
  }
  // Race: either the YouTube embed request fires, or we hit the hard cap.
  await Promise.race([embedFound, page.waitForTimeout(MAX_WAIT_MS)]);
  if (firstYtId) await page.waitForTimeout(POST_EMBED_GRACE_MS);
  page.off('request', onReq);

  // Read agency + format text
  let metadata = null;
  try {
    metadata = await page.evaluate(() => {
      const t = document.body.innerText;
      const m1 = t.match(/광고비 제공:\s*([^\n\r]+)/);
      const m2 = t.match(/형식:\s*([^\n\r]+)/);
      return { agency: m1 ? m1[1].trim() : null, format_text: m2 ? m2[1].trim() : null };
    });
  } catch {}

  const youtube_id = firstYtId;
  const thumb = youtube_id ? `https://i.ytimg.com/vi/${youtube_id}/hqdefault.jpg` : null;
  const landing = youtube_id ? await fetchYoutubeLanding(youtube_id) : null;
  return {
    id: item.id,
    thumbnail_url: thumb,
    image_urls: null,
    video_urls: youtube_id ? JSON.stringify([{ kind: 'youtube', id: youtube_id, embed: `https://www.youtube.com/embed/${youtube_id}` }]) : null,
    ad_agency: metadata?.agency ?? null,
    copy_text: null,
    landing_url: landing,
  };
}

let done = 0;
let lastLog = Date.now();
const start = Date.now();

async function worker(pageIdx) {
  const page = await ctx.newPage();
  while (true) {
    const item = todo.shift();
    if (!item) break;
    try {
      const upd = await processOne(page, item);
      if (upd) updateAd.run(upd);
    } catch (e) {
      // swallow individual failures; we'll re-run for missing later
    }
    done++;
    if (Date.now() - lastLog > 5000) {
      const rate = done / ((Date.now() - start) / 1000);
      const remaining = todo.length;
      console.log(`[enrich] done=${done}  pending=${remaining}  rate=${rate.toFixed(2)}/s  ETA=${remaining > 0 ? Math.round(remaining / rate / 60) + ' min' : '-'}`);
      lastLog = Date.now();
    }
  }
  await page.close();
}

const workers = [];
for (let i = 0; i < CONCURRENCY; i++) workers.push(worker(i));
await Promise.all(workers);

await browser.close();

const haveThumb = db.prepare(`SELECT COUNT(*) AS n FROM ad WHERE channel='google' AND thumbnail_url IS NOT NULL`).get();
const haveAgency = db.prepare(`SELECT COUNT(*) AS n FROM ad WHERE channel='google' AND ad_agency IS NOT NULL`).get();
console.log(`\n[enrich] complete in ${Math.round((Date.now() - start) / 1000)}s`);
console.log(`[enrich] now have: thumbnail=${haveThumb.n}, agency=${haveAgency.n}`);
db.close();
