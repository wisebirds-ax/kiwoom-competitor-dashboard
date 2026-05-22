// Diff engine — compute new / stopped / continuing ads between the two most
// recent snapshots per channel. Writes nothing; prints a human-readable report.
import { openDb } from '@kcd/db';

const db = openDb();

function lastTwoSnapshots(channel) {
  return db
    .prepare(
      `SELECT id, run_at, ads_active FROM snapshot WHERE channel=? AND notes='ok' ORDER BY run_at DESC LIMIT 2`
    )
    .all(channel);
}

function adIdsForSnapshot(snapId) {
  const rows = db
    .prepare(`SELECT ad_id FROM ad_snapshot WHERE snapshot_id=? AND was_active=1`)
    .all(snapId);
  return new Set(rows.map((r) => r.ad_id));
}

function adInfo(adId) {
  return db
    .prepare(
      `SELECT a.*, c.name_kr AS competitor_name FROM ad a JOIN competitor c ON c.key=a.competitor_key WHERE a.id=?`
    )
    .get(adId);
}

const channels = ['google', 'meta'];
for (const ch of channels) {
  const snaps = lastTwoSnapshots(ch);
  if (snaps.length < 2) {
    console.log(`\n[${ch}] need at least 2 successful snapshots to diff (have ${snaps.length})`);
    continue;
  }
  const [now, prev] = snaps;
  const nowSet = adIdsForSnapshot(now.id);
  const prevSet = adIdsForSnapshot(prev.id);

  const newIds = [...nowSet].filter((id) => !prevSet.has(id));
  const stoppedIds = [...prevSet].filter((id) => !nowSet.has(id));
  const continuingIds = [...nowSet].filter((id) => prevSet.has(id));

  console.log(`\n=== [${ch}] diff: ${prev.run_at} → ${now.run_at} ===`);
  console.log(`active ${prev.ads_active} → ${now.ads_active}`);
  console.log(`new: ${newIds.length}  stopped: ${stoppedIds.length}  continuing: ${continuingIds.length}`);

  if (newIds.length) {
    console.log('\nNEW ads:');
    for (const id of newIds.slice(0, 25)) {
      const a = adInfo(id);
      console.log(`  [${a.competitor_name}] ${a.format ?? '-'}  ${(a.copy_text || '').slice(0, 60)}  → ${a.detail_url}`);
    }
    if (newIds.length > 25) console.log(`  ... +${newIds.length - 25} more`);
  }
  if (stoppedIds.length) {
    console.log('\nSTOPPED ads:');
    for (const id of stoppedIds.slice(0, 25)) {
      const a = adInfo(id);
      if (a) console.log(`  [${a.competitor_name}] ${a.format ?? '-'}  ${(a.copy_text || '').slice(0, 60)}`);
    }
    if (stoppedIds.length > 25) console.log(`  ... +${stoppedIds.length - 25} more`);
  }
}

db.close();
