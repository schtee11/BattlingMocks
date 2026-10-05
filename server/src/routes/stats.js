import { Router } from 'express';
import { pool } from '../db/pool.js';
import { CURRENT_DRAFT_YEAR } from '../config.js';

const router = Router();

router.get('/', async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM mocks WHERE mock_type = 'round1' AND draft_year = $1) AS total_mocks,
      (SELECT COUNT(*)::int FROM users) AS total_users,
      (SELECT COALESCE(ROUND(AVG(total_score))::int, 0) FROM mocks WHERE mock_type = 'round1' AND draft_year = $1 AND total_score > 0) AS avg_score,
      (SELECT COALESCE(MAX(total_score), 0) FROM mocks WHERE mock_type = 'round1' AND draft_year = $1) AS highest_score,
      $1::int AS draft_year,
      (SELECT is_locked FROM draft_settings WHERE id = 1) AS is_locked
  `, [CURRENT_DRAFT_YEAR]);
  res.set('Cache-Control', 'public, max-age=60');
  res.json(rows[0]);
});

export default router;
