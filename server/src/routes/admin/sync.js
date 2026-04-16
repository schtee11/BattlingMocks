import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { adminAuth } from '../../middleware/adminAuth.js';
import { fetchRoundOne, fetchAllRounds, resetLogFlag } from '../../services/espnDraft.js';
import { syncPicksOnce } from '../../services/draftSync.js';
import { startPoller, stopPoller, getStatus as getPollerStatus } from '../../services/draftPoller.js';

const router = Router();
router.use(adminAuth);

// ---------- ESPN draft sync (Phase 1, Round 1 only, manual trigger) ----------
// Both endpoints support ?dry=1 which returns what WOULD be written without
// touching the DB. Use the dry run first to verify the data looks sane.

// GET /api/admin/sync/preview?year=2026 — returns the raw parsed ESPN round-1
// data without writing anything. Useful for verifying the parser.
router.get('/sync/preview', async (req, res) => {
  const year = parseInt(req.query.year, 10) || 2026;
  resetLogFlag();
  try {
    const picks = await fetchRoundOne(year);
    res.json({ year, count: picks.length, picks });
  } catch (e) {
    console.error('[espn preview]', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/sync/draft-order?year=2026[&dry=1]
// Pulls the Round 1 team-per-pick order from ESPN and upserts draft_order.
// Only overwrites team + team_name. team_needs stays untouched.
router.post('/sync/draft-order', async (req, res) => {
  const year = parseInt(req.query.year, 10) || 2026;
  const dry = req.query.dry === '1';
  resetLogFlag();

  try {
    const picks = await fetchRoundOne(year);
    if (picks.length === 0) {
      const currentYear = new Date().getFullYear();
      const future = year > currentYear || (year === currentYear && new Date().getMonth() < 3);
      const hint = future
        ? `ESPN has not published the ${year} draft order yet — it typically appears after the prior draft concludes. The /api/draft-order/future?year=${year} endpoint will keep using the synthetic fallback.`
        : 'ESPN returned no picks; check logs';
      return res.status(502).json({ error: hint, year });
    }

    const r1 = picks.filter((p) => p.round === 1 && p.pick >= 1 && p.pick <= 32 && p.team_abbr);
    const summary = {
      year,
      dry,
      fetched: picks.length,
      round1: r1.length,
      would_update: r1.length,
      samples: r1.slice(0, 5),
    };

    if (dry) return res.json(summary);

    let updated = 0;
    for (const p of r1) {
      try {
        // Upsert so new-year syncs (e.g. 2027) insert rows rather than no-op.
        // Existing-year rows update team/team_name only and keep team_needs.
        await pool.query(
          `INSERT INTO draft_order (pick_number, team, team_name, team_needs, round, draft_year)
           VALUES ($1, $2, $3, ARRAY[]::TEXT[], 1, $4)
           ON CONFLICT (pick_number, draft_year) DO UPDATE
             SET team = EXCLUDED.team,
                 team_name = EXCLUDED.team_name,
                 updated_at = NOW()`,
          [p.pick, p.team_abbr, p.team_name || p.team_abbr, year]
        );
        updated++;
      } catch (e) {
        console.warn('[sync draft-order] pick', p.pick, e.message);
      }
    }

    res.json({ ...summary, updated });
  } catch (e) {
    console.error('[sync draft-order]', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/sync/draft-order-all?year=2026[&dry=1][&include_r1=1]
// Pulls ALL rounds from ESPN and upserts them into draft_order. By default
// leaves R1 alone (so hand-curated team names + annotations stay). Pass
// include_r1=1 to overwrite round 1 too.
router.post('/sync/draft-order-all', async (req, res) => {
  const year = parseInt(req.query.year, 10) || 2026;
  const dry = req.query.dry === '1';
  const includeR1 = req.query.include_r1 === '1';
  resetLogFlag();

  try {
    const picks = await fetchAllRounds(year);
    if (picks.length === 0) {
      const currentYear = new Date().getFullYear();
      const future = year > currentYear || (year === currentYear && new Date().getMonth() < 3);
      const hint = future
        ? `ESPN has not published the ${year} draft order yet — it typically appears after the prior draft concludes. The /api/draft-order/future?year=${year} endpoint will keep using the synthetic fallback.`
        : 'ESPN returned no picks across any round; check logs';
      return res.status(502).json({ error: hint, year });
    }

    const filtered = picks.filter((p) => {
      if (!p.team_abbr) return false;
      if (!includeR1 && p.round === 1) return false;
      return p.pick >= 1 && p.pick <= 262;
    });

    // Group by round for the summary
    const byRound = {};
    for (const p of filtered) {
      byRound[p.round] = (byRound[p.round] || 0) + 1;
    }

    const summary = {
      year,
      dry,
      include_r1: includeR1,
      fetched: picks.length,
      would_update: filtered.length,
      by_round: byRound,
      samples: filtered.slice(0, 5),
    };

    if (dry) return res.json(summary);

    let inserted = 0;
    let updated = 0;
    for (const p of filtered) {
      try {
        // Use RETURNING + xmax to distinguish inserts from updates without an
        // extra SELECT. xmax = 0 means the row was freshly inserted.
        const { rows } = await pool.query(
          `INSERT INTO draft_order (pick_number, team, team_name, team_needs, round, draft_year)
           VALUES ($1, $2, $3, ARRAY[]::TEXT[], $4, $5)
           ON CONFLICT (pick_number, draft_year) DO UPDATE
             SET team = EXCLUDED.team,
                 team_name = EXCLUDED.team_name,
                 round = EXCLUDED.round,
                 updated_at = NOW()
           RETURNING (xmax = 0) AS is_insert`,
          [p.pick, p.team_abbr, p.team_name || p.team_abbr, p.round, year]
        );
        if (rows[0]?.is_insert) inserted++;
        else updated++;
      } catch (e) {
        console.warn('[sync draft-order-all] pick', p.pick, e.message);
      }
    }

    res.json({ ...summary, inserted, updated });
  } catch (e) {
    console.error('[sync draft-order-all]', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/sync/picks?year=2026[&dry=1]
// Thin wrapper around the shared syncPicksOnce service (also used by the
// auto-poller). Matches by player name, upserts actual_picks, re-scores all
// mocks inside one transaction.
router.post('/sync/picks', async (req, res) => {
  const year = parseInt(req.query.year, 10) || 2026;
  const dry = req.query.dry === '1';
  try {
    const summary = await syncPicksOnce({ year, dry });
    res.json(summary);
  } catch (e) {
    console.error('[sync picks]', e);
    res.status(500).json({ error: e.message });
  }
});

// ---------- Auto-poller (Phase 2) ----------
router.get('/sync/poll-status', (_req, res) => {
  res.json(getPollerStatus());
});

router.post('/sync/poll-start', (req, res) => {
  const year = parseInt(req.query.year, 10) || 2026;
  const intervalSec = parseInt(req.query.interval, 10) || 20;
  try {
    const status = startPoller({ year, intervalSec });
    res.json(status);
  } catch (e) {
    console.error('[poller start]', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/sync/poll-stop', (_req, res) => {
  const status = stopPoller();
  res.json(status);
});

export default router;
