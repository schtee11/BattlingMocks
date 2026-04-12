import { describe, it, expect } from 'vitest';
import {
  computeTeamMockGrade,
  computeAllTeamGrades,
  computePickValueScore,
  computeRosterConstructionScore,
  computeRelativeRankScore,
  letterFromScore,
  gradeColor,
} from '../draftGrader.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makePlayer(overrides = {}) {
  return {
    id: overrides.id ?? 1,
    rank: overrides.rank ?? 10,
    consensus_rank: overrides.consensus_rank ?? overrides.rank ?? 10,
    name: overrides.name ?? 'Test Player',
    position: overrides.position ?? 'WR',
    school: 'TestU',
    ...overrides,
  };
}

function makePick(overrides = {}) {
  return {
    pick_number: overrides.pick_number ?? 10,
    player_id: overrides.player_id ?? 1,
    round: overrides.round ?? 1,
    team: overrides.team ?? 'LV',
    is_user: true,
    ...overrides,
  };
}

function buildGradeInput(specs, teamNeeds = ['EDGE', 'CB', 'WR', 'OT', 'IOL']) {
  const players = specs.map((s, i) => makePlayer({ id: i + 1, ...s }));
  const byId = new Map(players.map((p) => [p.id, p]));
  const myPicks = specs.map((s, i) => makePick({
    player_id: i + 1,
    pick_number: s.pick_number ?? (i + 1) * 10,
    round: s.round ?? 1,
    team: s.team ?? 'LV',
  }));
  return { myPicks, byId, teamNeeds };
}

// Build a full-draft input with user + CPU picks for relative rank testing
function buildFullDraftInput(userSpecs, cpuTeams, teamNeeds = ['EDGE', 'CB', 'WR', 'OT', 'IOL']) {
  let nextId = 1;
  const allPlayers = [];
  const allPicks = [];

  // User picks
  for (const spec of userSpecs) {
    const player = makePlayer({ id: nextId, ...spec });
    allPlayers.push(player);
    allPicks.push(makePick({
      player_id: nextId,
      pick_number: spec.pick_number ?? nextId * 10,
      round: spec.round ?? 1,
      team: 'LV',
    }));
    nextId++;
  }

  // CPU team picks
  for (const cpuTeam of cpuTeams) {
    for (const spec of cpuTeam.picks) {
      const player = makePlayer({ id: nextId, ...spec });
      allPlayers.push(player);
      allPicks.push(makePick({
        player_id: nextId,
        pick_number: spec.pick_number ?? nextId * 10,
        round: spec.round ?? 1,
        team: cpuTeam.team,
      }));
      nextId++;
    }
  }

  const byId = new Map(allPlayers.map((p) => [p.id, p]));
  const myPicks = allPicks.filter((p) => p.team === 'LV');
  return { myPicks, byId, teamNeeds, allPicks, userTeam: 'LV' };
}

// ─── letterFromScore ────────────────────────────────────────────────────────

describe('letterFromScore (academic scale)', () => {
  it('returns A+ for 97+', () => expect(letterFromScore(98)).toBe('A+'));
  it('returns A for 93-96', () => expect(letterFromScore(95)).toBe('A'));
  it('returns A- for 90-92', () => expect(letterFromScore(91)).toBe('A-'));
  it('returns B+ for 87-89', () => expect(letterFromScore(88)).toBe('B+'));
  it('returns B for 83-86', () => expect(letterFromScore(85)).toBe('B'));
  it('returns B- for 80-82', () => expect(letterFromScore(81)).toBe('B-'));
  it('returns C+ for 77-79', () => expect(letterFromScore(78)).toBe('C+'));
  it('returns C for 73-76', () => expect(letterFromScore(74)).toBe('C'));
  it('returns C- for 70-72', () => expect(letterFromScore(71)).toBe('C-'));
  it('returns D for 60-69', () => expect(letterFromScore(65)).toBe('D'));
  it('returns F for <60', () => expect(letterFromScore(55)).toBe('F'));
});

describe('gradeColor', () => {
  it('returns green for A grades', () => expect(gradeColor('A+')).toBe('#34d399'));
  it('returns yellow for B grades', () => expect(gradeColor('B-')).toBe('#fbbf24'));
  it('returns orange for C grades', () => expect(gradeColor('C')).toBe('#f97316'));
  it('returns red for D/F grades', () => expect(gradeColor('F')).toBe('#ef4444'));
  it('returns gray for null', () => expect(gradeColor(null)).toBe('#94a3b8'));
});

// ─── Component 1: Per-Pick Value Score ──────────────────────────────────────

describe('computePickValueScore', () => {
  it('rewards steals with recalibrated thresholds (3.75 pts/spot)', () => {
    const pick = makePick({ pick_number: 15 });
    const player = makePlayer({ rank: 5, position: 'EDGE' });
    const result = computePickValueScore(pick, player, 1);
    // delta = +10: base 80 + 8*3.0 + 2*1.5 = 107 (capped 100), tier bonus +3
    expect(result.score).toBeGreaterThanOrEqual(95);
    expect(result.delta).toBe(10);
    expect(result.tag).toMatch(/steal|value/i);
  });

  it('penalizes reaches with progressive penalty and round modifier', () => {
    const pick = makePick({ pick_number: 10 });
    const player = makePlayer({ rank: 25, position: 'CB' });
    const result = computePickValueScore(pick, player, 1);
    // delta = -15 in R1: progressive penalty is gentle for first 8 spots,
    // moderate for next 7. With R1 roundMult 1.3 and tier penalty, score ~64
    expect(result.score).toBeLessThan(70);
    expect(result.score).toBeGreaterThan(55);
    expect(result.delta).toBe(-15);
  });

  it('centers at-value picks around base 80 (Good value / B-)', () => {
    const pick = makePick({ pick_number: 10 });
    const player = makePlayer({ rank: 10, position: 'EDGE' });
    const result = computePickValueScore(pick, player, 1);
    // delta = 0: base 80, tier bonus 0 (tier 1 at tier 1 slot), no need bonus
    expect(result.score).toBeGreaterThanOrEqual(77);
    expect(result.score).toBeLessThanOrEqual(83);
    expect(result.tag).toBe('Good value');
  });

  it('applies tier bonus when player is from a better tier than expected', () => {
    const pick = makePick({ pick_number: 40 }); // Expected: Tier 3 (33-64)
    const player = makePlayer({ rank: 8, position: 'EDGE' }); // Tier 1 (1-12)
    const result = computePickValueScore(pick, player, 2);
    // delta = +32: huge steal + tier bonus (expected tier 3, got tier 1 = +6) → capped at 100
    expect(result.score).toBeGreaterThanOrEqual(96);
    expect(result.tag).toBe('Elite steal');
  });

  it('applies tier penalty when reaching into a lower tier', () => {
    const pick = makePick({ pick_number: 10 }); // Expected: Tier 1 (1-12)
    const player = makePlayer({ rank: 40, position: 'WR' }); // Tier 3 (33-64)
    const result = computePickValueScore(pick, player, 1);
    // delta = -30: big reach + tier penalty (expected tier 1, got tier 3)
    expect(result.score).toBeLessThan(30);
  });

  it('returns 60 for unranked players', () => {
    const pick = makePick({ pick_number: 10 });
    const player = makePlayer({ rank: null, consensus_rank: null });
    const result = computePickValueScore(pick, player, 1);
    expect(result.score).toBe(60);
    expect(result.tag).toBe('Unranked');
  });

  it('discounts late-round reaches (R7 vs R1)', () => {
    const player = makePlayer({ rank: 25, position: 'CB' });
    const r1 = computePickValueScore(makePick({ pick_number: 10 }), player, 1);
    const r7 = computePickValueScore(makePick({ pick_number: 10 }), player, 7);
    // Same delta (-15), but R7 should be more forgiving than R1
    expect(r7.score).toBeGreaterThan(r1.score);
  });

  it('treats specialist picks (K/P) leniently in late rounds', () => {
    // Best K (rank 258) taken at pick 224 (last pick, R7)
    const kPick = makePick({ pick_number: 224 });
    const kPlayer = makePlayer({ rank: 258, position: 'K' });
    const kResult = computePickValueScore(kPick, kPlayer, 7);
    // Despite delta -34, specialist discount should keep it reasonable
    expect(kResult.score).toBeGreaterThanOrEqual(52);
    expect(kResult.tag).not.toBe('Big reach');

    // Compare: non-specialist with same delta in R7
    const wrPick = makePick({ pick_number: 190 });
    const wrPlayer = makePlayer({ rank: 224, position: 'WR' });
    const wrResult = computePickValueScore(wrPick, wrPlayer, 7);
    // Specialist should score better than non-specialist at same delta
    expect(kResult.score).toBeGreaterThan(wrResult.score);
  });

  it('grades at-value picks at a top need as 95 (A)', () => {
    const pick = makePick({ pick_number: 26 });
    const player = makePlayer({ rank: 26, position: 'DT' });
    // needRank 0 = top need → +15 bonus
    const result = computePickValueScore(pick, player, 1, 0);
    // base 80 + 0 (delta) + 0 (tier) + 15 (need) = 95
    expect(result.score).toBe(95);
    expect(result.tag).toBe('Great value');
  });

  it('grades at-value picks at a lower need as 90 (A-)', () => {
    const pick = makePick({ pick_number: 126 });
    const player = makePlayer({ rank: 126, position: 'CB' });
    // needRank 3 = lower need → +10 bonus
    const result = computePickValueScore(pick, player, 4, 3);
    // base 80 + 0 + 0 + 10 = 90
    expect(result.score).toBe(90);
    expect(result.tag).toBe('Great value');
  });

  it('gives no need bonus when needRank is -1 (not a need)', () => {
    const pick = makePick({ pick_number: 50 });
    const player = makePlayer({ rank: 50, position: 'RB' });
    const withNeed = computePickValueScore(pick, player, 2, 0);
    const withoutNeed = computePickValueScore(pick, player, 2, -1);
    expect(withNeed.score).toBeGreaterThan(withoutNeed.score);
    // Without need: base 80, at-value → "Good value" (need bonus adds on top)
    expect(withoutNeed.score).toBe(80);
  });

  it('need bonus offsets slight reaches for need-filling picks', () => {
    // Slight reach (-4) but filling top need
    const pick = makePick({ pick_number: 91 });
    const player = makePlayer({ rank: 95, position: 'WR' });
    const withNeed = computePickValueScore(pick, player, 3, 1);
    const withoutNeed = computePickValueScore(pick, player, 3, -1);
    // With need bonus, should be at least "Fair pick", better than without
    expect(withNeed.score).toBeGreaterThan(withoutNeed.score);
    expect(withNeed.tag).not.toMatch(/reach/i);
  });
});

// ─── Component 2: Roster Construction Score ─────────────────────────────────

describe('computeRosterConstructionScore', () => {
  it('rewards positional diversity', () => {
    const specs = [
      { rank: 5, position: 'EDGE', pick_number: 5 },
      { rank: 10, position: 'CB', pick_number: 10 },
      { rank: 20, position: 'WR', pick_number: 20 },
      { rank: 40, position: 'OT', pick_number: 40, round: 2 },
      { rank: 60, position: 'RB', pick_number: 60, round: 2 },
      { rank: 80, position: 'DT', pick_number: 80, round: 3 },
    ];
    const { myPicks, byId, teamNeeds } = buildGradeInput(specs);
    const score = computeRosterConstructionScore(myPicks, byId, teamNeeds);
    expect(score).toBeGreaterThan(70); // diverse roster + needs addressed
  });

  it('penalizes over-investment at one position', () => {
    const specs = [
      { rank: 5, position: 'WR', pick_number: 5 },
      { rank: 10, position: 'WR', pick_number: 10 },
      { rank: 20, position: 'WR', pick_number: 20 },
      { rank: 40, position: 'WR', pick_number: 40, round: 2 },
      { rank: 60, position: 'WR', pick_number: 60, round: 2 },
    ];
    const { myPicks, byId, teamNeeds } = buildGradeInput(specs);
    const score = computeRosterConstructionScore(myPicks, byId, teamNeeds);
    expect(score).toBeLessThan(55); // narrow + over-invested
  });

  it('penalizes catastrophic neglect of top needs', () => {
    // Team needs EDGE and CB, drafts neither
    const specs = [
      { rank: 5, position: 'RB', pick_number: 5 },
      { rank: 10, position: 'TE', pick_number: 10 },
      { rank: 20, position: 'S', pick_number: 20 },
    ];
    const { myPicks, byId, teamNeeds } = buildGradeInput(specs);
    const score = computeRosterConstructionScore(myPicks, byId, teamNeeds);
    expect(score).toBeLessThan(60); // missing top needs + neglect
  });

  it('rewards high need coverage', () => {
    // Address 4 of 5 needs
    const specs = [
      { rank: 5, position: 'EDGE', pick_number: 5 },
      { rank: 10, position: 'CB', pick_number: 10 },
      { rank: 20, position: 'WR', pick_number: 20 },
      { rank: 40, position: 'OT', pick_number: 40, round: 2 },
    ];
    const { myPicks, byId, teamNeeds } = buildGradeInput(specs);
    const score = computeRosterConstructionScore(myPicks, byId, teamNeeds);
    expect(score).toBeGreaterThan(75); // 80% coverage + good breadth
  });
});

// ─── Component 3: Relative Rank Score ───────────────────────────────────────

describe('computeRelativeRankScore', () => {
  it('returns 100 for the #1 ranked team', () => {
    const allPicks = [
      makePick({ player_id: 1, team: 'LV' }),
      makePick({ player_id: 2, team: 'NYJ' }),
    ];
    const byId = new Map([
      [1, makePlayer({ id: 1, rank: 1 })], // LV gets rank 1 → highest value
      [2, makePlayer({ id: 2, rank: 50 })], // NYJ gets rank 50 → lower value
    ]);
    const score = computeRelativeRankScore('LV', allPicks, byId);
    expect(score).toBe(100);
  });

  it('returns 30 for the last-place team', () => {
    const allPicks = [
      makePick({ player_id: 1, team: 'LV' }),
      makePick({ player_id: 2, team: 'NYJ' }),
    ];
    const byId = new Map([
      [1, makePlayer({ id: 1, rank: 50 })], // LV gets rank 50 → lower value
      [2, makePlayer({ id: 2, rank: 1 })],  // NYJ gets rank 1 → highest value
    ]);
    const score = computeRelativeRankScore('LV', allPicks, byId);
    expect(score).toBe(30);
  });

  it('scales linearly between best and worst', () => {
    const allPicks = [
      makePick({ player_id: 1, team: 'A' }),
      makePick({ player_id: 2, team: 'B' }),
      makePick({ player_id: 3, team: 'C' }),
    ];
    const byId = new Map([
      [1, makePlayer({ id: 1, rank: 1 })],
      [2, makePlayer({ id: 2, rank: 10 })],
      [3, makePlayer({ id: 3, rank: 50 })],
    ]);
    const score = computeRelativeRankScore('B', allPicks, byId);
    // B is rank 2 of 3: score = 100 - (1/2)*70 = 65
    expect(score).toBe(65);
  });

  it('returns null when allPicks is empty', () => {
    const byId = new Map([[1, makePlayer({ id: 1 })]]);
    expect(computeRelativeRankScore('LV', [], byId)).toBeNull();
  });

  it('returns null when team has fewer than 2 teams', () => {
    const allPicks = [makePick({ player_id: 1, team: 'LV' })];
    const byId = new Map([[1, makePlayer({ id: 1 })]]);
    expect(computeRelativeRankScore('LV', allPicks, byId)).toBeNull();
  });
});

// ─── computeTeamMockGrade (main function) ───────────────────────────────────

describe('computeTeamMockGrade', () => {
  it('returns zeroes for empty picks', () => {
    const result = computeTeamMockGrade({ myPicks: [], byId: new Map(), teamNeeds: [] });
    expect(result.total).toBe(0);
    expect(result.letter).toBeNull();
    expect(result.pickBreakdown).toHaveLength(0);
  });

  it('includes pickValue, rosterBuild, and relativeRank in the result', () => {
    const input = buildGradeInput([
      { rank: 10, position: 'EDGE', pick_number: 10 },
    ]);
    const result = computeTeamMockGrade(input);
    expect(result).toHaveProperty('pickValue');
    expect(result).toHaveProperty('rosterBuild');
    expect(result).toHaveProperty('relativeRank');
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('letter');
    expect(result).toHaveProperty('pickBreakdown');
  });

  it('uses 2-component scoring when allPicks is not provided (CPU mode)', () => {
    const input = buildGradeInput([
      { rank: 10, position: 'EDGE', pick_number: 10 },
    ]);
    const result = computeTeamMockGrade(input);
    expect(result.relativeRank).toBeNull();
    // total ≈ pickValue * 0.55 + rosterBuild * 0.45
    const expected = Math.round(result.pickValue * 0.55 + result.rosterBuild * 0.45);
    expect(Math.abs(result.total - expected)).toBeLessThanOrEqual(1);
  });

  it('uses 2-component scoring even when allPicks is provided (user mode)', () => {
    const input = buildFullDraftInput(
      [{ rank: 5, position: 'EDGE', pick_number: 5 }],
      [{ team: 'NYJ', picks: [{ rank: 30, position: 'WR', pick_number: 2 }] }],
    );
    const result = computeTeamMockGrade(input);
    expect(result.relativeRank).not.toBeNull(); // still computed, just not used in grade
    // total = pickValue * 0.55 + rosterBuild * 0.45 (relativeRank excluded from grade)
    const expected = Math.round(result.pickValue * 0.55 + result.rosterBuild * 0.45);
    expect(Math.abs(result.total - expected)).toBeLessThanOrEqual(1);
  });

  describe('per-pick breakdown', () => {
    it('assigns a letter grade and value tag to each pick', () => {
      const input = buildGradeInput([
        { rank: 5, position: 'EDGE', pick_number: 15 },   // steal
        { rank: 30, position: 'CB', pick_number: 10 },    // reach
      ]);
      const result = computeTeamMockGrade(input);
      expect(result.pickBreakdown).toHaveLength(2);
      expect(result.pickBreakdown[0].pick_grade).toBeTruthy();
      expect(result.pickBreakdown[0].value_tag).toBeTruthy();
      expect(result.pickBreakdown[1].pick_grade).toBeTruthy();
    });

    it('tags steals and reaches correctly', () => {
      const input = buildGradeInput([
        { rank: 1, position: 'EDGE', pick_number: 20 },   // big steal
        { rank: 50, position: 'CB', pick_number: 10 },    // big reach
      ]);
      const result = computeTeamMockGrade(input);
      expect(result.pickBreakdown[0].value_tag).toMatch(/steal|value/i);
      expect(result.pickBreakdown[1].value_tag).toMatch(/reach/i);
    });
  });

  describe('need-awareness in overall grade', () => {
    it('pickValue is higher when picks address team needs', () => {
      // Draft addressing needs: EDGE, CB, WR are top needs
      const onNeed = buildGradeInput([
        { rank: 10, position: 'EDGE', pick_number: 10 },
        { rank: 20, position: 'CB', pick_number: 20 },
        { rank: 40, position: 'WR', pick_number: 40, round: 2 },
      ], ['EDGE', 'CB', 'WR', 'OT', 'IOL']);

      // Draft ignoring needs: same ADP delta but non-need positions
      const offNeed = buildGradeInput([
        { rank: 10, position: 'RB', pick_number: 10 },
        { rank: 20, position: 'S', pick_number: 20 },
        { rank: 40, position: 'LB', pick_number: 40, round: 2 },
      ], ['EDGE', 'CB', 'WR', 'OT', 'IOL']);

      const onResult = computeTeamMockGrade(onNeed);
      const offResult = computeTeamMockGrade(offNeed);

      // On-need picks should have higher pickValue due to need bonus
      expect(onResult.pickValue).toBeGreaterThan(offResult.pickValue);
    });

    it('second pick at same need position does not get need bonus', () => {
      // Two DTs — only first should get need bonus
      const input = buildGradeInput([
        { rank: 26, position: 'DT', pick_number: 26 },
        { rank: 80, position: 'DT', pick_number: 80, round: 3 },
      ], ['DT', 'WR', 'CB']);

      const result = computeTeamMockGrade(input);
      // First DT gets need bonus (needRank 0 → +5), second does not
      expect(result.pickBreakdown[0].value_score).toBeGreaterThan(result.pickBreakdown[1].value_score);
    });
  });

  describe('overall grade variance', () => {
    it('produces A-range for a great mock (all steals at needs)', () => {
      const input = buildGradeInput([
        { rank: 1, position: 'EDGE', pick_number: 10 },
        { rank: 5, position: 'CB', pick_number: 20 },
        { rank: 10, position: 'WR', pick_number: 30 },
        { rank: 15, position: 'OT', pick_number: 40, round: 2 },
        { rank: 20, position: 'IOL', pick_number: 50, round: 2 },
      ]);
      const result = computeTeamMockGrade(input);
      // With no allPicks, this is 2-component (CPU mode)
      // pickValue should be high (all steals), rosterBuild should be high (needs addressed)
      expect(result.pickValue).toBeGreaterThan(80);
      expect(result.letter).toMatch(/^[AB]/);
    });

    it('produces C/D range for a bad mock (big reaches, wrong positions)', () => {
      const input = buildGradeInput([
        { rank: 40, position: 'RB', pick_number: 5 },
        { rank: 50, position: 'S', pick_number: 15 },
        { rank: 60, position: 'LB', pick_number: 25 },
        { rank: 70, position: 'RB', pick_number: 35, round: 2 },
      ]);
      const result = computeTeamMockGrade(input);
      expect(result.pickValue).toBeLessThan(55);
      expect(['C+', 'C', 'C-', 'D', 'F']).toContain(result.letter);
    });

    it('relativeRank is still computed but does not affect total', () => {
      const input = buildFullDraftInput(
        [
          { rank: 80, position: 'RB', pick_number: 5 },
          { rank: 90, position: 'S', pick_number: 15 },
        ],
        [
          { team: 'NYJ', picks: [
            { rank: 1, position: 'EDGE', pick_number: 2 },
            { rank: 2, position: 'QB', pick_number: 12 },
          ]},
        ],
      );
      const result = computeTeamMockGrade(input);
      expect(result.relativeRank).toBe(30); // still computed
      // total uses only PV and RB — relativeRank excluded
      const expected = Math.round(result.pickValue * 0.55 + result.rosterBuild * 0.45);
      expect(Math.abs(result.total - expected)).toBeLessThanOrEqual(1);
    });
  });
});

// ─── computeAllTeamGrades ───────────────────────────────────────────────────

describe('computeAllTeamGrades', () => {
  it('grades all teams and sorts by total descending', () => {
    const input = buildFullDraftInput(
      [{ rank: 1, position: 'EDGE', pick_number: 5 }],
      [
        { team: 'NYJ', picks: [{ rank: 30, position: 'WR', pick_number: 2 }] },
        { team: 'ARI', picks: [{ rank: 50, position: 'RB', pick_number: 3 }] },
      ],
    );
    const draftOrder = [
      { team: 'LV', team_name: 'Las Vegas Raiders', team_needs: ['EDGE', 'CB'] },
      { team: 'NYJ', team_name: 'New York Jets', team_needs: ['QB', 'OT'] },
      { team: 'ARI', team_name: 'Arizona Cardinals', team_needs: ['EDGE', 'CB'] },
    ];
    const results = computeAllTeamGrades({
      allPicks: input.allPicks,
      byId: input.byId,
      draftOrder,
      userTeam: 'LV',
    });
    expect(results.length).toBe(3);
    // Results should be sorted by total descending
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].total).toBeGreaterThanOrEqual(results[i].total);
    }
    // User team should be flagged
    const userResult = results.find((r) => r.team === 'LV');
    expect(userResult.isUser).toBe(true);
    // User should have relativeRank, CPU should not
    expect(userResult.relativeRank).not.toBeNull();
    const cpuResult = results.find((r) => r.team === 'NYJ');
    expect(cpuResult.relativeRank).toBeNull();
    expect(cpuResult.isUser).toBe(false);
  });
});
