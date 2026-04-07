import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { pool } from './pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROSPECTS_PATH = join(__dirname, '..', 'data', 'prospects-2026.json');
const ORDER_PATH = join(__dirname, '..', 'data', 'draft-order-2026.json');

// Normalize legacy/variant position labels to the canonical set:
// QB, RB, WR, TE, OT, IOL, EDGE, DT, CB, S, LB
const POS_MAP = {
  QB: 'QB', RB: 'RB', HB: 'RB', FB: 'RB',
  WR: 'WR', TE: 'TE',
  OT: 'OT', T: 'OT', LT: 'OT', RT: 'OT',
  IOL: 'IOL', OG: 'IOL', G: 'IOL', LG: 'IOL', RG: 'IOL', C: 'IOL', OC: 'IOL',
  EDGE: 'EDGE', DE: 'EDGE',
  DT: 'DT', DL: 'DT', NT: 'DT',
  CB: 'CB', DB: 'CB',
  S: 'S', FS: 'S', SS: 'S',
  LB: 'LB', ILB: 'LB', OLB: 'LB', MLB: 'LB',
};

export function normalizePosition(p) {
  if (!p) return 'ATH';
  const key = String(p).trim().toUpperCase();
  return POS_MAP[key] || key;
}

export async function importProspects(prospects) {
  let added = 0, updated = 0, unchanged = 0;
  for (const p of prospects) {
    const name = p.name?.trim();
    if (!name) continue;
    const position = normalizePosition(p.position);
    const school = p.school?.trim() || null;

    const { rows } = await pool.query(
      'SELECT id, position, school FROM players WHERE LOWER(name) = LOWER($1) LIMIT 1',
      [name]
    );
    if (rows.length) {
      const cur = rows[0];
      if (cur.position === position && cur.school === school) {
        unchanged++;
      } else {
        await pool.query(
          'UPDATE players SET position = $1, school = $2 WHERE id = $3',
          [position, school, cur.id]
        );
        updated++;
      }
    } else {
      await pool.query(
        'INSERT INTO players (name, position, school) VALUES ($1, $2, $3)',
        [name, position, school]
      );
      added++;
    }
  }
  return { added, updated, unchanged, total: prospects.length };
}

export async function seedDraftOrder(order) {
  for (const row of order) {
    await pool.query(
      `INSERT INTO draft_order (pick_number, team, team_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (pick_number) DO UPDATE
         SET team = EXCLUDED.team, team_name = EXCLUDED.team_name, updated_at = NOW()`,
      [row.pick_number, row.team, row.team_name]
    );
  }
}

async function run() {
  const prospects = JSON.parse(readFileSync(PROSPECTS_PATH, 'utf8'));
  const order = JSON.parse(readFileSync(ORDER_PATH, 'utf8'));
  const r = await importProspects(prospects);
  console.log(`[seed] prospects: added ${r.added}, updated ${r.updated}, unchanged ${r.unchanged}`);
  await seedDraftOrder(order);
  console.log(`[seed] draft_order: ${order.length} rows upserted`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run()
    .then(() => pool.end())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

export { PROSPECTS_PATH };
