import { Router } from 'express';
import { pool } from '../db/pool.js';

const router = Router();

router.get('/', async (req, res) => {
  // Default to Round 1 only so the live Draft page stays 32 slots. Pass
  // ?round=all to get every row (for future team-mock consumers).
  const roundParam = (req.query.round || '1').toString().toLowerCase();
  let rows;
  if (roundParam === 'all') {
    ({ rows } = await pool.query(
      'SELECT pick_number, team, team_name, team_needs, round FROM draft_order ORDER BY pick_number'
    ));
  } else {
    const round = parseInt(roundParam, 10) || 1;
    ({ rows } = await pool.query(
      'SELECT pick_number, team, team_name, team_needs, round FROM draft_order WHERE round = $1 ORDER BY pick_number',
      [round]
    ));
  }
  res.set('Cache-Control', 'public, max-age=3600');
  res.json(rows);
});

export default router;
