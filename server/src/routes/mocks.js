import { Router } from 'express';
import { pool } from '../db/pool.js';

const router = Router();

async function getSettings(client = pool) {
  const { rows } = await client.query('SELECT * FROM draft_settings WHERE id = 1');
  return rows[0];
}

router.post('/', async (req, res) => {
  const { user_id, picks } = req.body || {};
  if (!user_id || !Array.isArray(picks)) {
    return res.status(400).json({ error: 'user_id and picks[] required' });
  }
  if (picks.length !== 32) {
    return res.status(400).json({ error: 'must submit exactly 32 picks' });
  }
  const slots = new Set();
  const players = new Set();
  for (const p of picks) {
    if (!Number.isInteger(p.pick_number) || p.pick_number < 1 || p.pick_number > 32) {
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
    const settings = await getSettings(client);
    if (settings.is_locked) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'submissions are locked' });
    }
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
    const existing = await client.query(
      "SELECT id FROM mocks WHERE user_id = $1 AND mock_type = 'round1'",
      [user_id]
    );
    let mockId;
    if (existing.rows.length) {
      mockId = existing.rows[0].id;
      await client.query('DELETE FROM mock_picks WHERE mock_id = $1', [mockId]);
      await client.query('UPDATE mocks SET submitted_at = NOW(), total_score = 0 WHERE id = $1', [mockId]);
    } else {
      const ins = await client.query(
        "INSERT INTO mocks (user_id, mock_type) VALUES ($1, 'round1') RETURNING id",
        [user_id]
      );
      mockId = ins.rows[0].id;
    }
    for (const p of picks) {
      await client.query(
        'INSERT INTO mock_picks (mock_id, pick_number, player_id) VALUES ($1, $2, $3)',
        [mockId, p.pick_number, p.player_id]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ mock_id: mockId });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'server error' });
  } finally {
    client.release();
  }
});

router.get('/:userId', async (req, res) => {
  const { rows: mocks } = await pool.query(
    "SELECT id, user_id, submitted_at, is_locked, total_score FROM mocks WHERE user_id = $1 AND mock_type = 'round1'",
    [req.params.userId]
  );
  if (!mocks.length) return res.status(404).json({ error: 'no mock' });
  const mock = mocks[0];
  const { rows: picks } = await pool.query(
    `SELECT mp.pick_number, mp.player_id, p.name, p.position, p.school, p.headshot_url
     FROM mock_picks mp JOIN players p ON p.id = mp.player_id
     WHERE mp.mock_id = $1 ORDER BY mp.pick_number`,
    [mock.id]
  );
  res.json({ ...mock, picks });
});

export default router;
