import { Router } from 'express';
import { pool } from '../db/pool.js';
import { adminAuth } from '../middleware/adminAuth.js';

const router = Router();
router.use(adminAuth);

// Players CRUD
router.post('/players', async (req, res) => {
  const { name, position, school, headshot_url } = req.body || {};
  if (!name || !position) return res.status(400).json({ error: 'name and position required' });
  const { rows } = await pool.query(
    'INSERT INTO players (name, position, school, headshot_url) VALUES ($1, $2, $3, $4) RETURNING *',
    [name, position, school || null, headshot_url || null]
  );
  res.status(201).json(rows[0]);
});

router.put('/players/:id', async (req, res) => {
  const { name, position, school, headshot_url } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE players SET
       name = COALESCE($1, name),
       position = COALESCE($2, position),
       school = COALESCE($3, school),
       headshot_url = COALESCE($4, headshot_url)
     WHERE id = $5 RETURNING *`,
    [name, position, school, headshot_url, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
});

router.delete('/players/:id', async (req, res) => {
  await pool.query('DELETE FROM players WHERE id = $1', [req.params.id]);
  res.status(204).end();
});

// Actual picks
router.get('/actual-picks', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT ap.pick_number, ap.player_id, ap.team, ap.entered_at,
            p.name, p.position, p.school
     FROM actual_picks ap JOIN players p ON p.id = ap.player_id
     ORDER BY ap.pick_number`
  );
  res.json(rows);
});

router.post('/actual-picks', async (req, res) => {
  const { pick_number, player_id, team } = req.body || {};
  if (!Number.isInteger(pick_number) || pick_number < 1 || pick_number > 32) {
    return res.status(400).json({ error: 'invalid pick_number' });
  }
  if (!Number.isInteger(player_id)) {
    return res.status(400).json({ error: 'invalid player_id' });
  }
  const { rows } = await pool.query(
    `INSERT INTO actual_picks (pick_number, player_id, team)
     VALUES ($1, $2, $3)
     ON CONFLICT (pick_number) DO UPDATE
       SET player_id = EXCLUDED.player_id, team = EXCLUDED.team, entered_at = NOW()
     RETURNING *`,
    [pick_number, player_id, team || null]
  );
  res.status(201).json(rows[0]);
});

// Lock toggle
router.post('/lock', async (req, res) => {
  const { is_locked } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE draft_settings SET is_locked = COALESCE($1, NOT is_locked) WHERE id = 1 RETURNING *`,
    [typeof is_locked === 'boolean' ? is_locked : null]
  );
  // also lock all existing mocks if locking
  if (rows[0].is_locked) {
    await pool.query('UPDATE mocks SET is_locked = TRUE');
  }
  res.json(rows[0]);
});

// Scoring
router.post('/score', async (_req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: actuals } = await client.query(
      'SELECT pick_number, player_id FROM actual_picks'
    );
    const actualByPlayer = new Map();
    for (const a of actuals) actualByPlayer.set(a.player_id, a.pick_number);

    const { rows: mocks } = await client.query('SELECT id FROM mocks');
    for (const m of mocks) {
      const { rows: picks } = await client.query(
        'SELECT pick_number, player_id FROM mock_picks WHERE mock_id = $1',
        [m.id]
      );
      let total = 0;
      for (const p of picks) {
        const actualSlot = actualByPlayer.get(p.player_id);
        if (actualSlot == null) continue;
        if (actualSlot === p.pick_number) {
          total += 15;
        } else if (Math.abs(actualSlot - p.pick_number) <= 5) {
          total += 8;
        } else {
          total += 5;
        }
      }
      await client.query('UPDATE mocks SET total_score = $1 WHERE id = $2', [total, m.id]);
    }
    await client.query('UPDATE draft_settings SET scoring_run_at = NOW() WHERE id = 1');
    await client.query('COMMIT');
    res.json({ ok: true, scored: mocks.length });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'server error' });
  } finally {
    client.release();
  }
});

export default router;
