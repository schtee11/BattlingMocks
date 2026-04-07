import { Router } from 'express';
import { pool } from '../db/pool.js';

const router = Router();

router.get('/', async (_req, res) => {
  // Row number ordering by id approximates the seeded rank.
  const { rows } = await pool.query(
    `SELECT id, name, position, school, headshot_url,
            ROW_NUMBER() OVER (ORDER BY id)::int AS rank
     FROM players
     ORDER BY id`
  );
  res.set('Cache-Control', 'public, max-age=300');
  res.json(rows);
});

export default router;
