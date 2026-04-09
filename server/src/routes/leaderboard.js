import { Router } from 'express';
import { pool } from '../db/pool.js';

const router = Router();

router.get('/', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;

  // Single query: rank + per-mock stats (picks correct, exact matches)
  const { rows } = await pool.query(
    `
    WITH stats AS (
      SELECT
        m.id,
        m.user_id,
        m.total_score,
        m.submitted_at,
        u.display_name,
        u.avatar_url,
        COUNT(mp.*) FILTER (WHERE ap.player_id IS NOT NULL) AS picks_correct,
        COUNT(mp.*) FILTER (WHERE ap.pick_number = mp.pick_number) AS exact_picks
      FROM mocks m
      JOIN users u ON u.id = m.user_id
      LEFT JOIN mock_picks mp ON mp.mock_id = m.id
      LEFT JOIN actual_picks ap ON ap.player_id = mp.player_id
      WHERE m.mock_type = 'round1'
      GROUP BY m.id, u.id
    )
    SELECT
      id, user_id, display_name, avatar_url, total_score, submitted_at,
      picks_correct::int, exact_picks::int,
      RANK() OVER (ORDER BY total_score DESC, submitted_at ASC) AS rank
    FROM stats
    ORDER BY total_score DESC, submitted_at ASC
    LIMIT $1 OFFSET $2
    `,
    [limit, offset]
  );
  const { rows: countRows } = await pool.query(
    "SELECT COUNT(*)::int AS c FROM mocks WHERE mock_type = 'round1'"
  );
  res.set('Cache-Control', 'public, max-age=30');
  res.json({ entries: rows, total: countRows[0].c });
});

export default router;
