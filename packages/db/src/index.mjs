import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = path.resolve(__dirname, '../../../data/dashboard.sqlite');

export function openDb(dbPath = DEFAULT_DB_PATH) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export function initSchema(db) {
  const schemaPath = path.resolve(__dirname, '../schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(sql);
}

export function seedCompetitors(db, competitorsJsonPath) {
  const conf = JSON.parse(fs.readFileSync(competitorsJsonPath, 'utf8'));
  const upsertCompetitor = db.prepare(
    `INSERT INTO competitor (key, name_kr, name_en, is_client) VALUES (@key, @name_kr, @name_en, @is_client)
     ON CONFLICT(key) DO UPDATE SET name_kr=excluded.name_kr, name_en=excluded.name_en, is_client=excluded.is_client`
  );
  const upsertAdvertiser = db.prepare(
    `INSERT INTO advertiser (id, channel, competitor_key, external_id, display_name, handle, is_primary, metadata, last_seen_at)
     VALUES (@id, @channel, @competitor_key, @external_id, @display_name, @handle, @is_primary, @metadata, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET is_primary=excluded.is_primary, display_name=excluded.display_name, last_seen_at=excluded.last_seen_at`
  );

  const tx = db.transaction(() => {
    for (const c of conf.competitors) {
      upsertCompetitor.run({
        key: c.key,
        name_kr: c.name_kr,
        name_en: c.name_en ?? null,
        is_client: c.is_client ? 1 : 0,
      });
      // Meta advertiser (page)
      if (c.meta?.page_id) {
        upsertAdvertiser.run({
          id: `meta:${c.meta.page_id}`,
          channel: 'meta',
          competitor_key: c.key,
          external_id: c.meta.page_id,
          display_name: c.name_kr,
          handle: c.meta.handle ?? null,
          is_primary: 1,
          metadata: JSON.stringify({ source: 'config' }),
        });
      }
      // Google advertisers (potentially multiple)
      for (const arId of c.google?.advertiser_ids ?? []) {
        upsertAdvertiser.run({
          id: `google:${arId}`,
          channel: 'google',
          competitor_key: c.key,
          external_id: arId,
          display_name: c.name_kr,
          handle: null,
          is_primary: arId === c.google.primary_advertiser_id ? 1 : 0,
          metadata: JSON.stringify({ source: 'config', search_aliases: c.google.search_aliases }),
        });
      }
    }
  });
  tx();
}

export function generateSnapshotId(channel, runAt = new Date()) {
  const stamp = runAt.toISOString().replace(/[:T]/g, '-').slice(0, 16);
  return `${channel}-${stamp}`;
}

export function recordSnapshot(db, { id, channel, competitor_key = null, ads_total, ads_active, notes = null, run_at = null }) {
  db.prepare(
    `INSERT OR REPLACE INTO snapshot (id, run_at, channel, competitor_key, ads_total, ads_active, notes)
     VALUES (@id, COALESCE(@run_at, datetime('now')), @channel, @competitor_key, @ads_total, @ads_active, @notes)`
  ).run({ id, run_at, channel, competitor_key, ads_total, ads_active, notes });
}

export function upsertAd(db, ad) {
  db.prepare(
    `INSERT INTO ad (
       id, channel, external_id, advertiser_id, competitor_key,
       format, ad_agency, copy_text, cta_text, landing_url,
       thumbnail_url, image_urls, video_urls, detail_url,
       first_seen_at, last_seen_at, ad_started_at, ad_last_shown_at, status, raw
     ) VALUES (
       @id, @channel, @external_id, @advertiser_id, @competitor_key,
       @format, @ad_agency, @copy_text, @cta_text, @landing_url,
       @thumbnail_url, @image_urls, @video_urls, @detail_url,
       COALESCE(@first_seen_at, datetime('now')), datetime('now'),
       @ad_started_at, @ad_last_shown_at, @status, @raw
     )
     ON CONFLICT(channel, external_id) DO UPDATE SET
       advertiser_id    = excluded.advertiser_id,
       format           = COALESCE(excluded.format, ad.format),
       ad_agency        = COALESCE(excluded.ad_agency, ad.ad_agency),
       copy_text        = COALESCE(excluded.copy_text, ad.copy_text),
       cta_text         = COALESCE(excluded.cta_text, ad.cta_text),
       landing_url      = COALESCE(excluded.landing_url, ad.landing_url),
       thumbnail_url    = COALESCE(excluded.thumbnail_url, ad.thumbnail_url),
       image_urls       = COALESCE(excluded.image_urls, ad.image_urls),
       video_urls       = COALESCE(excluded.video_urls, ad.video_urls),
       detail_url       = excluded.detail_url,
       last_seen_at     = datetime('now'),
       ad_started_at    = COALESCE(ad.ad_started_at, excluded.ad_started_at),
       ad_last_shown_at = excluded.ad_last_shown_at,
       status           = excluded.status,
       raw              = excluded.raw`
  ).run({
    first_seen_at: null,
    image_urls: null,
    video_urls: null,
    ad_started_at: null,
    ad_last_shown_at: null,
    ad_agency: null,
    copy_text: null,
    cta_text: null,
    landing_url: null,
    thumbnail_url: null,
    raw: null,
    ...ad,
  });
}

export function recordAdSnapshot(db, snapshotId, adId, wasActive) {
  db.prepare(
    `INSERT OR REPLACE INTO ad_snapshot (snapshot_id, ad_id, was_active) VALUES (?, ?, ?)`
  ).run(snapshotId, adId, wasActive ? 1 : 0);
}

export function markStoppedAdsForChannel(db, channel, snapshotId) {
  // Any ad that is currently active and was NOT in this snapshot's seen set is marked stopped.
  // Caller must have inserted ad_snapshot rows for everything seen.
  db.prepare(
    `UPDATE ad SET status = 'stopped'
     WHERE channel = ? AND status = 'active'
       AND id NOT IN (
         SELECT ad_id FROM ad_snapshot WHERE snapshot_id = ? AND was_active = 1
       )`
  ).run(channel, snapshotId);
}
