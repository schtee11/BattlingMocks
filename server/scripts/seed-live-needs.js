// One-shot seed of the live (production) team needs into the local DB.
//
// Avoids having to re-key the admin UI on every dev machine. Writes to
// draft_order.team_needs JSONB (same column the /admin Team Needs card
// writes to). Idempotent — rerun any time to overwrite local needs with
// the snapshot below.
//
// Usage:
//   node server/scripts/seed-live-needs.js
//
// Positions are kept verbatim (uppercased) as entered in the admin UI —
// the bot picker's normalizePos() handles aliases (C/G/RG/LG → IOL,
// DL → DT, OL → OT+IOL expansion) at read time.

import { pool } from '../src/db/pool.js';

// Snapshot from production admin UI — pasted 2026-04-16.
const TEAM_NEEDS = {
  LV:  ['QB', 'WR', 'DT'],
  NYJ: ['WR', 'QB', 'EDGE'],
  ARI: ['OL', 'QB', 'S'],
  TEN: ['EDGE', 'WR', 'C'],
  NYG: ['DT', 'G', 'CB'],
  CLE: ['OT', 'WR', 'QB'],
  WSH: ['WR', 'CB', 'C'],
  NO:  ['WR', 'EDGE', 'CB'],
  KC:  ['EDGE', 'WR', 'DT'],
  CIN: ['DT', 'OT', 'WR'],
  MIA: ['WR', 'EDGE', 'CB'],
  DAL: ['LB', 'EDGE', 'CB'],
  LAR: ['WR', 'OT', 'CB'],
  BAL: ['IOL', 'DT', 'WR'],
  TB:  ['EDGE', 'LB', 'TE'],
  DET: ['OL', 'EDGE', 'CB'],
  MIN: ['C', 'S', 'WR'],
  CAR: ['S', 'WR', 'EDGE'],
  PIT: ['WR', 'IOL', 'S'],
  LAC: ['RG', 'LG', 'DT'],
  PHI: ['EDGE', 'OL', 'TE'],
  CHI: ['EDGE', 'S', 'C'],
  BUF: ['EDGE', 'LB', 'WR', 'DT', 'S'],
  SF:  ['S', 'EDGE', 'OL'],
  HOU: ['IOL', 'DT', 'CB'],
  NE:  ['OL', 'EDGE', 'LB'],
  SEA: ['RB', 'EDGE', 'CB'],
  IND: ['EDGE', 'LB', 'WR'],
  ATL: ['LB', 'WR', 'DT'],
  GB:  ['EDGE', 'CB', 'OL'],
  JAX: ['DT', 'EDGE', 'LB'],
  DEN: ['TE', 'LB', 'DL'],
};

async function main() {
  const client = await pool.connect();
  let updated = 0;
  let skipped = 0;
  try {
    await client.query('BEGIN');
    for (const [team, needs] of Object.entries(TEAM_NEEDS)) {
      const { rowCount } = await client.query(
        'UPDATE draft_order SET team_needs = $1, updated_at = NOW() WHERE team = $2',
        [needs, team]
      );
      if (rowCount > 0) {
        updated += rowCount;
        console.log(`  ${team.padEnd(4)} ← [${needs.join(', ')}] (${rowCount} rows)`);
      } else {
        skipped++;
        console.warn(`  ${team.padEnd(4)} ← no matching draft_order rows (skipped)`);
      }
    }
    await client.query('COMMIT');
    console.log(`\nDone. Updated ${updated} draft_order rows across ${Object.keys(TEAM_NEEDS).length - skipped} teams.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
