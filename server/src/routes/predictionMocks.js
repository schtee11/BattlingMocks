import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth, optionalAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';

const router = Router();
const MAX_SLOTS = 10;

// Allowed event_type values for the usage telemetry table. Kept narrow so
// admin analytics can enumerate exhaustively — add here intentionally.
const EVENT_TYPES = new Set([
  'create',   // user saved a new mock
  'update',   // user overwrote an existing mock
  'delete',   // user deleted a saved mock
  'load',     // user loaded a saved mock into the draft view
  'export',   // user clicked Export/Share (copy-to-clipboard or Web Share)
  'download', // user clicked Download (explicit PNG file save)
  'share',    // reserved for future native-share-only surface
]);

// Best-effort event log. Never throws — analytics is non-critical, so a
// failure here must not break the user-facing CRUD response. Callers can
// fire-and-forget.
async function logMockEvent({ mockId = null, userId = null, eventType, metadata = {} }) {
  if (!EVENT_TYPES.has(eventType)) return;
  try {
    await pool.query(
      `INSERT INTO prediction_mock_events (mock_id, user_id, event_type, metadata)
       VALUES ($1, $2, $3, $4)`,
      [mockId, userId, eventType, JSON.stringify(metadata || {})]
    );
  } catch (e) {
    console.warn('[prediction-mocks] event log failed:', e.message);
  }
}

const saveLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many requests, please wait a minute' },
});

// Separate, looser limit for the telemetry endpoint — a user in a single
// session can legitimately fire many events (load → edit → download → share).
const eventLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many events, slow down' },
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
    // Fire-and-forget usage log (see logMockEvent — errors are swallowed).
    logMockEvent({
      mockId: r.id,
      userId: req.userId,
      eventType: 'create',
      metadata: { pick_count: Object.keys(picks || {}).length },
    });
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
    logMockEvent({
      mockId: r.id,
      userId: req.userId,
      eventType: 'update',
      metadata: { pick_count: Object.keys(picks || {}).length },
    });
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
    // Log BEFORE delete so the FK ON DELETE SET NULL doesn't null out mock_id
    // on the event row. (The event still survives either way, but attaching
    // the id makes per-mock lifetime analysis possible.)
    const { rowCount } = await pool.query(
      'DELETE FROM prediction_mocks WHERE id = $1 AND user_id = $2',
      [mockId, req.userId]
    );
    if (!rowCount) return res.status(404).json({ error: 'not found' });
    logMockEvent({
      mockId: null, // row is gone; leave null rather than dangling reference
      userId: req.userId,
      eventType: 'delete',
      metadata: { original_mock_id: mockId },
    });
    res.status(204).end();
  } catch (e) {
    console.error('[prediction-mocks] delete error:', e);
    res.status(500).json({ error: 'server error' });
  }
});

// ---------- Usage telemetry endpoint ----------
// Clients fire these for load/export/download/share so admins can see how
// the prediction tool is actually being used. Uses optionalAuth so guest
// exports still show up in the analytics — we want the full usage picture,
// not just logged-in activity.
const eventSchema = validate({
  body: z.object({
    event_type: z.enum(['load', 'export', 'download', 'share']),
    mock_id: z.number().int().positive().nullish(),
    metadata: z.record(z.string(), z.any()).optional().default({}),
  }),
});

router.post('/events', eventLimit, optionalAuth, eventSchema, async (req, res) => {
  const { event_type, mock_id, metadata } = req.body;
  // If the client says this event is tied to a saved mock, verify ownership
  // so a user can't spam events against someone else's mock id. For guests
  // (no userId), we just drop the mock_id rather than rejecting — the event
  // is still useful for aggregate counts.
  let effectiveMockId = null;
  if (mock_id != null) {
    if (req.userId) {
      const { rows } = await pool.query(
        'SELECT id FROM prediction_mocks WHERE id = $1 AND user_id = $2',
        [mock_id, req.userId]
      );
      if (rows.length) effectiveMockId = rows[0].id;
    }
  }
  await logMockEvent({
    mockId: effectiveMockId,
    userId: req.userId || null,
    eventType: event_type,
    metadata: metadata || {},
  });
  res.status(204).end();
});

export default router;
