// SYNC WARNING: This file must stay in sync with client/src/lib/botPicker.js.
// Last synced: 2026-04-12. If you modify one, update the other.
//
// Server-side bot picker. Accepts an optional `config` parameter so callers
// can pass the stored algo config from the database; defaults to ALGO_DEFAULTS.

const ALGO_DEFAULTS = {
  decayRate: 0.04,
  needsBoost1: 0.20,
  needsBoost2: 0.13,
  needsBoost3: 0.07,
  needsBoost4: 0.04,
  needsBoost5: 0.02,
  fallCap1MaxRank: 5,  fallCap1MaxFall: 5,  fallCap1Boost: 15,
  fallCap2MaxRank: 10, fallCap2MaxFall: 9,  fallCap2Boost: 8,
  fallCap3MaxRank: 20, fallCap3MaxFall: 13, fallCap3Boost: 4,
  smoothFallEnabled: true,
  fallAllowedBase: 3,
  fallAllowedScale: 0.5,
  fallBoostRate: 0.35,
  fallBoostMax: 20,
  positionTiers: {
    QB:   1.30,
    OT:   1.12,
    EDGE: 1.12,
    WR:   1.12,
    CB:   1.08,
    TE:   1.04,
  },
  rosterScoreWeights: {
    QB: 1.00, RB: 0.75, WR: 0.90, TE: 0.80,
    OT: 0.85, IOL: 0.65, EDGE: 0.95, DT: 0.80,
    LB: 0.75, NCB: 0.60, CB: 0.90, S: 0.60,
  },
  rosterScoreMaxBoost: 1.30,
  rosterScoreDefault: 5.5,
  scoreSharpness: 5,
  scarcityEnabled: true,
  scarcityThreshold: 0.5,
  scarcityMaxBoost: 1.25,
  scarcityCurve: 1.5,
  draftedNeedDecay: 0.6,
  draftedNeedFloor: 0.3,
  runWindowSize: 8,
  runThreshold: 3,
  runBoostNeed: 0.20,
  runBoostAny: 0.05,
};

const POS_ALIASES = {
  // Defensive line
  DL: 'DT', DE: 'EDGE', NT: 'DT',
  // Offensive line (interior)
  OG: 'IOL', OC: 'IOL', C: 'IOL', G: 'IOL', RG: 'IOL', LG: 'IOL',
  // Offensive line (tackle)
  T: 'OT', LT: 'OT', RT: 'OT',
  // Linebackers
  ILB: 'LB', OLB: 'LB', MLB: 'LB',
  // Defensive backs
  FS: 'S', SS: 'S', DB: 'CB',
  // Backs
  HB: 'RB', FB: 'RB',
};

export function normalizePos(pos) {
  if (!pos) return '';
  const up = String(pos).toUpperCase().trim();
  return POS_ALIASES[up] || up;
}

const NEEDS_EXPANSIONS = {
  OL: ['OT', 'IOL'],
};

function expandNeedToken(token) {
  if (!token) return [];
  const up = String(token).toUpperCase().trim();
  if (NEEDS_EXPANSIONS[up]) return NEEDS_EXPANSIONS[up];
  const norm = normalizePos(up);
  return norm ? [norm] : [];
}

function positionTierMultiplier(canonicalPos, cfg) {
  const m = cfg.positionTiers?.[canonicalPos];
  return Number.isFinite(m) && m > 0 ? m : 1;
}

const NEEDS_BOOST_KEYS = ['needsBoost1', 'needsBoost2', 'needsBoost3', 'needsBoost4', 'needsBoost5'];

export function pickForTeam({ available, teamNeeds = [], randomness = 0.25, pickNumber = 999, draftContext, config }) {
  if (!available || available.length === 0) return null;

  const cfg = config
    ? {
        ...ALGO_DEFAULTS,
        ...config,
        positionTiers: { ...ALGO_DEFAULTS.positionTiers, ...(config.positionTiers || {}) },
        rosterScoreWeights: { ...ALGO_DEFAULTS.rosterScoreWeights, ...(config.rosterScoreWeights || {}) },
      }
    : ALGO_DEFAULTS;

  const needsPriority = new Map();
  let priorityCounter = 0;
  for (const token of teamNeeds || []) {
    const positions = expandNeedToken(token);
    if (positions.length === 0) continue;
    for (const pos of positions) {
      if (!needsPriority.has(pos)) needsPriority.set(pos, priorityCounter);
    }
    priorityCounter++;
  }

  // Feature 1: Positional scarcity pre-computation.
  let scarcityMap = null;
  if (cfg.scarcityEnabled && draftContext?.allPlayers) {
    const totalByPos = new Map();
    for (const p of draftContext.allPlayers) {
      const pos = normalizePos(p.position);
      if (pos) totalByPos.set(pos, (totalByPos.get(pos) || 0) + 1);
    }
    const remainByPos = new Map();
    for (const p of available) {
      const pos = normalizePos(p.position);
      if (pos) remainByPos.set(pos, (remainByPos.get(pos) || 0) + 1);
    }
    scarcityMap = { totalByPos, remainByPos };
  }

  // Feature 3: Position run pre-computation.
  let positionRunCounts = null;
  if (cfg.runWindowSize > 0 && draftContext?.recentPicks?.length > 0) {
    positionRunCounts = new Map();
    for (const rp of draftContext.recentPicks) {
      const pos = normalizePos(rp.position);
      if (pos) positionRunCounts.set(pos, (positionRunCounts.get(pos) || 0) + 1);
    }
  }

  // Scoring loop.
  const scored = [];
  for (const p of available) {
    const rank = Number.isFinite(p.rank) ? p.rank : 500;
    const baseScore = Math.exp(-cfg.decayRate * (rank - 1));

    const pos = normalizePos(p.position);

    // Needs multiplier (5-deep, with roster decay).
    let needsMultiplier = 1;
    if (needsPriority.has(pos)) {
      const priority = needsPriority.get(pos);
      const boostKey = NEEDS_BOOST_KEYS[priority];
      let boost = boostKey ? (cfg[boostKey] ?? 0) : 0;

      // Feature 2: Drafted-need decay.
      if (boost > 0 && draftContext?.teamDraftedPos) {
        const priorCount = draftContext.teamDraftedPos.filter((p) => p === pos).length;
        if (priorCount > 0) {
          const decayFactor = Math.max(
            cfg.draftedNeedFloor,
            Math.pow(cfg.draftedNeedDecay, priorCount),
          );
          boost *= decayFactor;
        }
      }
      needsMultiplier = 1 + boost;
    }

    const tierMult = positionTierMultiplier(pos, cfg);

    // Roster-score multiplier. Score=10 → no boost. Score=1 with weight=1.0 →
    // rosterScoreMaxBoost (e.g. 1.30). Uses rosterScoreDefault when no score
    // entered for that team/position so unseeded rows stay roughly neutral.
    let rosterScoreMult = 1;
    if (pos && draftContext?.teamRosterScores) {
      const raw = draftContext.teamRosterScores[pos];
      const score = Number.isFinite(raw) ? raw : cfg.rosterScoreDefault;
      const weight = cfg.rosterScoreWeights?.[pos];
      if (Number.isFinite(weight) && weight > 0 && Number.isFinite(score)) {
        const clamped = Math.min(10, Math.max(1, score));
        const deficit = (10 - clamped) / 9;
        const maxBoost = (cfg.rosterScoreMaxBoost ?? 1) - 1;
        rosterScoreMult = 1 + maxBoost * weight * deficit;
      }
    }

    // Feature 1: Scarcity multiplier.
    let scarcityMult = 1;
    if (scarcityMap && pos) {
      const total = scarcityMap.totalByPos.get(pos) || 0;
      const remain = scarcityMap.remainByPos.get(pos) || 0;
      if (total > 0) {
        const depletionPct = 1 - remain / total;
        if (depletionPct > cfg.scarcityThreshold) {
          const intensity = (depletionPct - cfg.scarcityThreshold) / (1 - cfg.scarcityThreshold);
          scarcityMult = 1 + (cfg.scarcityMaxBoost - 1) * Math.pow(intensity, 1 / cfg.scarcityCurve);
        }
      }
    }

    // Feature 3: Run multiplier.
    let runMult = 1;
    if (positionRunCounts && pos) {
      const runCount = positionRunCounts.get(pos) || 0;
      if (runCount >= cfg.runThreshold) {
        runMult = needsPriority.has(pos) ? 1 + cfg.runBoostNeed : 1 + cfg.runBoostAny;
      }
    }

    const jitter = 1 + (Math.random() - 0.5) * randomness;

    let score = baseScore * needsMultiplier * tierMult * rosterScoreMult * scarcityMult * runMult * jitter;
    scored.push({ player: p, rank, score });
  }

  // Fall cap.
  if (cfg.smoothFallEnabled) {
    for (const entry of scored) {
      const { rank } = entry;
      const fall = pickNumber - rank;
      const allowedFall = cfg.fallAllowedBase + cfg.fallAllowedScale * (rank - 1);
      const excess = Math.max(0, fall - allowedFall);
      if (excess > 0) {
        entry.score *= Math.min(cfg.fallBoostMax, 1 + cfg.fallBoostRate * Math.pow(excess, 1.5));
      }
    }
  } else {
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
  }

  // Weighted random selection from a top-N candidate pool.
  scored.sort((a, b) => b.score - a.score);
  const poolSize = Math.min(
    Math.max(3, Math.round(5 + randomness * 10)),
    scored.length
  );
  const pool = scored.slice(0, poolSize);

  const sharpness = Number.isFinite(cfg.scoreSharpness) && cfg.scoreSharpness > 0
    ? cfg.scoreSharpness
    : 1;
  const weights = pool.map((x) => Math.pow(Math.max(x.score, 0), sharpness));
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  if (totalWeight <= 0) return pool[0]?.player ?? null;

  let roll = Math.random() * totalWeight;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return pool[i].player;
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
