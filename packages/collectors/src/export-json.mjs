// SQLite 데이터를 JSON 파일로 내보내는 스크립트
// 실행: node packages/collectors/src/export-json.mjs
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const SQLITE_PATH = path.join(ROOT, 'data/dashboard.sqlite');
const OUT_DIR = path.join(ROOT, 'packages/dashboard/src/data');

if (!fs.existsSync(SQLITE_PATH)) {
  console.error('오류: data/dashboard.sqlite 파일이 없습니다.');
  process.exit(1);
}

const db = new Database(SQLITE_PATH, { readonly: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

// 1. 경쟁사 목록
const competitors = db.prepare(
  'SELECT key, name_kr, name_en, is_client FROM competitor ORDER BY is_client DESC, name_kr'
).all();
fs.writeFileSync(path.join(OUT_DIR, 'competitors.json'), JSON.stringify(competitors));
console.log(`경쟁사: ${competitors.length}개`);

// 2. 광고 (raw 필드 제외해서 용량 절약, 경쟁사 이름 포함)
const ads = db.prepare(`
  SELECT
    a.id, a.channel, a.external_id, a.competitor_key,
    c.name_kr AS competitor_name_kr,
    a.format, a.ad_agency, a.copy_text, a.cta_text, a.landing_url,
    a.thumbnail_url, a.image_urls, a.video_urls, a.detail_url,
    a.first_seen_at, a.last_seen_at, a.ad_started_at, a.ad_last_shown_at,
    a.status
  FROM ad a
  JOIN competitor c ON c.key = a.competitor_key
  ORDER BY a.last_seen_at DESC
`).all();
fs.writeFileSync(path.join(OUT_DIR, 'ads.json'), JSON.stringify(ads));
console.log(`광고: ${ads.length}개`);

// 3. 스냅샷 (수집 기록)
const snapshots = db.prepare(
  'SELECT * FROM snapshot ORDER BY run_at DESC LIMIT 200'
).all();
fs.writeFileSync(path.join(OUT_DIR, 'snapshots.json'), JSON.stringify(snapshots));
console.log(`스냅샷: ${snapshots.length}개`);

db.close();
console.log('\n완료! packages/dashboard/src/data/ 폴더에 저장됐습니다.');
