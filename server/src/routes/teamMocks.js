import { Router } from 'express';
import { pool } from '../db/pool.js';

const router = Router();

// Team-specific mock drafts (Phase 4). Distinct from the scored Round 1 mock
// stored under mock_type='round1'. A user can hold one of each kind because
// the unique constraint is (user_id, mock_type).
//
// V1 keeps simulation client-side: the React page runs the bot picker on
// every pick and only POSTs the final 262 picks once the user is done. The
// backend is just a thin persistence layer.

router.post('/', async (req, res) => {
  const { user_id, team_abbr, picks } = req.body || {};
  if (!user_id || !team_abbr || !Array.isArray(picks)) {
    return res.status(400).json({ error: 'user_id, team_abbr, picks[] required' });
  }
  if (picks.length === 0) {
    return res.status(400).json({ error: 'picks[] cannot be empty' });
  }

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

    // Upsert the parent mock row, keyed on (user_id, mock_type='team').
    const existing = await client.query(
      "SELECT id FROM mocks WHERE user_id = $1 AND mock_type = 'team'",
      [user_id]
    );
    let mockId;
    if (existing.rows.length) {
      mockId = existing.rows[0].id;
      await client.query('DELETE FROM mock_picks WHERE mock_id = $1', [mockId]);
      await client.query(
        'UPDATE mocks SET submitted_at = NOW(), team_abbr = $1, total_score = 0 WHERE id = $2',
        [team_abbr, mockId]
      );
    } else {
      const ins = await client.query(
        "INSERT INTO mocks (user_id, mock_type, team_abbr) VALUES ($1, 'team', $2) RETURNING id",
        [user_id, team_abbr]
      );
      mockId = ins.rows[0].id;
    }

    // Bulk insert. Round comes from the client (1..7) so the schema's round
    // index stays accurate; default to 1 if missing for safety.
    for (const p of picks) {
      const round = Number.isInteger(p.round) ? p.round : 1;
      await client.query(
        'INSERT INTO mock_picks (mock_id, pick_number, player_id, round) VALUES ($1, $2, $3, $4)',
        [mockId, p.pick_number, p.player_id, round]
      );
    }

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

router.get('/:userId', async (req, res) => {
  const { rows: mocks } = await pool.query(
    `SELECT id, user_id, submitted_at, team_abbr, mock_type
     FROM mocks
     WHERE user_id = $1 AND mock_type = 'team'`,
    [req.params.userId]
  );
  if (!mocks.length) return res.status(404).json({ error: 'no team mock' });
  const mock = mocks[0];

  const { rows: picks } = await pool.query(
    `SELECT mp.pick_number, mp.player_id, mp.round,
            p.name, p.position, p.school, p.headshot_url
     FROM mock_picks mp
     JOIN players p ON p.id = mp.player_id
     WHERE mp.mock_id = $1
     ORDER BY mp.pick_number`,
    [mock.id]
  );
  res.json({ ...mock, picks });
});

router.delete('/:userId', async (req, res) => {
  const result = await pool.query(
    "DELETE FROM mocks WHERE user_id = $1 AND mock_type = 'team' RETURNING id",
    [req.params.userId]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'no team mock' });
  res.status(204).end();
});

export default router;
