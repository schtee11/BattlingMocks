import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { adminAuth } from '../../middleware/adminAuth.js';

const router = Router();
router.use(adminAuth);

// ---------- Volume stats (data-set health dashboard) ----------
// Admin self-testing inflates the numbers on this dashboard (consensus data
// is fine with it — every extra board helps the aggregate signal — but the
// "X mocks completed this week" headline is misleading when half of them
// are the admin's own test runs). Exclude them by display_name.
const VOLUME_STATS_EXCLUDED_HANDLES = ['schtee-8923'];

router.get('/volume-stats', async (req, res) => {
  const year = parseInt(req.query.year, 10) || 2026;
  try {
    // Resolve the handles to user_ids once. Missing handles just yield an
    // empty list — the rest of the queries degrade to their unfiltered form.
    const { rows: excludedRows } = await pool.query(
      `SELECT id FROM users WHERE display_name = ANY($1::text[])`,
      [VOLUME_STATS_EXCLUDED_HANDLES]
    );
    const excludedIds = excludedRows.map((r) => r.id);

    // 1) High-level session counts
    const { rows: [overview] } = await pool.query(`
      SELECT
        COUNT(*)::int                                           AS total_sessions,
        SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END)::int AS completed,
        SUM(CASE WHEN completed_at IS NULL THEN 1 ELSE 0 END)::int     AS abandoned,
        COUNT(DISTINCT user_id)::int                            AS unique_users,
        SUM(CASE WHEN user_id IS NULL THEN 1 ELSE 0 END)::int  AS anonymous_sessions,
        ROUND(EXTRACT(EPOCH FROM AVG(
          CASE WHEN completed_at IS NOT NULL THEN completed_at - started_at END
        )))::int                                                AS avg_duration_sec,
        MIN(started_at)                                         AS earliest_session,
        MAX(started_at)                                         AS latest_session
      FROM draft_sessions
      WHERE draft_year = $1
        AND (user_id IS NULL OR user_id <> ALL($2::uuid[]))
    `, [year, excludedIds]);

    // 2) Team mock breakdown by user_team (the money query)
    const { rows: byTeam } = await pool.query(`
      SELECT
        user_team,
        COUNT(*)::int                                           AS total,
        SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END)::int AS completed,
        COUNT(DISTINCT user_id)::int                            AS unique_users
      FROM draft_sessions
      WHERE draft_year = $1 AND mock_type = 'team'
        AND (user_id IS NULL OR user_id <> ALL($2::uuid[]))
      GROUP BY user_team
      ORDER BY completed DESC, user_team
    `, [year, excludedIds]);

    // 4) Daily volume over last 30 days
    // Convert to America/New_York before extracting the date so that sessions
    // are bucketed into the correct EST/EDT calendar day rather than UTC day.
    const { rows: daily } = await pool.query(`
      SELECT
        TO_CHAR(started_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS day,
        COUNT(*)::int                                           AS total,
        SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END)::int AS completed,
        COUNT(DISTINCT CASE WHEN completed_at IS NOT NULL AND mock_type = 'team' THEN user_team END)::int AS distinct_teams
      FROM draft_sessions
      WHERE draft_year = $1
        AND started_at >= NOW() - INTERVAL '30 days'
        AND (user_id IS NULL OR user_id <> ALL($2::uuid[]))
      GROUP BY TO_CHAR(started_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD')
      ORDER BY day DESC
    `, [year, excludedIds]);

    // 5) Top users by completed team mocks (guests lumped together)
    const { rows: topUsers } = await pool.query(`
      SELECT
        COALESCE(ds.user_id::text, 'guest') AS user_id,
        COALESCE(u.display_name, 'Guest')   AS display_name,
        COUNT(*)::int                        AS completed_team_mocks
      FROM draft_sessions ds
      LEFT JOIN users u ON u.id = ds.user_id
      WHERE ds.draft_year = $1
        AND ds.mock_type = 'team'
        AND ds.completed_at IS NOT NULL
        AND (ds.user_id IS NULL OR ds.user_id <> ALL($2::uuid[]))
      GROUP BY COALESCE(ds.user_id::text, 'guest'), COALESCE(u.display_name, 'Guest')
      ORDER BY completed_team_mocks DESC
      LIMIT 15
    `, [year, excludedIds]);

    // 6) Latest 20 sessions
    const { rows: recent } = await pool.query(`
      SELECT
        ds.id,
        ds.user_team,
        ds.started_at,
        ds.completed_at,
        CASE WHEN ds.user_id IS NULL THEN TRUE ELSE FALSE END AS is_guest,
        COALESCE(u.display_name, 'Guest')                     AS display_name
      FROM draft_sessions ds
      LEFT JOIN users u ON u.id = ds.user_id
      WHERE ds.draft_year = $1
        AND (ds.user_id IS NULL OR ds.user_id <> ALL($2::uuid[]))
      ORDER BY ds.started_at DESC
      LIMIT 20
    `, [year, excludedIds]);

    res.json({ year, overview, byTeam, daily, topUsers, recent });
  } catch (e) {
    console.error('[volume-stats]', e);
    res.status(500).json({ error: 'server error' });
  }
});

// ---------- User Boards activity dashboard ----------
router.get('/boards', async (_req, res) => {
  try {
    const { rows: [overview] } = await pool.query(`
      SELECT
        COUNT(DISTINCT ub.id)::int                          AS total_boards,
        COUNT(DISTINCT ub.user_id)::int                     AS unique_users,
        COUNT(ubr.board_id)::int                            AS total_rankings,
        ROUND(
          CASE WHEN COUNT(DISTINCT ub.id) > 0
            THEN COUNT(ubr.board_id)::numeric / COUNT(DISTINCT ub.id)
            ELSE 0
          END, 1
        )                                                   AS avg_rankings_per_board,
        MIN(ub.created_at)                                  AS earliest_board,
        MAX(ub.created_at)                                  AS latest_board
      FROM user_boards ub
      LEFT JOIN user_board_rankings ubr ON ubr.board_id = ub.id
    `);

    const { rows: recentBoards } = await pool.query(`
      SELECT
        ub.id,
        ub.title,
        ub.created_at,
        ub.updated_at,
        u.display_name,
        u.avatar_url,
        COUNT(ubr.board_id)::int AS ranking_count
      FROM user_boards ub
      LEFT JOIN users u ON u.id = ub.user_id
      LEFT JOIN user_board_rankings ubr ON ubr.board_id = ub.id
      GROUP BY ub.id, ub.title, ub.created_at, ub.updated_at, u.display_name, u.avatar_url
      ORDER BY ub.created_at DESC
      LIMIT 30
    `);

    const { rows: topUsers } = await pool.query(`
      SELECT
        u.display_name,
        u.avatar_url,
        COUNT(ub.id)::int                      AS board_count,
        SUM(sub.ranking_count)::int            AS total_rankings
      FROM users u
      JOIN user_boards ub ON ub.user_id = u.id
      LEFT JOIN (
        SELECT board_id, COUNT(*)::int AS ranking_count
        FROM user_board_rankings
        GROUP BY board_id
      ) sub ON sub.board_id = ub.id
      GROUP BY u.id, u.display_name, u.avatar_url
      ORDER BY board_count DESC, total_rankings DESC
      LIMIT 15
    `);

    const { rows: daily } = await pool.query(`
      SELECT
        TO_CHAR(created_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS day,
        COUNT(*)::int AS boards_created
      FROM user_boards
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY TO_CHAR(created_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD')
      ORDER BY day DESC
    `);

    res.json({ overview, recentBoards, topUsers, daily });
  } catch (e) {
    console.error('[admin/boards]', e);
    res.status(500).json({ error: 'server error' });
  }
});

// ---------- Prediction mocks analytics ----------
// Usage dashboard for the predictive-draft tool: how many mocks users save,
// how often they load/export/download, and who the power users are. Powers
// the "Prediction Mocks" panel inside the Volume Stats tab.
router.get('/prediction-mock-stats', async (_req, res) => {
  try {
    // Same admin-exclusion the team-mock volume stats use — filter the
    // admin's own test mocks out of every prediction-mock query.
    const { rows: excludedRows } = await pool.query(
      `SELECT id FROM users WHERE display_name = ANY($1::text[])`,
      [VOLUME_STATS_EXCLUDED_HANDLES]
    );
    const excludedIds = excludedRows.map((r) => r.id);

    // 1) Saved-slot overview — the state of the prediction_mocks table
    //    right now (not an event count).
    const { rows: [slotOverview] } = await pool.query(`
      SELECT
        COUNT(*)::int                                AS total_mocks,
        COUNT(DISTINCT user_id)::int                 AS unique_users,
        ROUND(
          CASE WHEN COUNT(DISTINCT user_id) > 0
            THEN COUNT(*)::numeric / COUNT(DISTINCT user_id)
            ELSE 0
          END, 2
        )                                            AS avg_mocks_per_user,
        MIN(created_at)                              AS earliest_mock,
        MAX(updated_at)                              AS latest_mock_update
      FROM prediction_mocks
      WHERE user_id IS NULL OR user_id <> ALL($1::uuid[])
    `, [excludedIds]);

    // 2) Event counts grouped by event_type (all time + last 30 days).
    //    The caller gets both windows so the UI can show "lifetime" and
    //    "trailing 30" side-by-side.
    const { rows: eventsByType } = await pool.query(`
      SELECT
        event_type,
        COUNT(*)::int                                                        AS total,
        SUM(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END)::int AS last_30d,
        SUM(CASE WHEN created_at >= NOW() - INTERVAL '7 days'  THEN 1 ELSE 0 END)::int AS last_7d,
        COUNT(DISTINCT user_id)::int                                         AS unique_users,
        SUM(CASE WHEN user_id IS NULL THEN 1 ELSE 0 END)::int                AS guest_events
      FROM prediction_mock_events
      WHERE user_id IS NULL OR user_id <> ALL($1::uuid[])
      GROUP BY event_type
      ORDER BY total DESC
    `, [excludedIds]);

    // 3) Daily trend — one row per EST/EDT day for the last 30 days, with
    //    each event_type pivoted into its own column so the UI can render a
    //    stacked bar without post-processing.
    const { rows: daily } = await pool.query(`
      SELECT
        TO_CHAR(created_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS day,
        COUNT(*)::int                                                     AS total,
        SUM(CASE WHEN event_type = 'create'   THEN 1 ELSE 0 END)::int     AS created,
        SUM(CASE WHEN event_type = 'update'   THEN 1 ELSE 0 END)::int     AS updated,
        SUM(CASE WHEN event_type = 'delete'   THEN 1 ELSE 0 END)::int     AS deleted,
        SUM(CASE WHEN event_type = 'load'     THEN 1 ELSE 0 END)::int     AS loaded,
        SUM(CASE WHEN event_type = 'export'   THEN 1 ELSE 0 END)::int     AS exported,
        SUM(CASE WHEN event_type = 'download' THEN 1 ELSE 0 END)::int     AS downloaded
      FROM prediction_mock_events
      WHERE created_at >= NOW() - INTERVAL '30 days'
        AND (user_id IS NULL OR user_id <> ALL($1::uuid[]))
      GROUP BY TO_CHAR(created_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD')
      ORDER BY day DESC
    `, [excludedIds]);

    // 4) Top users — who is getting the most value out of the tool? Ranks by
    //    export+download events (the "shared their mock" signal) with ties
    //    broken by total activity. Guests (user_id NULL) are lumped into one
    //    row so the leaderboard doesn't get overwhelmed by anonymous usage.
    const { rows: topUsers } = await pool.query(`
      SELECT
        COALESCE(e.user_id::text, 'guest')                                  AS user_id,
        COALESCE(u.display_name, 'Guest')                                   AS display_name,
        u.avatar_url                                                        AS avatar_url,
        COUNT(*)::int                                                       AS total_events,
        SUM(CASE WHEN e.event_type IN ('export','download','share') THEN 1 ELSE 0 END)::int AS exports,
        SUM(CASE WHEN e.event_type = 'create' THEN 1 ELSE 0 END)::int       AS mocks_created,
        SUM(CASE WHEN e.event_type = 'load'   THEN 1 ELSE 0 END)::int       AS loads,
        MAX(e.created_at)                                                   AS last_active
      FROM prediction_mock_events e
      LEFT JOIN users u ON u.id = e.user_id
      WHERE e.user_id IS NULL OR e.user_id <> ALL($1::uuid[])
      GROUP BY COALESCE(e.user_id::text, 'guest'),
               COALESCE(u.display_name, 'Guest'),
               u.avatar_url
      ORDER BY exports DESC, total_events DESC
      LIMIT 15
    `, [excludedIds]);

    // 5) Mode breakdown for export/download — how much of the export volume
    //    comes from prediction mode vs. competition mode? The client sends
    //    metadata.mode with each export event, so this is a JSONB lookup.
    const { rows: byMode } = await pool.query(`
      SELECT
        COALESCE(metadata->>'mode', 'unknown') AS mode,
        event_type,
        COUNT(*)::int                          AS count
      FROM prediction_mock_events
      WHERE event_type IN ('export', 'download')
        AND (user_id IS NULL OR user_id <> ALL($1::uuid[]))
      GROUP BY COALESCE(metadata->>'mode', 'unknown'), event_type
      ORDER BY mode, event_type
    `, [excludedIds]);

    // 6) Most-popular saved slots — which mocks are being exported/downloaded
    //    most. Helps identify which user-generated content is "going viral"
    //    (relative to the small scale of this tool). Only rows where mock_id
    //    is still attached — excludes events whose mocks have been deleted.
    const { rows: topMocks } = await pool.query(`
      SELECT
        pm.id,
        pm.name,
        pm.updated_at,
        u.display_name,
        COUNT(*) FILTER (WHERE e.event_type IN ('export','download','share'))::int AS export_count,
        COUNT(*) FILTER (WHERE e.event_type = 'load')::int                         AS load_count
      FROM prediction_mock_events e
      JOIN prediction_mocks pm ON pm.id = e.mock_id
      LEFT JOIN users u        ON u.id = pm.user_id
      WHERE e.mock_id IS NOT NULL
        AND e.event_type IN ('export','download','share','load')
        AND (pm.user_id IS NULL OR pm.user_id <> ALL($1::uuid[]))
      GROUP BY pm.id, pm.name, pm.updated_at, u.display_name
      HAVING COUNT(*) FILTER (WHERE e.event_type IN ('export','download','share','load')) > 0
      ORDER BY export_count DESC, load_count DESC
      LIMIT 10
    `, [excludedIds]);

    // 7) Recent event stream — last 20 events, for a "what's happening right
    //    now" feel. Includes the mock name + user display when resolvable.
    const { rows: recent } = await pool.query(`
      SELECT
        e.id,
        e.event_type,
        e.created_at,
        e.metadata,
        COALESCE(u.display_name, 'Guest') AS display_name,
        CASE WHEN e.user_id IS NULL THEN TRUE ELSE FALSE END AS is_guest,
        pm.name AS mock_name
      FROM prediction_mock_events e
      LEFT JOIN users u            ON u.id = e.user_id
      LEFT JOIN prediction_mocks pm ON pm.id = e.mock_id
      WHERE e.user_id IS NULL OR e.user_id <> ALL($1::uuid[])
      ORDER BY e.created_at DESC
      LIMIT 20
    `, [excludedIds]);

    res.json({
      slotOverview,
      eventsByType,
      daily,
      topUsers,
      byMode,
      topMocks,
      recent,
    });
  } catch (e) {
    console.error('[prediction-mock-stats]', e);
    res.status(500).json({ error: 'server error' });
  }
});

export default router;
