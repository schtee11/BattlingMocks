import { Router } from 'express';
import { pool } from '../db/pool.js';

const router = Router();

// GET /api/predictive/live — live draft-night bundle for the /live page.
// Returns the current actual picks, all user mocks (so the client can
// color-code each user's prediction against each actual pick as it comes in),
// and the ranked leaderboard.
//
// Bundled into ONE endpoint so the /live page only has to poll once per
// cycle instead of fanning out to three separate endpoints. Short cache TTL
// (10s) so the page still feels live but repeat-viewers don't hammer the DB.
router.get('/live', async (_req, res) => {
  try {
    const [actualsRes, mocksRes, leaderboardRes, settingsRes] = await Promise.all([
      pool.query(
        `SELECT ap.pick_number, ap.player_id, ap.team, ap.entered_at,
                p.name, p.position, p.school, p.headshot_url
         FROM actual_picks ap JOIN players p ON p.id = ap.player_id
         WHERE ap.round = 1
         ORDER BY ap.pick_number`
      ),
      pool.query(
        `SELECT m.id AS mock_id, m.user_id, u.display_name, u.avatar_url,
                mp.pick_number, mp.player_id, mp.is_confident
         FROM mocks m
         JOIN users u ON u.id = m.user_id
         JOIN mock_picks mp ON mp.mock_id = m.id
         WHERE m.mock_type = 'round1'
         ORDER BY m.id, mp.pick_number`
      ),
      pool.query(
        `WITH stats AS (
           SELECT m.id, m.user_id, m.total_score, m.submitted_at,
                  u.display_name, u.avatar_url
           FROM mocks m JOIN users u ON u.id = m.user_id
           WHERE m.mock_type = 'round1'
         )
         SELECT id, user_id, display_name, avatar_url, total_score, submitted_at,
                RANK() OVER (ORDER BY total_score DESC, submitted_at ASC)::int AS rank
         FROM stats
         ORDER BY total_score DESC, submitted_at ASC
         LIMIT 50`
      ),
      pool.query('SELECT draft_year, is_locked, scoring_run_at FROM draft_settings WHERE id = 1'),
    ]);

    // Group mock picks by mock_id on the way out so the client can walk
    // one-row-per-user instead of filtering the flat list itself.
    const mocksById = new Map();
    for (const row of mocksRes.rows) {
      if (!mocksById.has(row.mock_id)) {
        mocksById.set(row.mock_id, {
          mock_id: row.mock_id,
          user_id: row.user_id,
          display_name: row.display_name,
          avatar_url: row.avatar_url,
          picks: [],
        });
      }
      mocksById.get(row.mock_id).picks.push({
        pick_number: row.pick_number,
        player_id: row.player_id,
        is_confident: row.is_confident,
      });
    }

    res.set('Cache-Control', 'public, max-age=10');
    res.json({
      actuals: actualsRes.rows,
      mocks: Array.from(mocksById.values()),
      leaderboard: leaderboardRes.rows,
      settings: settingsRes.rows[0] || null,
    });
  } catch (e) {
    console.error('[predictive/live]', e);
    res.status(500).json({ error: 'server error' });
  }
});

export default router;
