import { Router } from 'express';
import { adminAuth } from '../../middleware/adminAuth.js';
import { getTradeValues, calculateTrade, applyTrade } from '../../services/trades.js';

const router = Router();
router.use(adminAuth);

// ---------- Trades (Rich Hill chart) ----------
// Phase 3a: admin-only trade calculator + applier. Chart is static JSON.
// applyTrade only mutates draft_order for picks currently in the table
// (R1 only); out-of-range picks are reported in `skipped` so the admin can
// see them without getting an error.

router.get('/trades/values', (_req, res) => {
  try {
    res.json(getTradeValues());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/trades/calculate', (req, res) => {
  const { side_a_picks = [], side_b_picks = [] } = req.body || {};
  if (!Array.isArray(side_a_picks) || !Array.isArray(side_b_picks)) {
    return res.status(400).json({ error: 'side_a_picks and side_b_picks must be arrays' });
  }
  try {
    res.json(calculateTrade({ side_a_picks, side_b_picks }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/trades/apply', async (req, res) => {
  const { side_a_team, side_a_picks = [], side_b_team, side_b_picks = [] } = req.body || {};
  if (!side_a_team || !side_b_team) {
    return res.status(400).json({ error: 'side_a_team and side_b_team required' });
  }
  if (!Array.isArray(side_a_picks) || !Array.isArray(side_b_picks)) {
    return res.status(400).json({ error: 'picks must be arrays' });
  }
  if (side_a_picks.length === 0 && side_b_picks.length === 0) {
    return res.status(400).json({ error: 'at least one pick must change hands' });
  }
  try {
    const result = await applyTrade({ side_a_team, side_a_picks, side_b_team, side_b_picks });
    res.json(result);
  } catch (e) {
    console.error('[trades apply]', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
