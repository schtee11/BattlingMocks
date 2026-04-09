// Bot picker for the team-specific mock draft.
//
// Pure logic — no DB access, no I/O. The caller passes in the prospect pool,
// the team's needs, and a randomness setting. We return one player.
//
// Algorithm (per pick):
//   score = (pool_size - rank) + needs_bonus * needs_weight + jitter
//   - rank: lower is better, so we subtract from pool_size to make higher = better
//   - needs_bonus: 1 if the prospect's position is in team_needs, 0 otherwise
//   - needs_weight: how strongly to favor needs (default ~30, tunable later)
//   - jitter: random in [0, randomness * pool_size); wider = more chaos
//
// Position normalization keeps team_needs (e.g. "IOL", "EDGE") aligned with
// prospect positions. The big-board JSON already uses normalized labels.

// Map common alternates → canonical positions used in team_needs.
const POS_ALIASES = {
  DL: 'DT',
  DE: 'EDGE',
  OG: 'IOL',
  OC: 'IOL',
  C: 'IOL',
  G: 'IOL',
  ILB: 'LB',
  OLB: 'LB',
  FS: 'S',
  SS: 'S',
  CB: 'CB',
  DB: 'CB',
};

function normalizePos(pos) {
  if (!pos) return '';
  const up = String(pos).toUpperCase().trim();
  return POS_ALIASES[up] || up;
}

/**
 * Pick the best available player for a team given simple BPA + needs scoring.
 *
 * @param {Object} args
 * @param {Array}  args.available  - prospect rows: { id, name, position, rank }
 * @param {Array}  args.teamNeeds  - normalized position strings, ordered most→least urgent
 * @param {number} args.randomness - 0..1; 0 = always BPA, 1 = highly random
 * @param {number} [args.needsWeight=30] - magnitude of the needs bonus
 * @returns {Object|null} the picked prospect, or null if pool is empty
 */
export function pickForTeam({ available, teamNeeds = [], randomness = 0.15, needsWeight = 30 }) {
  if (!available || available.length === 0) return null;

  const poolSize = available.length;
  const needs = (teamNeeds || []).map(normalizePos);
  // Top-of-list needs get a slightly bigger nudge so QB-needy teams reach for QBs.
  const needsRank = new Map();
  needs.forEach((pos, i) => {
    if (!needsRank.has(pos)) needsRank.set(pos, i);
  });

  let bestScore = -Infinity;
  let best = null;

  for (const p of available) {
    const rank = Number.isFinite(p.rank) ? p.rank : poolSize; // unranked → worst
    const baseScore = poolSize - rank;

    const pos = normalizePos(p.position);
    let needsBonus = 0;
    if (needsRank.has(pos)) {
      // Position #0 in needs → full weight; deeper in the list → 60% weight.
      const idx = needsRank.get(pos);
      const decay = idx === 0 ? 1 : idx === 1 ? 0.85 : 0.6;
      needsBonus = needsWeight * decay;
    }

    // Jitter is uniform in [0, randomness * poolSize). Higher randomness lets
    // lower-ranked players occasionally overtake higher ones.
    const jitter = Math.random() * randomness * poolSize;

    const score = baseScore + needsBonus + jitter;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  return best;
}

/**
 * Run a full draft simulation for one user-controlled team.
 *
 * The user picks for their team's slots; the bot fills every other pick.
 * `userPicks` maps pick_number → player_id for slots the user has chosen.
 * Slots not in userPicks AND owned by the user team are left empty (so the
 * UI can prompt the user to pick). Slots owned by other teams get bot picks.
 *
 * @param {Object} args
 * @param {Array}  args.draftOrder - rows: { pick_number, team, team_needs, round }
 * @param {Array}  args.players    - rows: { id, name, position, rank }
 * @param {string} args.userTeam   - team abbr the user controls
 * @param {Object} [args.userPicks={}] - { [pick_number]: player_id }
 * @param {number} [args.randomness=0.15]
 * @returns {Array} picks: [{ pick_number, team, player_id|null, is_user, round }]
 */
export function simulateDraft({ draftOrder, players, userTeam, userPicks = {}, randomness = 0.15 }) {
  const used = new Set();
  // Pre-mark user picks as used so bots can't snipe them.
  for (const pid of Object.values(userPicks)) {
    if (Number.isFinite(pid)) used.add(pid);
  }

  const byId = new Map(players.map((p) => [p.id, p]));
  const sortedOrder = [...draftOrder].sort((a, b) => a.pick_number - b.pick_number);

  const result = [];
  for (const slot of sortedOrder) {
    const isUser = slot.team === userTeam;

    if (isUser) {
      const userChoice = userPicks[slot.pick_number];
      if (Number.isFinite(userChoice)) {
        result.push({
          pick_number: slot.pick_number,
          team: slot.team,
          player_id: userChoice,
          is_user: true,
          round: slot.round,
        });
      } else {
        // User hasn't picked yet — leave empty so the UI can prompt.
        result.push({
          pick_number: slot.pick_number,
          team: slot.team,
          player_id: null,
          is_user: true,
          round: slot.round,
        });
      }
      continue;
    }

    // Bot pick: filter out used players, then score.
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
