import { Router } from 'express';
import { pool } from '../db/pool.js';

const router = Router();

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

router.post('/', async (req, res) => {
  const { display_name } = req.body || {};
  if (!display_name || typeof display_name !== 'string' || display_name.trim().length < 2) {
    return res.status(400).json({ error: 'display_name required (min 2 chars)' });
  }
  const name = display_name.trim().slice(0, 60);
  try {
    const { rows } = await pool.query(
      'INSERT INTO users (display_name) VALUES ($1) RETURNING id, display_name, created_at',
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

router.get('/:id', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, display_name, created_at FROM users WHERE id = $1',
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
});

export default router;
