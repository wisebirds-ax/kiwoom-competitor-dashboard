// Meta Ad Library web-scraper collector (no auth required).
// For each competitor's Meta page_id, visits the public Ad Library page,
// scrolls to load all ads, extracts per-ad data, persists to DB.
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

const MAX_SCROLL_PASSES = 30;
const STOP_AFTER_EMPTY_PASSES = 4;

function pageUrl(pageId, activeOnly = true) {
  const p = new URLSearchParams({
    active_status: activeOnly ? 'active' : 'all',
    ad_type: 'all',
    country: 'KR',
    view_all_page_id: pageId,
    media_type: 'all',
  });
  return `https://www.facebook.com/ads/library/?${p.toString()}`;
}

function detailUrl(libraryId) {
  return `https://www.facebook.com/ads/library/?id=${libraryId}`;
}

// Decode l.facebook.com/l.php?u=<encoded>&... wrapper to real landing URL
function decodeFbLink(href) {
  if (!href) return null;
  try {
    if (/^https?:\/\/l\.facebook\.com\/l\.php/.test(href)) {
      const u = new URL(href);
      const real = u.searchParams.get('u');
      if (real) return decodeURIComponent(real);
    }
  } catch {}
  return href;
}

function parseStartDate(text) {
  // "2026. 5. 5.에 게재 시작함" → 2026-05-05
  const m = text?.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?에 게재 시작/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}T00:00:00.000Z`;
}

async function dismissCookie(page) {
  for (const s of [
    'div[aria-label="모든 쿠키 허용"]',
    'div[aria-label="필수 항목만 허용"]',
    'button:has-text("모든 쿠키 허용")',
    'button:has-text("Allow all cookies")',
  ]) {
    const b = page.locator(s).first();
    if (await b.count()) {
      await b.click({ timeout: 1500 }).catch(() => {});
      await page.waitForTimeout(500);
      return;
    }
  }
}

async function scrollToBottom(page) {
  let prev = -1;
  let empty = 0;
  for (let i = 0; i < MAX_SCROLL_PASSES; i++) {
    const count = await page.evaluate(() => (document.body.innerText.match(/라이브러리 ID:\s*\d+/g) || []).length);
    if (count === prev) {
      empty++;
      if (empty >= STOP_AFTER_EMPTY_PASSES) break;
    } else empty = 0;
    prev = count;
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(1600);
  }
}

async function extractCards(page) {
  return await page.evaluate(() => {
    // First: map every <video> back to its enclosing libId by walking up.
    const videoByLib = new Map(); // libId → {src, poster}
    document.querySelectorAll('video').forEach((v) => {
      let el = v;
      for (let i = 0; i < 30 && el; i++, el = el.parentElement) {
        const t = el.innerText || '';
        const m = t.match(/라이브러리 ID:\s*(\d+)/);
        if (m) {
          if (!videoByLib.has(m[1]) && v.src) videoByLib.set(m[1], { src: v.src, poster: v.poster || null });
          break;
        }
      }
    });

    const out = [];
    document.querySelectorAll('div').forEach((el) => {
      const t = el.innerText || '';
      const idMatches = t.match(/라이브러리 ID:\s*(\d+)/g);
      if (!idMatches || idMatches.length !== 1) return;
      if (t.length < 80 || t.length > 4000) return;
      if (!/게재 시작/.test(t)) return;
      const lib = t.match(/라이브러리 ID:\s*(\d+)/)?.[1];
      if (!lib) return;
      const imgs = [...el.querySelectorAll('img')]
        .map((i) => i.src)
        .filter((s) => s && /^https?:/.test(s) && !s.startsWith('data:') && /scontent|fbcdn/.test(s));
      const links = [...el.querySelectorAll('a[href]')]
        .map((a) => ({ href: a.href, text: a.innerText.trim() }))
        .filter(
          (a) =>
            /^https?:/.test(a.href) &&
            !/facebook\.com\/(help|policies|ads\/library|kbsecable1|miraeasset|samsungsec|toss|kakao|kiwoom|nh|bankis)/.test(a.href)
        );
      out.push({
        lib_id: lib,
        full_text: t,
        compact_text: t.replace(/\s+/g, ' '),
        box_area: el.offsetWidth * el.offsetHeight,
        imgs: [...new Set(imgs)],
        video: videoByLib.get(lib) || null,
        links,
      });
    });
    // dedup by lib_id, keep the LARGEST element (most ancestral card)
    const map = new Map();
    for (const r of out) {
      const prev = map.get(r.lib_id);
      if (!prev || r.box_area > prev.box_area) map.set(r.lib_id, r);
    }
    return [...map.values()];
  });
}

function extractCopyText(fullText) {
  // Strip noise headers/footers
  // Pattern: "...드롭다운 열기 / 광고 상세 정보 보기 / <Brand> 광고  <COPY>  <CTA TEXT>"
  // We take the substring between "광고 상세 정보 보기" (or "요약 세부 사항 보기") and the LAST occurrence of "Learn More" / "더 알아보기" etc.
  let s = fullText.replace(/\r/g, '');
  // remove platform-icon zero-width chars
  s = s.replace(/[​‎‏]/g, '');
  // Trim everything up to "광고 상세 정보 보기" or similar
  s = s.replace(/^[\s\S]*?(?:광고 상세 정보 보기|요약 세부 사항 보기)/, '');
  // Drop trailing "Learn More" / "더 알아보기" line and below
  s = s.replace(/(Learn More|더 알아보기|지금 신청하기|회원가입|구매하기|예약하기|문의하기|앱 다운로드|자세히 알아보기|지금 시작하기)[\s\S]*$/, '');
  // Drop leading "<Brand> 광고" line if present
  s = s.replace(/^\s*\S+\s+광고\s*/, '').trim();
  return s.trim().slice(0, 800) || null;
}

function pickLandingLink(links) {
  // CTA links almost always contain "Learn More" or similar
  const ctaPatterns = /Learn More|더 알아보기|지금 신청|회원가입|구매하기|예약하기|문의하기|앱 다운로드|자세히 알아보기|지금 시작|보러가기/;
  const cta = links.find((l) => ctaPatterns.test(l.text));
  return cta ? decodeFbLink(cta.href) : decodeFbLink(links[0]?.href);
}

function pickCtaText(links) {
  const ctaPatterns = /Learn More|더 알아보기|지금 신청|회원가입|구매하기|예약하기|문의하기|앱 다운로드|자세히 알아보기|지금 시작|보러가기/;
  const cta = links.find((l) => ctaPatterns.test(l.text));
  if (!cta) return null;
  const lines = cta.text.split('\n').map((s) => s.trim()).filter(Boolean);
  // CTA text is typically the LAST line ("Learn More" / "더 알아보기")
  return lines[lines.length - 1] || null;
}

function pickThumbnailAndImage(imgs) {
  if (!imgs.length) return { thumbnail_url: null, image_urls: null };
  // Prefer the LARGE creative image (600+ px) as the card thumbnail.
  // Match like `dst-jpg_s600x600`, `_s1200x1200`, etc. Avoid 60x60 brand logos.
  const isSmall = (s) => /s\d{2}x\d{2}(?!\d)|s60x60|s64x64|s80x80|s100x100/.test(s);
  const big = imgs.find((s) => /s[1-9]\d{2,}x\d{2,}/.test(s) && !isSmall(s)) ?? imgs.find((s) => !isSmall(s)) ?? imgs[0];
  const small = imgs.find(isSmall) ?? imgs[0];
  return {
    thumbnail_url: big,
    image_urls: JSON.stringify([{ kind: 'image', url: big, small }]),
  };
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

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  locale: 'ko-KR',
  viewport: { width: 1366, height: 1100 },
});
const page = await ctx.newPage();

let perCompetitor = [];
for (const c of conf.competitors) {
  if (!c.meta?.page_id) continue;
  process.stdout.write(`[meta] ${c.name_kr} (page ${c.meta.page_id}) ... `);
  try {
    await page.goto(pageUrl(c.meta.page_id, true), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await dismissCookie(page);
    await page.waitForTimeout(2500);
    await scrollToBottom(page);
    const cards = await extractCards(page);
    console.log(`${cards.length} unique creatives`);

    for (const card of cards) {
      const start = parseStartDate(card.compact_text);
      const copy = extractCopyText(card.full_text);
      const cta = pickCtaText(card.links);
      const landing = pickLandingLink(card.links);
      const isVideo = !!card.video;
      const format = isVideo ? 'video' : 'image';
      // Thumbnail priority for VIDEO: poster > large image. For IMAGE: large image.
      let thumb = null;
      let imageUrls = null;
      let videoUrls = null;
      if (isVideo) {
        thumb = card.video.poster || pickThumbnailAndImage(card.imgs).thumbnail_url;
        videoUrls = JSON.stringify([{ kind: 'fbcdn_mp4', url: card.video.src, poster: card.video.poster }]);
      } else {
        const media = pickThumbnailAndImage(card.imgs);
        thumb = media.thumbnail_url;
        imageUrls = media.image_urls;
      }
      const adId = `meta:${card.lib_id}`;
      upsertAd(db, {
        id: adId,
        channel: 'meta',
        external_id: card.lib_id,
        advertiser_id: `meta:${c.meta.page_id}`,
        competitor_key: c.key,
        format,
        ad_agency: null,
        copy_text: copy,
        cta_text: cta,
        landing_url: landing,
        thumbnail_url: thumb,
        image_urls: imageUrls,
        video_urls: videoUrls,
        detail_url: detailUrl(card.lib_id),
        ad_started_at: start,
        ad_last_shown_at: null,
        status: 'active',
        raw: JSON.stringify({ compact_text: card.compact_text.slice(0, 800), has_video: isVideo, imgs: card.imgs.slice(0, 4), links: card.links.slice(0, 4) }),
      });
      recordAdSnapshot(db, snapId, adId, true);
    }
    perCompetitor.push({ name: c.name_kr, n: cards.length });
  } catch (e) {
    console.log(`ERROR ${e.message}`);
  }
}

await browser.close();

if (!onlyKey) markStoppedAdsForChannel(db, 'meta', snapId);
const totals = db.prepare(`SELECT COUNT(*) AS n FROM ad WHERE channel='meta'`).get();
const actives = db.prepare(`SELECT COUNT(*) AS n FROM ad WHERE channel='meta' AND status='active'`).get();
db.prepare(`UPDATE snapshot SET ads_total=?, ads_active=?, notes='ok' WHERE id=?`).run(totals.n, actives.n, snapId);

console.log('\n=== Meta scrape complete ===');
console.log(`Snapshot: ${snapId}`);
console.log(`Total ads in DB: ${totals.n}   Active: ${actives.n}`);
console.log('Per competitor:');
for (const r of perCompetitor) console.log(`  ${r.name.padEnd(10)} ${r.n}`);
db.close();
