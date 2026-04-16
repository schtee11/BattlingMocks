import { Router } from 'express';
import { readFileSync } from 'fs';
import { pool } from '../../db/pool.js';
import { adminAuth } from '../../middleware/adminAuth.js';
import { importProspects, normalizePosition, PROSPECTS_PATH } from '../../db/seed.js';
import { fetchProspects, resetLogFlag } from '../../services/espnDraft.js';

const router = Router();
router.use(adminAuth);

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

// ---------- Sync prospects from ESPN ----------
// Tries several ESPN prospects endpoints, normalizes, upserts. Dry-run
// mode returns the first few parsed prospects without writing.
router.post('/prospects/sync-from-espn', async (req, res) => {
  const year = parseInt(req.query.year, 10) || 2026;
  const limit = Math.min(parseInt(req.query.limit, 10) || 400, 1000);
  const dry = req.query.dry === '1';
  resetLogFlag();

  try {
    const prospects = await fetchProspects(year, limit);
    if (prospects.length === 0) {
      return res.status(502).json({
        error: 'ESPN returned no prospects from any endpoint; check logs',
        hint: 'Use the bulk-import JSON paste instead',
      });
    }

    const summary = {
      year,
      dry,
      fetched: prospects.length,
      samples: prospects.slice(0, 10),
    };

    if (dry) return res.json(summary);

    const result = await importProspects(prospects);
    res.json({ ...summary, ...result });
  } catch (e) {
    console.error('[prospects sync-from-espn]', e);
    res.status(500).json({ error: e.message });
  }
});

// ---------- Bulk import from pasted JSON ----------
// Accepts an array of { name, position, school?, headshot_url?, rank? }.
// Uses the same upsert semantics as importProspects — matches on lowercase
// name. Existing players get position/school/headshot updated, new names
// get inserted. Nothing deletes.
router.post('/prospects/bulk-import', async (req, res) => {
  const body = req.body || {};
  const list = Array.isArray(body) ? body : body.prospects;
  if (!Array.isArray(list)) {
    return res.status(400).json({ error: 'expected array or { prospects: [...] }' });
  }

  // Shallow validation — every entry needs at least a name + position
  const invalid = [];
  const clean = [];
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!p || typeof p !== 'object') { invalid.push({ index: i, reason: 'not an object' }); continue; }
    if (!p.name || typeof p.name !== 'string') { invalid.push({ index: i, reason: 'missing name' }); continue; }
    if (!p.position || typeof p.position !== 'string') { invalid.push({ index: i, reason: 'missing position' }); continue; }
    clean.push({
      name: p.name.trim(),
      position: String(p.position).trim(),
      school: p.school ? String(p.school).trim() : null,
      headshot_url: p.headshot_url ? String(p.headshot_url).trim() : null,
    });
  }

  if (clean.length === 0) {
    return res.status(400).json({ error: 'no valid prospects in payload', invalid });
  }

  try {
    const result = await importProspects(clean);
    res.json({ ...result, received: list.length, invalid_count: invalid.length, invalid: invalid.slice(0, 10) });
  } catch (e) {
    console.error('[bulk-import]', e);
    res.status(500).json({ error: 'import failed: ' + e.message });
  }
});

// ---------- Bulk player rank import from parsed CSV ----------
// Accepts an array of { name, rank, position?, school?, draft_year?, projected_round? }.
// Matches on lowercase name. Existing players get their consensus_rank (and
// optionally projected_round + draft_year) updated. Rows with a position
// supplied for players that don't yet exist are inserted. Rows without a
// position for a name that doesn't exist are reported as not_found — we
// won't guess a position.
router.post('/player-ranks/bulk-import', async (req, res) => {
  const body = req.body || {};
  const list = Array.isArray(body) ? body : body.ranks;
  if (!Array.isArray(list)) {
    return res.status(400).json({ error: 'expected array or { ranks: [...] }' });
  }

  const defaultYear = parseInt(body.draft_year, 10) || null;
  const invalid = [];
  const clean = [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (!r || typeof r !== 'object') {
      invalid.push({ index: i, reason: 'not an object' });
      continue;
    }
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    if (!name) {
      invalid.push({ index: i, reason: 'missing name' });
      continue;
    }
    const rankRaw = r.rank ?? r.consensus_rank ?? r.overall_rank;
    const rank = Number.parseInt(rankRaw, 10);
    if (!Number.isFinite(rank) || rank <= 0) {
      invalid.push({ index: i, reason: 'missing or invalid rank', name });
      continue;
    }
    const yearRaw = r.draft_year ?? r.year ?? defaultYear;
    const draftYear = yearRaw != null ? Number.parseInt(yearRaw, 10) : null;
    const projRoundRaw = r.projected_round ?? r.proj_round ?? r.round;
    const projectedRound = projRoundRaw != null && projRoundRaw !== ''
      ? Number.parseInt(projRoundRaw, 10)
      : null;

    clean.push({
      name,
      rank,
      position: r.position ? String(r.position).trim() : null,
      school: r.school ? String(r.school).trim() : null,
      draft_year: Number.isFinite(draftYear) ? draftYear : null,
      projected_round: Number.isFinite(projectedRound) ? projectedRound : null,
    });
  }

  if (clean.length === 0) {
    return res.status(400).json({ error: 'no valid rank rows in payload', invalid });
  }

  let updated = 0;
  let inserted = 0;
  let unchanged = 0;
  const notFound = [];

  try {
    for (const row of clean) {
      const { rows } = await pool.query(
        'SELECT id, consensus_rank, draft_year, projected_round FROM players WHERE LOWER(name) = LOWER($1) LIMIT 1',
        [row.name]
      );
      if (rows.length) {
        const cur = rows[0];
        const nextYear = row.draft_year ?? cur.draft_year;
        const nextProj = row.projected_round ?? cur.projected_round;
        if (
          cur.consensus_rank === row.rank &&
          cur.draft_year === nextYear &&
          cur.projected_round === nextProj
        ) {
          unchanged++;
        } else {
          await pool.query(
            `UPDATE players
               SET consensus_rank = $1,
                   draft_year = COALESCE($2, draft_year),
                   projected_round = COALESCE($3, projected_round)
             WHERE id = $4`,
            [row.rank, row.draft_year, row.projected_round, cur.id]
          );
          updated++;
        }
      } else if (row.position) {
        // New player row — only insert when the CSV supplied a position so we
        // don't create bogus rows with a guessed position.
        const pos = normalizePosition(row.position);
        await pool.query(
          `INSERT INTO players (name, position, school, consensus_rank, draft_year, projected_round)
           VALUES ($1, $2, $3, $4, COALESCE($5, 2026), $6)`,
          [row.name, pos, row.school, row.rank, row.draft_year, row.projected_round]
        );
        inserted++;
      } else {
        notFound.push({ name: row.name, rank: row.rank });
      }
    }

    res.json({
      received: list.length,
      total: clean.length,
      inserted,
      updated,
      unchanged,
      not_found_count: notFound.length,
      not_found: notFound.slice(0, 20),
      invalid_count: invalid.length,
      invalid: invalid.slice(0, 10),
    });
  } catch (e) {
    console.error('[player-ranks bulk-import]', e);
    res.status(500).json({ error: 'rank import failed: ' + e.message });
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
          'User-Agent': 'MockDraftShowdown/1.0 (+https://mockdraftshowdown.com)',
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

export default router;
