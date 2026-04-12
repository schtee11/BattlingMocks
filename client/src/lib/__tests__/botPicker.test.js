import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pickForTeam, normalizePos, simulateDraft } from '../botPicker.js';

// Stub algoConfig so tests are deterministic and independent of server state.
vi.mock('../algoConfig.js', () => {
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
      QB: 1.30, OT: 1.12, EDGE: 1.12, WR: 1.12, CB: 1.08, TE: 1.04,
    },
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
  let _override = null;
  return {
    ALGO_DEFAULTS,
    getAlgoConfig: () => ({ ...ALGO_DEFAULTS, ..._override }),
    loadAlgoConfig: async () => ({ ...ALGO_DEFAULTS, ..._override }),
    __setOverride: (o) => { _override = o; },
  };
});

// Import the mock helper to change config mid-test.
import { __setOverride } from '../algoConfig.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makePlayers(specs) {
  return specs.map((s, i) => ({
    id: s.id ?? i + 1,
    rank: s.rank ?? i + 1,
    name: s.name ?? `Player${i + 1}`,
    position: s.position ?? 'WR',
    school: 'TestU',
  }));
}

function makeQBPool(count) {
  return makePlayers(
    Array.from({ length: count }, (_, i) => ({
      id: 100 + i,
      rank: i + 1,
      position: 'QB',
      name: `QB${i + 1}`,
    }))
  );
}

// Run pickForTeam N times and return a Map<playerId, count>.
function distribution(args, n = 500) {
  const counts = new Map();
  for (let i = 0; i < n; i++) {
    const p = pickForTeam(args);
    counts.set(p.id, (counts.get(p.id) || 0) + 1);
  }
  return counts;
}

// ─── normalizePos ───────────────────────────────────────────────────────────

describe('normalizePos', () => {
  it('maps DL → DT, DE → EDGE', () => {
    expect(normalizePos('DL')).toBe('DT');
    expect(normalizePos('DE')).toBe('EDGE');
  });
  it('maps OG/C/G → IOL', () => {
    expect(normalizePos('OG')).toBe('IOL');
    expect(normalizePos('C')).toBe('IOL');
  });
  it('maps LT/RT/T → OT', () => {
    expect(normalizePos('LT')).toBe('OT');
    expect(normalizePos('RT')).toBe('OT');
    expect(normalizePos('T')).toBe('OT');
  });
  it('passes through canonical positions', () => {
    expect(normalizePos('QB')).toBe('QB');
    expect(normalizePos('WR')).toBe('WR');
    expect(normalizePos('EDGE')).toBe('EDGE');
  });
  it('handles null/undefined', () => {
    expect(normalizePos(null)).toBe('');
    expect(normalizePos(undefined)).toBe('');
  });
});

// ─── BPA (Best Player Available) ────────────────────────────────────────────

describe('BPA selection (no needs)', () => {
  it('returns a player from the available pool', () => {
    const players = makePlayers([
      { rank: 1, position: 'QB' },
      { rank: 5, position: 'WR' },
      { rank: 10, position: 'RB' },
    ]);
    const pick = pickForTeam({ available: players, teamNeeds: [], randomness: 0.25, pickNumber: 1 });
    expect(pick).toBeTruthy();
    expect(players.some((p) => p.id === pick.id)).toBe(true);
  });

  it('strongly favors top-ranked player at low randomness', () => {
    const players = makePlayers([
      { rank: 1, position: 'EDGE' },
      { rank: 10, position: 'WR' },
      { rank: 20, position: 'RB' },
    ]);
    const counts = distribution({ available: players, teamNeeds: [], randomness: 0.15, pickNumber: 1 }, 500);
    // Rank-1 should dominate at low randomness
    expect(counts.get(1) || 0).toBeGreaterThan(350);
  });

  it('returns null for empty available', () => {
    expect(pickForTeam({ available: [], teamNeeds: [], randomness: 0.25, pickNumber: 1 })).toBeNull();
  });

  it('returns the only player when one available', () => {
    const players = makePlayers([{ rank: 50, position: 'K' }]);
    const pick = pickForTeam({ available: players, teamNeeds: [], randomness: 0.25, pickNumber: 1 });
    expect(pick.id).toBe(1);
  });
});

// ─── Needs influence ────────────────────────────────────────────────────────

describe('needs influence', () => {
  it('boosts a lower-ranked player matching top need', () => {
    // Rank 5 WR with top-need WR should beat rank 6 RB (no need) frequently.
    const players = makePlayers([
      { rank: 5, position: 'WR' },
      { rank: 6, position: 'RB' },
    ]);
    const counts = distribution(
      { available: players, teamNeeds: ['WR'], randomness: 0.15, pickNumber: 5 },
      500
    );
    expect(counts.get(1) || 0).toBeGreaterThan(350);
  });

  it('supports OL expansion token for both OT and IOL', () => {
    const players = makePlayers([
      { rank: 10, position: 'OT' },
      { rank: 10, position: 'IOL' },
      { rank: 10, position: 'CB' },
    ]);
    // "OL" should boost both OT and IOL equally.
    const counts = distribution(
      { available: players, teamNeeds: ['OL'], randomness: 0.15, pickNumber: 10 },
      600
    );
    const otCount = counts.get(1) || 0;
    const iolCount = counts.get(2) || 0;
    const cbCount = counts.get(3) || 0;
    // Both OT and IOL should be picked much more than CB
    expect(otCount + iolCount).toBeGreaterThan(cbCount * 2);
  });
});

// ─── Position tiers ─────────────────────────────────────────────────────────

describe('position tiers', () => {
  it('QB tier (1.30) makes a lower-ranked QB competitive', () => {
    // Rank-7 QB: base 0.785 * 1.30 = 1.02, rank-1 WR: base 1.00 * 1.12 = 1.12.
    // WR should still win overall. But rank-5 QB: 0.852 * 1.30 = 1.11, close to rank-1 WR.
    const players = makePlayers([
      { rank: 1, position: 'WR' },
      { rank: 5, position: 'QB' },
    ]);
    // QB at rank 5 should win sometimes against WR at rank 1 due to tier boost
    const counts = distribution(
      { available: players, teamNeeds: [], randomness: 0.25, pickNumber: 1 },
      1000
    );
    const qbRate = (counts.get(2) || 0) / 1000;
    // QB should get at least 15% of picks (tier premium matters)
    expect(qbRate).toBeGreaterThan(0.15);
  });

  it('CB tier (1.08) produces scores between tier-3 and tier-2', () => {
    // At same rank, CB (1.08) should be picked more than RB (1.00) but less than EDGE (1.12)
    const players = makePlayers([
      { rank: 5, position: 'CB' },
      { rank: 5, position: 'RB' },
      { rank: 5, position: 'EDGE' },
    ]);
    const counts = distribution(
      { available: players, teamNeeds: [], randomness: 0.15, pickNumber: 5 },
      1500
    );
    const cb = counts.get(1) || 0;
    const rb = counts.get(2) || 0;
    const edge = counts.get(3) || 0;
    expect(edge).toBeGreaterThan(cb);
    expect(cb).toBeGreaterThan(rb);
  });
});

// ─── Smooth fall cap ────────────────────────────────────────────────────────

describe('smooth fall cap', () => {
  it('boosts a rank-1 player who has fallen to pick 10', () => {
    // Rank-1 player at pick 10 should dominate despite rank-2 and rank-3 also available.
    const players = makePlayers([
      { rank: 1, position: 'EDGE' },
      { rank: 8, position: 'WR' },
      { rank: 9, position: 'CB' },
    ]);
    const counts = distribution(
      { available: players, teamNeeds: [], randomness: 0.25, pickNumber: 10 },
      300
    );
    expect(counts.get(1) || 0).toBeGreaterThan(250);
  });

  it('does not boost a rank-1 player at pick 3 (within allowed fall)', () => {
    // Rank-1 at pick 3: fall=2, allowedFall=3. No boost applied.
    // With randomness, lower-ranked players should get some picks.
    const players = makePlayers([
      { rank: 1, position: 'WR' },
      { rank: 2, position: 'EDGE' },
      { rank: 3, position: 'QB' },
    ]);
    const counts = distribution(
      { available: players, teamNeeds: [], randomness: 0.25, pickNumber: 3 },
      500
    );
    // Rank 2 and 3 should each get some picks (QB has tier boost too)
    const nonRank1 = (counts.get(2) || 0) + (counts.get(3) || 0);
    expect(nonRank1).toBeGreaterThan(50);
  });
});

// ─── Legacy cliff fall cap ──────────────────────────────────────────────────

describe('legacy cliff fall cap', () => {
  beforeEach(() => { __setOverride({ smoothFallEnabled: false }); });
  afterEach(() => { __setOverride(null); });

  it('applies ×15 boost for rank ≤5 fallen >5 picks', () => {
    const players = makePlayers([
      { rank: 3, position: 'RB' },
      { rank: 7, position: 'EDGE' },
      { rank: 8, position: 'WR' },
    ]);
    // Rank-3 at pick 10: fall=7 > 5, rank ≤ 5 → ×15. Should always win.
    const counts = distribution(
      { available: players, teamNeeds: [], randomness: 0.15, pickNumber: 10 },
      300
    );
    expect(counts.get(1) || 0).toBeGreaterThan(280);
  });
});

// ─── Positional scarcity (Feature 1) ────────────────────────────────────────

describe('positional scarcity', () => {
  it('boosts players when their position is depleted', () => {
    // Full pool: 10 QBs + 10 WRs. Available: 2 QBs + 8 WRs.
    // QB depletion = 80% > threshold 50%. Scarcity should boost QBs.
    const allPlayers = [
      ...makePlayers(Array.from({ length: 10 }, (_, i) => ({ id: i + 1, rank: i + 1, position: 'QB' }))),
      ...makePlayers(Array.from({ length: 10 }, (_, i) => ({ id: i + 11, rank: i + 11, position: 'WR' }))),
    ];
    const available = [
      allPlayers[8], allPlayers[9],  // QB rank 9, 10
      ...allPlayers.slice(10, 18),   // WR rank 11-18
    ];
    const counts = distribution(
      {
        available,
        teamNeeds: ['QB'],
        randomness: 0.15,
        pickNumber: 15,
        draftContext: { allPlayers, teamDraftedPos: [], recentPicks: [] },
      },
      500
    );
    const qbPicks = (counts.get(9) || 0) + (counts.get(10) || 0);
    // QBs should get significant picks despite worse rank, due to scarcity + need
    expect(qbPicks).toBeGreaterThan(200);
  });

  it('does not apply scarcity when draftContext is missing', () => {
    const players = makePlayers([
      { rank: 1, position: 'EDGE' },
      { rank: 5, position: 'QB' },
    ]);
    // Without draftContext, should behave like baseline BPA
    const pick = pickForTeam({ available: players, teamNeeds: [], randomness: 0, pickNumber: 1 });
    expect(pick).toBeTruthy();
  });
});

// ─── Run detection (Feature 3) ──────────────────────────────────────────────

describe('position run detection', () => {
  it('boosts a position when 3+ recent picks are at that position', () => {
    const allPlayers = makePlayers([
      { rank: 8, position: 'QB' },
      { rank: 5, position: 'WR' },
    ]);
    // Simulate a QB run: 3 QBs in last 8 picks
    const recentPicks = [
      { position: 'QB' }, { position: 'QB' }, { position: 'QB' },
      { position: 'WR' }, { position: 'EDGE' },
    ];
    const counts = distribution(
      {
        available: allPlayers,
        teamNeeds: ['QB'],
        randomness: 0.15,
        pickNumber: 10,
        draftContext: { allPlayers, teamDraftedPos: [], recentPicks },
      },
      500
    );
    // QB at rank 8 should get a meaningful share due to run + need
    expect(counts.get(1) || 0).toBeGreaterThan(150);
  });
});

// ─── Roster context decay (Feature 2) ───────────────────────────────────────

describe('roster context decay', () => {
  it('reduces need boost when team already drafted that position', () => {
    const players = makePlayers([
      { rank: 5, position: 'EDGE' },
      { rank: 5, position: 'WR' },
    ]);
    const allPlayers = players;

    // With no prior EDGE: EDGE should dominate (EDGE has tier 1.12 + need 1.20)
    const N = 2000;
    const countsNoPrior = distribution(
      {
        available: players,
        teamNeeds: ['EDGE'],
        randomness: 0.15,
        pickNumber: 5,
        draftContext: { allPlayers, teamDraftedPos: [], recentPicks: [] },
      },
      N
    );

    // With one prior EDGE: EDGE need boost should be decayed
    const countsWithPrior = distribution(
      {
        available: players,
        teamNeeds: ['EDGE'],
        randomness: 0.15,
        pickNumber: 5,
        draftContext: { allPlayers, teamDraftedPos: ['EDGE'], recentPicks: [] },
      },
      N
    );

    const edgeRateNoPrior = (countsNoPrior.get(1) || 0) / N;
    const edgeRateWithPrior = (countsWithPrior.get(1) || 0) / N;
    // EDGE pick rate should be lower when already drafted EDGE
    expect(edgeRateNoPrior).toBeGreaterThanOrEqual(edgeRateWithPrior);
  });
});

// ─── Extended needs (Feature 6) ─────────────────────────────────────────────

describe('extended needs boosts', () => {
  it('applies boost to 4th and 5th priority needs', () => {
    // 5 same-ranked players at different positions. Needs order: p1, p2, p3, p4, p5.
    const players = makePlayers([
      { rank: 10, position: 'QB' },
      { rank: 10, position: 'WR' },
      { rank: 10, position: 'EDGE' },
      { rank: 10, position: 'RB' },
      { rank: 10, position: 'S' },
    ]);
    const counts = distribution(
      {
        available: players,
        teamNeeds: ['QB', 'WR', 'EDGE', 'RB', 'S'],
        randomness: 0.15,
        pickNumber: 10,
      },
      3000
    );
    // QB (need 1 + tier 1.30) should dominate. But RB (need 4) and S (need 5) should
    // get more picks than they would with zero boost. At minimum they should each appear.
    expect(counts.get(4) || 0).toBeGreaterThan(0); // RB (4th need)
    expect(counts.get(5) || 0).toBeGreaterThan(0); // S (5th need)
  });
});

// ─── Backward compatibility ─────────────────────────────────────────────────

describe('backward compatibility', () => {
  it('works without draftContext parameter', () => {
    const players = makePlayers([
      { rank: 1, position: 'QB' },
      { rank: 2, position: 'EDGE' },
      { rank: 3, position: 'WR' },
    ]);
    // Call with original 4-param signature — no draftContext
    const pick = pickForTeam({
      available: players,
      teamNeeds: ['QB'],
      randomness: 0.25,
      pickNumber: 1,
    });
    expect(pick).toBeTruthy();
    expect(players.some((p) => p.id === pick.id)).toBe(true);
  });

  it('simulateDraft works without draftContext', () => {
    const players = makePlayers([
      { rank: 1, position: 'QB' },
      { rank: 2, position: 'EDGE' },
      { rank: 3, position: 'WR' },
      { rank: 4, position: 'OT' },
    ]);
    const draftOrder = [
      { pick_number: 1, team: 'NYG', team_needs: ['QB'], round: 1 },
      { pick_number: 2, team: 'NE', team_needs: ['WR'], round: 1 },
      { pick_number: 3, team: 'CLE', team_needs: ['EDGE'], round: 1 },
    ];
    const result = simulateDraft({
      draftOrder,
      players,
      userTeam: 'NONE',
      userPicks: {},
      randomness: 0.25,
    });
    expect(result).toHaveLength(3);
    // All picks should have valid player_ids
    result.forEach((r) => {
      expect(r.player_id).toBeTruthy();
    });
    // No duplicate picks
    const ids = result.map((r) => r.player_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
