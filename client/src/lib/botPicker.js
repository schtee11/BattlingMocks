import { getAlgoConfig } from './algoConfig.js';

// SYNC WARNING: This file must stay in sync with server/src/services/botPicker.js.
// Last synced: 2026-04-12. If you modify one, update the other.
//
// Client-side bot picker.
//
// Scoring: score = baseScore * needsMultiplier * tierMult * rosterScoreMult * scarcityMult * runMult * jitter
// Then post-scoring: score *= fallBoost
//
//   baseScore        exponential decay off rank (e^-0.04 per rank step).
//   needsMultiplier  +20%/+13%/+7%/+4%/+2% for team's top-5 positional needs.
//                    Decays when the team has already drafted that position
//                    (draftedNeedDecay). Supports OL → OT+IOL expansion.
//   tierMult         ×1.30 QB, ×1.12 OT/EDGE/WR, ×1.08 CB, ×1.04 TE, ×1.00 rest.
//   rosterScoreMult  Heatmap-driven: admin scores each team 1–10 at every
//                    position. Low score (deficient roster) → higher boost,
//                    scaled by per-position weight. Feeds a dense 12-position
//                    view into the picker beyond the top-5 needs list.
//   scarcityMult     Boosts positions as they deplete off the board (threshold-based).
//   runMult          Panic boost when 3+ of same position go in last 8 picks.
//   jitter           multiplicative 1 ± randomness/2.
//   fallBoost        Smooth continuous curve (or legacy cliff caps) preventing
//                    unrealistic falls of consensus talents.
//
// Selection: weighted random draw from a top-N candidate pool.
// All new features require an optional draftContext parameter; when absent
// every new multiplier defaults to 1.0 (backward compatible).

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

// Need-token expansions — tokens an admin may enter in the Team Needs UI
// that should match MULTIPLE canonical player positions with the same
// priority. "OL" in particular is commonly used to mean "any offensive
// line help" (tackle OR interior), so it expands to both OT and IOL.
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

// Needs-boost keys ordered by priority index (0 = top need … 4 = 5th need).
const NEEDS_BOOST_KEYS = ['needsBoost1', 'needsBoost2', 'needsBoost3', 'needsBoost4', 'needsBoost5'];

export function pickForTeam({ available, teamNeeds = [], randomness = 0.25, pickNumber = 999, draftContext }) {
  if (!available || available.length === 0) return null;

  // Build a position → priority map. Each input token can expand to MULTIPLE
  // canonical positions (e.g. "OL" → ["OT","IOL"]); all expanded positions
  // from the same token share the same priority index, so an admin listing
  // "OL" as their top need effectively boosts both tackles and interior
  // linemen equally at priority 0.
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

  const cfg = getAlgoConfig();

  // ── Feature 1: Positional scarcity pre-computation ──────────────────────
  // When a position is depleted relative to the full pool, remaining players
  // at that position become more attractive (scarcity premium).
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

  // ── Feature 3: Position run pre-computation ─────────────────────────────
  // When 3+ players at the same position go in the recent window, teams that
  // need that position get a panic boost.
  let positionRunCounts = null;
  if (cfg.runWindowSize > 0 && draftContext?.recentPicks?.length > 0) {
    positionRunCounts = new Map();
    for (const rp of draftContext.recentPicks) {
      const pos = normalizePos(rp.position);
      if (pos) positionRunCounts.set(pos, (positionRunCounts.get(pos) || 0) + 1);
    }
  }

  // ── Scoring loop ────────────────────────────────────────────────────────
  const scored = [];
  for (const p of available) {
    const rank = Number.isFinite(p.rank) ? p.rank : 500;
    const baseScore = Math.exp(-cfg.decayRate * (rank - 1));

    const pos = normalizePos(p.position);

    // Needs multiplier (F6: supports all 5 priority levels, F2: roster decay).
    let needsMultiplier = 1;
    if (needsPriority.has(pos)) {
      const priority = needsPriority.get(pos);
      const boostKey = NEEDS_BOOST_KEYS[priority];
      let boost = boostKey ? (cfg[boostKey] ?? 0) : 0;

      // Feature 2: Drafted-need decay — reduce boost if team already drafted
      // this position. Each prior pick multiplies the boost by decayFactor.
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

      // Premium-pick anchor — top picks are consensus events. Without this,
      // the default boost (~0.20 for top need) lets a top BPA at any
      // position occasionally beat the obvious franchise pick (e.g. a #2
      // ranked WR sneaking past the consensus #1 QB for a QB-needy team
      // at #1 overall). Real GMs at premium slots play it safe — amplify
      // the needs boost so top-ranked need-fillers decisively dominate.
      if (pickNumber <= 3) boost *= 4;
      else if (pickNumber <= 10) boost *= 2;

      needsMultiplier = 1 + boost;
    }

    const tierMult = positionTierMultiplier(pos, cfg);

    // Roster-score multiplier. When the team has a 1–10 admin-entered score
    // at this position, interpolate a boost: score=10 → ×1.0 (no help needed),
    // score=1 & weight=1.0 → ×rosterScoreMaxBoost. If no score is set we use
    // rosterScoreDefault (5.5 mid) so unseeded positions stay roughly neutral.
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

  // ── Fall cap ────────────────────────────────────────────────────────────
  if (cfg.smoothFallEnabled) {
    // Feature 5: Smooth continuous fall cap.
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
    // Legacy cliff-based fall cap (admin can revert via smoothFallEnabled: false).
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
  // Top-3 picks shrink the pool to 2 so the obvious franchise pick
  // can't be edged out via lottery. Top-5 caps at 3. Picks 6+ keep
  // the original size-from-randomness formula so 4th/5th-priority
  // needs can still surface.
  const basePoolSize = Math.max(3, Math.round(5 + randomness * 10));
  const premiumPoolCap = pickNumber <= 3 ? 2 : pickNumber <= 5 ? 3 : basePoolSize;
  const poolSize = Math.min(premiumPoolCap, basePoolSize, scored.length);
  const pool = scored.slice(0, poolSize);

  // Apply selection sharpness: weight = score^sharpness. Sharpness > 1
  // makes the top-scoring player clearly dominate the pool draw without
  // collapsing to deterministic max.
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
