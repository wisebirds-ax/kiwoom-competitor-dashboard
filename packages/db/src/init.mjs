// Init DB schema and seed competitors from config/competitors.json
import path from 'node:path';
import url from 'node:url';
import { openDb, initSchema, seedCompetitors } from './index.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const competitorsPath = path.resolve(__dirname, '../../../config/competitors.json');

const db = openDb();
initSchema(db);
seedCompetitors(db, competitorsPath);

const competitors = db.prepare('SELECT key, name_kr, is_client FROM competitor ORDER BY key').all();
const advertisers = db
  .prepare('SELECT channel, COUNT(*) as n FROM advertiser GROUP BY channel ORDER BY channel')
  .all();

console.log('Competitors seeded:');
competitors.forEach((c) => console.log(`  - ${c.key.padEnd(8)} ${c.name_kr}${c.is_client ? '  (client)' : ''}`));
console.log('\nAdvertisers by channel:');
advertisers.forEach((a) => console.log(`  - ${a.channel}: ${a.n}`));
db.close();
