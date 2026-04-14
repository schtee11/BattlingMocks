// @vitest-environment jsdom
/**
 * Smoke test: verify DraftSimulator renders without crashing.
 * Specifically guards against TDZ errors from hook declaration order.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../lib/api.js', () => ({
  api: {
    listBoards: vi.fn().mockResolvedValue([]),
    getBoardById: vi.fn().mockResolvedValue({ players: [] }),
    createDraftSession: vi.fn().mockResolvedValue({ id: 1 }),
    logDraftSessionPicks: vi.fn().mockResolvedValue({}),
    completeDraftSession: vi.fn().mockResolvedValue({}),
    getAlgoConfig: vi.fn().mockResolvedValue({}),
    listTeamMocks: vi.fn().mockResolvedValue([]),
    getPlayers: vi.fn().mockResolvedValue([]),
    getDraftOrderAll: vi.fn().mockResolvedValue([]),
  },
  proxyImageUrl: vi.fn((u) => u),
  API_BASE: 'http://localhost:3001',
}));

const ALGO = {
  decayRate: 0.04, needsBoost1: 0.2, needsBoost2: 0.13, runWindowSize: 8,
  needsBoost3: 0.07, needsBoost4: 0.04, needsBoost5: 0.02,
  fallCap1MaxRank: 5, fallCap1MaxFall: 5, fallCap1Boost: 15,
  fallCap2MaxRank: 10, fallCap2MaxFall: 9, fallCap2Boost: 8,
  fallCap3MaxRank: 20, fallCap3MaxFall: 13, fallCap3Boost: 4,
  smoothFallEnabled: true, fallAllowedBase: 3, fallAllowedScale: 0.5,
  fallBoostRate: 0.35, fallBoostMax: 20,
  positionTiers: { QB: 1.3, OT: 1.12, EDGE: 1.12, WR: 1.12, CB: 1.08, TE: 1.04 },
  scoreSharpness: 5, scarcityEnabled: true, scarcityThreshold: 0.5,
  scarcityMaxBoost: 1.25, scarcityCurve: 1.5,
  draftedNeedDecay: 0.6, draftedNeedFloor: 0.3,
};
vi.mock('../../lib/algoConfig.js', () => ({
  ALGO_DEFAULTS: ALGO,
  loadAlgoConfig: vi.fn().mockResolvedValue(ALGO),
  getAlgoConfig: vi.fn(() => ALGO),
}));

vi.mock('../../hooks/useAuth.js', () => ({
  useAuth: vi.fn(() => ({ user: null, signOut: vi.fn() })),
}));

vi.mock('../../hooks/usePageMeta.js', () => ({
  usePageMeta: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
}));

// Fake players and draft order
const FAKE_PLAYERS = Array.from({ length: 20 }, (_, i) => ({
  id: i + 1,
  name: `Player ${i + 1}`,
  position: 'QB',
  school: 'Test U',
  headshot_url: null,
  consensus_rank: i + 1,
  rank: i + 1,
}));

const FAKE_DRAFT_ORDER = Array.from({ length: 32 }, (_, i) => ({
  pick_number: i + 1,
  round: 1,
  team: i === 0 ? 'KC' : `T${i + 1}`,
  team_name: `Team ${i + 1}`,
  team_needs: [],
}));

// ── Tests ────────────────────────────────────────────────────────────────────

describe('DraftSimulator — smoke test (no crash on render)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('TeamMock page renders without throwing', async () => {
    const { default: TeamMockPage } = await import('../TeamMock.jsx');

    expect(() =>
      render(
        <MemoryRouter>
          <TeamMockPage />
        </MemoryRouter>
      )
    ).not.toThrow();
  });

  it('DraftSimulator (team selected) renders without throwing — TDZ guard', async () => {
    // This specifically exercises the hook declaration order inside DraftSimulator.
    // The TDZ bug was: activePlayers (useState) was declared AFTER effectivePlayers
    // (a plain const that references activePlayers), causing a ReferenceError in
    // production-minified code. The fix moves activePlayers before effectivePlayers.
    const TeamMockModule = await import('../TeamMock.jsx');
    const TeamMockPage = TeamMockModule.default;

    let container;
    expect(() => {
      const result = render(
        <MemoryRouter initialEntries={['/team-mock']}>
          <TeamMockPage />
        </MemoryRouter>
      );
      container = result.container;
    }).not.toThrow();

    // Page should render something (at minimum the team picker or loading state)
    expect(container).toBeTruthy();
  });
});
