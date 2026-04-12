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
  needsBoost4: 0.04,   // 4th need    → score × 1.04
  needsBoost5: 0.02,   // 5th need    → score × 1.02

  // Hard fall caps — if a player (in rank range) has fallen more than
  // maxFall picks past their rank, their score is multiplied by boost to
  // force selection.
  fallCap1MaxRank: 5,  fallCap1MaxFall: 5,  fallCap1Boost: 15,
  fallCap2MaxRank: 10, fallCap2MaxFall: 9,  fallCap2Boost: 8,
  fallCap3MaxRank: 20, fallCap3MaxFall: 13, fallCap3Boost: 4,

  // Smooth fall cap — continuous curve replacing the cliff system above.
  // When smoothFallEnabled is true the cliff params are ignored.
  // allowedFall = fallAllowedBase + fallAllowedScale × (rank - 1).
  // excessFall  = max(0, pickNumber - rank - allowedFall).
  // fallBoost   = min(fallBoostMax, 1 + fallBoostRate × excessFall^1.5).
  smoothFallEnabled: true,
  fallAllowedBase: 3,
  fallAllowedScale: 0.5,
  fallBoostRate: 0.35,
  fallBoostMax: 20,

  // ── Context-aware features ───────────────────────────────────────────────
  // Dynamic positional scarcity — boosts positions as they deplete off the board.
  scarcityEnabled: true,
  scarcityThreshold: 0.5,   // kicks in when ≤50% of a position remains
  scarcityMaxBoost: 1.25,   // max multiplier at extreme depletion
  scarcityCurve: 1.5,       // exponent controlling ramp-up speed

  // Drafted-need decay — reduces need boost when team already picked that position.
  draftedNeedDecay: 0.6,    // each prior pick at that pos multiplies boost by this
  draftedNeedFloor: 0.3,    // boost never decays below 30% of original

  // Position run detection — panic boost when 3+ of same position go in recent window.
  runWindowSize: 8,
  runThreshold: 3,
  runBoostNeed: 0.20,       // +20% for teams that need the running position
  runBoostAny: 0.05,        // +5% for all teams (BPA pull)

  // Positional value tiers — multiplier applied to baseScore so premium
  // positions command extra draft capital (QB especially). Keys are the
  // CANONICAL positions produced by normalizePos() in botPicker.js:
  // QB, RB, WR, TE, OT, IOL, EDGE, DT, CB, S, LB. Missing keys fall
  // through to 1.00 (Tier 3). Calibrated so a rank-7 QB still outscores
  // a rank-1 non-QB on base+tier alone (0.785 × 1.30 = 1.021 > 1.000)
  // but a rank-8 QB does not (0.756 × 1.30 = 0.983 < 1.000).
  positionTiers: {
    QB:   1.30, // Tier 1 — franchise QB premium
    OT:   1.12, // Tier 2 — tackle premium (covers LT + RT)
    EDGE: 1.12, // Tier 2 — pass rusher premium
    WR:   1.12, // Tier 2 — receiver premium
    CB:   1.08, // Tier 2B — modern passing-game CB premium
    TE:   1.04, // Tier 2C — elite TE premium (Bowers effect)
    // Tier 3 implicit 1.00: RB, IOL (G/C), DT (IDL), S, LB
  },

  // Selection sharpness — exponent applied to pool scores when doing the
  // weighted-random draw. Does NOT change which players make the pool,
  // only how dominant the top-scoring player's share is in the final draw.
  // Measured on the 2026 prospects board with a QB-needy Raiders at 1.01
  // and randomness=0.25:
  //   sharpness = 1  → ~18% Mendoza rate (linear, very flat pool)
  //   sharpness = 3  → ~39% Mendoza rate
  //   sharpness = 5  → ~62% Mendoza rate (default — clear top-pick dominance)
  //   sharpness = 7  → ~80% Mendoza rate (near-lock)
  //   sharpness = 10 → ~93% Mendoza rate (effectively deterministic at #1)
  // Tunable via admin /api/admin/algo-config without a code change.
  scoreSharpness: 5,

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
    // Deep-merge positionTiers so a partial admin override (e.g. just
    // { QB: 1.35 }) doesn't wipe the default OT/EDGE/WR entries. All
    // other config fields remain shallow-merged.
    _cache = {
      ...ALGO_DEFAULTS,
      ...stored,
      positionTiers: {
        ...ALGO_DEFAULTS.positionTiers,
        ...(stored?.positionTiers || {}),
      },
    };
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
