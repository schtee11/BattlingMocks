import { Router } from 'express';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../db/pool.js';

const router = Router();

router.get('/', async (req, res) => {
  // Default to Round 1 only so the live Draft page stays 32 slots. Pass
  // ?round=all to get every row (used by the team mock page).
  //
  // Team needs resolution strategy:
  //   1. Prefer the draft_order.team_needs JSONB column when populated —
  //      that's where the admin UI writes user-customised needs.
  //   2. Fall back to the live team_needs table (populated on first migrate
  //      from server/src/data/team-needs-2026.json).
  // Both paths keep the bot picker + trade proposer needs-aware. The fall-
  // back matters on dev DBs where the admin UI was never opened — without
  // it, the JSONB column is empty and every bot runs pure BPA.
  //
  // NULLIF vs empty array: COALESCE only falls through on NULL, not on an
  // empty array. NULLIF(...,ARRAY[]::TEXT[]) coerces empty arrays to NULL
  // so the fallback kicks in. Both sides must be TEXT[] — draft_order
  // stores needs as a text array, and array_agg() returns TEXT[] too.
  const roundParam = (req.query.round || '1').toString().toLowerCase();
  // This endpoint always serves the CURRENT draft (2026). Future-year picks
  // live in the same table now (post-Phase-8 composite PK) and are served
  // separately via /api/draft-order/future.
  const whereClauses = ['d.draft_year = 2026'];
  const params = [];
  if (roundParam !== 'all') {
    params.push(parseInt(roundParam, 10) || 1);
    whereClauses.push(`d.round = $${params.length}`);
  }
  const sql = `
    SELECT
      d.pick_number,
      d.team,
      d.team_name,
      d.round,
      COALESCE(
        NULLIF(d.team_needs, ARRAY[]::TEXT[]),
        (SELECT array_agg(tn.position ORDER BY tn.priority ASC)
           FROM team_needs tn
          WHERE tn.team_id = d.team AND tn.draft_year = 2026)
      ) AS team_needs
    FROM draft_order d
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY d.pick_number
  `;
  const { rows } = await pool.query(sql, params);

  if (roundParam === 'all') {
    // Shorter TTL for the full list — admin sync of R2-R7 needs to show up
    // promptly, and this endpoint is only hit by the team-mock page.
    res.set('Cache-Control', 'public, max-age=30');
  } else {
    res.set('Cache-Control', 'public, max-age=3600');
  }
  res.json(rows);
});

// Future-year picks (e.g. 2027). Real-world order is unknown, so each team
// gets a single synthetic pick per round labelled by year+round+team rather
// than by a pick_number. Values are derived from the standard "one round of
// discount" convention (see server/src/data/future-pick-values.json).
//
// Returns: [{ id, year, round, team, team_name, value }]
//
// Why a route instead of static client data: gives admins a single place to
// override values later, and ensures the team list always tracks the live
// draft_order team list (so expansion / re-branding flows through without
// touching client code).
let futureValuesCache = null;
function loadFutureValues() {
  if (futureValuesCache) return futureValuesCache;
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const path = join(__dirname, '..', 'data', 'future-pick-values.json');
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  futureValuesCache = raw;
  return raw;
}

router.get('/future', async (req, res) => {
  const year = parseInt(req.query.year || '2027', 10);
  if (!Number.isFinite(year) || year < 2026 || year > 2030) {
    return res.status(400).json({ error: 'invalid year' });
  }

  // Single-source strategy with fill-in:
  //
  //   1. Pull every (team, round) row for the requested year from draft_order
  //      — real data from the ESPN sync. Collapses comp picks via DISTINCT ON
  //      so each (team, round) yields exactly one pick.
  //
  //   2. Pull the canonical 32-team list from the current draft (2026).
  //
  //   3. For every (team, round) in the canonical grid that doesn't have a
  //      real row, generate a synthetic stand-in. This way partial sync state
  //      (e.g. only R1 synced so far, or only a handful of teams) never hides
  //      the other 31 teams' 2027 picks from the trade UI.
  //
  // Values come from future-pick-values.json — real GMs discount future picks
  // by one round regardless of known slot.
  const values = loadFutureValues().year_offset_1 || {};
  const pickValue = (round) => values[String(round)] ?? 1;

  const { rows: real } = await pool.query(
    `SELECT DISTINCT ON (team, round) team, team_name, round, pick_number
       FROM draft_order
      WHERE draft_year = $1
      ORDER BY team, round, pick_number`,
    [year]
  );

  const { rows: teams } = await pool.query(
    `SELECT DISTINCT ON (team) team, team_name
       FROM draft_order
      WHERE round = 1 AND draft_year = 2026
      ORDER BY team, pick_number`
  );

  // Index real rows by "TEAM-R#" so the fill-in loop is O(1) per slot.
  const realByKey = new Map();
  for (const r of real) realByKey.set(`${r.team}-R${r.round}`, r);

  const out = [];
  for (const t of teams) {
    for (let round = 1; round <= 7; round++) {
      const hit = realByKey.get(`${t.team}-R${round}`);
      if (hit) {
        out.push({
          id: `${year}-${hit.team}-R${hit.round}`,
          year,
          round: hit.round,
          team: hit.team,
          team_name: hit.team_name,
          value: pickValue(hit.round),
          pick_number: hit.pick_number,
        });
      } else {
        out.push({
          id: `${year}-${t.team}-R${round}`,
          year,
          round,
          team: t.team,
          team_name: t.team_name,
          value: pickValue(round),
        });
      }
    }
  }

  res.set('Cache-Control', 'public, max-age=3600');
  res.json(out);
});

export default router;
