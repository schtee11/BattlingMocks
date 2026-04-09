import { Router } from 'express';
import { readFileSync } from 'fs';
import { pool } from '../db/pool.js';
import { adminAuth } from '../middleware/adminAuth.js';
import { importProspects, seedDraftOrder, PROSPECTS_PATH } from '../db/seed.js';
import { fetchRoundOne, resetLogFlag } from '../services/espnDraft.js';
import { runScoringOnClient } from '../services/scoring.js';
import { syncPicksOnce } from '../services/draftSync.js';
import { startPoller, stopPoller, getStatus as getPollerStatus } from '../services/draftPoller.js';

const router = Router();
router.use(adminAuth);

// Shared scoring logic — runs inside whatever transaction client is passed.
// Used by both the explicit POST /score endpoint and the auto-score that
// runs after an actual-pick is entered during draft night.
// runScoringOnClient and sync-picks logic live in services/ so the poller
// can reuse them. The route handlers here are thin wrappers.

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
      return res.status(502).json({ error: 'ESPN returned no picks; check logs' });
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
        await pool.query(
          `UPDATE draft_order
             SET team = $1, team_name = $2, updated_at = NOW()
           WHERE pick_number = $3`,
          [p.team_abbr, p.team_name || p.team_abbr, p.pick]
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

// ---------- Users (admin view) ----------
router.get('/users', async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT
      u.id,
      u.display_name,
      u.avatar_url,
      u.discord_id,
      u.created_at,
      (m.id IS NOT NULL) AS has_mock,
      COALESCE(m.total_score, 0) AS total_score,
      m.submitted_at
    FROM users u
    LEFT JOIN mocks m ON m.user_id = u.id
    ORDER BY u.created_at DESC
  `);
  res.json(rows);
});

// ---------- Players CRUD ----------
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
  try {
    await pool.query('DELETE FROM players WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (e) {
    if (e.code === '23503') {
      return res.status(409).json({ error: 'player is referenced by a mock or actual pick' });
    }
    throw e;
  }
});

// ---------- Import from local JSON ----------
router.post('/import-prospects', async (_req, res) => {
  try {
    const data = JSON.parse(readFileSync(PROSPECTS_PATH, 'utf8'));
    const result = await importProspects(data);
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'import failed: ' + e.message });
  }
});

// ---------- Bulk headshot fetch from ESPN ----------
// Queries ESPN's undocumented search API, prefers college-football results,
// matches by school when possible. Stores successes in players.headshot_url.

// Walks an arbitrary object looking for a plausible image URL. Checks common
// fields first, then falls back to scanning the whole object for any https URL
// that looks like a player headshot.
function extractImageUrl(obj) {
  if (!obj) return null;
  if (typeof obj === 'string') {
    return obj.startsWith('http') ? obj : null;
  }
  if (typeof obj !== 'object') return null;

  const fields = ['default', 'href', 'url', 'src', 'lg', 'large', 'md', 'medium', 'small'];
  for (const f of fields) {
    if (typeof obj[f] === 'string' && obj[f].startsWith('http')) return obj[f];
  }
  try {
    const json = JSON.stringify(obj);
    const m = json.match(/https?:\/\/[^"]*\.(?:png|jpg|jpeg|webp)[^"]*/i);
    if (m) return m[0];
    const m2 = json.match(/https?:\/\/[^"]*(?:headshot|player|athlete|i\/headshots|combiner)[^"]*/i);
    if (m2) return m2[0];
  } catch {}
  return null;
}

let loggedSample = false; // log the first ESPN response per server start for debugging

async function searchEspnForHeadshot(name, school) {
  const q = encodeURIComponent(name);
  // Try the v2 search first — it's what ESPN's own apps use and has stable
  // image URLs on each result. Fall back to common/v3 if v2 misses.
  const urls = [
    `https://site.web.api.espn.com/apis/search/v2?region=us&lang=en&query=${q}&limit=10&page=1`,
    `https://site.web.api.espn.com/apis/common/v3/search?limit=10&query=${q}&type=player`,
  ];

  for (const url of urls) {
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'MockDraftShowdown/1.0 (+https://mockdraftshowdown.netlify.app)',
          Accept: 'application/json',
        },
      });
      if (!r.ok) continue;
      const data = await r.json();

      if (!loggedSample) {
        loggedSample = true;
        console.log('[espn search] sample response for', name, JSON.stringify(data).slice(0, 2000));
      }

      // Normalize candidates from whichever path exists in the response
      const buckets = [
        data?.items,
        data?.results?.flatMap?.((g) => g.contents || g.hits || []),
        data?.results,
      ].filter(Array.isArray);
      const items = (buckets[0] || []).filter((it) => it && typeof it === 'object');

      if (items.length === 0) continue;

      // Prefer college-football hits
      const isCfb = (it) => {
        const blob = [it.sport, it.league, it.subtitle, it.description, JSON.stringify(it.link || '')]
          .filter(Boolean).join(' ').toLowerCase();
        return /college|ncaa|fbs/.test(blob);
      };
      const cfb = items.filter(isCfb);
      const candidates = cfb.length > 0 ? cfb : items;

      // Fuzzy match by school
      let best = candidates[0];
      if (school && candidates.length > 1) {
        const sl = school.toLowerCase();
        const matched = candidates.find((it) => {
          const blob = `${it.subtitle || ''} ${it.description || ''} ${JSON.stringify(it.link || '')}`.toLowerCase();
          return blob.includes(sl);
        });
        if (matched) best = matched;
      }

      // Try each plausible image source
      const candidateImages = [best.image, best.headshot, best.thumbnail, best.img, best.logo, best];
      for (const c of candidateImages) {
        const u = extractImageUrl(c);
        if (u) return u;
      }
    } catch (e) {
      console.error('[espn search] error', e.message);
    }
  }
  return null;
}

router.post('/fetch-headshots', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
  const overwrite = req.query.overwrite === '1';

  // Reset the sample logging flag so the first call after deploy logs a sample
  loggedSample = false;

  const { rows: players } = await pool.query(
    overwrite
      ? 'SELECT id, name, school FROM players ORDER BY id LIMIT $1'
      : 'SELECT id, name, school FROM players WHERE headshot_url IS NULL ORDER BY id LIMIT $1',
    [limit]
  );

  let updated = 0;
  let failed = 0;
  const samples = [];
  for (const p of players) {
    const url = await searchEspnForHeadshot(p.name, p.school);
    if (url) {
      try {
        await pool.query('UPDATE players SET headshot_url = $1 WHERE id = $2', [url, p.id]);
        updated++;
        if (samples.length < 5) samples.push({ name: p.name, url });
      } catch {
        failed++;
      }
    } else {
      failed++;
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  console.log('[fetch-headshots] done', { scanned: players.length, updated, failed, samples });
  res.json({ ok: true, scanned: players.length, updated, failed, samples });
});

// ---------- Draft order ----------
router.get('/draft-order', async (_req, res) => {
  const { rows } = await pool.query(
    'SELECT pick_number, team, team_name, team_needs FROM draft_order ORDER BY pick_number'
  );
  res.json(rows);
});

router.post('/draft-order', async (req, res) => {
  const { order } = req.body || {};
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order[] required' });
  for (const row of order) {
    if (!Number.isInteger(row.pick_number) || row.pick_number < 1 || row.pick_number > 32) {
      return res.status(400).json({ error: 'invalid pick_number' });
    }
    if (!row.team || !row.team_name) {
      return res.status(400).json({ error: 'team and team_name required' });
    }
    if (row.team_needs != null && !Array.isArray(row.team_needs)) {
      return res.status(400).json({ error: 'team_needs must be an array' });
    }
  }
  try {
    await seedDraftOrder(order);
    res.json({ ok: true, updated: order.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server error' });
  }
});

// ---------- Actual picks ----------
router.get('/actual-picks', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT ap.pick_number, ap.player_id, ap.team, ap.entered_at,
            p.name, p.position, p.school, p.headshot_url
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
  const exists = await pool.query('SELECT id FROM players WHERE id = $1', [player_id]);
  if (!exists.rows.length) return res.status(400).json({ error: 'player not found' });

  // Save the pick AND re-score every mock in one transaction so the
  // leaderboard reflects the new state instantly.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO actual_picks (pick_number, player_id, team)
       VALUES ($1, $2, $3)
       ON CONFLICT (pick_number) DO UPDATE
         SET player_id = EXCLUDED.player_id, team = EXCLUDED.team, entered_at = NOW()
       RETURNING *`,
      [pick_number, player_id, team || null]
    );
    const scoredMocks = await runScoringOnClient(client);
    await client.query('COMMIT');
    res.status(201).json({ ...rows[0], scored_mocks: scoredMocks });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[actual-picks auto-score]', e);
    res.status(500).json({ error: 'server error' });
  } finally {
    client.release();
  }
});

router.delete('/actual-picks/:pick', async (req, res) => {
  await pool.query('DELETE FROM actual_picks WHERE pick_number = $1', [req.params.pick]);
  res.status(204).end();
});

// ---------- Lock toggle ----------
router.post('/lock', async (req, res) => {
  const { is_locked } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE draft_settings SET is_locked = COALESCE($1, NOT is_locked) WHERE id = 1 RETURNING *`,
    [typeof is_locked === 'boolean' ? is_locked : null]
  );
  if (rows[0].is_locked) {
    await pool.query('UPDATE mocks SET is_locked = TRUE');
  }
  res.json(rows[0]);
});

// ---------- Scoring (transactional, idempotent) ----------
router.post('/score', async (_req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const totalMocks = await runScoringOnClient(client);
    await client.query('COMMIT');

    const { rows: summary } = await pool.query(`
      SELECT COUNT(*)::int AS scored,
             COALESCE(ROUND(AVG(total_score))::int, 0) AS avg_score,
             COALESCE(MAX(total_score), 0) AS max_score
      FROM mocks WHERE total_score > 0
    `);
    res.json({ ok: true, ...summary[0], total_mocks: totalMocks });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'server error' });
  } finally {
    client.release();
  }
});

export default router;
