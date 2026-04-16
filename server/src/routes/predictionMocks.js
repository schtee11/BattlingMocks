import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';

const router = Router();
const MAX_SLOTS = 10;

const saveLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many requests, please wait a minute' },
});

const saveSchema = validate({
  body: z.object({
    name: z.string().min(1).max(80),
    picks: z.record(z.string(), z.number().int()).default({}),
    draftOrder: z.array(z.any()).default([]),
  }),
});

const updateSchema = validate({
  body: z.object({
    picks: z.record(z.string(), z.number().int()).default({}),
    draftOrder: z.array(z.any()).default([]),
  }),
});

// List all prediction mocks for the current user
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, picks, draft_order, created_at, updated_at
       FROM prediction_mocks
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [req.userId]
    );
    res.json(rows.map((r) => ({
      id: r.id,
      name: r.name,
      picks: r.picks || {},
      draftOrder: r.draft_order || [],
      savedAt: r.updated_at,
    })));
  } catch (e) {
    console.error('[prediction-mocks] list error:', e);
    res.status(500).json({ error: 'server error' });
  }
});

// Save a new prediction mock
router.post('/', saveLimit, requireAuth, saveSchema, async (req, res) => {
  const { name, picks, draftOrder } = req.body;
  try {
    // Enforce max slots
    const { rows: countRows } = await pool.query(
      'SELECT COUNT(*)::int AS c FROM prediction_mocks WHERE user_id = $1',
      [req.userId]
    );
    if (countRows[0].c >= MAX_SLOTS) {
      return res.status(400).json({ error: `max ${MAX_SLOTS} prediction mocks allowed` });
    }
    const { rows } = await pool.query(
      `INSERT INTO prediction_mocks (user_id, name, picks, draft_order)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, picks, draft_order, updated_at`,
      [req.userId, name, JSON.stringify(picks), JSON.stringify(draftOrder)]
    );
    const r = rows[0];
    res.status(201).json({
      id: r.id,
      name: r.name,
      picks: r.picks || {},
      draftOrder: r.draft_order || [],
      savedAt: r.updated_at,
    });
  } catch (e) {
    console.error('[prediction-mocks] save error:', e);
    res.status(500).json({ error: 'server error' });
  }
});

// Update an existing prediction mock (owner only)
router.put('/:id', saveLimit, requireAuth, updateSchema, async (req, res) => {
  const { picks, draftOrder } = req.body;
  const mockId = parseInt(req.params.id, 10);
  if (!Number.isFinite(mockId)) return res.status(400).json({ error: 'invalid id' });
  try {
    const { rows } = await pool.query(
      `UPDATE prediction_mocks
       SET picks = $1, draft_order = $2, updated_at = NOW()
       WHERE id = $3 AND user_id = $4
       RETURNING id, name, picks, draft_order, updated_at`,
      [JSON.stringify(picks), JSON.stringify(draftOrder), mockId, req.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    const r = rows[0];
    res.json({
      id: r.id,
      name: r.name,
      picks: r.picks || {},
      draftOrder: r.draft_order || [],
      savedAt: r.updated_at,
    });
  } catch (e) {
    console.error('[prediction-mocks] update error:', e);
    res.status(500).json({ error: 'server error' });
  }
});

// Delete a prediction mock (owner only)
router.delete('/:id', requireAuth, async (req, res) => {
  const mockId = parseInt(req.params.id, 10);
  if (!Number.isFinite(mockId)) return res.status(400).json({ error: 'invalid id' });
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM prediction_mocks WHERE id = $1 AND user_id = $2',
      [mockId, req.userId]
    );
    if (!rowCount) return res.status(404).json({ error: 'not found' });
    res.status(204).end();
  } catch (e) {
    console.error('[prediction-mocks] delete error:', e);
    res.status(500).json({ error: 'server error' });
  }
});

export default router;
