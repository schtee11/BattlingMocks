import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

// All routes require authentication.
router.use(requireAuth);

// ─── Schemas ─────────────────────────────────────────────────────────────────

const rankingSchema = z.object({
  player_id: z.number().int().positive(),
  rank: z.number().int().positive(),
});

const createBoardSchema = validate({
  body: z.object({
    title: z.string().min(1).max(100).default('My Board'),
    rankings: z.array(rankingSchema).max(800).optional().default([]),
  }),
});

const updateBoardSchema = validate({
  body: z.object({
    title: z.string().min(1).max(100).optional(),
    rankings: z.array(rankingSchema).max(800).optional(),
  }),
});

// ─── Helper: verify board ownership ──────────────────────────────────────────

async function getOwnedBoard(boardId, userId) {
  const { rows } = await pool.query(
    'SELECT id, user_id, title, created_at, updated_at FROM user_boards WHERE id = $1',
    [boardId]
  );
  if (!rows[0]) return null;
  if (rows[0].user_id !== userId) return false; // forbidden
  return rows[0];
}

// ─── GET /api/boards — list user's boards (metadata only) ────────────────────

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.id, b.title, b.created_at, b.updated_at,
              COUNT(r.player_id)::int AS rank_count
       FROM user_boards b
       LEFT JOIN user_board_rankings r ON r.board_id = b.id
       WHERE b.user_id = $1
       GROUP BY b.id
       ORDER BY b.updated_at DESC`,
      [req.userId]
    );
    res.json(rows);
  } catch (err) {
    console.error('boards list error:', err);
    res.status(500).json({ error: 'Failed to load boards' });
  }
});

// ─── POST /api/boards — create a new board ───────────────────────────────────

router.post('/', createBoardSchema, async (req, res) => {
  const { title, rankings } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO user_boards (user_id, title) VALUES ($1, $2) RETURNING id`,
      [req.userId, title.trim()]
    );
    const boardId = rows[0].id;

    if (rankings.length > 0) {
      // Verify all player_ids exist before inserting
      const ids = rankings.map((r) => r.player_id);
      const { rows: found } = await client.query(
        'SELECT id FROM players WHERE id = ANY($1)',
        [ids]
      );
      const foundSet = new Set(found.map((r) => r.id));
      const missing = ids.filter((id) => !foundSet.has(id));
      if (missing.length > 0) {
        await client.query('ROLLBACK');
        return res.status(422).json({ error: `Unknown player ids: ${missing.join(', ')}` });
      }

      // Build a parameterized bulk INSERT to avoid any risk of SQL injection.
      // boardId is a server-generated integer (never user input), but
      // player_id and rank come from the request body so we use $N placeholders.
      const placeholders = rankings.map((_, i) => {
        const b = i * 3;
        return `($${b + 1}, $${b + 2}, $${b + 3})`;
      }).join(', ');
      const params = rankings.flatMap((r) => [boardId, r.player_id, r.rank]);
      await client.query(
        `INSERT INTO user_board_rankings (board_id, player_id, rank) VALUES ${placeholders}
         ON CONFLICT (board_id, player_id) DO UPDATE SET rank = EXCLUDED.rank`,
        params
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ id: boardId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('boards create error:', err);
    res.status(500).json({ error: 'Failed to create board' });
  } finally {
    client.release();
  }
});

// ─── GET /api/boards/:id — full ordered player list (user-ranked + auto-completed) ──

router.get('/:id', async (req, res) => {
  const boardId = parseInt(req.params.id, 10);
  if (!Number.isFinite(boardId)) return res.status(400).json({ error: 'Invalid board id' });

  try {
    const board = await getOwnedBoard(boardId, req.userId);
    if (board === null) return res.status(404).json({ error: 'Board not found' });
    if (board === false) return res.status(403).json({ error: 'Forbidden' });

    // 1. Explicitly ranked players, in user's order
    const { rows: ranked } = await pool.query(
      `SELECT p.id, p.name, p.position, p.school, p.headshot_url,
              p.consensus_rank, p.projected_round, p.height, p.weight,
              r.rank AS user_rank
       FROM user_board_rankings r
       JOIN players p ON p.id = r.player_id
       WHERE r.board_id = $1
       ORDER BY r.rank ASC`,
      [boardId]
    );

    // 2. Remaining players not in the board, ordered by default consensus_rank
    const rankedIds = ranked.map((p) => p.id);
    const { rows: rest } = await pool.query(
      `SELECT id, name, position, school, headshot_url,
              consensus_rank, projected_round, height, weight
       FROM players
       WHERE ($1::int[] IS NULL OR id != ALL($1))
       ORDER BY COALESCE(consensus_rank, 9999), id`,
      [rankedIds.length > 0 ? rankedIds : null]
    );

    // 3. Merge and assign sequential rank 1..N
    const merged = [
      ...ranked.map((p, i) => ({ ...p, rank: i + 1 })),
      ...rest.map((p, i) => ({ ...p, rank: ranked.length + i + 1 })),
    ];

    res.json({ board: { id: board.id, title: board.title }, players: merged });
  } catch (err) {
    console.error('boards get error:', err);
    res.status(500).json({ error: 'Failed to load board' });
  }
});

// ─── GET /api/boards/:id/top50 — first 50 explicitly-ranked players ──────────

router.get('/:id/top50', async (req, res) => {
  const boardId = parseInt(req.params.id, 10);
  if (!Number.isFinite(boardId)) return res.status(400).json({ error: 'Invalid board id' });

  try {
    const board = await getOwnedBoard(boardId, req.userId);
    if (board === null) return res.status(404).json({ error: 'Board not found' });
    if (board === false) return res.status(403).json({ error: 'Forbidden' });

    const { rows } = await pool.query(
      `SELECT p.id, p.name, p.position, p.school, p.headshot_url,
              p.consensus_rank, p.projected_round,
              r.rank AS rank
       FROM user_board_rankings r
       JOIN players p ON p.id = r.player_id
       WHERE r.board_id = $1
       ORDER BY r.rank ASC
       LIMIT 50`,
      [boardId]
    );

    res.json({ board: { id: board.id, title: board.title }, players: rows });
  } catch (err) {
    console.error('boards top50 error:', err);
    res.status(500).json({ error: 'Failed to load top 50' });
  }
});

// ─── PUT /api/boards/:id — update title and/or full rankings ─────────────────

router.put('/:id', updateBoardSchema, async (req, res) => {
  const boardId = parseInt(req.params.id, 10);
  if (!Number.isFinite(boardId)) return res.status(400).json({ error: 'Invalid board id' });

  const { title, rankings } = req.body;
  const client = await pool.connect();
  try {
    const board = await getOwnedBoard(boardId, req.userId);
    if (board === null) return res.status(404).json({ error: 'Board not found' });
    if (board === false) return res.status(403).json({ error: 'Forbidden' });

    await client.query('BEGIN');

    if (title !== undefined) {
      await client.query(
        'UPDATE user_boards SET title = $1, updated_at = NOW() WHERE id = $2',
        [title.trim(), boardId]
      );
    }

    if (rankings !== undefined) {
      // Validate player ids
      if (rankings.length > 0) {
        const ids = rankings.map((r) => r.player_id);
        const { rows: found } = await client.query(
          'SELECT id FROM players WHERE id = ANY($1)',
          [ids]
        );
        const foundSet = new Set(found.map((r) => r.id));
        const missing = ids.filter((id) => !foundSet.has(id));
        if (missing.length > 0) {
          await client.query('ROLLBACK');
          return res.status(422).json({ error: `Unknown player ids: ${missing.join(', ')}` });
        }
      }

      // Replace all rankings for this board atomically using parameterized query.
      await client.query('DELETE FROM user_board_rankings WHERE board_id = $1', [boardId]);
      if (rankings.length > 0) {
        const placeholders = rankings.map((_, i) => {
          const b = i * 3;
          return `($${b + 1}, $${b + 2}, $${b + 3})`;
        }).join(', ');
        const params = rankings.flatMap((r) => [boardId, r.player_id, r.rank]);
        await client.query(
          `INSERT INTO user_board_rankings (board_id, player_id, rank) VALUES ${placeholders}`,
          params
        );
      }

      // Always bump updated_at when rankings change
      await client.query(
        'UPDATE user_boards SET updated_at = NOW() WHERE id = $1',
        [boardId]
      );
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('boards update error:', err);
    res.status(500).json({ error: 'Failed to update board' });
  } finally {
    client.release();
  }
});

// ─── DELETE /api/boards/:id ───────────────────────────────────────────────────

router.delete('/:id', async (req, res) => {
  const boardId = parseInt(req.params.id, 10);
  if (!Number.isFinite(boardId)) return res.status(400).json({ error: 'Invalid board id' });

  try {
    const board = await getOwnedBoard(boardId, req.userId);
    if (board === null) return res.status(404).json({ error: 'Board not found' });
    if (board === false) return res.status(403).json({ error: 'Forbidden' });

    // CASCADE on user_board_rankings handles rank rows automatically
    await pool.query('DELETE FROM user_boards WHERE id = $1', [boardId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('boards delete error:', err);
    res.status(500).json({ error: 'Failed to delete board' });
  }
});

export default router;
