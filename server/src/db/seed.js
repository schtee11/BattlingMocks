import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { pool } from './pool.js';
import { CURRENT_DRAFT_YEAR } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROSPECTS_PATH = join(__dirname, '..', 'data', `prospects-${CURRENT_DRAFT_YEAR}.json`);
const ORDER_PATH = join(__dirname, '..', 'data', `draft-order-${CURRENT_DRAFT_YEAR}.json`);
const TEAM_NEEDS_PATH = join(__dirname, '..', 'data', `team-needs-${CURRENT_DRAFT_YEAR}.json`);
const NFL_TEAMS_PATH = join(__dirname, '..', 'data', 'nfl-teams.json');

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

// Import sources (ESPN in particular) sometimes hand back objects or numbers
// where we expect strings — e.g. school as { id, displayName }. Coerce to a
// trimmed string, or null, instead of calling .trim() on whatever arrived.
function text(v) {
  if (v == null) return null;
  if (typeof v === 'object') v = v.displayName || v.name || v.abbreviation || null;
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

// Players are scoped by draft_year: a name only matches an existing row in
// the same draft class, so a prospect who returned to school (or shares a
// name with a past prospect) gets a fresh row for the new year instead of
// mutating — and dragging — last year's row, which old mocks still point at.
// `rank` (when present) is stored as consensus_rank so the board order
// follows the file rather than insertion order.
export async function importProspects(prospects, draftYear = CURRENT_DRAFT_YEAR) {
  let added = 0, updated = 0, unchanged = 0;
  for (const p of prospects) {
    const name = text(p.name);
    if (!name) continue;
    const position = normalizePosition(text(p.position));
    const school = text(p.school);
    const headshot = text(p.headshot_url);
    const rankNum = Number.parseInt(p.rank, 10);
    const rank = Number.isFinite(rankNum) && rankNum > 0 ? rankNum : null;

    const { rows } = await pool.query(
      `SELECT id, position, school, headshot_url, consensus_rank FROM players
        WHERE LOWER(name) = LOWER($1) AND draft_year = $2 LIMIT 1`,
      [name, draftYear]
    );
    if (rows.length) {
      const cur = rows[0];
      // Missing fields from a sparse source never clobber what's already stored.
      const nextHeadshot = headshot ?? cur.headshot_url;
      const nextSchool = school ?? cur.school;
      const nextRank = rank ?? cur.consensus_rank;
      if (
        cur.position === position && cur.school === nextSchool &&
        cur.headshot_url === nextHeadshot && cur.consensus_rank === nextRank
      ) {
        unchanged++;
      } else {
        await pool.query(
          `UPDATE players SET position = $1, school = $2, headshot_url = $3, consensus_rank = $4
            WHERE id = $5`,
          [position, nextSchool, nextHeadshot, nextRank, cur.id]
        );
        updated++;
      }
    } else {
      await pool.query(
        `INSERT INTO players (name, position, school, headshot_url, consensus_rank, draft_year)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [name, position, school, headshot, rank, draftYear]
      );
      added++;
    }
  }
  return { added, updated, unchanged, total: prospects.length };
}

export async function seedDraftOrder(order, draftYear = CURRENT_DRAFT_YEAR) {
  for (const row of order) {
    const needs = Array.isArray(row.team_needs) ? row.team_needs : [];
    const round = row.round || 1;
    await pool.query(
      `INSERT INTO draft_order (pick_number, team, team_name, team_needs, round, draft_year, original_team_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (pick_number, draft_year) DO UPDATE
         SET team = EXCLUDED.team,
             team_name = EXCLUDED.team_name,
             team_needs = EXCLUDED.team_needs,
             round = EXCLUDED.round,
             original_team_id = COALESCE(EXCLUDED.original_team_id, draft_order.original_team_id),
             updated_at = NOW()`,
      [row.pick_number, row.team, row.team_name, needs, round, draftYear, row.original_team || null]
    );
  }
}

// (Previously seeded R2-R7 from the Rich Hill value chart — that chart is now
// value-only. Draft order rounds 2-7 are populated from ESPN via the
// /api/admin/sync/draft-order-all admin endpoint.)

// Phase 6: seed the new team_needs table from the static JSON file. Only runs
// on a fresh install (or when the file changes) — uses ON CONFLICT upsert so
// re-running the seed is idempotent.
export async function seedTeamNeeds(teamNeeds, draftYear = CURRENT_DRAFT_YEAR) {
  let upserted = 0;
  for (const t of teamNeeds) {
    const teamId = t.teamId || t.team_id;
    const teamName = t.teamName || t.team_name || teamId;
    const needs = Array.isArray(t.needs) ? t.needs : [];
    for (const need of needs) {
      const pos = normalizePosition(need.position);
      const priority = Number(need.priority);
      if (!Number.isInteger(priority) || priority < 1 || priority > 3) continue;
      await pool.query(
        `INSERT INTO team_needs (team_id, team_name, position, priority, draft_year)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (team_id, position, draft_year) DO UPDATE
           SET priority = EXCLUDED.priority,
               team_name = EXCLUDED.team_name,
               updated_at = NOW()`,
        [teamId, teamName, pos, priority, draftYear]
      );
      upserted++;
    }
  }
  return { upserted };
}

async function run() {
  const prospects = JSON.parse(readFileSync(PROSPECTS_PATH, 'utf8'));
  const order = JSON.parse(readFileSync(ORDER_PATH, 'utf8'));
  const r = await importProspects(prospects);
  console.log(`[seed] prospects: added ${r.added}, updated ${r.updated}, unchanged ${r.unchanged}`);
  await seedDraftOrder(order);
  console.log(`[seed] draft_order R1: ${order.length} rows upserted`);
  console.log('[seed] R2-R7 sync via /api/admin/sync/draft-order-all (pulls from ESPN)');
  // Team needs are optional — skip silently if the file isn't present so
  // older deployments don't break on boot.
  try {
    const teamNeeds = JSON.parse(readFileSync(TEAM_NEEDS_PATH, 'utf8'));
    const tn = await seedTeamNeeds(teamNeeds);
    console.log(`[seed] team_needs: ${tn.upserted} rows upserted`);
  } catch (e) {
    console.warn('[seed] team_needs skipped:', e.message);
  }
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
