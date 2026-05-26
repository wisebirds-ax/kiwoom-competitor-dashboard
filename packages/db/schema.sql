-- Kiwoom Competitor Ad Dashboard — schema
-- Designed for Postgres (Supabase).

-- ────────────────────────────────────────────────────────────────────
-- competitors / channels
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS competitor (
  key            TEXT PRIMARY KEY,           -- 'mirae', 'samsung', ...
  name_kr        TEXT NOT NULL,
  name_en        TEXT,
  is_client      INTEGER NOT NULL DEFAULT 0  -- 1 only for 키움증권
);

CREATE TABLE IF NOT EXISTS advertiser (
  id             TEXT PRIMARY KEY,            -- channel-specific advertiser id
  channel        TEXT NOT NULL,               -- 'meta' | 'google'
  competitor_key TEXT NOT NULL REFERENCES competitor(key),
  external_id    TEXT NOT NULL,               -- e.g. Meta page_id or Google AR...
  display_name   TEXT,
  handle         TEXT,                        -- Meta @handle (null for Google)
  is_primary     INTEGER NOT NULL DEFAULT 0,  -- the canonical account per competitor+channel
  metadata       TEXT,                        -- JSON blob (followers, verification, etc.)
  first_seen_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_advertiser_competitor ON advertiser(competitor_key, channel);
CREATE INDEX IF NOT EXISTS idx_advertiser_external ON advertiser(channel, external_id);

-- ────────────────────────────────────────────────────────────────────
-- the ad creative itself (canonical, identified by channel + external id)
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ad (
  id                 TEXT PRIMARY KEY,            -- '{channel}:{external_id}'
  channel            TEXT NOT NULL,               -- 'meta' | 'google'
  external_id        TEXT NOT NULL,               -- Meta library_id or Google creative_id
  advertiser_id      TEXT NOT NULL REFERENCES advertiser(id),
  competitor_key     TEXT NOT NULL REFERENCES competitor(key),

  format             TEXT,                        -- 'image' | 'video' | 'text' | 'display' | 'native'
  ad_agency          TEXT,                        -- e.g. 옴니콤미디어그룹코리아 주식회사 (Google only)

  copy_text          TEXT,                        -- ad copy / body text
  cta_text           TEXT,                        -- '더 알아보기', etc.
  landing_url        TEXT,                        -- click-through destination

  -- assets stored in object storage (R2/S3) once downloaded
  thumbnail_url      TEXT,                        -- public thumbnail (e.g. YouTube hqdefault)
  image_urls         TEXT,                        -- JSON array
  video_urls         TEXT,                        -- JSON array (raw video links if extractable)
  detail_url         TEXT,                        -- official transparency page URL

  -- lifecycle timestamps (as observed)
  first_seen_at      TEXT NOT NULL,               -- first observed by our collector
  last_seen_at       TEXT NOT NULL,               -- last observed by our collector
  ad_started_at      TEXT,                        -- from the platform (start_date)
  ad_last_shown_at   TEXT,                        -- from the platform (last_shown)
  status             TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'stopped'

  raw                TEXT,                        -- JSON raw response for debugging

  UNIQUE (channel, external_id)
);
CREATE INDEX IF NOT EXISTS idx_ad_advertiser ON ad(advertiser_id);
CREATE INDEX IF NOT EXISTS idx_ad_competitor ON ad(competitor_key);
CREATE INDEX IF NOT EXISTS idx_ad_status ON ad(status, channel);

-- ────────────────────────────────────────────────────────────────────
-- snapshots: every collection run writes one row per ad it saw active.
-- Lets us diff between any two days/runs and compute KPI deltas.
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS snapshot (
  id             TEXT PRIMARY KEY,            -- UUID / 'YYYY-MM-DD HH:MM'
  run_at         TEXT NOT NULL,
  channel        TEXT NOT NULL,               -- the run's channel
  competitor_key TEXT,                        -- null = ran for all competitors
  ads_total      INTEGER,
  ads_active     INTEGER,
  notes          TEXT
);

CREATE TABLE IF NOT EXISTS ad_snapshot (
  snapshot_id    TEXT NOT NULL REFERENCES snapshot(id),
  ad_id          TEXT NOT NULL REFERENCES ad(id),
  was_active     INTEGER NOT NULL,
  PRIMARY KEY (snapshot_id, ad_id)
);

-- ────────────────────────────────────────────────────────────────────
-- creative_asset: persisted images/videos (once downloaded to R2/S3)
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS creative_asset (
  id           TEXT PRIMARY KEY,             -- sha256 of content
  ad_id        TEXT NOT NULL REFERENCES ad(id),
  kind         TEXT NOT NULL,                -- 'image' | 'video' | 'thumbnail'
  source_url   TEXT NOT NULL,
  storage_url  TEXT,                         -- R2/S3 URL after download
  mime         TEXT,
  bytes        INTEGER,
  downloaded_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_asset_ad ON creative_asset(ad_id);
