import { describe, it, expect } from 'vitest';
import { computeTeamMockGrade, letterFromScore, gradeColor } from '../draftGrader.js';

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
  }));
  return { myPicks, byId, teamNeeds };
}

// ─── letterFromScore ────────────────────────────────────────────────────────

describe('letterFromScore', () => {
  it('returns A+ for 97+', () => expect(letterFromScore(97)).toBe('A+'));
  it('returns A for 93-96', () => expect(letterFromScore(94)).toBe('A'));
  it('returns B+ for 87-89', () => expect(letterFromScore(88)).toBe('B+'));
  it('returns C+ for 77-79', () => expect(letterFromScore(78)).toBe('C+'));
  it('returns F for <60', () => expect(letterFromScore(30)).toBe('F'));
});

describe('gradeColor', () => {
  it('returns green for A grades', () => expect(gradeColor('A+')).toBe('#34d399'));
  it('returns yellow for B grades', () => expect(gradeColor('B-')).toBe('#fbbf24'));
  it('returns orange for C grades', () => expect(gradeColor('C')).toBe('#f97316'));
  it('returns red for D/F grades', () => expect(gradeColor('F')).toBe('#ef4444'));
  it('returns gray for null', () => expect(gradeColor(null)).toBe('#94a3b8'));
});

// ─── computeTeamMockGrade ───────────────────────────────────────────────────

describe('computeTeamMockGrade', () => {
  it('returns zeroes for empty picks', () => {
    const result = computeTeamMockGrade({ myPicks: [], byId: new Map(), teamNeeds: [] });
    expect(result.total).toBe(0);
    expect(result.letter).toBeNull();
    expect(result.pickBreakdown).toHaveLength(0);
  });

  describe('value dimension', () => {
    it('rewards steals (positive delta)', () => {
      // Pick a rank-5 player at pick 15 → steal of 10 spots
      const input = buildGradeInput([
        { rank: 5, position: 'EDGE', pick_number: 15 },
      ]);
      const result = computeTeamMockGrade(input);
      expect(result.value).toBeGreaterThan(85); // Big steal → high value score
    });

    it('penalizes reaches (negative delta)', () => {
      // Pick a rank-30 player at pick 10 → reach of 20 spots
      const input = buildGradeInput([
        { rank: 30, position: 'EDGE', pick_number: 10 },
      ]);
      const result = computeTeamMockGrade(input);
      expect(result.value).toBeLessThan(55); // Big reach → low value score
    });

    it('gives solid B+ for fair-value picks', () => {
      // Pick a rank-10 player at pick 10 → delta 0
      const input = buildGradeInput([
        { rank: 10, position: 'EDGE', pick_number: 10 },
      ]);
      const result = computeTeamMockGrade(input);
      expect(result.value).toBeGreaterThanOrEqual(75);
      expect(result.value).toBeLessThanOrEqual(82);
    });
  });

  describe('need fit dimension', () => {
    it('scores high when addressing top needs early', () => {
      const input = buildGradeInput([
        { rank: 5, position: 'EDGE', pick_number: 5 },  // top need
        { rank: 12, position: 'CB', pick_number: 12 },  // 2nd need
      ]);
      const result = computeTeamMockGrade(input);
      expect(result.needFit).toBeGreaterThan(85);
    });

    it('scores lower when ignoring all needs', () => {
      const input = buildGradeInput([
        { rank: 5, position: 'RB', pick_number: 5 },   // not a need
        { rank: 12, position: 'S', pick_number: 12 },  // not a need
      ]);
      const result = computeTeamMockGrade(input);
      expect(result.needFit).toBeLessThan(60);
    });

    it('penalizes repeated picks at same position (depth diminishing returns)', () => {
      const input = buildGradeInput([
        { rank: 5, position: 'EDGE', pick_number: 5 },
        { rank: 15, position: 'EDGE', pick_number: 40, round: 2 },
      ]);
      const result = computeTeamMockGrade(input);
      // First EDGE gets high score, second gets depth penalty
      const firstNeed = result.pickBreakdown[0].need_score;
      const secondNeed = result.pickBreakdown[1].need_score;
      expect(firstNeed).toBeGreaterThan(secondNeed);
    });
  });

  describe('roster build dimension', () => {
    it('rewards positional diversity', () => {
      const diverseInput = buildGradeInput([
        { rank: 5, position: 'EDGE', pick_number: 5 },
        { rank: 10, position: 'CB', pick_number: 10 },
        { rank: 20, position: 'WR', pick_number: 20 },
        { rank: 40, position: 'OT', pick_number: 40, round: 2 },
        { rank: 60, position: 'RB', pick_number: 60, round: 2 },
        { rank: 80, position: 'DT', pick_number: 80, round: 3 },
      ]);
      const narrowInput = buildGradeInput([
        { rank: 5, position: 'WR', pick_number: 5 },
        { rank: 10, position: 'WR', pick_number: 10 },
        { rank: 20, position: 'WR', pick_number: 20 },
        { rank: 40, position: 'WR', pick_number: 40, round: 2 },
        { rank: 60, position: 'WR', pick_number: 60, round: 2 },
        { rank: 80, position: 'WR', pick_number: 80, round: 3 },
      ]);
      const diverse = computeTeamMockGrade(diverseInput);
      const narrow = computeTeamMockGrade(narrowInput);
      expect(diverse.rosterBuild).toBeGreaterThan(narrow.rosterBuild);
    });
  });

  describe('strategy dimension', () => {
    it('rewards addressing top 2 needs in first 3 picks', () => {
      const goodStrategy = buildGradeInput([
        { rank: 5, position: 'EDGE', pick_number: 5 },   // need #1
        { rank: 10, position: 'CB', pick_number: 10 },   // need #2
        { rank: 20, position: 'WR', pick_number: 20 },   // need #3
      ]);
      const badStrategy = buildGradeInput([
        { rank: 5, position: 'RB', pick_number: 5 },    // not a need, low premium
        { rank: 10, position: 'S', pick_number: 10 },   // not a top need
        { rank: 20, position: 'LB', pick_number: 20 },  // not a top need
      ]);
      const good = computeTeamMockGrade(goodStrategy);
      const bad = computeTeamMockGrade(badStrategy);
      expect(good.strategy).toBeGreaterThan(bad.strategy);
    });
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
      expect(result.pickBreakdown[0].need_tag).toBeTruthy();
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

  describe('overall grade', () => {
    it('produces A-range for a perfect mock (all steals at top needs)', () => {
      const input = buildGradeInput([
        { rank: 1, position: 'EDGE', pick_number: 10 },
        { rank: 5, position: 'CB', pick_number: 20 },
        { rank: 10, position: 'WR', pick_number: 30 },
        { rank: 15, position: 'OT', pick_number: 40, round: 2 },
        { rank: 20, position: 'IOL', pick_number: 50, round: 2 },
      ]);
      const result = computeTeamMockGrade(input);
      expect(result.letter).toMatch(/^A/);
    });

    it('produces C/D range for a bad mock (big reaches, wrong positions)', () => {
      const input = buildGradeInput([
        { rank: 40, position: 'RB', pick_number: 5 },
        { rank: 50, position: 'S', pick_number: 15 },
        { rank: 60, position: 'LB', pick_number: 25 },
        { rank: 70, position: 'RB', pick_number: 35, round: 2 },
      ]);
      const result = computeTeamMockGrade(input);
      expect(['C+', 'C', 'C-', 'D', 'F']).toContain(result.letter);
    });

    it('total is weighted composite of 4 dimensions', () => {
      const input = buildGradeInput([
        { rank: 10, position: 'EDGE', pick_number: 10 },
      ]);
      const result = computeTeamMockGrade(input);
      // total should approximately equal 0.35*value + 0.30*needFit + 0.20*rosterBuild + 0.15*strategy
      const expected = Math.round(
        result.value * 0.35 + result.needFit * 0.30 + result.rosterBuild * 0.20 + result.strategy * 0.15
      );
      expect(Math.abs(result.total - expected)).toBeLessThanOrEqual(1);
    });
  });
});
