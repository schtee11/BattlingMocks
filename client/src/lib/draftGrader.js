// Draft grade engine — rebuilt to produce meaningful variance.
//
// Three scoring components:
//   1. Per-Pick Value (40%)  — Tier-based value + recalibrated ADP delta.
//   2. Roster Construction (35%) — Positional balance, need coverage, round-appropriate picks.
//   3. Relative Rank (25%, user only) — User roster value vs all CPU teams.
//
// CPU teams receive Components 1 + 2 only (rebalanced to 55% / 45%).
// Per-pick grades: each pick gets its own letter grade + narrative tag.
// Overall grade: weighted composite of the component scores → letter grade.

import { normalizePos } from './botPicker.js';

// ─── ADP Tiers ──────────────────────────────────────────────────────────────
// Groupings by consensus rank calibrated to the 713-prospect board.
// Used to detect picks from a better or worse talent band than expected for
// the slot, adding signal beyond raw ADP delta.
const ADP_TIERS = [
  { tier: 1, min: 1, max: 12 },     // Elite prospects
  { tier: 2, min: 13, max: 32 },    // First-round talents
  { tier: 3, min: 33, max: 64 },    // Day-2 early (R2)
  { tier: 4, min: 65, max: 100 },   // Day-2 late (R3)
  { tier: 5, min: 101, max: 160 },  // Day-3 mid (R4-R5)
  { tier: 6, min: 161, max: Infinity }, // Late round (R6-R7)
];

function getTier(rank) {
  for (const t of ADP_TIERS) {
    if (rank >= t.min && rank <= t.max) return t;
  }
  return ADP_TIERS[ADP_TIERS.length - 1];
}

function getExpectedTier(pickNumber) {
  for (const t of ADP_TIERS) {
    if (pickNumber >= t.min && pickNumber <= t.max) return t;
  }
  return ADP_TIERS[ADP_TIERS.length - 1];
}

// ─── Position value tiers for grading context ────────────────────────────────
const POSITION_PREMIUM = {
  QB: 1.0, EDGE: 0.85, OT: 0.80, WR: 0.75, CB: 0.70,
  TE: 0.55, DT: 0.50, IOL: 0.50, S: 0.45, LB: 0.40, RB: 0.35,
  K: 0.15, P: 0.15, LS: 0.10,
};
function getPositionPremium(pos) {
  return POSITION_PREMIUM[normalizePos(pos)] ?? 0.40;
}

// ─── Starter slots by position (typical NFL roster) ──────────────────────────
const STARTER_SLOTS = {
  QB: 1, RB: 1, WR: 3, TE: 1, OT: 2, IOL: 3,
  EDGE: 2, DT: 2, LB: 2, CB: 2, S: 2,
  K: 1, P: 1, LS: 1,
};

// Key positions that should be addressed during a 7-round draft.
const CRITICAL_POSITIONS = ['QB', 'WR', 'EDGE', 'OT', 'CB'];

// ─── Letter grading ─────────────────────────────────────────────────────────
// Thresholds tuned against Part 4 simulation runs so the user grade
// distribution approximately matches:
//   A/A+ ~10%,  A- ~15%,  B+ ~20%,  B ~20%,  B- ~15%,  C+ ~10%,  C/below ~10%

export function letterFromScore(score) {
  if (score >= 90) return 'A+';
  if (score >= 83) return 'A';
  if (score >= 78) return 'A-';
  if (score >= 73) return 'B+';
  if (score >= 68) return 'B';
  if (score >= 63) return 'B-';
  if (score >= 58) return 'C+';
  if (score >= 52) return 'C';
  if (score >= 45) return 'C-';
  if (score >= 35) return 'D';
  return 'F';
}

export function gradeColor(letter) {
  if (!letter) return '#94a3b8';
  if (letter.startsWith('A')) return '#34d399';
  if (letter.startsWith('B')) return '#fbbf24';
  if (letter.startsWith('C')) return '#f97316';
  return '#ef4444';
}

// ─── Component 1: Per-Pick Value Score ──────────────────────────────────────
// Combines recalibrated ADP delta with a tier-based overlay.
//
// Calibrated to the sim engine's realistic delta range:
//   P5/P95 = ±7, max ≈ ±12-15, stddev ≈ 4.6
// A +7 steal should read as "great value", not "meh".

export function computePickValueScore(pick, player, roundNumber) {
  const rank = Number(player.consensus_rank ?? player.rank);
  if (!Number.isFinite(rank) || rank <= 0) return { score: 60, delta: 0, tag: 'Unranked' };

  const delta = pick.pick_number - rank; // positive = steal, negative = reach
  const pos = normalizePos(player.position);
  const premium = getPositionPremium(pos);

  // ── Recalibrated ADP delta score ──
  // Base 75: at-value picks land in the "Good value" range so the grading
  // tone feels positive for reasonable drafting. Steals push well into A+;
  // reaches drop proportionally. Penalty per spot of reach is intentionally
  // lower than the steal reward — good drafters should be rewarded more than
  // mild reaches are penalized, and late-round prospect rankings have wider
  // uncertainty margins.
  const BASE = 75;
  let adpScore;
  if (delta >= 0) {
    // Steal: +3.5 per spot up to 8, then +1.5 (diminishing returns on giant steals)
    adpScore = BASE + Math.min(delta, 8) * 3.5 + Math.max(0, delta - 8) * 1.5;
  } else {
    // Reach: -2.0 per spot, amplified in early rounds, discounted in late rounds.
    // R1-2 are high-capital picks where reaches hurt most; R5-R7 are where
    // teams take fliers on developmental players and specialists.
    const roundMult = roundNumber <= 2 ? 1.3
      : roundNumber <= 4 ? 1.15
      : roundNumber === 5 ? 0.85
      : roundNumber === 6 ? 0.70
      : 0.55; // R7
    const premDiscount = 1 - premium * 0.3;
    // Specialists (K, P, LS) are always ranked far below where they're drafted;
    // reaching for one is expected, not a mistake.
    const isSpecialist = pos === 'K' || pos === 'P' || pos === 'LS';
    const specialistDiscount = isSpecialist ? 0.20 : 1.0;
    adpScore = BASE + delta * 2.0 * roundMult * premDiscount * specialistDiscount;
  }

  // ── Tier overlay ──
  // Compare the player's talent tier to the expected tier for this pick slot.
  // This rewards getting a better-tier player than the slot warrants and
  // penalizes reaching into a lower tier.
  const playerTier = getTier(rank);
  const expectedTier = getExpectedTier(pick.pick_number);
  const tierDiff = expectedTier.tier - playerTier.tier; // positive = got a better tier
  let tierBonus;
  if (tierDiff >= 2) tierBonus = 6;
  else if (tierDiff === 1) tierBonus = 3;
  else if (tierDiff === 0) tierBonus = 0;
  else if (tierDiff === -1) tierBonus = -3;
  else tierBonus = -5;

  const score = Math.max(0, Math.min(100, Math.round(adpScore + tierBonus)));

  let tag;
  if (score >= 96) tag = 'Elite steal';
  else if (score >= 86) tag = 'Great value';
  else if (score >= 72) tag = 'Good value';
  else if (score >= 58) tag = 'Fair pick';
  else if (score >= 44) tag = 'Slight reach';
  else if (score >= 30) tag = 'Reach';
  else tag = 'Big reach';

  return { score, delta, tag };
}

// ─── Component 2: Roster Construction Score ─────────────────────────────────
// Evaluates the full draft as a roster:
//   A. Draft capital efficiency (up to +12 / -3)
//   B. Positional breadth (up to +12)
//   C. Critical position coverage (up to +10)
//   D. Catastrophic neglect penalty (up to -10 / -6 needs)
//   E. Need coverage (up to +15)
//   F. Round-appropriate picking (up to +12 / -8)
//   G. Over-investment penalty (up to -8)

export function computeRosterConstructionScore(picks, byId, teamNeeds, avgPickValue = null) {
  if (!picks || picks.length === 0) return 0;

  const needList = (Array.isArray(teamNeeds) ? teamNeeds : []).map((n) => normalizePos(String(n)));
  const positionCounts = new Map();
  const draftedPositions = [];

  for (const pick of picks) {
    const player = byId.get(pick.player_id);
    if (!player) continue;
    const pos = normalizePos(player.position);
    positionCounts.set(pos, (positionCounts.get(pos) || 0) + 1);
    draftedPositions.push({ pos, round: pick.round || 1 });
  }

  let score = 65; // baseline — neutral starting point

  // A. Draft capital efficiency: getting elite talent IS good roster
  // construction.  High per-pick value means the team used its draft
  // capital wisely, which is a roster-building signal independent of
  // positional balance.
  if (avgPickValue != null) {
    if (avgPickValue >= 85) score += 12;
    else if (avgPickValue >= 78) score += 7;
    else if (avgPickValue >= 70) score += 3;
    else if (avgPickValue < 60) score -= 3;
  }

  // B. Positional breadth
  const uniquePositions = positionCounts.size;
  if (uniquePositions >= 6) score += 12;
  else if (uniquePositions >= 5) score += 8;
  else if (uniquePositions >= 4) score += 5;
  else if (uniquePositions <= 2) score -= 8;

  // C. Critical position coverage
  for (const critPos of CRITICAL_POSITIONS) {
    if (positionCounts.has(critPos)) score += 2;
  }

  // D. Catastrophic neglect penalty
  for (const critPos of CRITICAL_POSITIONS) {
    if (!positionCounts.has(critPos)) score -= 2;
  }
  if (needList.length > 0) {
    const topNeeds = needList.slice(0, 2);
    for (const need of topNeeds) {
      if (!positionCounts.has(need)) score -= 3;
    }
  }

  // E. Need coverage
  if (needList.length > 0) {
    const needsAddressed = new Set(draftedPositions.map((d) => d.pos).filter((p) => needList.includes(p)));
    const coverageRatio = needsAddressed.size / Math.min(needList.length, 5);
    if (coverageRatio >= 0.8) score += 15;
    else if (coverageRatio >= 0.6) score += 10;
    else if (coverageRatio >= 0.4) score += 5;
  } else {
    score += 8; // no needs data — partial credit
  }

  // F. Round-appropriate picking
  // R1-3: reward premium positions early (BPA era), penalize low-value picks
  // R4-7: reward addressing remaining needs, penalize ignoring them
  const earlyPicks = [];
  const latePicks = [];
  for (const pick of picks) {
    const player = byId.get(pick.player_id);
    if (!player) continue;
    if ((pick.round || 1) <= 3) earlyPicks.push(player);
    else latePicks.push(player);
  }

  let earlyAdj = 0;
  for (const player of earlyPicks) {
    const premium = getPositionPremium(player.position);
    if (premium >= 0.70) earlyAdj += 2;
    else if (premium < 0.40) earlyAdj -= 2;
  }
  score += Math.max(-4, Math.min(6, earlyAdj));

  const needsHitEarly = new Set();
  for (const player of earlyPicks) {
    const pos = normalizePos(player.position);
    if (needList.includes(pos)) needsHitEarly.add(pos);
  }
  const remainingNeeds = needList.filter((n) => !needsHitEarly.has(n));

  let lateAdj = 0;
  for (const player of latePicks) {
    const pos = normalizePos(player.position);
    if (remainingNeeds.includes(pos)) lateAdj += 2;
    else if (remainingNeeds.length >= 2) lateAdj -= 1;
  }
  score += Math.max(-4, Math.min(6, lateAdj));

  // G. Over-investment penalty
  for (const [pos, count] of positionCounts) {
    const slots = STARTER_SLOTS[pos] || 1;
    if (count > slots) score -= (count - slots) * 2;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ─── Component 3: Relative Rank Score (user team only) ──────────────────────
// Compares the user's roster projected value against all CPU teams.
// Uses the same exponential-decay value model as the bot picker
// (rank 1 = 1.0, rank 10 ≈ 0.70).  1st-place team = 100, last = 30, linear.

export function computeRelativeRankScore(userTeam, allPicks, byId) {
  if (!allPicks || allPicks.length === 0) return null;

  // Group picks by team
  const teamPicks = new Map();
  for (const pick of allPicks) {
    const team = pick.team;
    if (!team) continue;
    if (!teamPicks.has(team)) teamPicks.set(team, []);
    teamPicks.get(team).push(pick);
  }

  if (!teamPicks.has(userTeam) || teamPicks.size < 2) return null;

  // Compute roster value using the exponential-decay model
  function rosterValue(picks) {
    let total = 0;
    for (const pick of picks) {
      const player = byId.get(pick.player_id);
      if (!player) continue;
      const rank = Number(player.consensus_rank ?? player.rank);
      if (Number.isFinite(rank) && rank > 0) {
        total += Math.exp(-0.04 * (rank - 1));
      }
    }
    return total;
  }

  const teamValues = [];
  for (const [team, picks] of teamPicks) {
    teamValues.push({ team, value: rosterValue(picks) });
  }
  teamValues.sort((a, b) => b.value - a.value);

  const userRank = teamValues.findIndex((t) => t.team === userTeam) + 1;
  const numTeams = teamValues.length;

  if (numTeams <= 1) return null;

  // Linear scale: 1st = 100, last = 30
  const score = Math.round(100 - ((userRank - 1) / (numTeams - 1)) * 70);
  return Math.max(0, Math.min(100, score));
}

// ─── Main grading function ──────────────────────────────────────────────────

export function computeTeamMockGrade({ myPicks, byId, teamNeeds = [], allPicks = [], userTeam = null }) {
  if (!myPicks || myPicks.length === 0) {
    return {
      pickValue: 0, rosterBuild: 0, relativeRank: null,
      total: 0, letter: null, pickBreakdown: [],
    };
  }

  const needList = (Array.isArray(teamNeeds) ? teamNeeds : []).map((n) => String(n).toUpperCase());

  // Per-pick scoring
  const pickBreakdown = [];
  let valueSum = 0;

  for (let i = 0; i < myPicks.length; i++) {
    const pick = myPicks[i];
    const player = byId.get(pick.player_id);
    if (!player) continue;

    const roundNumber = pick.round || 1;
    const pos = normalizePos(player.position);

    // Component 1 per-pick
    const valueResult = computePickValueScore(pick, player, roundNumber);
    valueSum += valueResult.score;

    pickBreakdown.push({
      pick_number: pick.pick_number,
      round: roundNumber,
      player_name: player.name,
      position: pos,
      value_score: valueResult.score,
      value_tag: valueResult.tag,
      delta: valueResult.delta,
      pick_grade: letterFromScore(valueResult.score),
      pick_total: valueResult.score,
    });
  }

  const validPicks = pickBreakdown.length || 1;
  const pickValue = Math.round(valueSum / validPicks);

  // Component 2: Roster Construction (informed by per-pick quality)
  const rosterBuild = computeRosterConstructionScore(myPicks, byId, teamNeeds, pickValue);

  // Component 3: Relative Rank (user team only, requires allPicks)
  const team = userTeam || myPicks[0]?.team;
  const relativeRank = allPicks.length > 0 && team
    ? computeRelativeRankScore(team, allPicks, byId)
    : null;

  // Final weighted composite
  let total;
  if (relativeRank !== null) {
    // User team: 3-component scoring
    total = Math.round(pickValue * 0.40 + rosterBuild * 0.35 + relativeRank * 0.25);
  } else {
    // CPU team or no all-draft data: 2-component scoring
    total = Math.round(pickValue * 0.55 + rosterBuild * 0.45);
  }

  return {
    pickValue,
    rosterBuild,
    relativeRank,
    total,
    letter: letterFromScore(total),
    pickBreakdown,
  };
}

// ─── League-wide grades (all teams in the draft) ────────────────────────────
// CPU teams get Components 1 + 2; user team gets all three.

export function computeAllTeamGrades({ allPicks, byId, draftOrder = [], userTeam = null }) {
  if (!allPicks || allPicks.length === 0) return [];

  // Group picks by team
  const teamPicksMap = new Map();
  for (const pick of allPicks) {
    if (!pick.team) continue;
    if (!teamPicksMap.has(pick.team)) teamPicksMap.set(pick.team, []);
    teamPicksMap.get(pick.team).push(pick);
  }

  // Build team → needs map from draft order
  const teamNeedsMap = new Map();
  for (const slot of draftOrder) {
    if (slot.team && Array.isArray(slot.team_needs) && slot.team_needs.length && !teamNeedsMap.has(slot.team)) {
      teamNeedsMap.set(slot.team, slot.team_needs);
    }
  }

  const results = [];
  for (const [team, picks] of teamPicksMap) {
    const needs = teamNeedsMap.get(team) || [];
    const isUser = team === userTeam;
    const grade = computeTeamMockGrade({
      myPicks: picks.sort((a, b) => a.pick_number - b.pick_number),
      byId,
      teamNeeds: needs,
      allPicks: isUser ? allPicks : [],
      userTeam: isUser ? team : null,
    });
    results.push({
      team,
      teamName: draftOrder.find((s) => s.team === team)?.team_name || team,
      isUser,
      ...grade,
    });
  }

  results.sort((a, b) => b.total - a.total);
  return results;
}
