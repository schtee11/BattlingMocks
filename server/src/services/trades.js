// Trade value + trade application. Pure JS module — reads the static Rich
// Hill chart JSON once at import time. Trade application touches draft_order
// but ONLY for picks 1-32 (matches the current schema constraint).

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { pool } from '../db/pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHART_PATH = join(__dirname, '..', 'data', 'trade-values-2026.json');

let chartCache = null;
function chart() {
  if (!chartCache) {
    const raw = JSON.parse(readFileSync(CHART_PATH, 'utf8'));
    const byPick = new Map();
    for (const row of raw) byPick.set(row.pick, row);
    chartCache = { rows: raw, byPick };
  }
  return chartCache;
}

export function getTradeValues() {
  return chart().rows;
}

export function getValue(pick) {
  return chart().byPick.get(Number(pick))?.value ?? 0;
}

// Normalize a list of pick numbers → { picks: [{pick,team,value}], total }
function totalFor(pickNumbers) {
  const c = chart();
  const picks = [];
  let total = 0;
  for (const p of pickNumbers || []) {
    const row = c.byPick.get(Number(p));
    if (row) {
      picks.push(row);
      total += row.value;
    }
  }
  return { picks, total };
}

// Calculate a proposed trade. Returns both sides' totals + a fairness verdict.
export function calculateTrade({ side_a_picks, side_b_picks }) {
  const a = totalFor(side_a_picks);
  const b = totalFor(side_b_picks);
  const diff = a.total - b.total;
  const max = Math.max(a.total, b.total, 1);
  const pct_diff = (Math.abs(diff) / max) * 100;

  let verdict;
  if (pct_diff <= 5) verdict = 'fair';
  else if (pct_diff <= 15) verdict = 'slight_lean';
  else verdict = 'lopsided';

  return {
    side_a: { picks: a.picks, total: a.total },
    side_b: { picks: b.picks, total: b.total },
    diff,
    pct_diff: Math.round(pct_diff * 10) / 10,
    verdict,
    favors: diff > 0 ? 'a' : diff < 0 ? 'b' : null,
  };
}

// Apply a trade: swap ownership of each pick from its original team to the
// other side's team. Only operates on picks that exist in draft_order
// (currently 1-32). Picks outside that range are logged + skipped.
//
// Strategy: for each pick in side A, change its team+team_name in draft_order
// to team B. And vice versa. team_needs stays untouched.
export async function applyTrade({ side_a_team, side_a_picks, side_b_team, side_b_picks }) {
  if (!side_a_team || !side_b_team) {
    throw new Error('both team abbreviations required');
  }
  const all = [
    ...side_a_picks.map((p) => ({ pick: Number(p), newTeam: side_b_team })),
    ...side_b_picks.map((p) => ({ pick: Number(p), newTeam: side_a_team })),
  ];

  const client = await pool.connect();
  const applied = [];
  const skipped = [];
  try {
    await client.query('BEGIN');
    for (const entry of all) {
      // Only update picks that exist in draft_order (R1 only for now)
      const { rows } = await client.query(
        'SELECT pick_number, team, team_name FROM draft_order WHERE pick_number = $1',
        [entry.pick]
      );
      if (!rows.length) {
        skipped.push({ pick: entry.pick, reason: 'not in draft_order (outside R1)' });
        continue;
      }
      const prevName = rows[0].team_name || '';
      // Preserve "(via ORIGINAL)" annotation so trade history is visible in the UI
      const originalBase = prevName.replace(/\s*\(via [A-Z]+\)\s*$/i, '');
      const newTeamName = `${originalBase} (via ${rows[0].team})`;
      await client.query(
        `UPDATE draft_order
           SET team = $1, team_name = $2, updated_at = NOW()
         WHERE pick_number = $3`,
        [entry.newTeam, newTeamName, entry.pick]
      );
      applied.push({ pick: entry.pick, from: rows[0].team, to: entry.newTeam });
    }
    await client.query('COMMIT');
    return { ok: true, applied, skipped };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
