// Google Ads Transparency Center collector.
// For each Google advertiser_id in config, opens the advertiser page,
// captures SearchCreatives RPC responses (scrolls to paginate),
// and persists every creative as an `ad` row.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import {
  openDb,
  initSchema,
  seedCompetitors,
  upsertAd,
  recordSnapshot,
  recordAdSnapshot,
  markStoppedAdsForChannel,
  generateSnapshotId,
} from '@kcd/db';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const CONFIG_PATH = path.join(ROOT, 'config/competitors.json');

const FORMAT_NAMES = { 1: 'text', 2: 'image', 3: 'video', 4: 'display', 5: 'native' };
const MAX_SCROLL_PASSES = 80; // hard cap
const STOP_AFTER_EMPTY_PASSES = 6; // stop after N consecutive scrolls with no new ads

function advertiserUrl(arId) {
  return `https://adstransparency.google.com/advertiser/${arId}?region=KR`;
}
function creativeDetailUrl(arId, crId) {
  return `https://adstransparency.google.com/advertiser/${arId}/creative/${crId}?region=KR`;
}

function parseCreatives(body) {
  let obj;
  try {
    obj = JSON.parse(body);
  } catch {
    return [];
  }
  const arr = obj?.['1'] || [];
  return arr
    .map((c) => ({
      advertiser_id: c['1'],
      creative_id: c['2'],
      format: c['4'],
      format_name: FORMAT_NAMES[c['4']] || `unknown_${c['4']}`,
      first_shown_unix: c['6']?.['1'] ? parseInt(c['6']['1'], 10) : null,
      last_shown_unix: c['7']?.['1'] ? parseInt(c['7']['1'], 10) : null,
      advertiser_name: c['12'],
      preview_url: c['3']?.['1']?.['4'] ?? null,
    }))
    .filter((c) => c.creative_id && c.advertiser_id);
}

function unixToIso(u) {
  return u ? new Date(u * 1000).toISOString() : null;
}

async function collectAdvertiser(page, arId, competitor_key) {
  const seen = new Map(); // creative_id -> creative
  const onResp = async (resp) => {
    if (!/SearchService\/SearchCreatives/.test(resp.url())) return;
    try {
      const t = await resp.text();
      const items = parseCreatives(t);
      for (const it of items) if (!seen.has(it.creative_id)) seen.set(it.creative_id, it);
    } catch {}
  };
  page.on('response', onResp);

  await page.goto(advertiserUrl(arId), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4500);

  // Scroll to bottom each pass. Stop when N consecutive scrolls add 0 new ads.
  let prev = -1;
  let emptyPasses = 0;
  for (let i = 0; i < MAX_SCROLL_PASSES; i++) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(1300);
    if (seen.size === prev) {
      emptyPasses++;
      // small "kick" — scroll up then back down to retrigger virtualized loader
      await page.evaluate(() => window.scrollBy(0, -400));
      await page.waitForTimeout(300);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(900);
      if (emptyPasses >= STOP_AFTER_EMPTY_PASSES) break;
    } else {
      emptyPasses = 0;
    }
    prev = seen.size;
  }

  page.off('response', onResp);
  return [...seen.values()];
}

const conf = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const onlyKeyArg = process.argv.find((a) => a.startsWith('--only='));
const onlyKey = onlyKeyArg ? onlyKeyArg.split('=')[1] : null;
if (onlyKey) {
  conf.competitors = conf.competitors.filter((c) => c.key === onlyKey);
  if (!conf.competitors.length) {
    console.error(`No competitor with key "${onlyKey}"`);
    process.exit(1);
  }
}
const db = openDb();
initSchema(db);
seedCompetitors(db, CONFIG_PATH);

const runAt = new Date();
const snapId = generateSnapshotId('google', runAt);
recordSnapshot(db, { id: snapId, channel: 'google', ads_total: 0, ads_active: 0, notes: 'in_progress', run_at: runAt.toISOString() });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  locale: 'ko-KR',
  viewport: { width: 1366, height: 900 },
});
const page = await ctx.newPage();

const summary = [];
for (const c of conf.competitors) {
  const competitorAdsSeen = new Set();
  let totalForCompetitor = 0;
  for (const arId of c.google?.advertiser_ids ?? []) {
    process.stdout.write(`[google] ${c.name_kr} @ ${arId} ... `);
    let creatives = [];
    try {
      creatives = await collectAdvertiser(page, arId, c.key);
    } catch (e) {
      console.log(`ERROR ${e.message}`);
      continue;
    }
    console.log(`${creatives.length} creatives`);
    for (const cr of creatives) {
      const adId = `google:${cr.creative_id}`;
      upsertAd(db, {
        id: adId,
        channel: 'google',
        external_id: cr.creative_id,
        advertiser_id: `google:${cr.advertiser_id}`,
        competitor_key: c.key,
        format: cr.format_name,
        ad_agency: null, // filled in by detail enrichment, optional
        copy_text: null,
        cta_text: null,
        landing_url: null,
        thumbnail_url: null,
        image_urls: null,
        video_urls: null,
        detail_url: creativeDetailUrl(cr.advertiser_id, cr.creative_id),
        ad_started_at: unixToIso(cr.first_shown_unix),
        ad_last_shown_at: unixToIso(cr.last_shown_unix),
        status: 'active',
        raw: JSON.stringify(cr),
      });
      recordAdSnapshot(db, snapId, adId, true);
      competitorAdsSeen.add(adId);
      totalForCompetitor++;
    }
  }
  summary.push({ competitor: c.name_kr, key: c.key, active_ads: competitorAdsSeen.size, all_advertisers_count: totalForCompetitor });
}

await browser.close();

// Mark previously-active ads not seen this run as stopped.
// Only safe when running for all competitors (a partial --only run would
// mistakenly mark every other competitor's ads as stopped).
if (!onlyKey) markStoppedAdsForChannel(db, 'google', snapId);

// Update snapshot summary
const totals = db.prepare(`SELECT COUNT(*) AS n FROM ad WHERE channel='google'`).get();
const actives = db.prepare(`SELECT COUNT(*) AS n FROM ad WHERE channel='google' AND status='active'`).get();
db.prepare(`UPDATE snapshot SET ads_total=?, ads_active=?, notes='ok' WHERE id=?`).run(totals.n, actives.n, snapId);

console.log('\n=== Google collection complete ===');
console.log(`Snapshot: ${snapId}`);
console.log(`Total ads in DB: ${totals.n}   Active: ${actives.n}`);
console.log('\nPer-competitor active ads:');
const perComp = db
  .prepare(
    `SELECT c.name_kr,
            SUM(CASE WHEN a.status='active' THEN 1 ELSE 0 END) AS active,
            COUNT(a.id) AS total
     FROM competitor c LEFT JOIN ad a ON a.competitor_key=c.key AND a.channel='google'
     GROUP BY c.key ORDER BY active DESC`
  )
  .all();
for (const r of perComp) console.log(`  ${r.name_kr.padEnd(10)}  active=${r.active}  total=${r.total}`);

db.close();
