import { Router } from 'express';
import { pool } from '../db/pool.js';

const router = Router();

router.get('/', async (_req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, position, school, headshot_url FROM players ORDER BY position, name'
  );
  res.json(rows);
});

export default router;
