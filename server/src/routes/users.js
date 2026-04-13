import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { validate } from '../middleware/validate.js';

const router = Router();

const createUserLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many account creation attempts, please wait a minute' },
});

// Display names: alphanumeric, hyphens, underscores, spaces. 2-60 chars.
const displayNameRegex = /^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,58}[a-zA-Z0-9]$/;

const createUserSchema = validate({
  body: z.object({
    display_name: z
      .string()
      .min(2, 'display name must be at least 2 characters')
      .max(60, 'display name must be at most 60 characters')
      .regex(displayNameRegex, 'display name can only contain letters, numbers, hyphens, underscores, and spaces'),
  }),
});

// Look up a user by display name (case-insensitive) — used for sign-in.
router.get('/by-name', async (req, res) => {
  const name = (req.query.name || '').toString().trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const { rows } = await pool.query(
    'SELECT id, display_name, avatar_url, created_at FROM users WHERE LOWER(display_name) = LOWER($1)',
    [name]
  );
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
});

// Debounced availability check for the Join page.
router.get('/check', async (req, res) => {
  const name = (req.query.name || '').toString().trim();
  if (name.length < 2) return res.json({ available: false, reason: 'too_short' });
  if (name.length > 60) return res.json({ available: false, reason: 'too_long' });
  const { rows } = await pool.query(
    'SELECT id FROM users WHERE LOWER(display_name) = LOWER($1)',
    [name]
  );
  res.json({ available: rows.length === 0 });
});

router.post('/', createUserLimit, createUserSchema, async (req, res) => {
  const name = req.body.display_name.trim();
  try {
    const { rows } = await pool.query(
      'INSERT INTO users (display_name) VALUES ($1) RETURNING id, display_name, avatar_url, created_at',
      [name]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'display_name already taken' });
    }
    console.error(e);
    res.status(500).json({ error: 'server error' });
  }
});

// GET /api/users/:id/profile — user profile with mock stats (total mocks,
// best/avg score, team mock count, exact-match count on their R1 mock if any).
// Must come BEFORE /:id so the literal '/profile' doesn't get mistaken for a
// UUID in the /:id route.
router.get('/:id/profile', async (req, res) => {
  const userId = req.params.id;
  try {
    const { rows: userRows } = await pool.query(
      'SELECT id, display_name, avatar_url, created_at FROM users WHERE id = $1',
      [userId]
    );
    if (!userRows.length) return res.status(404).json({ error: 'not found' });
    const user = userRows[0];

    // R1 mock stats (there's at most 1 per user).
    const { rows: r1Rows } = await pool.query(
      `SELECT m.id, m.total_score, m.submitted_at,
              COUNT(mp.*) FILTER (WHERE ap.pick_number = mp.pick_number) AS exact_picks,
              COUNT(mp.*) FILTER (WHERE ap.player_id IS NOT NULL) AS correct_picks
       FROM mocks m
       LEFT JOIN mock_picks mp ON mp.mock_id = m.id
       LEFT JOIN actual_picks ap ON ap.player_id = mp.player_id
       WHERE m.user_id = $1 AND m.mock_type = 'round1'
       GROUP BY m.id`,
      [userId]
    );
    const r1Mock = r1Rows[0] || null;

    // Team mock counts (unlimited per user).
    const { rows: tmRows } = await pool.query(
      `SELECT COUNT(*)::int AS total_team_mocks
       FROM mocks WHERE user_id = $1 AND mock_type = 'team'`,
      [userId]
    );

    // Rank within the R1 leaderboard (only if they have an R1 mock).
    let rank = null;
    let percentile = null;
    if (r1Mock) {
      const { rows: rankRows } = await pool.query(
        `WITH ranked AS (
           SELECT id,
                  RANK() OVER (ORDER BY total_score DESC, submitted_at ASC) AS rank,
                  PERCENT_RANK() OVER (ORDER BY total_score ASC) AS pct,
                  COUNT(*) OVER () AS total
           FROM mocks WHERE mock_type = 'round1'
         )
         SELECT rank::int, pct, total::int FROM ranked WHERE id = $1`,
        [r1Mock.id]
      );
      if (rankRows.length) {
        rank = rankRows[0].rank;
        percentile =
          rankRows[0].total <= 1 ? 100 : Math.round(Number(rankRows[0].pct) * 100);
      }
    }

    res.json({
      user,
      stats: {
        r1_submitted: !!r1Mock,
        r1_score: r1Mock?.total_score ?? null,
        r1_exact_picks: r1Mock ? Number(r1Mock.exact_picks) : null,
        r1_correct_picks: r1Mock ? Number(r1Mock.correct_picks) : null,
        r1_rank: rank,
        r1_percentile: percentile,
        total_team_mocks: tmRows[0].total_team_mocks,
      },
    });
  } catch (e) {
    console.error('[profile]', e);
    res.status(500).json({ error: 'server error' });
  }
});

router.get('/:id', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, display_name, avatar_url, created_at FROM users WHERE id = $1',
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
});

export default router;
