// Algo config — stored server-side (draft_settings.algo_config JSONB) so
// changes by the admin affect all users on their next draft/trade session.
//
// Usage pattern:
//   1. Call `loadAlgoConfig()` once at draft/trade startup (async).
//   2. Call `getAlgoConfig()` anywhere in the hot path (sync, returns cache).
//   3. Server overrides are merged onto ALGO_DEFAULTS so fields omitted from
//      the DB always fall back to a sensible value.

import { api } from './api.js';

export const ALGO_DEFAULTS = {
  // ── Draft engine (botPicker) ──────────────────────────────────────────────
  // Exponential decay per rank step. Higher = steeper curve = top players
  // dominate more strongly. 0.04 → rank-10 scores 0.70 of rank-1.
  decayRate: 0.04,

  // Needs multipliers for the team's top-3 positional needs (as fractions).
  needsBoost1: 0.20,   // top need    → score × 1.20
  needsBoost2: 0.13,   // 2nd need    → score × 1.13
  needsBoost3: 0.07,   // 3rd need    → score × 1.07

  // Hard fall caps — if a player (in rank range) has fallen more than
  // maxFall picks past their rank, their score is multiplied by boost to
  // force selection.
  fallCap1MaxRank: 5,  fallCap1MaxFall: 5,  fallCap1Boost: 15,
  fallCap2MaxRank: 10, fallCap2MaxFall: 9,  fallCap2Boost: 8,
  fallCap3MaxRank: 20, fallCap3MaxFall: 13, fallCap3Boost: 4,

  // ── Trade acceptance (TradeModal) ─────────────────────────────────────────
  // Base premium the mover-up must pay over chart value (fraction).
  tradeBasePremium: 0.05,
  // Extra premium when the top pick in the deal is in the top 5 overall.
  tradeTop5Bonus: 0.03,
  // Hard-reject threshold: if the mover-up underpays by more than this
  // fraction the trade is blocked outright (stored as a positive number).
  hardUnderpayLimit: 0.25,
};

// Module-level cache populated by loadAlgoConfig().
let _cache = null;

/**
 * Async — fetches overrides from the server and caches them. Call this once
 * before starting a draft or opening the trade modal. Safe to call multiple
 * times (subsequent calls re-fetch and refresh the cache).
 */
export async function loadAlgoConfig() {
  try {
    const stored = await api.getAlgoConfig();
    _cache = { ...ALGO_DEFAULTS, ...stored };
  } catch {
    // Network error — keep any existing cache or fall back to defaults.
    if (!_cache) _cache = { ...ALGO_DEFAULTS };
  }
  return _cache;
}

/**
 * Sync — returns the cached config. Returns defaults if loadAlgoConfig() has
 * not yet completed (e.g. called before the async load finishes).
 */
export function getAlgoConfig() {
  return _cache ?? { ...ALGO_DEFAULTS };
}
