import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { adminAuth } from '../../middleware/adminAuth.js';

const router = Router();
router.use(adminAuth);

// ---------- Algo config ----------
// GET returns the raw stored overrides (client merges with defaults).
// PUT replaces the blob. DELETE resets to empty (all defaults).
router.get('/algo-config', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT COALESCE(algo_config, '{}'::jsonb) AS algo_config FROM draft_settings WHERE id = 1"
    );
    res.json(rows[0]?.algo_config ?? {});
  } catch (e) {
    console.error('[algo-config get]', e);
    res.status(500).json({ error: e.message });
  }
});

router.put('/algo-config', async (req, res) => {
  const config = req.body;
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return res.status(400).json({ error: 'expected a JSON object' });
  }
  try {
    const { rows } = await pool.query(
      "UPDATE draft_settings SET algo_config = $1::jsonb WHERE id = 1 RETURNING algo_config",
      [JSON.stringify(config)]
    );
    res.json(rows[0]?.algo_config ?? {});
  } catch (e) {
    console.error('[algo-config put]', e);
    res.status(500).json({ error: e.message });
  }
});

router.delete('/algo-config', async (_req, res) => {
  try {
    await pool.query("UPDATE draft_settings SET algo_config = '{}'::jsonb WHERE id = 1");
    res.status(204).end();
  } catch (e) {
    console.error('[algo-config delete]', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
