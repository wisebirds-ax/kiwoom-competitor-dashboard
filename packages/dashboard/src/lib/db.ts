import competitorsRaw from '../data/competitors.json';
import adsRaw from '../data/ads.json';
import snapshotsRaw from '../data/snapshots.json';

export type Competitor = {
  key: string;
  name_kr: string;
  is_client: number;
};

export type Ad = {
  id: string;
  channel: 'meta' | 'google';
  external_id: string;
  competitor_key: string;
  competitor_name_kr: string;
  format: string | null;
  ad_agency: string | null;
  copy_text: string | null;
  cta_text: string | null;
  landing_url: string | null;
  thumbnail_url: string | null;
  image_urls: string | null;
  video_urls: string | null;
  detail_url: string | null;
  ad_started_at: string | null;
  ad_last_shown_at: string | null;
  status: 'active' | 'stopped';
  first_seen_at: string;
  last_seen_at: string;
};

export type CompetitorKpi = {
  competitor_key: string;
  name_kr: string;
  is_client: number;
  active_total: number;
  new_24h: number;
  stopped_24h: number;
  median_run_days: number | null;
  format_video: number;
  format_image: number;
  format_text: number;
  format_other: number;
  unique_landing_pages: number;
};

export type EnrichmentStatus = {
  total: number;
  enriched: number;
  pct: number;
};

const allCompetitors = competitorsRaw as unknown as Competitor[];
const allAds = adsRaw as unknown as Ad[];
const allSnapshots = snapshotsRaw as unknown as Array<{
  id: string;
  run_at: string;
  channel: string;
  competitor_key: string | null;
  ads_total: number;
  ads_active: number;
  notes: string | null;
}>;

export function parseVideoUrls(s: string | null): Array<{ kind: string; id: string; embed: string }> {
  if (!s) return [];
  try { return JSON.parse(s); } catch { return []; }
}

export function listCompetitors(): Competitor[] {
  return allCompetitors;
}

export function listAds(opts: {
  competitor?: string;
  channel?: string;
  status?: 'active' | 'stopped' | 'all';
  newSinceHours?: number;
  limit?: number;
} = {}): Ad[] {
  const { competitor, channel, status = 'active', newSinceHours, limit = 500 } = opts;
  let result = allAds;
  if (competitor) result = result.filter((a) => a.competitor_key === competitor);
  if (channel) result = result.filter((a) => a.channel === channel);
  result = result.filter((a) => a.format !== 'text');
  if (status !== 'all') result = result.filter((a) => a.status === status);
  if (newSinceHours) {
    const since = new Date(Date.now() - newSinceHours * 60 * 60 * 1000).toISOString();
    result = result.filter((a) => a.first_seen_at > since);
  }
  return [...result]
    .sort((a, b) => {
      if (!!a.thumbnail_url !== !!b.thumbnail_url) return a.thumbnail_url ? -1 : 1;
      const aDate = a.ad_last_shown_at ?? a.last_seen_at;
      const bDate = b.ad_last_shown_at ?? b.last_seen_at;
      return bDate.localeCompare(aDate);
    })
    .slice(0, limit);
}

export function competitorKpis(): CompetitorKpi[] {
  const h24ago = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const results: CompetitorKpi[] = [];

  for (const c of allCompetitors) {
    const competitorAds = allAds.filter((a) => a.competitor_key === c.key);
    const active = competitorAds.filter((a) => a.status === 'active');

    const new24h = competitorAds.filter((a) => a.first_seen_at > h24ago).length;
    const stopped24h = competitorAds.filter(
      (a) => a.status === 'stopped' && a.last_seen_at > h24ago
    ).length;

    const days = active
      .map((a) => {
        if (!a.ad_started_at || !a.ad_last_shown_at) return null;
        return (new Date(a.ad_last_shown_at).getTime() - new Date(a.ad_started_at).getTime()) / 86400000;
      })
      .filter((d): d is number => typeof d === 'number' && Number.isFinite(d) && d >= 0)
      .sort((a, b) => a - b);
    const median = days.length ? days[Math.floor(days.length / 2)] : null;

    const formatCount = (f: string) =>
      active.filter((a) => (a.format ?? '').toLowerCase() === f).length;
    const lpSet = new Set(active.map((a) => a.landing_url).filter(Boolean));

    results.push({
      competitor_key: c.key,
      name_kr: c.name_kr,
      is_client: c.is_client,
      active_total: active.length,
      new_24h: new24h,
      stopped_24h: stopped24h,
      median_run_days: median !== null ? Math.round(median * 10) / 10 : null,
      format_video: formatCount('video'),
      format_image: formatCount('image'),
      format_text: formatCount('text'),
      format_other:
        active.length - formatCount('video') - formatCount('image') - formatCount('text'),
      unique_landing_pages: lpSet.size,
    });
  }

  return results.sort((a, b) => b.active_total - a.active_total);
}

export function latestSnapshot(channel: string) {
  const snaps = allSnapshots
    .filter((s) => s.channel === channel)
    .sort((a, b) => b.run_at.localeCompare(a.run_at));
  return snaps[0] as
    | { id: string; run_at: string; channel: string; ads_total: number; ads_active: number; notes: string | null }
    | undefined;
}

export function enrichmentStatus(): EnrichmentStatus {
  const googleActive = allAds.filter(
    (a) => a.channel === 'google' && a.status === 'active'
  );
  const total = googleActive.length;
  const enriched = googleActive.filter((a) => a.thumbnail_url).length;
  return {
    total,
    enriched,
    pct: total ? Math.round((enriched * 100) / total) : 0,
  };
}

export function recentNewAds(hours = 24, limit = 24): Ad[] {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const half = Math.ceil(limit / 2);

  const meta = allAds
    .filter(
      (a) => a.channel === 'meta' && a.status === 'active' && a.first_seen_at > since
    )
    .sort((a, b) => {
      if (!!a.thumbnail_url !== !!b.thumbnail_url) return a.thumbnail_url ? -1 : 1;
      const aDate = a.ad_started_at ?? a.first_seen_at;
      const bDate = b.ad_started_at ?? b.first_seen_at;
      return bDate.localeCompare(aDate);
    })
    .slice(0, half);

  const google = allAds
    .filter(
      (a) =>
        a.channel === 'google' &&
        a.status === 'active' &&
        a.first_seen_at > since &&
        !!a.thumbnail_url
    )
    .sort((a, b) => {
      const aDate = a.ad_last_shown_at ?? a.last_seen_at;
      const bDate = b.ad_last_shown_at ?? b.last_seen_at;
      return bDate.localeCompare(aDate);
    })
    .slice(0, half);

  const out: Ad[] = [];
  for (let i = 0; i < Math.max(meta.length, google.length); i++) {
    if (meta[i]) out.push(meta[i]);
    if (google[i]) out.push(google[i]);
  }
  return out.slice(0, limit);
}
