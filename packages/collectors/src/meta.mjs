// Meta Ad Library API collector.
// Requires env var META_ACCESS_TOKEN (Marketing API, scope ads_read).
// Per Page ID, fetches all active KR ads via /ads_archive, persists them.
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

const TOKEN = process.env.META_ACCESS_TOKEN;
if (!TOKEN) {
  console.error('Missing META_ACCESS_TOKEN env var.');
  console.error('Get one from https://developers.facebook.com → App → Marketing API → Tools (scope: ads_read)');
  process.exit(1);
}

const GRAPH = 'https://graph.facebook.com/v23.0/ads_archive';
const FIELDS = [
  'id',
  'page_id',
  'page_name',
  'ad_creation_time',
  'ad_delivery_start_time',
  'ad_delivery_stop_time',
  'ad_creative_bodies',
  'ad_creative_link_captions',
  'ad_creative_link_titles',
  'ad_creative_link_descriptions',
  'ad_snapshot_url',
  'publisher_platforms',
  'languages',
  'currency',
  'ad_active_status',
  'eu_total_reach',
].join(',');

function detailUrl(libraryId) {
  return `https://www.facebook.com/ads/library/?id=${libraryId}`;
}

function inferFormatFromUrl(snapshotUrl) {
  if (!snapshotUrl) return null;
  // Snapshot URLs often contain hints; we'll fall back to 'display' if unknown
  if (/video|movie|reel/i.test(snapshotUrl)) return 'video';
  return 'display'; // unknown image/video — display covers static creatives in Meta
}

async function fetchPageAds(pageId) {
  const ads = [];
  let nextUrl = `${GRAPH}?search_page_ids=${encodeURIComponent(pageId)}&ad_reached_countries=["KR"]&ad_active_status=ACTIVE&ad_type=ALL&limit=100&fields=${FIELDS}&access_token=${TOKEN}`;
  while (nextUrl) {
    const res = await fetch(nextUrl);
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Meta API ${res.status}: ${err.slice(0, 400)}`);
    }
    const json = await res.json();
    for (const ad of json.data ?? []) ads.push(ad);
    nextUrl = json.paging?.next ?? null;
  }
  return ads;
}

const conf = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const onlyKeyArg = process.argv.find((a) => a.startsWith('--only='));
const onlyKey = onlyKeyArg ? onlyKeyArg.split('=')[1] : null;
if (onlyKey) conf.competitors = conf.competitors.filter((c) => c.key === onlyKey);

const db = openDb();
initSchema(db);
seedCompetitors(db, CONFIG_PATH);

const runAt = new Date();
const snapId = generateSnapshotId('meta', runAt);
recordSnapshot(db, { id: snapId, channel: 'meta', ads_total: 0, ads_active: 0, notes: 'in_progress', run_at: runAt.toISOString() });

for (const c of conf.competitors) {
  if (!c.meta?.page_id) continue;
  process.stdout.write(`[meta] ${c.name_kr} (page ${c.meta.page_id}) ... `);
  let ads = [];
  try {
    ads = await fetchPageAds(c.meta.page_id);
  } catch (e) {
    console.log(`ERROR ${e.message}`);
    continue;
  }
  console.log(`${ads.length} ads`);
  for (const m of ads) {
    const adId = `meta:${m.id}`;
    const copyBody = m.ad_creative_bodies?.[0] ?? null;
    const linkTitle = m.ad_creative_link_titles?.[0] ?? null;
    const linkDesc = m.ad_creative_link_descriptions?.[0] ?? null;
    const cta = m.ad_creative_link_captions?.[0] ?? null;
    upsertAd(db, {
      id: adId,
      channel: 'meta',
      external_id: m.id,
      advertiser_id: `meta:${c.meta.page_id}`,
      competitor_key: c.key,
      format: inferFormatFromUrl(m.ad_snapshot_url),
      ad_agency: null,
      copy_text: [copyBody, linkTitle, linkDesc].filter(Boolean).join(' · ') || null,
      cta_text: cta,
      landing_url: null, // Meta hides target URL behind redirect in ad_snapshot_url; resolving is expensive — phase 2
      thumbnail_url: null,
      image_urls: null,
      video_urls: null,
      detail_url: m.ad_snapshot_url || detailUrl(m.id),
      ad_started_at: m.ad_delivery_start_time ?? null,
      ad_last_shown_at: m.ad_delivery_stop_time ?? null,
      status: m.ad_active_status === 'ACTIVE' ? 'active' : 'stopped',
      raw: JSON.stringify(m),
    });
    recordAdSnapshot(db, snapId, adId, m.ad_active_status === 'ACTIVE');
  }
}

if (!onlyKey) markStoppedAdsForChannel(db, 'meta', snapId);

const totals = db.prepare(`SELECT COUNT(*) AS n FROM ad WHERE channel='meta'`).get();
const actives = db.prepare(`SELECT COUNT(*) AS n FROM ad WHERE channel='meta' AND status='active'`).get();
db.prepare(`UPDATE snapshot SET ads_total=?, ads_active=?, notes='ok' WHERE id=?`).run(totals.n, actives.n, snapId);

console.log('\n=== Meta collection complete ===');
console.log(`Snapshot: ${snapId}`);
console.log(`Total ads: ${totals.n}   Active: ${actives.n}`);
db.close();
