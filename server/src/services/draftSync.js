// One-shot draft pick sync — fetches Round 1 from ESPN, matches players
// against the local `players` table, upserts matched picks into `actual_picks`
// and re-scores every mock. Used by both the manual admin endpoint and the
// auto-poller during draft night.
//
// Returns a summary object regardless of success/failure; callers can inspect
// it without handling exceptions for the "no new picks" case.

import { pool } from '../db/pool.js';
import { fetchRoundOne, resetLogFlag } from './espnDraft.js';
import { runScoringOnClient } from './scoring.js';

function normalizeName(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function syncPicksOnce({ year, dry = false }) {
  resetLogFlag();

  const fetched = await fetchRoundOne(year);
  const withPlayer = fetched.filter(
    (p) => p.round === 1 && p.pick >= 1 && p.pick <= 32 && p.player_name
  );

  if (withPlayer.length === 0) {
    return {
      year,
      dry,
      fetched: fetched.length,
      round1_with_player: 0,
      matched: 0,
      unmatched: 0,
      saved: 0,
      scored_mocks: 0,
      matched_samples: [],
      unmatched_samples: [],
    };
  }

  const { rows: localPlayers } = await pool.query(
    'SELECT id, name, school FROM players'
  );
  const byName = new Map();
  for (const lp of localPlayers) byName.set(normalizeName(lp.name), lp);

  const matched = [];
  const unmatched = [];
  for (const p of withPlayer) {
    const key = normalizeName(p.player_name);
    let local = byName.get(key);
    if (!local) {
      // Fuzzy: last name + first initial fallback
      const parts = key.split(' ');
      const first = parts[0] || '';
      const last = parts[parts.length - 1] || '';
      if (last) {
        local = localPlayers.find((lp) => {
          const lk = normalizeName(lp.name);
          return lk.endsWith(' ' + last) && lk.startsWith((first[0] || '') + '');
        });
      }
    }
    if (local) matched.push({ ...p, player_id: local.id, matched_name: local.name });
    else unmatched.push(p);
  }

  const summary = {
    year,
    dry,
    fetched: fetched.length,
    round1_with_player: withPlayer.length,
    matched: matched.length,
    unmatched: unmatched.length,
    matched_samples: matched.slice(0, 5),
    unmatched_samples: unmatched.slice(0, 10),
    saved: 0,
    scored_mocks: 0,
  };

  if (dry || matched.length === 0) return summary;

  // Compare against current DB state — only count as "newly saved" picks
  // whose player_id is different from what's already stored. This keeps
  // repeated poller runs from inflating the "saved" count.
  const { rows: existing } = await pool.query(
    'SELECT pick_number, player_id FROM actual_picks'
  );
  const existingByPick = new Map(existing.map((e) => [e.pick_number, e.player_id]));

  let newlySaved = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const m of matched) {
      const prior = existingByPick.get(m.pick);
      if (prior !== m.player_id) newlySaved++;
      await client.query(
        `INSERT INTO actual_picks (pick_number, player_id, team)
           VALUES ($1, $2, $3)
         ON CONFLICT (pick_number) DO UPDATE
           SET player_id = EXCLUDED.player_id,
               team = EXCLUDED.team,
               entered_at = NOW()`,
        [m.pick, m.player_id, m.team_abbr || null]
      );
    }
    const scoredMocks = await runScoringOnClient(client);
    await client.query('COMMIT');
    summary.saved = newlySaved;
    summary.total_matched_upserted = matched.length;
    summary.scored_mocks = scoredMocks;
    return summary;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
