import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { adminAuth } from '../../middleware/adminAuth.js';

const router = Router();
router.use(adminAuth);

// ---------- Users (admin view) ----------
router.get('/users', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        u.id,
        u.display_name,
        u.avatar_url,
        u.discord_id,
        u.created_at,
        (m.id IS NOT NULL) AS has_mock,
        COALESCE(m.total_score, 0) AS total_score,
        m.submitted_at
      FROM users u
      LEFT JOIN mocks m ON m.user_id = u.id AND m.mock_type = 'round1'
      ORDER BY u.created_at DESC
    `);
    res.json(rows);
  } catch (e) {
    console.error('[admin users]', e);
    res.status(500).json({ error: 'server error' });
  }
});

export default router;
