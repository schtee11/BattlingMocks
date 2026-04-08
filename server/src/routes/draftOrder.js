import { Router } from 'express';
import { pool } from '../db/pool.js';

const router = Router();

router.get('/', async (_req, res) => {
  const { rows } = await pool.query(
    'SELECT pick_number, team, team_name, team_needs FROM draft_order ORDER BY pick_number'
  );
  res.set('Cache-Control', 'public, max-age=3600');
  res.json(rows);
});

export default router;
