import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { adminAuth } from '../../middleware/adminAuth.js';
import { seedDraftOrder } from '../../db/seed.js';
import { runScoringOnClient } from '../../services/scoring.js';

const router = Router();
router.use(adminAuth);

// ---------- Draft order ----------
router.get('/draft-order', async (req, res) => {
  try {
    // Same round filter as the public endpoint — admin UI stays R1 unless
    // explicitly asking for more via ?round=all. Year defaults to 2026 so
    // the current-draft admin panel keeps working unchanged; pass ?year=2027
    // to view future-year rows after a sync.
    const roundParam = (req.query.round || '1').toString().toLowerCase();
    const year = parseInt(req.query.year, 10) || 2026;
    let rows;
    if (roundParam === 'all') {
      ({ rows } = await pool.query(
        'SELECT pick_number, team, team_name, team_needs, round FROM draft_order WHERE draft_year = $1 ORDER BY pick_number',
        [year]
      ));
    } else {
      const round = parseInt(roundParam, 10) || 1;
      ({ rows } = await pool.query(
        'SELECT pick_number, team, team_name, team_needs, round FROM draft_order WHERE round = $1 AND draft_year = $2 ORDER BY pick_number',
        [round, year]
      ));
    }
    res.json(rows);
  } catch (e) {
    console.error('[admin draft-order]', e);
    res.status(500).json({ error: 'server error' });
  }
});

router.post('/draft-order', async (req, res) => {
  const { order } = req.body || {};
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order[] required' });
  for (const row of order) {
    if (!Number.isInteger(row.pick_number) || row.pick_number < 1 || row.pick_number > 32) {
      return res.status(400).json({ error: 'invalid pick_number' });
    }
    if (!row.team || !row.team_name) {
      return res.status(400).json({ error: 'team and team_name required' });
    }
    if (row.team_needs != null && !Array.isArray(row.team_needs)) {
      return res.status(400).json({ error: 'team_needs must be an array' });
    }
  }
  try {
    await seedDraftOrder(order);
    res.json({ ok: true, updated: order.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server error' });
  }
});

// ---------- Team needs (bulk per-team) ----------
// Needs are stored per draft_order row, but the UI treats them as per-team
// since a team's needs don't meaningfully change between their round 1 pick
// and their round 7 pick. This endpoint takes a { TEAM: [...needs] } map and
// propagates each team's needs to every draft_order row owned by that team
// across all 7 rounds. The team-mock bot picker reads team_needs off the
// row, so setting them here directly feeds the BPA + needs algorithm.
router.post('/team-needs', async (req, res) => {
  const { needs } = req.body || {};
  if (!needs || typeof needs !== 'object' || Array.isArray(needs)) {
    return res.status(400).json({ error: 'needs object required' });
  }

  const client = await pool.connect();
  let updated = 0;
  try {
    await client.query('BEGIN');
    for (const [team, arr] of Object.entries(needs)) {
      if (!team || !Array.isArray(arr)) continue;
      // Normalize: uppercase, trim, dedupe, filter blanks, clamp to 10 entries.
      const cleaned = [...new Set(arr.map((s) => String(s).trim().toUpperCase()).filter(Boolean))].slice(0, 10);
      // Needs only live on current-year (2026) rows. 2027 rows — pulled from
      // ESPN — reuse the same team's needs implicitly at read time, so we
      // don't duplicate-write them.
      const { rowCount } = await client.query(
        'UPDATE draft_order SET team_needs = $1, updated_at = NOW() WHERE team = $2 AND draft_year = 2026',
        [cleaned, team]
      );
      updated += rowCount;
    }
    await client.query('COMMIT');
    res.json({ ok: true, rows_updated: updated });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[team-needs]', e);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ---------- Position scores (roster heatmap) ----------
// The admin UI renders a team × position grid of 1–10 scores that represent
// how stocked each team is at every position. The bot reads these scores and
// boosts picks for positions where the team is deficient. Kept separate from
// team_needs because needs is a ranked top-3 list while scores are a dense
// numeric grid.
router.get('/position-scores', async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || 2026;
    const { rows } = await pool.query(
      `SELECT team_id, team_name, position, score
         FROM position_scores
        WHERE draft_year = $1
        ORDER BY team_id, position`,
      [year]
    );
    res.json(rows);
  } catch (e) {
    console.error('[admin position-scores GET]', e);
    res.status(500).json({ error: 'server error' });
  }
});

router.post('/position-scores', async (req, res) => {
  const { scores, year } = req.body || {};
  const draftYear = parseInt(year, 10) || 2026;
  if (!scores || typeof scores !== 'object' || Array.isArray(scores)) {
    return res.status(400).json({ error: 'scores object required' });
  }

  const client = await pool.connect();
  let upserts = 0;
  let deletes = 0;
  try {
    await client.query('BEGIN');
    for (const [teamId, entry] of Object.entries(scores)) {
      if (!teamId || !entry || typeof entry !== 'object') continue;
      const teamName = String(entry.teamName || teamId).slice(0, 80);
      const byPosition = entry.scores || {};
      for (const [position, raw] of Object.entries(byPosition)) {
        const pos = String(position).toUpperCase().trim();
        if (!pos) continue;
        // `null` / empty → clear the row so admins can blank a cell.
        if (raw === null || raw === '' || raw === undefined) {
          const { rowCount } = await client.query(
            `DELETE FROM position_scores
              WHERE team_id = $1 AND position = $2 AND draft_year = $3`,
            [teamId, pos, draftYear]
          );
          deletes += rowCount;
          continue;
        }
        const score = Number(raw);
        if (!Number.isInteger(score) || score < 1 || score > 10) continue;
        await client.query(
          `INSERT INTO position_scores (team_id, team_name, position, score, draft_year)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (team_id, position, draft_year)
           DO UPDATE SET score = EXCLUDED.score,
                         team_name = EXCLUDED.team_name,
                         updated_at = NOW()`,
          [teamId, teamName, pos, score, draftYear]
        );
        upserts++;
      }
    }
    await client.query('COMMIT');
    res.json({ ok: true, upserts, deletes });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[admin position-scores POST]', e);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ---------- Actual picks ----------
router.get('/actual-picks', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT ap.pick_number, ap.player_id, ap.team, ap.entered_at,
            p.name, p.position, p.school, p.headshot_url
     FROM actual_picks ap JOIN players p ON p.id = ap.player_id
     ORDER BY ap.pick_number`
  );
  res.json(rows);
});

router.post('/actual-picks', async (req, res) => {
  const { pick_number, player_id, team } = req.body || {};
  if (!Number.isInteger(pick_number) || pick_number < 1 || pick_number > 32) {
    return res.status(400).json({ error: 'invalid pick_number' });
  }
  if (!Number.isInteger(player_id)) {
    return res.status(400).json({ error: 'invalid player_id' });
  }
  const exists = await pool.query('SELECT id FROM players WHERE id = $1', [player_id]);
  if (!exists.rows.length) return res.status(400).json({ error: 'player not found' });

  // Save the pick AND re-score every mock in one transaction so the
  // leaderboard reflects the new state instantly.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO actual_picks (pick_number, player_id, team)
       VALUES ($1, $2, $3)
       ON CONFLICT (pick_number) DO UPDATE
         SET player_id = EXCLUDED.player_id, team = EXCLUDED.team, entered_at = NOW()
       RETURNING *`,
      [pick_number, player_id, team || null]
    );
    const scoredMocks = await runScoringOnClient(client);
    await client.query('COMMIT');
    res.status(201).json({ ...rows[0], scored_mocks: scoredMocks });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[actual-picks auto-score]', e);
    res.status(500).json({ error: 'server error' });
  } finally {
    client.release();
  }
});

router.delete('/actual-picks/:pick', async (req, res) => {
  await pool.query('DELETE FROM actual_picks WHERE pick_number = $1', [req.params.pick]);
  res.status(204).end();
});

// ---------- Lock toggle ----------
router.post('/lock', async (req, res) => {
  const { is_locked } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE draft_settings SET is_locked = COALESCE($1, NOT is_locked) WHERE id = 1 RETURNING *`,
    [typeof is_locked === 'boolean' ? is_locked : null]
  );
  if (rows[0].is_locked) {
    await pool.query('UPDATE mocks SET is_locked = TRUE');
  }
  res.json(rows[0]);
});

// ---------- Scoring (transactional, idempotent) ----------
router.post('/score', async (_req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const totalMocks = await runScoringOnClient(client);
    await client.query('COMMIT');

    const { rows: summary } = await pool.query(`
      SELECT COUNT(*)::int AS scored,
             COALESCE(ROUND(AVG(total_score))::int, 0) AS avg_score,
             COALESCE(MAX(total_score), 0) AS max_score
      FROM mocks WHERE mock_type = 'round1' AND total_score > 0
    `);
    res.json({ ok: true, ...summary[0], total_mocks: totalMocks });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'server error' });
  } finally {
    client.release();
  }
});

export default router;
