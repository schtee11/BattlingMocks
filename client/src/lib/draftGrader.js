// Draft grade engine — enterprise-grade evaluation of team mock drafts.
//
// Dimensions:
//   1. Value (35%)  — Steal vs reach, weighted by positional premium & round.
//   2. Need Fit (30%) — Did you fill top needs early and in priority order?
//   3. Roster Build (20%) — Starter holes filled, positional balance, capital allocation.
//   4. Strategy (15%) — Premium position investment, avoiding redundancy, draft capital efficiency.
//
// Per-pick grades: each pick gets its own A-F grade + narrative tag (e.g. "Elite steal", "Reach").
// Overall grade: weighted average of the 4 dimension scores → letter grade.

import { normalizePos } from './botPicker.js';

// ─── Position value tiers for grading context ────────────────────────────────
// Premium positions score higher when taken at value; reaching on a premium
// position is less penalized than reaching on a non-premium one.
const POSITION_PREMIUM = {
  QB: 1.0, EDGE: 0.85, OT: 0.80, WR: 0.75, CB: 0.70,
  TE: 0.55, DT: 0.50, IOL: 0.50, S: 0.45, LB: 0.40, RB: 0.35,
};
function getPositionPremium(pos) {
  return POSITION_PREMIUM[normalizePos(pos)] ?? 0.40;
}

// ─── Starter slots by position (typical NFL roster) ──────────────────────────
const STARTER_SLOTS = {
  QB: 1, RB: 1, WR: 3, TE: 1, OT: 2, IOL: 3,
  EDGE: 2, DT: 2, LB: 2, CB: 2, S: 2,
};

// ─── Letter grading ─────────────────────────────────────────────────────────

export function letterFromScore(score) {
  if (score >= 94) return 'A+';
  if (score >= 89) return 'A';
  if (score >= 84) return 'A-';
  if (score >= 79) return 'B+';
  if (score >= 74) return 'B';
  if (score >= 69) return 'B-';
  if (score >= 64) return 'C+';
  if (score >= 58) return 'C';
  if (score >= 52) return 'C-';
  if (score >= 45) return 'D';
  return 'F';
}

export function gradeColor(letter) {
  if (!letter) return '#94a3b8';
  if (letter.startsWith('A')) return '#34d399';
  if (letter.startsWith('B')) return '#fbbf24';
  if (letter.startsWith('C')) return '#f97316';
  return '#ef4444';
}

// ─── Per-pick value scoring ─────────────────────────────────────────────────

function computePickValueScore(pick, player, roundNumber) {
  const rank = Number(player.consensus_rank ?? player.rank);
  if (!Number.isFinite(rank) || rank <= 0) return { score: 72, delta: 0, tag: 'Unranked' };

  const delta = pick.pick_number - rank; // positive = steal, negative = reach
  const pos = normalizePos(player.position);
  const premium = getPositionPremium(pos);

  // Base scoring: centered at 78 (solid B+). Each spot moved is worth more
  // in early rounds (where gaps between players are larger).
  const roundMultiplier = roundNumber <= 1 ? 2.0 : roundNumber <= 3 ? 1.5 : 1.0;

  // Steals get rewarded; reaches get penalized, but premium positions
  // are penalized less for reaches (it's more acceptable to reach for a QB).
  let adjustment;
  if (delta >= 0) {
    // Steal: +1.8 per spot (diminishing after 10 spots to prevent inflation)
    adjustment = Math.min(delta, 10) * 1.8 + Math.max(0, delta - 10) * 0.8;
  } else {
    // Reach: penalized more in later rounds, less for premium positions.
    const reachPenalty = 1.8 * roundMultiplier * (1 - premium * 0.4);
    adjustment = delta * reachPenalty; // delta is negative, so this subtracts
  }

  const score = Math.max(0, Math.min(100, 78 + adjustment));

  let tag;
  if (score >= 95) tag = 'Elite steal';
  else if (score >= 88) tag = 'Great value';
  else if (score >= 80) tag = 'Good value';
  else if (score >= 72) tag = 'Fair pick';
  else if (score >= 60) tag = 'Slight reach';
  else if (score >= 45) tag = 'Reach';
  else tag = 'Big reach';

  return { score: Math.round(score), delta, tag };
}

// ─── Per-pick need scoring ──────────────────────────────────────────────────

function computePickNeedScore(player, teamNeeds, addressedNeeds, pickIndex, totalPicks) {
  const pos = normalizePos(player.position);
  const needList = teamNeeds.map((n) => normalizePos(n));

  if (needList.length === 0) return { score: 75, tag: 'No needs data' };

  const needIdx = needList.indexOf(pos);

  if (needIdx === -1) {
    // Not on the needs list at all. Not punished hard — BPA has value.
    // But slightly less credit in early rounds where you should address needs.
    const earlyRoundPenalty = pickIndex < 3 ? 8 : 0;
    return { score: 58 - earlyRoundPenalty, tag: 'BPA / depth' };
  }

  const priorAtPos = addressedNeeds.filter((p) => p === pos).length;

  if (priorAtPos > 0) {
    // Already addressed this need — depth pick. Less value each time.
    const depthScore = Math.max(45, 62 - priorAtPos * 10);
    return { score: depthScore, tag: 'Depth add' };
  }

  // First time addressing this need. Higher priority = higher score.
  // Priority 0 (top need) = 100, smoothly down to ~72 for 5th need.
  const priorityScore = 100 - needIdx * 7;
  // Bonus for addressing top needs early in the draft (first 3 picks)
  const earlyBonus = (needIdx <= 1 && pickIndex < 3) ? 5 : 0;
  // Penalty for addressing top need very late
  const latePenalty = (needIdx === 0 && pickIndex >= totalPicks - 2) ? 10 : 0;

  const score = Math.min(100, Math.max(0, priorityScore + earlyBonus - latePenalty));
  const tag = needIdx === 0 ? 'Top need' : needIdx === 1 ? 'Key need' : 'Need fit';
  return { score: Math.round(score), tag };
}

// ─── Roster build dimension ─────────────────────────────────────────────────

function computeRosterBuildScore(picks, byId) {
  const positionCounts = new Map();
  for (const pick of picks) {
    const player = byId.get(pick.player_id);
    if (!player) continue;
    const pos = normalizePos(player.position);
    positionCounts.set(pos, (positionCounts.get(pos) || 0) + 1);
  }

  let score = 75; // baseline

  // Reward: filling starter holes across multiple positions (breadth)
  const positionsFilled = positionCounts.size;
  if (positionsFilled >= 6) score += 8;
  else if (positionsFilled >= 4) score += 4;
  else if (positionsFilled <= 2) score -= 10; // too narrow

  // Penalty: over-investing at one position (diminishing returns)
  for (const [pos, count] of positionCounts) {
    const starterSlots = STARTER_SLOTS[pos] || 1;
    const excess = count - starterSlots;
    if (excess > 0) {
      // -4 per excess pick beyond starter need
      score -= excess * 4;
    }
  }

  // Reward: premium position investment in early rounds (first 3 picks)
  const earlyPicks = picks.slice(0, 3);
  let premiumEarly = 0;
  for (const pick of earlyPicks) {
    const player = byId.get(pick.player_id);
    if (!player) continue;
    const premium = getPositionPremium(player.position);
    if (premium >= 0.70) premiumEarly++;
  }
  if (premiumEarly >= 2) score += 6;
  else if (premiumEarly === 0 && picks.length >= 3) score -= 5;

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ─── Strategy dimension ─────────────────────────────────────────────────────

function computeStrategyScore(picks, byId, teamNeeds) {
  let score = 75;
  const needList = teamNeeds.map((n) => normalizePos(n));

  // Track what was drafted
  const draftedPositions = [];
  for (const pick of picks) {
    const player = byId.get(pick.player_id);
    if (!player) continue;
    draftedPositions.push(normalizePos(player.position));
  }

  // Reward: addressing top 2 needs within first 3 picks
  const top2Needs = needList.slice(0, 2);
  const earlyAddressed = draftedPositions.slice(0, 3).filter((p) => top2Needs.includes(p));
  if (earlyAddressed.length >= 2) score += 10;
  else if (earlyAddressed.length === 1) score += 4;
  else if (top2Needs.length >= 2 && picks.length >= 3) score -= 6;

  // Reward: no duplicate positions in first 4 picks (variety)
  const first4 = draftedPositions.slice(0, 4);
  const uniqueFirst4 = new Set(first4);
  if (first4.length >= 4 && uniqueFirst4.size === 4) score += 5;
  else if (first4.length >= 4 && uniqueFirst4.size <= 2) score -= 8;

  // Reward: addressing at least 3 of 5 needs somewhere in the draft
  const needsAddressed = new Set(draftedPositions.filter((p) => needList.includes(p)));
  const coverageRatio = needList.length > 0 ? needsAddressed.size / Math.min(needList.length, 5) : 0.5;
  if (coverageRatio >= 0.8) score += 8;
  else if (coverageRatio >= 0.6) score += 3;
  else if (coverageRatio < 0.4 && needList.length >= 3) score -= 8;

  // Penalty: spending early capital on low-premium positions
  for (let i = 0; i < Math.min(2, picks.length); i++) {
    const player = byId.get(picks[i]?.player_id);
    if (!player) continue;
    const premium = getPositionPremium(player.position);
    if (premium < 0.40) score -= 6; // e.g., taking a RB or punter top-2
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ─── Main grading function ──────────────────────────────────────────────────

export function computeTeamMockGrade({ myPicks, byId, teamNeeds = [] }) {
  if (!myPicks || myPicks.length === 0) {
    return {
      value: 0, needFit: 0, rosterBuild: 0, strategy: 0,
      total: 0, letter: null, pickBreakdown: [],
    };
  }

  const needList = (Array.isArray(teamNeeds) ? teamNeeds : []).map((n) => String(n).toUpperCase());
  const addressedNeeds = [];

  const pickBreakdown = [];
  let valueSum = 0;
  let needSum = 0;

  for (let i = 0; i < myPicks.length; i++) {
    const pick = myPicks[i];
    const player = byId.get(pick.player_id);
    if (!player) continue;

    const roundNumber = pick.round || 1;
    const pos = normalizePos(player.position);

    // Value score
    const valueResult = computePickValueScore(pick, player, roundNumber);
    valueSum += valueResult.score;

    // Need score
    const needResult = computePickNeedScore(player, needList, addressedNeeds, i, myPicks.length);
    needSum += needResult.score;

    // Track addressed needs for subsequent picks
    if (needList.includes(pos)) {
      addressedNeeds.push(pos);
    }

    // Per-pick combined grade
    const pickTotal = Math.round(valueResult.score * 0.55 + needResult.score * 0.45);

    pickBreakdown.push({
      pick_number: pick.pick_number,
      round: roundNumber,
      player_name: player.name,
      position: pos,
      value_score: valueResult.score,
      value_tag: valueResult.tag,
      delta: valueResult.delta,
      need_score: needResult.score,
      need_tag: needResult.tag,
      pick_grade: letterFromScore(pickTotal),
      pick_total: pickTotal,
    });
  }

  const validPicks = pickBreakdown.length || 1;
  const value = Math.round(valueSum / validPicks);
  const needFit = Math.round(needSum / validPicks);
  const rosterBuild = computeRosterBuildScore(myPicks, byId);
  const strategy = computeStrategyScore(myPicks, byId, teamNeeds);

  // Weighted composite: Value 35%, Need Fit 30%, Roster Build 20%, Strategy 15%
  const total = Math.round(value * 0.35 + needFit * 0.30 + rosterBuild * 0.20 + strategy * 0.15);

  return {
    value,
    needFit,
    rosterBuild,
    strategy,
    total,
    letter: letterFromScore(total),
    pickBreakdown,
  };
}
