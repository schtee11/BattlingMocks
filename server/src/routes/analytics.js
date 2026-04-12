import { Router } from 'express';
import { pool } from '../db/pool.js';

const router = Router();

// GET /api/analytics/r1-consensus
// Most-picked players across all team mock sessions — user picks only.
// Uses draft_session_picks (is_user = TRUE) which was purpose-built for this,
// with a dedicated partial index: idx_draft_session_picks_consensus.
router.get('/r1-consensus', async (_req, res) => {
  try {
    const [playersResult, countResult] = await Promise.all([
      pool.query(`
        SELECT
          p.id,
          p.name,
          p.position,
          p.school,
          p.headshot_url,
          p.consensus_rank,
          COUNT(dsp.id)::int                        AS pick_count,
          ROUND(AVG(dsp.pick_number)::numeric, 1)   AS avg_pick,
          MIN(dsp.pick_number)                      AS earliest_pick,
          MAX(dsp.pick_number)                      AS latest_pick
        FROM draft_session_picks dsp
        JOIN draft_sessions ds ON ds.id = dsp.session_id
        JOIN players p ON p.id = dsp.player_id
        WHERE dsp.is_user = TRUE
          AND ds.mock_type = 'team'
          AND ds.completed_at IS NOT NULL
        GROUP BY p.id
        ORDER BY pick_count DESC, avg_pick ASC
        LIMIT 50
      `),
      pool.query(`SELECT COUNT(*)::int AS total FROM draft_sessions WHERE mock_type = 'team' AND completed_at IS NOT NULL`),
    ]);

    res.set('Cache-Control', 'public, max-age=120');
    res.json({
      total_mocks: countResult.rows[0].total,
      players: playersResult.rows,
    });
  } catch (e) {
    console.error('[analytics/r1-consensus]', e);
    res.status(500).json({ error: 'server error' });
  }
});

// GET /api/analytics/team-pick-breakdown/:team
// Every pick slot a team owns (all 7 rounds), top-3 player choices + % at each
// slot, from draft_session_picks where is_user = TRUE and user_team = :team.
router.get('/team-pick-breakdown/:team', async (req, res) => {
  const team = (req.params.team || '').toUpperCase();
  if (!/^[A-Z0-9]{2,5}$/.test(team)) {
    return res.status(400).json({ error: 'invalid team abbreviation' });
  }
  try {
    const [rowsResult, totalResult] = await Promise.all([
      pool.query(`
        WITH slot_picks AS (
          SELECT
            dsp.pick_number,
            dsp.round,
            p.id          AS player_id,
            p.name,
            p.position,
            p.school,
            p.headshot_url,
            COUNT(*)::int AS pick_count
          FROM draft_session_picks dsp
          JOIN draft_sessions ds ON ds.id = dsp.session_id
          JOIN players p         ON p.id  = dsp.player_id
          WHERE dsp.is_user = TRUE
            AND ds.mock_type = 'team'
            AND ds.user_team = $1
            AND ds.completed_at IS NOT NULL
          GROUP BY dsp.pick_number, dsp.round, p.id, p.name, p.position, p.school, p.headshot_url
        ),
        slot_totals AS (
          SELECT pick_number, SUM(pick_count)::int AS slot_total
          FROM slot_picks
          GROUP BY pick_number
        ),
        ranked AS (
          SELECT
            sp.*,
            st.slot_total,
            ROUND((sp.pick_count::numeric / st.slot_total) * 100, 1)::float AS pct,
            ROW_NUMBER() OVER (PARTITION BY sp.pick_number ORDER BY sp.pick_count DESC) AS slot_rank
          FROM slot_picks sp
          JOIN slot_totals st ON st.pick_number = sp.pick_number
        )
        SELECT *
        FROM ranked
        WHERE slot_rank <= 3
        ORDER BY pick_number ASC, slot_rank ASC
      `, [team]),
      pool.query(`
        SELECT COUNT(DISTINCT id)::int AS total
        FROM draft_sessions
        WHERE mock_type = 'team' AND user_team = $1 AND completed_at IS NOT NULL
      `, [team]),
    ]);

    // Group flat rows into nested picks → options structure
    const picksMap = new Map();
    for (const row of rowsResult.rows) {
      if (!picksMap.has(row.pick_number)) {
        picksMap.set(row.pick_number, {
          pick_number: row.pick_number,
          round: row.round,
          slot_total: row.slot_total,
          options: [],
        });
      }
      picksMap.get(row.pick_number).options.push({
        player_id: row.player_id,
        name: row.name,
        position: row.position,
        school: row.school,
        headshot_url: row.headshot_url,
        pick_count: row.pick_count,
        pct: parseFloat(row.pct),
      });
    }

    res.set('Cache-Control', 'public, max-age=120');
    res.json({
      team,
      total_team_mocks: totalResult.rows[0].total,
      picks: Array.from(picksMap.values()),
    });
  } catch (e) {
    console.error('[analytics/team-pick-breakdown]', e);
    res.status(500).json({ error: 'server error' });
  }
});

// GET /api/analytics/positions
// Position distribution across all team mock sessions — user picks only.
router.get('/positions', async (_req, res) => {
  try {
    const [posResult, totalResult] = await Promise.all([
      pool.query(`
        SELECT
          p.position,
          COUNT(dsp.id)::int AS pick_count
        FROM draft_session_picks dsp
        JOIN draft_sessions ds ON ds.id = dsp.session_id
        JOIN players p         ON p.id  = dsp.player_id
        WHERE dsp.is_user = TRUE
          AND ds.mock_type = 'team'
          AND ds.completed_at IS NOT NULL
        GROUP BY p.position
        ORDER BY pick_count DESC
      `),
      pool.query(`
        SELECT COUNT(dsp.id)::int AS total
        FROM draft_session_picks dsp
        JOIN draft_sessions ds ON ds.id = dsp.session_id
        WHERE dsp.is_user = TRUE
          AND ds.mock_type = 'team'
          AND ds.completed_at IS NOT NULL
      `),
    ]);

    res.set('Cache-Control', 'public, max-age=120');
    res.json({
      total_r1_picks: totalResult.rows[0].total,
      positions: posResult.rows,
    });
  } catch (e) {
    console.error('[analytics/positions]', e);
    res.status(500).json({ error: 'server error' });
  }
});

export default router;
