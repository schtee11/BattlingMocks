import { Router } from 'express';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../db/pool.js';

const router = Router();

router.get('/', async (req, res) => {
  // Default to Round 1 only so the live Draft page stays 32 slots. Pass
  // ?round=all to get every row (used by the team mock page).
  const roundParam = (req.query.round || '1').toString().toLowerCase();
  let rows;
  if (roundParam === 'all') {
    ({ rows } = await pool.query(
      'SELECT pick_number, team, team_name, team_needs, round FROM draft_order ORDER BY pick_number'
    ));
    // Shorter TTL for the full list — admin sync of R2-R7 needs to show up
    // promptly, and this endpoint is only hit by the team-mock page.
    res.set('Cache-Control', 'public, max-age=30');
  } else {
    const round = parseInt(roundParam, 10) || 1;
    ({ rows } = await pool.query(
      'SELECT pick_number, team, team_name, team_needs, round FROM draft_order WHERE round = $1 ORDER BY pick_number',
      [round]
    ));
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

  // Pull the canonical team list from the current draft_order. Using R1 only
  // gives us exactly 32 rows (one per franchise) without compensatory dupes.
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (team) team, team_name
       FROM draft_order
      WHERE round = 1
      ORDER BY team, pick_number`
  );

  const values = loadFutureValues().year_offset_1 || {};
  const out = [];
  for (const t of rows) {
    for (let round = 1; round <= 7; round++) {
      out.push({
        id: `${year}-${t.team}-R${round}`,
        year,
        round,
        team: t.team,
        team_name: t.team_name,
        value: values[String(round)] ?? 1,
      });
    }
  }

  res.set('Cache-Control', 'public, max-age=3600');
  res.json(out);
});

export default router;
