import { Router } from 'express';
import { pool } from '../db/pool.js';

const router = Router();

router.get('/', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const { rows } = await pool.query(
    `SELECT m.id, m.total_score, m.submitted_at, u.id AS user_id, u.display_name,
            RANK() OVER (ORDER BY m.total_score DESC, m.submitted_at ASC) AS rank
     FROM mocks m JOIN users u ON u.id = m.user_id
     ORDER BY m.total_score DESC, m.submitted_at ASC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  const { rows: countRows } = await pool.query('SELECT COUNT(*)::int AS c FROM mocks');
  res.json({ entries: rows, total: countRows[0].c });
});

export default router;
