// Client-side bot picker — mirrors server/src/services/botPicker.js (pure logic).

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

export function pickForTeam({ available, teamNeeds = [], randomness = 0.15, needsWeight = 30 }) {
  if (!available || available.length === 0) return null;
  const poolSize = available.length;
  const needs = teamNeeds.map(normalizePos);
  const needsRank = new Map();
  needs.forEach((pos, i) => { if (!needsRank.has(pos)) needsRank.set(pos, i); });

  let bestScore = -Infinity;
  let best = null;
  for (const p of available) {
    const rank = Number.isFinite(p.rank) ? p.rank : poolSize;
    const baseScore = poolSize - rank;
    const pos = normalizePos(p.position);
    let needsBonus = 0;
    if (needsRank.has(pos)) {
      const idx = needsRank.get(pos);
      const decay = idx === 0 ? 1 : idx === 1 ? 0.85 : 0.6;
      needsBonus = needsWeight * decay;
    }
    const jitter = Math.random() * randomness * poolSize;
    const score = baseScore + needsBonus + jitter;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}

/**
 * Simulate the full draft. Returns array of picks:
 * { pick_number, team, player_id, player, is_user, round }
 */
export function simulateDraft({ draftOrder, players, userTeam, userPicks = {}, randomness = 0.15 }) {
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
      const picked = pickForTeam({ available, teamNeeds: slot.team_needs || [], randomness });
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
