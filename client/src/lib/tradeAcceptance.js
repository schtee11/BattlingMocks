import { getAlgoConfig } from './algoConfig.js';

// ── Probability helpers ─────────────────────────────────────────────────────
// Trades have a % chance of acceptance based on how far the mover-up's value
// is from the required threshold. Fair deals are nearly always accepted;
// underpays drop steeply; extreme overpays are dampened (unrealistic gifts).
//
// The live preview ONLY shows the probability — accept/reject is decided
// by a deterministic hash roll at proposal time (handlePropose in TradeModal,
// or the per-pick roll in bot-vs-bot flow). Preview is always monotonic:
// more value → higher %, always.

// Hard-reject limit is read from algo config so it's admin-tunable.
// Kept as a file-level accessor so the sigmoid comment below stays legible.
export function hardUnderpayLimit() {
  return -(getAlgoConfig().hardUnderpayLimit ?? 0.25);
}

// Acceptance probability curve:
//   Sigmoid base centered at -8% surplus (fair ≈ 94%) with an exponential
//   dampener above +30% surplus to make gift trades very unlikely.
//
//   +10% → 99.8%   (slight overpay — partner happy)
//   +5%  → 99%     (good deal)
//    0%  → 94%     (fair — almost always accepted)
//   -5%  → 74%     (slight underpay — decent chance)
//   -8%  → 50%     (midpoint)
//   -10% → 33%     (getting risky)
//   -15% → 8%      (very unlikely)
//   +35% → ~47%    (starting to look unrealistic)
//   +50% → ~5%     (gift trade — nearly impossible)
export function acceptanceProbability(surplusPct) {
  const base = 1 / (1 + Math.exp(-0.35 * ((surplusPct * 100) + 8)));
  // Dampen extreme overpays — real teams don't make gift trades
  if (surplusPct > 0.30) {
    const excess = (surplusPct - 0.30) * 100;
    return base * Math.exp(-0.15 * excess);
  }
  return base;
}

// Deterministic random from trade contents — used ONLY at proposal time so
// the live preview never shows an accept/reject that contradicts the %.
export function tradeHash(from, partner, aPicks, bPicks) {
  // Stringify pick ids first — the hash feeds into sort() and some callers
  // pass in mixed numeric + string (future) ids.
  const sortedA = [...aPicks].map(String).sort();
  const sortedB = [...bPicks].map(String).sort();
  const key = [from, partner, ...sortedA, '|', ...sortedB].join(',');
  let h = 0;
  for (let i = 0; i < key.length; i++) h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  const x = Math.sin(Math.abs(h) + 1) * 10000;
  return x - Math.floor(x); // 0..1
}
