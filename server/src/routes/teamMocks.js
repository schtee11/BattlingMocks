import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

// Team-specific mock drafts (Phase 4). Distinct from the scored Round 1 mock
// stored under mock_type='round1'. Users can save as many team mocks as they
// want — each POST inserts a brand-new mock row.
//
// V1 keeps simulation client-side: the React page runs the bot picker on
// every pick and only POSTs the final 262 picks once the user is done. The
// backend is just a thin persistence layer.

const teamMockPickSchema = z.object({
  pick_number: z.number().int().min(1).max(262),
  player_id: z.number().int(),
  round: z.number().int().optional(),
  team: z.string().max(5).optional(),
});

const submitTeamMockSchema = validate({
  body: z.object({
    team_abbr: z.string().min(2).max(5),
    picks: z.array(teamMockPickSchema).min(1).max(262),
    title: z.string().max(80).optional().nullable(),
    trades: z.array(z.any()).optional().nullable(),
  }),
});

// POST /api/team-mocks — create a new team mock (never updates)
router.post('/', requireAuth, submitTeamMockSchema, async (req, res) => {
  const user_id = req.userId;
  const { team_abbr, picks, title, trades } = req.body;

  const slots = new Set();
  const players = new Set();
  for (const p of picks) {
    if (!Number.isInteger(p.pick_number) || p.pick_number < 1 || p.pick_number > 262) {
      return res.status(400).json({ error: 'invalid pick_number' });
    }
    if (!Number.isInteger(p.player_id)) {
      return res.status(400).json({ error: 'invalid player_id' });
    }
    if (slots.has(p.pick_number)) return res.status(400).json({ error: 'duplicate pick_number' });
    if (players.has(p.player_id)) return res.status(400).json({ error: 'duplicate player_id' });
    slots.add(p.pick_number);
    players.add(p.player_id);
  }

  const trimmedTitle = typeof title === 'string' ? title.trim().slice(0, 80) : null;
  const tradesJson = Array.isArray(trades) ? JSON.stringify(trades) : '[]';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userCheck = await client.query('SELECT id FROM users WHERE id = $1', [user_id]);
    if (!userCheck.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'user not found' });
    }

    const playerIds = picks.map((p) => p.player_id);
    const playerCheck = await client.query(
      'SELECT id FROM players WHERE id = ANY($1::int[])',
      [playerIds]
    );
    if (playerCheck.rows.length !== playerIds.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'one or more player_ids do not exist' });
    }

    // Always INSERT — never UPDATE — so users can save unlimited team mocks
    const ins = await client.query(
      `INSERT INTO mocks (user_id, mock_type, team_abbr, title, trades)
       VALUES ($1, 'team', $2, $3, $4::jsonb)
       RETURNING id`,
      [user_id, team_abbr, trimmedTitle, tradesJson]
    );
    const mockId = ins.rows[0].id;

    // Batch insert all picks in one query instead of N individual INSERTs
    const values = [];
    const params = [];
    picks.forEach((p, i) => {
      const round = Number.isInteger(p.round) ? p.round : 1;
      const pickTeam = typeof p.team === 'string' ? p.team.toUpperCase().slice(0, 5) : null;
      const off = i * 5;
      values.push(`($${off + 1}, $${off + 2}, $${off + 3}, $${off + 4}, $${off + 5})`);
      params.push(mockId, p.pick_number, p.player_id, round, pickTeam);
    });
    await client.query(
      `INSERT INTO mock_picks (mock_id, pick_number, player_id, round, team) VALUES ${values.join(', ')}`,
      params
    );

    await client.query('COMMIT');
    res.status(201).json({ mock_id: mockId });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[team-mocks POST]', e);
    res.status(500).json({ error: 'server error' });
  } finally {
    client.release();
  }
});

// GET /api/team-mocks/user/:userId — list all team mocks for a user
// (metadata only, no picks — keeps the payload small for the list view)
router.get('/user/:userId', async (req, res) => {
  // Count only the picks owned by the user's team (not all 262 bot+user
  // picks), and include the trade count for the list card.
  const { rows } = await pool.query(
    `SELECT m.id, m.user_id, m.submitted_at, m.team_abbr, m.title,
            COUNT(mp.*) FILTER (WHERE mp.team = m.team_abbr)::int AS pick_count,
            COALESCE(jsonb_array_length(m.trades), 0)::int AS trade_count
     FROM mocks m
     LEFT JOIN mock_picks mp ON mp.mock_id = m.id
     WHERE m.user_id = $1 AND m.mock_type = 'team'
     GROUP BY m.id
     ORDER BY m.submitted_at DESC`,
    [req.params.userId]
  );
  res.json(rows);
});

// GET /api/team-mocks/:id — fetch a single team mock with all its picks
router.get('/:id', async (req, res) => {
  const mockId = parseInt(req.params.id, 10);
  if (!Number.isFinite(mockId)) return res.status(400).json({ error: 'invalid id' });

  const { rows: mocks } = await pool.query(
    `SELECT id, user_id, submitted_at, team_abbr, title, mock_type,
            COALESCE(trades, '[]'::jsonb) AS trades
     FROM mocks
     WHERE id = $1 AND mock_type = 'team'`,
    [mockId]
  );
  if (!mocks.length) return res.status(404).json({ error: 'no team mock' });
  const mock = mocks[0];

  // COALESCE gives older saves (where mp.team was not yet snapshotted) a
  // fallback to the current draft_order team for the same pick_number.
  const { rows: picks } = await pool.query(
    `SELECT mp.pick_number, mp.player_id, mp.round,
            COALESCE(mp.team, do2.team) AS team,
            p.name, p.position, p.school, p.headshot_url
     FROM mock_picks mp
     JOIN players p ON p.id = mp.player_id
     LEFT JOIN draft_order do2 ON do2.pick_number = mp.pick_number
     WHERE mp.mock_id = $1
     ORDER BY mp.pick_number`,
    [mock.id]
  );
  res.json({ ...mock, picks });
});

// DELETE /api/team-mocks/:id — delete a specific team mock (owner only)
router.delete('/:id', requireAuth, async (req, res) => {
  const mockId = parseInt(req.params.id, 10);
  if (!Number.isFinite(mockId)) return res.status(400).json({ error: 'invalid id' });

  const result = await pool.query(
    "DELETE FROM mocks WHERE id = $1 AND mock_type = 'team' AND user_id = $2 RETURNING id",
    [mockId, req.userId]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'no team mock' });
  res.status(204).end();
});

export default router;
