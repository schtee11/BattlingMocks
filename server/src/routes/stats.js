import { Router } from 'express';
import { pool } from '../db/pool.js';

const router = Router();

router.get('/', async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM mocks) AS total_mocks,
      (SELECT COUNT(*)::int FROM users) AS total_users,
      (SELECT COALESCE(ROUND(AVG(total_score))::int, 0) FROM mocks WHERE total_score > 0) AS avg_score,
      (SELECT COALESCE(MAX(total_score), 0) FROM mocks) AS highest_score,
      (SELECT draft_year FROM draft_settings WHERE id = 1) AS draft_year,
      (SELECT is_locked FROM draft_settings WHERE id = 1) AS is_locked
  `);
  res.set('Cache-Control', 'public, max-age=60');
  res.json(rows[0]);
});

export default router;
