import { Router } from 'express';
import { getTradeValues } from '../services/trades.js';

const router = Router();

// Public read of the Rich Hill trade value chart. Used by the team-mock page
// to calculate trade proposals client-side. Static data; long cache is fine.
router.get('/', (_req, res) => {
  try {
    const rows = getTradeValues();
    res.set('Cache-Control', 'public, max-age=86400');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
