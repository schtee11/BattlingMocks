import { Router } from 'express';
import { pool } from '../db/pool.js';
import { CURRENT_DRAFT_YEAR } from '../config.js';

const router = Router();

// Public read-only view of actual draft results (for client-side MyMock coloring).
router.get('/', async (req, res) => {
  const year = parseInt(req.query.year, 10) || CURRENT_DRAFT_YEAR;
  const { rows } = await pool.query(
    `SELECT ap.pick_number, ap.player_id, ap.team,
            p.name, p.position, p.school, p.headshot_url
     FROM actual_picks ap JOIN players p ON p.id = ap.player_id
     WHERE ap.draft_year = $1
     ORDER BY ap.pick_number`,
    [year]
  );
  res.set('Cache-Control', 'public, max-age=30');
  res.json(rows);
});

export default router;
