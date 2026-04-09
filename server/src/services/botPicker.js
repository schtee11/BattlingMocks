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
 *                 rank 1 = 1.00, rank 10 = 0.80, rank 50 = 0.29.
 * needsMultiplier +20% for the team's top need, +13% for second, +7% for
 *                 third, 1.0 otherwise.
 * jitter          multiplicative 1 ± randomness/2.
 */
export function pickForTeam({ available, teamNeeds = [], randomness = 0.15 }) {
  if (!available || available.length === 0) return null;

  const needs = (teamNeeds || []).map(normalizePos).filter(Boolean);
  const needsPriority = new Map();
  needs.forEach((pos, i) => {
    if (!needsPriority.has(pos)) needsPriority.set(pos, i);
  });

  let bestScore = -Infinity;
  let best = null;

  for (const p of available) {
    const rank = Number.isFinite(p.rank) ? p.rank : 500;
    const baseScore = Math.exp(-0.025 * (rank - 1));

    const pos = normalizePos(p.position);
    let needsMultiplier = 1;
    if (needsPriority.has(pos)) {
      const priority = needsPriority.get(pos);
      needsMultiplier = priority === 0 ? 1.20 : priority === 1 ? 1.13 : 1.07;
    }

    const jitter = 1 + (Math.random() - 0.5) * randomness;

    const score = baseScore * needsMultiplier * jitter;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  return best;
}

export function simulateDraft({ draftOrder, players, userTeam, userPicks = {}, randomness = 0.15 }) {
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
