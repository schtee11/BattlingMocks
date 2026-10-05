import { Router } from 'express';
import { pool } from '../db/pool.js';
import { CURRENT_DRAFT_YEAR } from '../config.js';

const router = Router();

router.get('/', async (req, res) => {
  // Row number ordering by id approximates the seeded rank. consensus_rank
  // is preferred when present (populated by Phase 6 bulk-import); the row
  // number fallback keeps the existing behavior for un-enriched data.
  // Scoped to one draft class — the current one unless ?year= asks for a
  // past season (old mocks still reference those player rows).
  const year = parseInt(req.query.year, 10) || CURRENT_DRAFT_YEAR;
  const { rows } = await pool.query(
    `SELECT id, name, position, school, headshot_url,
            height, weight, projected_round, consensus_rank,
            ROW_NUMBER() OVER (ORDER BY COALESCE(consensus_rank, 9999), id)::int AS rank
     FROM players
     WHERE draft_year = $1
     ORDER BY COALESCE(consensus_rank, 9999), id`,
    [year]
  );
  res.set('Cache-Control', 'public, max-age=300');
  res.json(rows);
});

// GET /api/players/:id — single prospect detail card
// Returns 404 if the id is unknown. Includes the extended Phase 6 fields
// (height, weight, strengths, weaknesses) for the prospect detail modal.
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'invalid id' });
  }
  const { rows } = await pool.query(
    `SELECT id, name, position, school, headshot_url,
            height, weight, projected_round, consensus_rank, draft_year,
            strengths, weaknesses
     FROM players WHERE id = $1 LIMIT 1`,
    [id]
  );
  if (!rows.length) return res.status(404).json({ error: 'player not found' });
  res.set('Cache-Control', 'public, max-age=300');
  res.json(rows[0]);
});

export default router;
