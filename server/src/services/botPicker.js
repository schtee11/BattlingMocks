// Server-side bot picker — mirrors client/src/lib/botPicker.js.
// Kept here for future server-authoritative simulation; the current team-mock
// page runs the same algorithm client-side.

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

/**
 * Score = baseScore * needsMultiplier * jitter.
 *
 * baseScore       exponential decay off rank so top picks dominate but mid-
 *                 round picks can still edge out BPA when needs intervene.
 *                 rank 1 = 1.00, rank 10 = 0.70, rank 20 = 0.45 (decay -0.04).
 *                 Steeper than the old -0.025 so rank-8 with top-need boost
 *                 (×1.20) scores 0.91 — below rank-1's 1.0, preventing routine
 *                 falls of consensus top talents.
 * needsMultiplier +20% for the team's top need, +13% for second, +7% for
 *                 third, 1.0 otherwise.
 * jitter          multiplicative 1 ± randomness/2.
 * Hard fall cap   Top-ranked players who have fallen too far get a large score
 *                 multiplier applied before pool selection. Requires pickNumber.
 *
 * Selection uses weighted random from a top-N candidate pool (not
 * deterministic max) so re-running the same board produces different picks.
 */
export function pickForTeam({ available, teamNeeds = [], randomness = 0.25, pickNumber = 999 }) {
  if (!available || available.length === 0) return null;

  const needs = (teamNeeds || []).map(normalizePos).filter(Boolean);
  const needsPriority = new Map();
  needs.forEach((pos, i) => {
    if (!needsPriority.has(pos)) needsPriority.set(pos, i);
  });

  const scored = [];
  for (const p of available) {
    const rank = Number.isFinite(p.rank) ? p.rank : 500;
    // Decay rate -0.04 (was -0.025): rank-8 with top-need boost now scores
    // 0.756 × 1.20 = 0.907, safely below rank-1's 1.0 baseline.
    const baseScore = Math.exp(-0.04 * (rank - 1));

    const pos = normalizePos(p.position);
    let needsMultiplier = 1;
    if (needsPriority.has(pos)) {
      const priority = needsPriority.get(pos);
      needsMultiplier = priority === 0 ? 1.20 : priority === 1 ? 1.13 : 1.07;
    }

    const jitter = 1 + (Math.random() - 0.5) * randomness;

    let score = baseScore * needsMultiplier * jitter;
    scored.push({ player: p, rank, score });
  }

  // Hard fall cap: boost top-ranked players who have fallen too far so they
  // are virtually guaranteed to be selected before drifting further.
  //   rank 1–5:  max 5-pick fall  → ×15 boost
  //   rank 6–10: max 9-pick fall  → ×8  boost
  //   rank 11–20: max 13-pick fall → ×4  boost
  for (const entry of scored) {
    const { rank } = entry;
    const fall = pickNumber - rank;
    if (rank <= 5 && fall > 5) {
      entry.score *= 15;
    } else if (rank <= 10 && fall > 9) {
      entry.score *= 8;
    } else if (rank <= 20 && fall > 13) {
      entry.score *= 4;
    }
  }

  // Weighted random selection from a top-N candidate pool.
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

export function simulateDraft({ draftOrder, players, userTeam, userPicks = {}, randomness = 0.25 }) {
  const used = new Set();
  for (const pid of Object.values(userPicks)) {
    if (Number.isFinite(pid)) used.add(pid);
  }

  const sortedOrder = [...draftOrder].sort((a, b) => a.pick_number - b.pick_number);
  const result = [];
  for (const slot of sortedOrder) {
    const isUser = slot.team === userTeam;
    if (isUser) {
      const userChoice = userPicks[slot.pick_number];
      result.push({
        pick_number: slot.pick_number,
        team: slot.team,
        player_id: Number.isFinite(userChoice) ? userChoice : null,
        is_user: true,
        round: slot.round,
      });
      continue;
    }
    const available = players.filter((p) => !used.has(p.id));
    const picked = pickForTeam({
      available,
      teamNeeds: slot.team_needs || [],
      randomness,
      pickNumber: slot.pick_number,
    });
    if (picked) {
      used.add(picked.id);
      result.push({
        pick_number: slot.pick_number,
        team: slot.team,
        player_id: picked.id,
        is_user: false,
        round: slot.round,
      });
    } else {
      result.push({
        pick_number: slot.pick_number,
        team: slot.team,
        player_id: null,
        is_user: false,
        round: slot.round,
      });
    }
  }
  return result;
}
