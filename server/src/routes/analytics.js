import { Router } from 'express';
import { pool } from '../db/pool.js';

const router = Router();

// GET /api/analytics/r1-consensus
// Most-picked players across all submitted round1 mocks, with frequency + avg slot.
router.get('/r1-consensus', async (_req, res) => {
  try {
    const [playersResult, countResult] = await Promise.all([
      pool.query(`
        SELECT
          p.id,
          p.name,
          p.position,
          p.school,
          p.headshot_url,
          p.consensus_rank,
          COUNT(mp.id)::int                       AS pick_count,
          ROUND(AVG(mp.pick_number)::numeric, 1)  AS avg_pick,
          MIN(mp.pick_number)                     AS earliest_pick,
          MAX(mp.pick_number)                     AS latest_pick,
          SUM(mp.is_confident::int)::int          AS confidence_count
        FROM players p
        JOIN mock_picks mp ON mp.player_id = p.id
        JOIN mocks m ON m.id = mp.mock_id
        WHERE m.mock_type = 'round1'
        GROUP BY p.id
        ORDER BY pick_count DESC, avg_pick ASC
        LIMIT 50
      `),
      pool.query(`SELECT COUNT(*)::int AS total FROM mocks WHERE mock_type = 'round1'`),
    ]);

    res.set('Cache-Control', 'public, max-age=120');
    res.json({
      total_mocks: countResult.rows[0].total,
      players: playersResult.rows,
    });
  } catch (e) {
    console.error('[analytics/r1-consensus]', e);
    res.status(500).json({ error: 'server error' });
  }
});

// GET /api/analytics/team-consensus/:team
// Top players drafted in R1 by a given team across all saved team mocks.
router.get('/team-consensus/:team', async (req, res) => {
  const team = (req.params.team || '').toUpperCase();
  if (!/^[A-Z0-9]{2,5}$/.test(team)) {
    return res.status(400).json({ error: 'invalid team abbreviation' });
  }
  try {
    const { rows } = await pool.query(`
      SELECT
        p.id,
        p.name,
        p.position,
        p.school,
        p.headshot_url,
        COUNT(mp.id)::int                       AS pick_count,
        ROUND(AVG(mp.pick_number)::numeric, 1)  AS avg_pick
      FROM mock_picks mp
      JOIN players p ON p.id = mp.player_id
      JOIN mocks m ON m.id = mp.mock_id
      WHERE m.mock_type = 'team'
        AND mp.team = $1
        AND mp.round = 1
      GROUP BY p.id
      ORDER BY pick_count DESC
      LIMIT 10
    `, [team]);

    res.set('Cache-Control', 'public, max-age=120');
    res.json({ team, players: rows });
  } catch (e) {
    console.error('[analytics/team-consensus]', e);
    res.status(500).json({ error: 'server error' });
  }
});

// GET /api/analytics/positions
// Position distribution across all round1 mocks.
router.get('/positions', async (_req, res) => {
  try {
    const [posResult, totalResult] = await Promise.all([
      pool.query(`
        SELECT
          p.position,
          COUNT(mp.id)::int AS pick_count
        FROM mock_picks mp
        JOIN mocks m ON m.id = mp.mock_id
        JOIN players p ON p.id = mp.player_id
        WHERE m.mock_type = 'round1'
        GROUP BY p.position
        ORDER BY pick_count DESC
      `),
      pool.query(`
        SELECT COUNT(mp.id)::int AS total
        FROM mock_picks mp
        JOIN mocks m ON m.id = mp.mock_id
        WHERE m.mock_type = 'round1'
      `),
    ]);

    res.set('Cache-Control', 'public, max-age=120');
    res.json({
      total_r1_picks: totalResult.rows[0].total,
      positions: posResult.rows,
    });
  } catch (e) {
    console.error('[analytics/positions]', e);
    res.status(500).json({ error: 'server error' });
  }
});

export default router;
