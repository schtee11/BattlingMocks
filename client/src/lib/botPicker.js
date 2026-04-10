import { getAlgoConfig } from './algoConfig.js';

// Client-side bot picker — mirrors server/src/services/botPicker.js.
//
// Scoring: each available player gets a score = baseScore * needsMultiplier * jitter.
//
//   baseScore      exponential decay off rank so top picks dominate but
//                  mid-round picks are still competitive when needs intervene.
//                  rank 1 = 1.00, rank 5 = 0.85, rank 10 = 0.70, rank 20 = 0.45
//                  (decay = e^-0.04 per rank step). Steeper than the old -0.025
//                  curve so a rank-8 player with top-need boost (×1.20) scores
//                  0.91 — safely below rank-1's 1.0, preventing routine falls.
//
//   needsMultiplier +20% for the team's top need position, +13% for second,
//                  +7% for third, 1.0 otherwise. With the steeper base curve a
//                  needs boost moves a player ~4-6 spots up, then BPA takes over.
//
//   jitter         multiplicative 1 ± randomness/2. At default randomness 0.25
//                  that's ±12.5%; at 1.0 (max chaos slider) it's ±50%.
//
//   Hard fall cap  After scoring, top-ranked players who have already fallen
//                  "too far" relative to their rank get a large score multiplier
//                  that forces them near the top of the pool. This prevents the
//                  unrealistic scenario where a consensus top-5 talent slips to
//                  pick 20+. Requires callers to pass pickNumber.
//
// Selection: instead of always picking the max-score player, scores are used
// as weights in a weighted random draw from a top-N candidate pool. This
// creates natural draft variance — the same pool won't always produce the
// same pick. The pool size scales with the randomness slider.

const POS_ALIASES = {
  DL: 'DT', DE: 'EDGE', OG: 'IOL', OC: 'IOL',
  C: 'IOL', G: 'IOL', ILB: 'LB', OLB: 'LB',
  FS: 'S', SS: 'S', DB: 'CB',
};
function normalizePos(pos) {
  if (!pos) return '';
  const up = String(pos).toUpperCase().trim();
  return POS_ALIASES[up] || up;
}

export function pickForTeam({ available, teamNeeds = [], randomness = 0.25, pickNumber = 999 }) {
  if (!available || available.length === 0) return null;

  const needs = (teamNeeds || []).map(normalizePos).filter(Boolean);
  const needsPriority = new Map();
  needs.forEach((pos, i) => {
    if (!needsPriority.has(pos)) needsPriority.set(pos, i);
  });

  const cfg = getAlgoConfig();

  const scored = [];
  for (const p of available) {
    const rank = Number.isFinite(p.rank) ? p.rank : 500;
    const baseScore = Math.exp(-cfg.decayRate * (rank - 1));

    const pos = normalizePos(p.position);
    let needsMultiplier = 1;
    if (needsPriority.has(pos)) {
      const priority = needsPriority.get(pos);
      needsMultiplier =
        priority === 0 ? 1 + cfg.needsBoost1 :
        priority === 1 ? 1 + cfg.needsBoost2 :
                         1 + cfg.needsBoost3;
    }

    const jitter = 1 + (Math.random() - 0.5) * randomness;

    let score = baseScore * needsMultiplier * jitter;
    scored.push({ player: p, rank, score });
  }

  // Hard fall cap: boost top-ranked players who have fallen too far.
  for (const entry of scored) {
    const { rank } = entry;
    const fall = pickNumber - rank;
    if (rank <= cfg.fallCap1MaxRank && fall > cfg.fallCap1MaxFall) {
      entry.score *= cfg.fallCap1Boost;
    } else if (rank <= cfg.fallCap2MaxRank && fall > cfg.fallCap2MaxFall) {
      entry.score *= cfg.fallCap2Boost;
    } else if (rank <= cfg.fallCap3MaxRank && fall > cfg.fallCap3MaxFall) {
      entry.score *= cfg.fallCap3Boost;
    }
  }

  // Weighted random selection from a top-N candidate pool.
  // Pool size scales with the randomness slider:
  //   randomness 0.15 → pool of ~7   (tight BPA, low variance)
  //   randomness 0.50 → pool of ~10  (moderate variance)
  //   randomness 1.00 → pool of ~15  (max chaos)
  // This ensures the same board doesn't always produce identical picks.
  scored.sort((a, b) => b.score - a.score);
  const poolSize = Math.min(
    Math.max(3, Math.round(5 + randomness * 10)),
    scored.length
  );
  const pool = scored.slice(0, poolSize);

  const totalWeight = pool.reduce((s, x) => s + x.score, 0);
  if (totalWeight <= 0) return pool[0]?.player ?? null;

  let roll = Math.random() * totalWeight;
  for (const { player, score } of pool) {
    roll -= score;
    if (roll <= 0) return player;
  }
  return pool[pool.length - 1]?.player ?? null;
}

/**
 * Full non-sequential simulation — kept for legacy callers/tests. The live
 * team-mock page uses its own pick-by-pick loop instead.
 */
export function simulateDraft({ draftOrder, players, userTeam, userPicks = {}, randomness = 0.25 }) {
  const used = new Set(Object.values(userPicks).filter(Number.isFinite));
  const byId = new Map(players.map((p) => [p.id, p]));
  const sorted = [...draftOrder].sort((a, b) => a.pick_number - b.pick_number);

  const result = [];
  for (const slot of sorted) {
    const isUser = slot.team === userTeam;
    if (isUser) {
      const uid = userPicks[slot.pick_number];
      result.push({
        pick_number: slot.pick_number,
        team: slot.team,
        player_id: uid ?? null,
        player: uid ? byId.get(uid) ?? null : null,
        is_user: true,
        round: slot.round,
      });
    } else {
      const available = players.filter((p) => !used.has(p.id));
      const picked = pickForTeam({ available, teamNeeds: slot.team_needs || [], randomness, pickNumber: slot.pick_number });
      if (picked) {
        used.add(picked.id);
        result.push({
          pick_number: slot.pick_number, team: slot.team,
          player_id: picked.id, player: picked, is_user: false, round: slot.round,
        });
      } else {
        result.push({ pick_number: slot.pick_number, team: slot.team, player_id: null, player: null, is_user: false, round: slot.round });
      }
    }
  }
  return result;
}
