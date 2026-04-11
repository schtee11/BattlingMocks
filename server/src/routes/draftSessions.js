import { Router } from 'express';
import { pool } from '../db/pool.js';

const router = Router();

// Draft-session telemetry. The client fires these endpoints as a
// fire-and-forget log — failures never block the draft flow. Payloads
// are intentionally loose-validated: we'd rather capture a mildly malformed
// session than drop it, because this is data-collection infrastructure.
//
// Relationship to mocks / mock_picks:
//   mocks / mock_picks          = user-curated, explicitly saved drafts
//   draft_sessions / …_picks    = append-only telemetry for every session
//
// The two don't share rows; a "saved" mock and its telemetry session are
// independent records. This keeps the curated-save flow stable while the
// telemetry schema evolves.

// POST /api/draft-sessions — create a session at draft start.
// Body: { session_uuid, user_id?, mock_type, user_team?, randomness,
//         algo_config_snapshot, draft_year }
// The session_uuid is minted client-side so a network retry with the same
// uuid is idempotent (ON CONFLICT DO UPDATE).
router.post('/', async (req, res) => {
  const {
    session_uuid,
    user_id,
    mock_type,
    user_team,
    randomness,
    algo_config_snapshot,
    draft_year,
  } = req.body || {};

  if (!session_uuid || typeof session_uuid !== 'string') {
    return res.status(400).json({ error: 'session_uuid required' });
  }
  if (!mock_type || typeof mock_type !== 'string') {
    return res.status(400).json({ error: 'mock_type required' });
  }

  try {
    // ON CONFLICT DO UPDATE rather than DO NOTHING: if the client retried
    // after a transient failure we still want the latest user_team /
    // randomness values (they may have picked a team just before the retry).
    const { rows } = await pool.query(
      `INSERT INTO draft_sessions
         (session_uuid, user_id, mock_type, user_team, randomness,
          algo_config_snapshot, draft_year)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       ON CONFLICT (session_uuid) DO UPDATE SET
         user_team = COALESCE(EXCLUDED.user_team, draft_sessions.user_team),
         randomness = COALESCE(EXCLUDED.randomness, draft_sessions.randomness),
         algo_config_snapshot = COALESCE(EXCLUDED.algo_config_snapshot, draft_sessions.algo_config_snapshot)
       RETURNING id`,
      [
        session_uuid,
        user_id || null,
        mock_type,
        user_team || null,
        Number.isFinite(randomness) ? randomness : null,
        algo_config_snapshot ? JSON.stringify(algo_config_snapshot) : '{}',
        Number.isInteger(draft_year) ? draft_year : null,
      ]
    );
    res.status(201).json({ session_id: rows[0].id });
  } catch (e) {
    console.error('[draft-sessions POST]', e);
    res.status(500).json({ error: 'server error' });
  }
});

// POST /api/draft-sessions/:id/picks — batch-append picks.
// Body: { picks: [{ pick_number, round, team, player_id, is_user }] }
// Idempotent via UNIQUE (session_id, pick_number) + ON CONFLICT DO NOTHING —
// a retry of the same batch is safe and reports 0 inserted.
router.post('/:id/picks', async (req, res) => {
  const sessionId = parseInt(req.params.id, 10);
  if (!Number.isFinite(sessionId)) {
    return res.status(400).json({ error: 'invalid session id' });
  }

  const { picks } = req.body || {};
  if (!Array.isArray(picks) || picks.length === 0) {
    return res.status(400).json({ error: 'picks[] required' });
  }
  // Hard cap — even a full 7-round draft is only 262 picks, so anything
  // larger is either a bug or abuse.
  if (picks.length > 300) {
    return res.status(400).json({ error: 'batch too large' });
  }

  // Shallow-validate each pick and drop anything malformed rather than
  // rejecting the whole batch. Telemetry should be maximally forgiving.
  const clean = [];
  for (const p of picks) {
    if (!Number.isInteger(p.pick_number) || p.pick_number < 1 || p.pick_number > 262) continue;
    if (!Number.isInteger(p.player_id)) continue;
    clean.push({
      pick_number: p.pick_number,
      round: Number.isInteger(p.round) ? p.round : 1,
      team: typeof p.team === 'string' ? p.team.toUpperCase().slice(0, 5) : 'UNK',
      player_id: p.player_id,
      is_user: !!p.is_user,
    });
  }
  if (clean.length === 0) return res.json({ inserted: 0 });

  try {
    const values = [];
    const params = [];
    clean.forEach((p, i) => {
      const off = i * 6;
      values.push(
        `($${off + 1}, $${off + 2}, $${off + 3}, $${off + 4}, $${off + 5}, $${off + 6})`
      );
      params.push(sessionId, p.pick_number, p.round, p.team, p.player_id, p.is_user);
    });
    const { rowCount } = await pool.query(
      `INSERT INTO draft_session_picks
         (session_id, pick_number, round, team, player_id, is_user)
       VALUES ${values.join(', ')}
       ON CONFLICT (session_id, pick_number) DO NOTHING`,
      params
    );
    res.json({ inserted: rowCount });
  } catch (e) {
    console.error('[draft-sessions picks]', e);
    res.status(500).json({ error: 'server error' });
  }
});

// PATCH /api/draft-sessions/:id — mark session complete.
// Idempotent: a second call is a no-op (WHERE completed_at IS NULL).
router.patch('/:id', async (req, res) => {
  const sessionId = parseInt(req.params.id, 10);
  if (!Number.isFinite(sessionId)) {
    return res.status(400).json({ error: 'invalid session id' });
  }
  try {
    const { rowCount } = await pool.query(
      'UPDATE draft_sessions SET completed_at = NOW() WHERE id = $1 AND completed_at IS NULL',
      [sessionId]
    );
    res.json({ updated: rowCount });
  } catch (e) {
    console.error('[draft-sessions PATCH]', e);
    res.status(500).json({ error: 'server error' });
  }
});

export default router;
