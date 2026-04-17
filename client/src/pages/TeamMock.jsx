import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
// Lazy-loaded on first export to keep the initial chunk small
const loadToPng = () => import('html-to-image').then((m) => m.toPng);
import { api, proxyImageUrl, fetchImageAsDataUrl } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { pickForTeam, normalizePos } from '../lib/botPicker.js';
import { loadAlgoConfig, getAlgoConfig } from '../lib/algoConfig.js';
import { computeTeamMockGrade, letterFromScore, gradeColor } from '../lib/draftGrader.js';
import { POSITIONS, posHex } from '../lib/positions.js';
import { TeamLogo } from '../components/ui/TeamLogo.jsx';
import { PlayerHeadshot } from '../components/ui/PlayerHeadshot.jsx';
import { PositionBadge } from '../components/ui/Badge.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { TradeModal } from '../components/TradeModal.jsx';
import { TradeOffersPanel } from '../components/TradeOffersPanel.jsx';
import { ConfirmModal } from '../components/ui/ConfirmModal.jsx';
import { usePageMeta } from '../hooks/usePageMeta.js';
import {
  buildFutureOwnership,
  swapFutureOwnership,
  formatPickLabel,
  isFuturePickId,
} from '../lib/futurePicks.js';
import {
  generateBotTradeOffers,
  generateBotToBotOffer,
  assessSellerReluctance,
} from '../lib/botTradeProposer.js';
import { acceptanceProbability, tradeHash } from '../lib/tradeAcceptance.js';

// ─── NFL Teams ────────────────────────────────────────────────────────────────
const NFL_TEAMS = [
  // AFC East
  { abbr: 'BUF', name: 'Bills' }, { abbr: 'MIA', name: 'Dolphins' },
  { abbr: 'NE', name: 'Patriots' }, { abbr: 'NYJ', name: 'Jets' },
  // AFC North
  { abbr: 'BAL', name: 'Ravens' }, { abbr: 'CIN', name: 'Bengals' },
  { abbr: 'CLE', name: 'Browns' }, { abbr: 'PIT', name: 'Steelers' },
  // AFC South
  { abbr: 'HOU', name: 'Texans' }, { abbr: 'IND', name: 'Colts' },
  { abbr: 'JAX', name: 'Jaguars' }, { abbr: 'TEN', name: 'Titans' },
  // AFC West
  { abbr: 'DEN', name: 'Broncos' }, { abbr: 'KC', name: 'Chiefs' },
  { abbr: 'LV', name: 'Raiders' }, { abbr: 'LAC', name: 'Chargers' },
  // NFC East
  { abbr: 'DAL', name: 'Cowboys' }, { abbr: 'NYG', name: 'Giants' },
  { abbr: 'PHI', name: 'Eagles' }, { abbr: 'WAS', name: 'Commanders' },
  // NFC North
  { abbr: 'CHI', name: 'Bears' }, { abbr: 'DET', name: 'Lions' },
  { abbr: 'GB', name: 'Packers' }, { abbr: 'MIN', name: 'Vikings' },
  // NFC South
  { abbr: 'ATL', name: 'Falcons' }, { abbr: 'CAR', name: 'Panthers' },
  { abbr: 'NO', name: 'Saints' }, { abbr: 'TB', name: 'Buccaneers' },
  // NFC West
  { abbr: 'ARI', name: 'Cardinals' }, { abbr: 'LAR', name: 'Rams' },
  { abbr: 'SF', name: '49ers' }, { abbr: 'SEA', name: 'Seahawks' },
];

const ROUND_LABELS = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th'];

// ─── Team Picker ──────────────────────────────────────────────────────────────
function TeamPicker({ onSelect, draftOrder, onRefresh }) {
  // Count how many rounds actually loaded — helps diagnose stale caches.
  const roundsLoaded = useMemo(() => {
    const s = new Set();
    for (const row of draftOrder || []) s.add(row.round);
    return [...s].sort((a, b) => a - b);
  }, [draftOrder]);
  const totalPicks = draftOrder?.length || 0;
  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="text-center mb-8">
        <h1 className="font-display text-3xl font-bold uppercase tracking-[0.12em] text-text-primary mb-2">
          Team Mock Draft
        </h1>
        <p className="text-text-secondary text-sm max-w-md mx-auto leading-relaxed">
          Pick your team. You'll draft all their picks across all 7 rounds.
          Bots fill every other team using BPA + team needs.
        </p>
        <div className="mt-3 flex items-center justify-center gap-2 text-[10px] font-mono text-text-muted">
          <span>
            {totalPicks} picks loaded · rounds [{roundsLoaded.join(', ') || '—'}]
          </span>
          <button
            onClick={onRefresh}
            className="font-display font-semibold uppercase tracking-[0.12em] text-[9.5px] text-accent hover:brightness-125 transition"
          >
            Refresh
          </button>
        </div>
      </div>
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
        {NFL_TEAMS.map((t) => (
          <button
            key={t.abbr}
            onClick={() => onSelect(t.abbr)}
            className="flex flex-col items-center gap-1.5 p-2 rounded-xl border border-border-subtle bg-bg-surface/40 hover:border-accent/60 hover:bg-accent/[0.05] hover:-translate-y-[2px] transition-all duration-150 group"
          >
            <TeamLogo abbr={t.abbr} size="lg" />
            <span className="font-display font-semibold text-[9.5px] uppercase tracking-[0.1em] text-text-muted group-hover:text-text-primary transition-colors">
              {t.abbr}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Saved View ───────────────────────────────────────────────────────────────
function SavedView({ savedMock, players, draftOrder = [], onRestart }) {
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const userTeam = savedMock.team_abbr;
  // Only show the user's own picks — the full 262-pick board is noise when
  // reviewing a saved team mock. The actual user_team picks are stored along
  // with bot picks in savedMock.picks; filter by team.
  const myPicks = useMemo(
    () =>
      savedMock.picks
        .filter((p) => p.team === userTeam)
        .sort((a, b) => a.pick_number - b.pick_number),
    [savedMock.picks, userTeam]
  );
  const myPicksByRound = useMemo(() => {
    const map = {};
    for (const p of myPicks) {
      if (!map[p.round]) map[p.round] = [];
      map[p.round].push(p);
    }
    return map;
  }, [myPicks]);
  const rounds = Object.keys(myPicksByRound).map(Number).sort((a, b) => a - b);

  // Compute grade for saved mock header
  const teamNeeds = useMemo(() => {
    const row = draftOrder.find((r) => r.team === userTeam && Array.isArray(r.team_needs) && r.team_needs.length);
    return row?.team_needs || [];
  }, [draftOrder, userTeam]);
  const savedGrade = useMemo(
    () => computeTeamMockGrade({
      myPicks, byId, teamNeeds,
      allPicks: savedMock.picks || [],
      userTeam,
    }),
    [myPicks, byId, teamNeeds, savedMock.picks, userTeam]
  );

  // ── Share export ──
  const {
    exportRef, exporting, handleShare, handleCopy, isMobile,
    theme, teamLogoDataUrl, headshotDataUrls,
  } = useShareExport({
    myPicks,
    byId,
    userTeam,
    mockTitle: savedMock.title || `${userTeam} Team Mock`,
    submittedAt: savedMock.submitted_at,
    trades: Array.isArray(savedMock.trades) ? savedMock.trades : [],
  });

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10 pb-32">
      {/* Hidden export card — kept in-viewport with opacity:0 so mobile
          browsers still decode images; html-to-image captures it on demand. */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          opacity: 0,
          zIndex: -1,
          pointerEvents: 'none',
        }}
        aria-hidden
      >
        <ExportCard
          ref={exportRef}
          savedMock={savedMock}
          myPicks={myPicks}
          byId={byId}
          userTeam={userTeam}
          theme={theme}
          teamLogoDataUrl={teamLogoDataUrl}
          headshotDataUrls={headshotDataUrls}
          trades={Array.isArray(savedMock.trades) ? savedMock.trades : []}
        />
      </div>

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-4 mb-8 sm:mb-10">
        <div className="flex items-center gap-4 sm:gap-5">
          <TeamLogo abbr={userTeam} size="xl" className="hidden sm:block" />
          <TeamLogo abbr={userTeam} size="lg" className="sm:hidden" />
          <div>
            <div className="font-display text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
              Team Mock · {userTeam}
            </div>
            <h2 className="font-display text-2xl sm:text-4xl font-bold uppercase tracking-[0.08em] text-text-primary leading-tight">
              {savedMock.title || `${userTeam} Team Mock`}
            </h2>
            <p className="text-text-secondary text-xs sm:text-sm mt-1">
              Saved · {new Date(savedMock.submitted_at).toLocaleString(undefined, {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
              })}
              <span className="mx-2 text-text-muted">·</span>
              {myPicks.length} pick{myPicks.length === 1 ? '' : 's'}
              {(() => {
                const n = (Array.isArray(savedMock.trades) ? savedMock.trades : [])
                  .filter((t) => t.initiator !== 'cpu').length;
                return n > 0 ? <span> · {n} trade{n === 1 ? '' : 's'}</span> : null;
              })()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {savedGrade.letter && (
            <div
              className="flex items-center gap-2.5 px-3 py-2 rounded-xl border"
              style={{
                borderColor: `${gradeColor(savedGrade.letter)}55`,
                background: `${gradeColor(savedGrade.letter)}0d`,
              }}
            >
              <div
                className="font-display font-bold leading-none"
                style={{
                  color: gradeColor(savedGrade.letter),
                  fontSize: savedGrade.letter.length > 1 ? 26 : 32,
                }}
              >
                {savedGrade.letter}
              </div>
              <div>
                <div className="font-display text-[9px] font-semibold uppercase tracking-[0.12em] text-text-muted">
                  Grade
                </div>
                <div className="font-mono text-[13px] font-bold text-text-primary leading-tight">
                  {savedGrade.total}
                </div>
              </div>
            </div>
          )}
          <button
            onClick={handleShare}
            disabled={exporting}
            title={isMobile ? 'Share via your phone\'s share sheet' : 'Copy image — paste into Discord with Ctrl+V'}
            className="font-display font-bold text-[11px] uppercase tracking-[0.12em] px-4 py-2 rounded-lg text-bg-deep transition hover:brightness-110 disabled:opacity-50"
            style={{ background: 'var(--gradient-accent)', boxShadow: '0 0 18px -6px rgba(0,229,255,0.55)' }}
          >
            {exporting ? 'Rendering…' : 'Share'}
          </button>
          {isMobile && (
            <button
              onClick={handleCopy}
              disabled={exporting}
              title="Copy image to clipboard"
              className="font-display font-semibold text-[11px] uppercase tracking-[0.12em] px-4 py-2 rounded-lg border border-border-subtle text-text-secondary hover:border-border-focus hover:text-text-primary transition disabled:opacity-50"
            >
              Copy
            </button>
          )}
          <button
            onClick={onRestart}
            className="font-display font-semibold text-[11px] uppercase tracking-[0.12em] px-4 py-2 rounded-lg border border-border-subtle text-text-secondary hover:border-border-focus hover:text-text-primary transition"
          >
            ← Back
          </button>
        </div>
      </div>

      {/* ── Picks by round ── */}
      <div className="space-y-8">
        {rounds.map((r) => (
          <div key={r}>
            <div className="flex items-center gap-3 mb-3">
              <div className="font-display text-[11px] sm:text-[12px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                {ROUND_LABELS[r] || `Round ${r}`} Round
              </div>
              <div className="flex-1 h-px bg-border-subtle" />
              <div className="font-mono text-[10px] text-text-muted">
                {myPicksByRound[r].length} pick{myPicksByRound[r].length === 1 ? '' : 's'}
              </div>
            </div>
            {/* Grid: 1 col mobile, 2 cols tablet, 3 cols desktop */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {myPicksByRound[r].map((pick) => {
                const player = byId.get(pick.player_id) || pick;
                const color = posHex(player.position);
                return (
                  <div
                    key={pick.pick_number}
                    className="relative flex items-center gap-4 p-4 rounded-xl border border-border-subtle bg-bg-surface/40 hover:border-accent/40 transition-colors overflow-hidden min-h-[88px]"
                    style={{ borderLeft: `4px solid ${color}` }}
                  >
                    {/* Pick number overlay */}
                    <div
                      className="absolute top-2 right-3 font-mono text-[10px] font-semibold"
                      style={{ color }}
                    >
                      #{pick.pick_number}
                    </div>
                    {/* Big player photo */}
                    <PlayerHeadshot
                      url={player.headshot_url}
                      name={player.name}
                      position={player.position}
                      size="lg"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-[15px] sm:text-[16px] font-bold truncate text-text-primary leading-tight">
                        {player.name}
                      </div>
                      {player.school && (
                        <div className="text-[11px] text-text-muted truncate mt-0.5">
                          {player.school}
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 mt-2">
                        <PositionBadge position={player.position} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* ── Trades made during the mock ── Only show trades the user
           participated in. CPU-to-CPU trades affect the board but don't
           clutter the wrap-up. */}
      {(() => {
        const userTradesList = (Array.isArray(savedMock.trades) ? savedMock.trades : [])
          .filter((t) => t.initiator !== 'cpu');
        if (userTradesList.length === 0) return null;
        return (
        <div className="mt-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="font-display text-[11px] sm:text-[12px] font-semibold uppercase tracking-[0.18em] text-text-muted">
              Trades Made
            </div>
            <div className="flex-1 h-px bg-border-subtle" />
            <div className="font-mono text-[10px] text-text-muted">
              {userTradesList.length} trade{userTradesList.length === 1 ? '' : 's'}
            </div>
          </div>
          <div className="space-y-3">
            {userTradesList.map((t, i) => {
              const isCpuTrade = t.teamA && t.teamA !== userTeam;
              const leftTeam = isCpuTrade ? t.teamA : userTeam;
              const rightTeam = isCpuTrade ? t.teamB : t.partnerTeam;
              return (
                <div
                  key={i}
                  className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl border border-border-subtle bg-bg-surface/40"
                >
                  <TeamLogo abbr={leftTeam} size="sm" />
                  <div className="text-[12px] text-text-muted font-mono">↔</div>
                  <TeamLogo abbr={rightTeam} size="sm" />
                  <div className="flex-1 min-w-0 text-[12px] sm:text-[13px]">
                    {isCpuTrade && (
                      <div className="text-[9px] font-display uppercase tracking-wider text-text-muted mb-0.5">
                        CPU Trade
                      </div>
                    )}
                    <div className="text-text-secondary">
                      <span className="text-text-muted text-[10px] font-display uppercase tracking-wide">{isCpuTrade ? `${leftTeam} sent` : 'Gave'}</span>{' '}
                      <span className="font-mono font-semibold text-text-primary">
                        {(t.gave || []).map(formatPickLabel).join(', ')}
                      </span>
                    </div>
                    <div className="text-text-secondary mt-1">
                      <span className="text-text-muted text-[10px] font-display uppercase tracking-wide">{isCpuTrade ? `${rightTeam} sent` : 'Got'}</span>{' '}
                      <span className="font-mono font-semibold text-accent">
                        {(t.got || []).map(formatPickLabel).join(', ')}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        );
      })()}
    </div>
  );
}

// ─── Shareable Export Card ────────────────────────────────────────────────────
// Self-contained card optimized for PNG capture via html-to-image. Uses inline
// styles (not Tailwind utilities) so the captured image doesn't depend on the
// full stylesheet being inlined. Fixed 900px width gives a clean aspect ratio
// for Twitter/Discord shares. Headshots are routed through the server proxy so
// html-to-image can read them into a canvas (ESPN CDN lacks CORS headers).

// Theme-aware color sets. The ExportCard mirrors whichever theme the user is
// currently using so the shared screenshot feels consistent with what they see.
const EXPORT_THEMES = {
  dark: {
    bg: '#04080f',
    bgGradientEnd: '#020408',
    surface: '#0b1120',
    subtle: '#1a2336',
    text: '#f0f4fc',
    muted: '#7a8ba8',
    accent: '#00e5ff',
    accentSoft: 'rgba(0,229,255,0.15)',
    footerTitle: '#f0f4fc',
  },
  light: {
    bg: '#f0f2f7',
    bgGradientEnd: '#e3e8f1',
    surface: '#ffffff',
    subtle: 'rgba(15,23,42,0.12)',
    text: '#0f172a',
    muted: '#64748b',
    accent: '#0891b2',
    accentSoft: 'rgba(8,145,178,0.12)',
    footerTitle: '#0f172a',
  },
};

function getCurrentTheme() {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

// Initials-in-circle fallback used whenever a headshot is missing or fails
// to load. Matches the fallback style elsewhere in the app.
function InitialCircle({ name, color, size = 56 }) {
  const initial = (name || '?').trim()[0]?.toUpperCase() || '?';
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: `${color}22`,
        boxShadow: `inset 0 0 0 2px ${color}66`,
        color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.42,
        fontWeight: 900,
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );
}

function teamLogoEspnUrl(abbr) {
  if (!abbr) return null;
  const key = abbr === 'WAS' ? 'wsh' : abbr.toLowerCase();
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${key}.png`;
}

// Primary brand colors for each NFL team. Used for the fallback team badge
// when the ESPN logo fetch fails or returns wrong content — every team gets
// a distinctive on-brand look instead of a generic accent-colored box.
const TEAM_BRAND = {
  BUF: '#00338D', MIA: '#008E97', NE: '#002244', NYJ: '#125740',
  BAL: '#241773', CIN: '#FB4F14', CLE: '#311D00', PIT: '#FFB612',
  HOU: '#03202F', IND: '#002C5F', JAX: '#006778', TEN: '#0C2340',
  DEN: '#FB4F14', KC: '#E31837', LV: '#000000', LAC: '#0080C6',
  DAL: '#003594', NYG: '#0B2265', PHI: '#004C54', WAS: '#5A1414',
  CHI: '#0B162A', DET: '#0076B6', GB: '#203731', MIN: '#4F2683',
  ATL: '#A71930', CAR: '#0085CA', NO: '#D3BC8D', TB: '#D50A0A',
  ARI: '#97233F', LAR: '#003594', SF: '#AA0000', SEA: '#002244',
};

const ExportCard = forwardRef(function ExportCard(
  { savedMock, myPicks, byId, userTeam, theme, teamLogoDataUrl, headshotDataUrls = {}, trades = [] },
  ref
) {
  const title = savedMock.title || `${userTeam} Team Mock`;
  const dateStr = new Date(savedMock.submitted_at).toLocaleDateString(undefined, {
    month: 'long', day: 'numeric', year: 'numeric',
  });

  const picksByRound = {};
  for (const p of myPicks) {
    if (!picksByRound[p.round]) picksByRound[p.round] = [];
    picksByRound[p.round].push(p);
  }
  const rounds = Object.keys(picksByRound).map(Number).sort((a, b) => a - b);

  const C = EXPORT_THEMES[theme] || EXPORT_THEMES.dark;

  return (
    <div
      ref={ref}
      style={{
        width: 900,
        padding: 48,
        background: `linear-gradient(180deg, ${C.bg} 0%, ${C.bgGradientEnd} 100%)`,
        color: C.text,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif',
        boxSizing: 'border-box',
      }}
    >
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 32 }}>
        {/* Real ESPN team logo, inlined as a base64 data URL so html-to-image
            captures the actual bytes already in the DOM — no network fetch
            during capture, no CORS headaches, no theme-timing weirdness.
            Falls back to a team-branded color badge if the pre-fetch hasn't
            completed yet or the upstream fetch failed entirely. */}
        {teamLogoDataUrl ? (
          <img
            src={teamLogoDataUrl}
            alt=""
            style={{
              width: 96,
              height: 96,
              objectFit: 'contain',
              flexShrink: 0,
            }}
          />
        ) : (
          <div
            style={{
              width: 96,
              height: 96,
              borderRadius: 18,
              background: TEAM_BRAND[userTeam] || C.accent,
              boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.18)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <div
              style={{
                fontSize: userTeam.length >= 4 ? 22 : 30,
                fontWeight: 900,
                letterSpacing: 1.5,
                color: '#ffffff',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif',
              }}
            >
              {userTeam}
            </div>
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 3,
              color: C.accent,
              marginBottom: 4,
            }}
          >
            Team Mock · {userTeam}
          </div>
          <div
            style={{
              fontSize: 40,
              fontWeight: 900,
              textTransform: 'uppercase',
              letterSpacing: 1.5,
              lineHeight: 1.05,
              color: C.text,
            }}
          >
            {title}
          </div>
          <div style={{ fontSize: 15, color: C.muted, marginTop: 6 }}>
            {myPicks.length} picks · {dateStr}
          </div>
        </div>
      </div>

      {/* Accent divider */}
      <div
        style={{
          height: 2,
          background: `linear-gradient(90deg, ${C.accent} 0%, transparent 100%)`,
          marginBottom: 28,
        }}
      />

      {/* ── Picks by round ── */}
      {rounds.map((r) => (
        <div key={r} style={{ marginBottom: 28 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 3,
              color: C.muted,
              marginBottom: 10,
            }}
          >
            {(ROUND_LABELS[r] || `Round ${r}`) + ' Round'}
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
            }}
          >
            {picksByRound[r].map((pick) => {
              const player = byId.get(pick.player_id) || pick;
              const color = posHex(player.position);
              // Prefer inlined data URL (pre-fetched in SavedView's useEffect)
              // so html-to-image captures a purely-local image. Falls back to
              // the initials circle if the pre-fetch hasn't completed or the
              // player has no headshot_url.
              const headshotDataUrl = headshotDataUrls[pick.player_id];
              return (
                <div
                  key={pick.pick_number}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    padding: 14,
                    borderRadius: 12,
                    background: C.surface,
                    border: `1px solid ${C.subtle}`,
                    borderLeft: `4px solid ${color}`,
                  }}
                >
                  {headshotDataUrl ? (
                    <img
                      src={headshotDataUrl}
                      alt=""
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: '50%',
                        objectFit: 'cover',
                        background: `${color}22`,
                        boxShadow: `inset 0 0 0 2px ${color}66`,
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <InitialCircle name={player.name} color={color} size={56} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 17,
                        fontWeight: 800,
                        color: C.text,
                        lineHeight: 1.2,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {player.name}
                    </div>
                    {player.school && (
                      <div
                        style={{
                          fontSize: 12,
                          color: C.muted,
                          marginTop: 2,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {player.school}
                      </div>
                    )}
                    <div
                      style={{
                        display: 'inline-block',
                        marginTop: 6,
                        padding: '3px 10px',
                        borderRadius: 999,
                        fontSize: 10,
                        fontWeight: 800,
                        letterSpacing: 1.2,
                        textTransform: 'uppercase',
                        background: `${color}22`,
                        color,
                        border: `1px solid ${color}55`,
                      }}
                    >
                      {player.position}
                    </div>
                  </div>
                  <div
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 13,
                      fontWeight: 700,
                      color,
                      flexShrink: 0,
                    }}
                  >
                    #{pick.pick_number}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* ── Trades Made ── Only user trades appear in the share export. */}
      {(() => {
        const userTradesExport = trades.filter((t) => t.initiator !== 'cpu');
        if (userTradesExport.length === 0) return null;
        return (
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: 3,
                color: C.muted,
              }}
            >
              Trades Made
            </div>
            <div style={{ flex: 1, height: 1, background: C.subtle }} />
            <div style={{ fontSize: 11, color: C.muted, fontFamily: 'monospace' }}>
              {userTradesExport.length} trade{userTradesExport.length === 1 ? '' : 's'}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {userTradesExport.map((t, i) => {
              const isCpuTrade = t.teamA && t.teamA !== userTeam;
              const leftTeam = isCpuTrade ? t.teamA : userTeam;
              const rightTeam = isCpuTrade ? t.teamB : t.partnerTeam;
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    padding: '14px 18px',
                    borderRadius: 12,
                    background: C.surface,
                    border: `1px solid ${C.subtle}`,
                  }}
                >
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 8,
                      background: TEAM_BRAND[leftTeam] || C.accent,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: (leftTeam || '').length >= 4 ? 10 : 12,
                      fontWeight: 900,
                      color: '#ffffff',
                      flexShrink: 0,
                      letterSpacing: 0.5,
                    }}
                  >
                    {leftTeam}
                  </div>
                  <div style={{ fontSize: 13, color: C.muted, fontFamily: 'monospace', flexShrink: 0 }}>↔</div>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 8,
                      background: TEAM_BRAND[rightTeam] || C.accent,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: (rightTeam || '').length >= 4 ? 10 : 12,
                      fontWeight: 900,
                      color: '#ffffff',
                      flexShrink: 0,
                      letterSpacing: 0.5,
                    }}
                  >
                    {rightTeam}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {isCpuTrade && (
                      <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: 700, color: C.muted, marginBottom: 2 }}>
                        CPU Trade
                      </div>
                    )}
                    <div style={{ fontSize: 13, color: C.muted }}>
                      <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: 700 }}>
                        {isCpuTrade ? `${leftTeam} sent` : 'Gave'}
                      </span>{' '}
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, color: C.text }}>
                        {(t.gave || []).map(formatPickLabel).join(', ')}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
                      <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: 700 }}>
                        {isCpuTrade ? `${rightTeam} sent` : 'Got'}
                      </span>{' '}
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, color: C.accent }}>
                        {(t.got || []).map(formatPickLabel).join(', ')}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        );
      })()}

      {/* ── Branding footer ── */}
      <div
        style={{
          marginTop: trades.filter((t) => t.initiator !== 'cpu').length > 0 ? 0 : 36,
          paddingTop: 20,
          borderTop: `1px solid ${C.subtle}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div
          style={{
            fontSize: 16,
            fontWeight: 900,
            letterSpacing: 2,
            textTransform: 'uppercase',
          }}
        >
          <span style={{ color: C.text }}>MOCKDRAFT</span>{' '}
          <span style={{ color: C.accent }}>SHOWDOWN</span>
        </div>
        <div style={{ fontSize: 12, color: C.muted }}>
          mockdraftshowdown.com
        </div>
      </div>
    </div>
  );
});

// ─── Share Export Hook ──────────────────────────────────────────────────────
// Encapsulates PNG export infrastructure shared by SavedView and ResultsView.
// Pre-fetches all images as base64 data URLs, renders the off-screen
// ExportCard to PNG via html-to-image, and provides platform-smart share
// (mobile native share sheet / desktop clipboard copy).
function useShareExport({ myPicks, byId, userTeam, mockTitle, submittedAt, trades }) {
  const exportRef = useRef(null);
  const [exporting, setExporting] = useState(false);
  const cachedBlobRef = useRef(null);

  // Mobile detection: touch-primary device with no hover. Desktops with
  // trackpads report hover:hover; phones/tablets report hover:none.
  const isMobile = useMemo(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    if (!navigator.share) return false;
    return window.matchMedia?.('(hover: none) and (pointer: coarse)').matches === true;
  }, []);

  // Theme mirror. The hidden card mounts with the current theme so the
  // captured PNG matches whatever the user is looking at.
  const [theme, setTheme] = useState(getCurrentTheme);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(getCurrentTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  const themeBg = theme === 'light' ? '#f0f2f7' : '#04080f';

  // Count how many headshots we expect to fetch so the share handlers can
  // wait for this count to be matched before generating the blob.
  const expectedHeadshotCount = useMemo(
    () => myPicks.filter((p) => byId.get(p.player_id)?.headshot_url).length,
    [myPicks, byId]
  );

  // Pre-fetch the team logo as a downsampled base64 PNG so the ExportCard's
  // <img> references inlined data that html-to-image captures without network
  // fetching — eliminates CORS, stale cache, and theme-timing issues. The
  // logo is displayed at 96 px so a 192 px source is plenty at 2× pixelRatio
  // and keeps the SVG foreignObject small enough for iOS Safari's rasterizer
  // (which silently drops oversized base64 payloads and leaves the logo
  // blank in the exported PNG).
  const [teamLogoDataUrl, setTeamLogoDataUrl] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetchImageAsDataUrl(proxyImageUrl(teamLogoEspnUrl(userTeam)), 192)
      .then((dataUrl) => { if (!cancelled && dataUrl) setTeamLogoDataUrl(dataUrl); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [userTeam]);

  // Pre-fetch all prospect headshots as downsampled base64 PNGs. Same
  // rationale as the team logo above — inlining the full-res ESPN headshot
  // bytes blows past iOS Safari's SVG rasterization budget during the
  // html-to-image capture and every headshot comes out blank. 128 px source
  // is visually indistinguishable from the 56 px × 2 display size.
  const [headshotDataUrls, setHeadshotDataUrls] = useState({});
  useEffect(() => {
    let cancelled = false;
    const toFetch = myPicks
      .map((p) => {
        const player = byId.get(p.player_id);
        return player?.headshot_url ? { id: p.player_id, url: player.headshot_url } : null;
      })
      .filter(Boolean);
    Promise.all(
      toFetch.map(({ id, url }) =>
        fetchImageAsDataUrl(proxyImageUrl(url), 128)
          .then((dataUrl) => [id, dataUrl])
          .catch(() => [id, null])
      )
    ).then((pairs) => {
      if (cancelled) return;
      const map = {};
      for (const [id, dataUrl] of pairs) if (dataUrl) map[id] = dataUrl;
      setHeadshotDataUrls(map);
    });
    return () => { cancelled = true; };
  }, [myPicks, byId]);

  // Refs mirror state so async handlers can poll for readiness without
  // capturing stale closure values.
  const logoReadyRef = useRef(!!teamLogoDataUrl);
  const headshotCountRef = useRef(Object.keys(headshotDataUrls).length);
  useEffect(() => { logoReadyRef.current = !!teamLogoDataUrl; }, [teamLogoDataUrl]);
  useEffect(() => { headshotCountRef.current = Object.keys(headshotDataUrls).length; }, [headshotDataUrls]);

  async function waitForImages(timeoutMs = 6000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (logoReadyRef.current && headshotCountRef.current >= expectedHeadshotCount) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  async function generateBlob() {
    if (!exportRef.current) return null;
    // Wait for all <img> inside the card to finish loading before capture.
    const imgs = exportRef.current.querySelectorAll('img');
    await Promise.all(
      Array.from(imgs).map((img) =>
        img.complete && img.naturalHeight > 0
          ? Promise.resolve()
          : new Promise((resolve) => {
              img.addEventListener('load', resolve, { once: true });
              img.addEventListener('error', resolve, { once: true });
            })
      )
    );
    const toPng = await loadToPng();
    // No cacheBust — images are already inlined as base64 data URLs, so
    // there's nothing to cache-bust. cacheBust appends query params to all
    // image URLs during DOM cloning, which can corrupt data: URLs on mobile
    // and cause images to silently fail to decode.
    const dataUrl = await toPng(exportRef.current, {
      pixelRatio: 2,
      backgroundColor: themeBg,
    });
    const res = await fetch(dataUrl);
    return res.blob();
  }

  // Pre-render the blob as soon as the card has data + the DOM is ready so
  // Share has something to hand off instantly. Re-render whenever the theme
  // or inlined image data URLs change.
  const headshotsLoadedCount = Object.keys(headshotDataUrls).length;
  useEffect(() => {
    let cancelled = false;
    cachedBlobRef.current = null;
    const t = setTimeout(() => {
      generateBlob()
        .then((blob) => { if (!cancelled) cachedBlobRef.current = blob; })
        .catch((e) => { console.warn('[pre-render]', e); });
    }, 100);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, teamLogoDataUrl, headshotsLoadedCount, trades.length]);

  const fileName = `${userTeam.toLowerCase()}-mock-${new Date(submittedAt).toISOString().slice(0, 10)}.png`;

  function handleCopy() {
    // CRITICAL: navigator.clipboard.write MUST be called synchronously from
    // within the user gesture. Pass a Promise<Blob> so the gesture stays
    // alive while html-to-image finishes rendering.
    if (!navigator.clipboard || !window.ClipboardItem) {
      toast.error('Clipboard unsupported — use Share instead');
      return;
    }
    setExporting(true);
    const blobPromise = (async () => {
      if (cachedBlobRef.current) return cachedBlobRef.current;
      await waitForImages();
      const blob = await generateBlob();
      if (!blob) throw new Error('render failed');
      cachedBlobRef.current = blob;
      return blob;
    })();
    navigator.clipboard
      .write([new ClipboardItem({ 'image/png': blobPromise })])
      .then(() => { toast.success('Copied — paste into Discord with Ctrl+V'); })
      .catch((e) => {
        console.error('[copy]', e);
        if (e.name === 'NotAllowedError' || e.message?.includes('focused')) {
          toast.error('Click the page first, then tap Copy');
        } else {
          toast.error('Copy failed — try Share instead');
        }
      })
      .finally(() => setExporting(false));
  }

  function triggerDownload(blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = fileName;
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Smart share: on mobile (touch, no hover) use the native share sheet; on
  // desktop use clipboard copy.
  function handleShare() {
    if (isMobile) handleMobileShare();
    else handleCopy();
  }

  async function handleMobileShare() {
    setExporting(true);
    try {
      let blob = cachedBlobRef.current;
      if (!blob) {
        await waitForImages();
        blob = await generateBlob();
        if (blob) cachedBlobRef.current = blob;
      }
      if (!blob) throw new Error('render failed');
      const file = new File([blob], fileName, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: mockTitle,
          });
          return;
        } catch (e) {
          if (e.name === 'AbortError') return;
          console.warn('[share] share failed, downloading instead:', e);
        }
      }
      triggerDownload(blob);
      toast.success('Downloaded — share it with the squad');
    } catch (e) {
      console.error('[share]', e);
      toast.error('Could not generate image');
    } finally {
      setExporting(false);
    }
  }

  return {
    exportRef,
    exporting,
    handleShare,
    handleCopy,
    isMobile,
    theme,
    teamLogoDataUrl,
    headshotDataUrls,
    fileName,
  };
}

// ─── Post-draft Results View ──────────────────────────────────────────────────
// Shown right after the draft finishes. Shows only the user's picks (not the
// full 262-pick board), any trades made during the mock, and save/share CTAs.
// Share produces the same PNG image as SavedView via ExportCard.
function ResultsView({
  team,
  picks,
  byId,
  userPicksMade,
  userSlotCount,
  saving,
  saved,
  trades = [],
  draftOrder = [],
  onSave,
  onRestart,
  onChangeTeam,
  onDone,
  isGuest,
}) {
  const [title, setTitle] = useState(
    `${team} · ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
  );

  const myPicksOnly = useMemo(() => picks.filter((p) => p.is_user), [picks]);

  // Pull team_needs for the user's team off the draft_order (any row for
  // this team carries the same team_needs array). Fallback to an empty list
  // so the grader can still compute a value-only score.
  const teamNeeds = useMemo(() => {
    const row = draftOrder.find((r) => r.team === team && Array.isArray(r.team_needs) && r.team_needs.length);
    return row?.team_needs || [];
  }, [draftOrder, team]);

  const draftGrade = useMemo(
    () => computeTeamMockGrade({ myPicks: myPicksOnly, byId, teamNeeds, allPicks: picks, userTeam: team }),
    [myPicksOnly, byId, teamNeeds, picks, team]
  );

  const myPicksByRound = useMemo(() => {
    const map = {};
    for (const p of myPicksOnly) {
      if (!map[p.round]) map[p.round] = [];
      map[p.round].push(p);
    }
    return map;
  }, [myPicksOnly]);
  const rounds = Object.keys(myPicksByRound).map(Number).sort((a, b) => a - b);

  // ── Share export ──
  const mockForExport = useMemo(() => ({
    title: title || `${team} Team Mock`,
    submitted_at: new Date().toISOString(),
    team_abbr: team,
  }), [title, team]);

  const {
    exportRef, exporting, handleShare, handleCopy, isMobile,
    theme, teamLogoDataUrl, headshotDataUrls,
  } = useShareExport({
    myPicks: myPicksOnly,
    byId,
    userTeam: team,
    mockTitle: title || `${team} Team Mock`,
    submittedAt: new Date().toISOString(),
    trades,
  });

  return (
    <div className="flex flex-col pb-24">
      {/* Hidden export card — kept in-viewport with opacity:0 so mobile
          browsers still decode images; html-to-image captures it on demand. */}
      <div
        style={{ position: 'fixed', top: 0, left: 0, opacity: 0, zIndex: -1, pointerEvents: 'none' }}
        aria-hidden
      >
        <ExportCard
          ref={exportRef}
          savedMock={mockForExport}
          myPicks={myPicksOnly}
          byId={byId}
          userTeam={team}
          theme={theme}
          teamLogoDataUrl={teamLogoDataUrl}
          headshotDataUrls={headshotDataUrls}
          trades={trades}
        />
      </div>

      <div className="max-w-3xl mx-auto w-full px-4 py-6">
        {/* ── Header ── */}
        <div className="flex items-center gap-3 mb-1">
          <TeamLogo abbr={team} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">
              Mock Complete
            </div>
            <h2 className="font-display text-xl sm:text-2xl font-bold uppercase tracking-[0.1em] text-text-primary">
              {team} Team Mock
            </h2>
            <p className="text-text-secondary text-[11px]">
              {userPicksMade} picks for {team}{(() => {
                const n = trades.filter((t) => t.initiator !== 'cpu').length;
                return n > 0 ? ` · ${n} trade${n === 1 ? '' : 's'}` : '';
              })()}
            </p>
          </div>
        </div>

        {/* ── Save / Share card ── */}
        {isGuest ? (
          <div className="mt-4 p-4 rounded-xl border border-accent/40 bg-accent/[0.05]">
            <div className="font-display text-[13px] font-bold uppercase tracking-[0.1em] text-text-primary mb-1">
              Nice draft, GM.
            </div>
            <p className="text-[12px] text-text-secondary leading-relaxed mb-3">
              Sign in to save this mock, track your draft grades over time, and build your collection.
            </p>
            <div className="flex flex-wrap gap-2 items-center">
              <button
                onClick={() => onSave(title.trim() || `${team} · ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`)}
                className="font-display font-bold text-[11px] uppercase tracking-[0.14em] text-bg-deep rounded-lg px-4 py-2.5 transition hover:brightness-110"
                style={{ background: 'var(--gradient-accent)', boxShadow: '0 0 18px -6px rgba(0,229,255,0.55)' }}
              >
                Sign in to Save
              </button>
              <button
                onClick={handleShare}
                disabled={exporting}
                className="font-display font-bold text-[11px] uppercase tracking-[0.12em] px-3 py-2.5 rounded-lg border border-accent/40 text-text-primary hover:bg-accent/[0.08] transition disabled:opacity-50"
              >
                {exporting ? '…' : 'Share'}
              </button>
              {isMobile && (
                <button
                  onClick={handleCopy}
                  disabled={exporting}
                  className="font-display font-bold text-[11px] uppercase tracking-[0.12em] px-3 py-2.5 rounded-lg border border-border-subtle text-text-secondary hover:border-border-focus hover:text-text-primary transition disabled:opacity-50"
                >
                  Copy
                </button>
              )}
            </div>
            <div className="flex gap-3 mt-3">
              <button
                onClick={onRestart}
                className="font-display text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted hover:text-text-primary transition"
              >
                ← Redraft
              </button>
              <button
                onClick={onChangeTeam}
                className="font-display text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted hover:text-text-primary transition"
              >
                New Team
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 p-3 rounded-xl border border-accent/40 bg-accent/[0.05]">
            <label className="font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted block mb-1">
              Mock Title
            </label>
            <div className="flex gap-2 items-center">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, 80))}
                placeholder="Name this mock…"
                className="flex-1 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-2 text-[13px] text-text-primary placeholder-text-muted focus:border-accent/60 outline-none transition"
              />
              <button
                onClick={handleShare}
                disabled={exporting}
                title={isMobile ? 'Share via share sheet' : 'Copy image — paste into Discord with Ctrl+V'}
                className="shrink-0 font-display font-bold text-[11px] uppercase tracking-[0.12em] px-3 py-2 rounded-lg border border-accent/40 text-text-primary hover:bg-accent/[0.08] transition disabled:opacity-50"
              >
                {exporting ? '…' : 'Share'}
              </button>
              {isMobile && (
                <button
                  onClick={handleCopy}
                  disabled={exporting}
                  title="Copy image to clipboard"
                  className="shrink-0 font-display font-bold text-[11px] uppercase tracking-[0.12em] px-3 py-2 rounded-lg border border-border-subtle text-text-secondary hover:border-border-focus hover:text-text-primary transition disabled:opacity-50"
                >
                  Copy
                </button>
              )}
              {saved ? (
                <button
                  onClick={onDone}
                  className="shrink-0 font-display font-bold text-[11px] uppercase tracking-[0.14em] text-bg-deep rounded-lg px-4 py-2 transition hover:brightness-110"
                  style={{ background: 'var(--gradient-accent)', boxShadow: '0 0 18px -6px rgba(0,229,255,0.55)' }}
                >
                  View My Mocks →
                </button>
              ) : (
                <button
                  onClick={() => onSave(title.trim() || `${team} · ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`)}
                  disabled={saving}
                  className="shrink-0 font-display font-bold text-[11px] uppercase tracking-[0.14em] text-bg-deep rounded-lg px-4 py-2 transition hover:brightness-110 disabled:opacity-50"
                  style={{ background: 'var(--gradient-accent)', boxShadow: '0 0 18px -6px rgba(0,229,255,0.55)' }}
                >
                  {saving ? 'Saving…' : 'Save Mock'}
                </button>
              )}
            </div>
            <div className="flex gap-3 mt-3">
              <button
                onClick={onRestart}
                className="font-display text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted hover:text-text-primary transition"
              >
                ← Redraft
              </button>
              <button
                onClick={onChangeTeam}
                className="font-display text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted hover:text-text-primary transition"
              >
                New Team
              </button>
            </div>
          </div>
        )}

        {/* ── Draft Grade ── */}
        {draftGrade.letter && (
          <div
            className="mt-4 p-4 rounded-xl border"
            style={{
              borderColor: `${gradeColor(draftGrade.letter)}55`,
              background: `${gradeColor(draftGrade.letter)}0d`,
            }}
          >
            <div className="flex items-center gap-5">
              <div
                className="shrink-0 flex items-center justify-center rounded-xl font-display font-bold"
                style={{
                  width: 78,
                  height: 78,
                  background: `${gradeColor(draftGrade.letter)}18`,
                  color: gradeColor(draftGrade.letter),
                  fontSize: draftGrade.letter.length > 1 ? 38 : 48,
                  lineHeight: 1,
                  textShadow: `0 0 24px ${gradeColor(draftGrade.letter)}66`,
                  border: `1px solid ${gradeColor(draftGrade.letter)}40`,
                }}
              >
                {draftGrade.letter}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                  Draft Grade
                </div>
                <div className="font-display font-bold uppercase tracking-wide text-text-primary text-[18px] mt-0.5">
                  {draftGrade.total} / 100
                </div>
              </div>
            </div>
            {/* Component breakdown */}
            <div className="mt-3 grid grid-cols-2 gap-3">
              {[
                { label: 'Pick Value', score: draftGrade.pickValue, weight: '55%' },
                { label: 'Roster Build', score: draftGrade.rosterBuild, weight: '45%' },
              ].map(({ label, score, weight }) => (
                <div key={label}>
                  <div className="font-display text-[9px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                    {label} <span className="opacity-50">({weight})</span>
                  </div>
                  <div className="font-mono font-bold tabular text-text-primary text-[14px]">{score}</div>
                  <div className="h-1.5 mt-1 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${score}%`, background: gradeColor(letterFromScore(score)) }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── User Picks by round ── */}
        <div className="mt-6 space-y-6">
          <div className="flex items-center gap-2">
            <TeamLogo abbr={team} size="xs" />
            <span className="font-display text-[11px] font-bold uppercase tracking-[0.14em] text-text-primary">
              Your {team} Picks
            </span>
            <span className="font-mono text-[10px] text-text-muted ml-auto">
              {userPicksMade} / {userSlotCount}
            </span>
          </div>
          {rounds.map((r) => (
            <div key={r}>
              <div className="flex items-center gap-3 mb-2">
                <div className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                  {ROUND_LABELS[r] || `Round ${r}`} Round
                </div>
                <div className="flex-1 h-px bg-border-subtle" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {myPicksByRound[r].map((pick) => {
                  const player = byId.get(pick.player_id);
                  if (!player) return null;
                  const color = posHex(player.position);
                  const pb = draftGrade.pickBreakdown?.find((b) => b.pick_number === pick.pick_number);
                  const pickLetterColor = pb ? gradeColor(pb.pick_grade) : '#94a3b8';
                  return (
                    <div
                      key={pick.pick_number}
                      className="flex items-center gap-2.5 p-2.5 rounded-lg border border-accent/30 bg-accent/[0.06]"
                      style={{ borderLeft: `3px solid ${color}` }}
                    >
                      <div className="shrink-0 w-12 text-right">
                        <div className="font-mono text-[10px] font-semibold text-text-muted">R{pick.round}</div>
                        <div className="font-mono text-[12px] font-bold text-text-primary">#{pick.pick_number}</div>
                      </div>
                      <PlayerHeadshot url={player.headshot_url} name={player.name} position={player.position} size="sm" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold truncate text-text-primary">
                          {player.name}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <PositionBadge position={player.position} />
                          <span className="text-[10px] text-text-muted truncate">{player.school}</span>
                          {pb && (
                            <span
                              className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0"
                              style={{ background: `${pickLetterColor}22`, color: pickLetterColor }}
                            >
                              {pb.value_tag}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* ── Trades made during the mock ── Only user trades appear
             in the live post-draft results card. */}
        {(() => {
          const userTradesLive = trades.filter((t) => t.initiator !== 'cpu');
          if (userTradesLive.length === 0) return null;
          return (
        <div className="mt-8">
            <div className="font-display text-[11px] font-bold uppercase tracking-[0.14em] text-text-primary mb-3">
              Trades Made
            </div>
            <div className="space-y-2">
              {userTradesLive.map((t, i) => {
                const isCpuTrade = t.teamA && t.teamA !== team;
                const leftTeam = isCpuTrade ? t.teamA : team;
                const rightTeam = isCpuTrade ? t.teamB : t.partnerTeam;
                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 p-3 rounded-lg border border-border-subtle bg-bg-surface/40"
                  >
                    <TeamLogo abbr={leftTeam} size="xs" />
                    <div className="text-[10px] text-text-muted font-mono">↔</div>
                    <TeamLogo abbr={rightTeam} size="xs" />
                    <div className="flex-1 min-w-0 text-[11px]">
                      {isCpuTrade && (
                        <div className="text-[9px] font-display uppercase tracking-wider text-text-muted mb-0.5">
                          CPU Trade
                        </div>
                      )}
                      <div className="text-text-secondary">
                        <span className="text-text-muted">{isCpuTrade ? `${leftTeam} sent:` : 'Gave:'}</span>{' '}
                        <span className="font-mono font-semibold text-text-primary">
                          {(t.gave || []).map(formatPickLabel).join(', ')}
                        </span>
                      </div>
                      <div className="text-text-secondary mt-0.5">
                        <span className="text-text-muted">{isCpuTrade ? `${rightTeam} sent:` : 'Got:'}</span>{' '}
                        <span className="font-mono font-semibold text-accent">
                          {(t.got || []).map(formatPickLabel).join(', ')}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          );
        })()}

        {/* ── Sticky bottom bar — terminal CTA ── */}
        <div className="sticky bottom-0 left-0 right-0 py-3 px-4 bg-bg-deep/90 backdrop-blur-sm border-t border-border-subtle mt-8">
          <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
            <div className="flex gap-3">
              <button
                onClick={onRestart}
                className="font-display text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted hover:text-text-primary transition"
              >
                Redraft
              </button>
              <button
                onClick={onChangeTeam}
                className="font-display text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted hover:text-text-primary transition"
              >
                New Team
              </button>
            </div>
            {saved ? (
              <button
                onClick={onDone}
                className="font-display font-bold text-[11px] uppercase tracking-[0.14em] text-bg-deep rounded-lg px-5 py-2 transition hover:brightness-110"
                style={{ background: 'var(--gradient-accent)', boxShadow: '0 0 18px -6px rgba(0,229,255,0.55)' }}
              >
                Done →
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={handleShare}
                  disabled={exporting}
                  className="font-display font-bold text-[11px] uppercase tracking-[0.12em] px-4 py-2 rounded-lg border border-accent/40 text-text-primary hover:bg-accent/[0.08] transition disabled:opacity-50"
                >
                  {exporting ? '…' : 'Share'}
                </button>
                {isMobile && (
                  <button
                    onClick={handleCopy}
                    disabled={exporting}
                    className="font-display font-bold text-[11px] uppercase tracking-[0.12em] px-4 py-2 rounded-lg border border-border-subtle text-text-secondary hover:border-border-focus hover:text-text-primary transition disabled:opacity-50"
                  >
                    Copy
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Draft Simulator (sequential on-the-clock) ───────────────────────────────
// Flow: user clicks Start. Bot picks forward pick-by-pick, pausing whenever the
// slot on the clock belongs to the user's team. User selects from the remaining
// pool, then the bot resumes until the next user slot. Repeats until all picks
// are in. No value leaks because the simulation doesn't run past the user's
// current slot — they see the true live pool at each of their picks.
const PHASE_READY = 'ready';
const PHASE_RUNNING = 'running';
const PHASE_PAUSED = 'paused';
const PHASE_ON_CLOCK = 'on_clock';
const PHASE_DONE = 'done';

// Speed slider tick → ms per bot pick. Index 0 = slowest, higher = faster (right = faster).
const SPEED_STEPS = [2500, 1500, 800, 400, 150, 0];
const SPEED_LABELS = ['Slowest', 'Slower', 'Slow', 'Normal', 'Fast', 'Instant'];

function DraftSimulator({ team, players, draftOrder, onSaved, onChangeTeam }) {
  const { user } = useAuth();
  const nav = useNavigate();

  // Live draft order — initialized from props but mutable so trades can swap
  // team ownership mid-draft without losing simulation state.
  const [liveOrder, setLiveOrder] = useState(() =>
    [...draftOrder].sort((a, b) => a.pick_number - b.pick_number)
  );
  useEffect(() => {
    // Reset whenever the source draftOrder changes (e.g. team change round-trip)
    setLiveOrder([...draftOrder].sort((a, b) => a.pick_number - b.pick_number));
  }, [draftOrder]);

  // ── 2027 future-pick ownership ──────────────────────────────────────────
  // Each team starts owning its own 7 future picks (R1–R7). Ownership lives
  // in a Map<id, pickRow> keyed by the synthetic pick id (e.g. "2027-LV-R1")
  // so trade swaps are O(1). Fetched lazily on mount; an empty Map until the
  // request resolves means future-pick UI is simply absent — never breaks
  // the trade flow.
  const [futureOwnership, setFutureOwnership] = useState(() => new Map());
  useEffect(() => {
    let cancelled = false;
    api.getFuturePicks(2027)
      .then((rows) => {
        if (!cancelled && Array.isArray(rows)) {
          setFutureOwnership(buildFutureOwnership(rows));
        }
      })
      .catch(() => {
        // Endpoint missing or network error — leave ownership empty so the
        // page still works. Future-pick UI is gated on size > 0.
      });
    return () => { cancelled = true; };
  }, []);

  // ── Custom big board (Phase 8) ───────────────────────────────────────────
  // Declared here — before effectivePlayers and byId — so activePlayers is
  // initialized before it is referenced (avoids temporal dead zone).
  const [userBoards, setUserBoards] = useState([]);
  const [selectedBoardId, setSelectedBoardId] = useState('');
  const [activePlayers, setActivePlayers] = useState(null);
  useEffect(() => {
    if (!user) return;
    api.listBoards()
      .then((list) => setUserBoards(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, [user]);

  // Eagerly fetch the selected board so the prospect sidebar reorders as
  // soon as the user picks a board — before they click Start.
  useEffect(() => {
    if (!selectedBoardId) { setActivePlayers(null); return; }
    let cancelled = false;
    api.getBoardById(selectedBoardId)
      .then((data) => {
        if (!cancelled && data?.players?.length) setActivePlayers(data.players);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedBoardId]);

  // Use the board-ordered player list when one is active; fall back to default.
  const effectivePlayers = activePlayers ?? players;
  const byId = useMemo(() => new Map(effectivePlayers.map((p) => [p.id, p])), [effectivePlayers]);
  const userSlotCount = useMemo(
    () => liveOrder.filter((s) => s.team === team).length,
    [liveOrder, team]
  );

  const [picks, setPicks] = useState([]); // sequential: [{pick_number, team, player_id, round, is_user}]
  const [phase, setPhase] = useState(PHASE_READY);
  const [randomness, setRandomness] = useState(0.25);
  const [speedIdx, setSpeedIdx] = useState(4); // default "Fast"
  const [showUsed, setShowUsed] = useState(false);
  const [tradeOpen, setTradeOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim().toLowerCase()), 150);
    return () => clearTimeout(t);
  }, [search]);
  const [posFilter, setPosFilter] = useState('ALL');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [trades, setTrades] = useState([]); // record trades for the results view
  // ── Incoming trade offers (Feature: bot-initiated trades) ──────────────
  // When the user enters PHASE_ON_CLOCK we generate a fresh batch of offers
  // from nearby bot teams. Offers persist until the user accepts one,
  // dismisses each individually, or the on-clock pick resolves. Dismissal
  // is sticky for the SAME on-clock pick — we record the dismissed ids so
  // a re-render doesn't resurrect them.
  const [incomingOffers, setIncomingOffers] = useState([]);
  const [dismissedOfferIds, setDismissedOfferIds] = useState(new Set());
  // Tracks the pick number we last generated offers for, so we only
  // recompute when the user advances to a NEW on-clock slot.
  const offersForPickRef = useRef(null);
  // ── User prefs for the offers feature, persisted across sessions ───────
  // `offersEnabled`   — flip to silence incoming offers entirely.
  // `botBotEnabled`   — flip to stop CPU-to-CPU trades during auto-run.
  // `offersCollapsed` — panel collapsed/expanded state; auto-expands on a
  //                     fresh on-clock slot so the user always sees the
  //                     first ring of a new call.
  const [offersEnabled, setOffersEnabled] = useState(
    () => (typeof localStorage !== 'undefined' ? localStorage.getItem('mds_incoming_offers_enabled') !== 'false' : true)
  );
  const [botBotEnabled, setBotBotEnabled] = useState(
    () => (typeof localStorage !== 'undefined' ? localStorage.getItem('mds_bot_bot_trades_enabled') !== 'false' : true)
  );
  const [offersCollapsed, setOffersCollapsed] = useState(
    () => (typeof localStorage !== 'undefined' ? localStorage.getItem('mds_offers_panel_collapsed') === 'true' : false)
  );
  useEffect(() => { try { localStorage.setItem('mds_incoming_offers_enabled', String(offersEnabled)); } catch {} }, [offersEnabled]);
  useEffect(() => { try { localStorage.setItem('mds_bot_bot_trades_enabled', String(botBotEnabled)); } catch {} }, [botBotEnabled]);
  useEffect(() => { try { localStorage.setItem('mds_offers_panel_collapsed', String(offersCollapsed)); } catch {} }, [offersCollapsed]);
  // Tracks pick_numbers where we've already rolled a bot-vs-bot trade check
  // so the engine effect doesn't re-roll on every render. Reset on restart.
  const botBotTriedRef = useRef(new Set());
  // Per-round hard cap on bot-vs-bot trades. Even with a high urgency floor
  // the auto-run can fire a flurry early in a round; this keeps the toast
  // stream legible and matches the realistic 2–3 trades per round cadence.
  // Shape: { round, count }. Reset on restart.
  const botBotRoundRef = useRef({ round: null, count: 0 });
  // Confirmation state for destructive actions. We gate Restart and Change
  // Team behind an explicit confirm as soon as the user has made any real
  // progress — losing a half-finished mock would be a terrible surprise.
  const [showRestart, setShowRestart] = useState(false);
  const [showChangeTeam, setShowChangeTeam] = useState(false);

  // ── Draft-session telemetry (Phase 5) ───────────────────────────────────
  // Fire-and-forget logging of every pick (user + bot) into draft_sessions /
  // draft_session_picks. All state lives in refs because telemetry must
  // never trigger re-renders or block the draft loop. All network calls
  // are wrapped in .catch → console.warn so failures are silent.
  //
  //   telemetry.uuid        client-minted UUID; stable across retries so a
  //                         network blip doesn't orphan the session
  //   telemetry.sessionId   server-assigned id once /draft-sessions POST
  //                         resolves; subsequent flushes target this id
  //   telemetry.sentCount   number of picks already POSTed — flush only
  //                         sends the slice picks.slice(sentCount)
  //   telemetry.flushTimer  debounce handle so a rapid burst of bot picks
  //                         batches into one POST instead of N
  const telemetry = useRef({
    uuid: null,
    sessionId: null,
    sentCount: 0,
    flushTimer: null,
    creating: null, // in-flight session-create promise (dedupe)
  });

  // Lock page scroll while the in-draft layout is active. On iOS/Chrome
  // mobile, overflow:hidden on body alone isn't enough — momentum scroll
  // bleeds through inner containers and snaps the page. Setting both html
  // and body to fixed+overflow:hidden is the only reliable cross-browser
  // scroll lock. We save/restore scrollY so the page doesn't jump when
  // returning to the team mock list.
  useEffect(() => {
    if (phase === PHASE_DONE) {
      // Release lock — ResultsView uses a fixed overlay with its own scroll
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      return;
    }
    const scrollY = window.scrollY;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      document.body.style.overflow = '';
      window.scrollTo(0, scrollY);
    };
  }, [phase]);

  // Mobile: tab-based layout replaces the old resizable panels
  const [mobileTab, setMobileTab] = useState('board'); // 'board' | 'picks' | 'prospects'
  const [settingsOpen, setSettingsOpen] = useState(false);

  const currentIdx = picks.length; // next slot to fill
  const currentSlot = currentIdx < liveOrder.length ? liveOrder[currentIdx] : null;
  const usedIds = useMemo(() => new Set(picks.map((p) => p.player_id)), [picks]);

  // Positions the on-clock team has already drafted in this mock — used to
  // strike through team_needs entries once addressed.
  const satisfiedNeeds = useMemo(() => {
    if (!currentSlot?.team) return new Set();
    const set = new Set();
    for (const p of picks) {
      if (p.team !== currentSlot.team) continue;
      const pos = byId.get(p.player_id)?.position;
      if (pos) set.add(pos);
    }
    return set;
  }, [picks, byId, currentSlot?.team]);

  const userPicksMade = picks.filter((p) => p.is_user).length;

  // Main engine: drive bot picks forward while phase is running. When the slot
  // on the clock belongs to the user's team, flip phase to ON_CLOCK and halt.
  useEffect(() => {
    if (phase !== PHASE_RUNNING) return;
    if (!currentSlot) { setPhase(PHASE_DONE); return; }
    if (currentSlot.team === team) { setPhase(PHASE_ON_CLOCK); return; }

    const delay = SPEED_STEPS[speedIdx] ?? 150;
    const timer = setTimeout(() => {
      // ── Bot-vs-bot trade attempt ────────────────────────────────────
      // No Math.random gate — the candidate search's BOT_BOT_URGENCY_FLOOR
      // already self-throttles to genuinely motivated trade-ups (need +
      // scarcity or a cliff). `botBotTriedRef` prevents re-rolling for the
      // same slot across re-renders, critically across the post-swap
      // render when the buyer becomes the new on-clock team. A per-round
      // cap enforces realistic volume: real drafts see 2–3 trade-ups per
      // round, not one on every pick.
      const MAX_BOT_BOT_TRADES_PER_ROUND = 3;
      const roundState = botBotRoundRef.current;
      if (roundState.round !== currentSlot.round) {
        roundState.round = currentSlot.round;
        roundState.count = 0;
      }
      if (
        botBotEnabled &&
        !botBotTriedRef.current.has(currentSlot.pick_number) &&
        roundState.count < MAX_BOT_BOT_TRADES_PER_ROUND
      ) {
        botBotTriedRef.current.add(currentSlot.pick_number);
        try {
          const result = generateBotToBotOffer({
            onClockTeam: currentSlot.team,
            liveOrder,
            picks,
            effectivePlayers,
            futureOwnership,
            randomness,
            byId,
            excludeTeams: [team],     // user team never transacts in auto-run
          });
          if (result && result.offer) {
            const offer = result.offer;
            // Seller-reluctance check — teams with a top-need star at a
            // premium slot should hold the pick regardless of value math.
            // generateBotToBotOffer already did a buyer-side urgency check;
            // this closes the missing seller-side half.
            const takenForReluctance = new Set(picks.map((pk) => pk.player_id));
            const availableForReluctance = effectivePlayers.filter(
              (pl) => !takenForReluctance.has(pl.id)
            );
            const reluctance = assessSellerReluctance({
              sellerSlot: currentSlot,
              available: availableForReluctance,
              picks,
              byId,
              effectivePlayers,
              randomness,
            });
            if (reluctance >= 0.8) {
              // Hard block — seller won't even entertain this trade.
              // Skip the acceptance roll entirely. Threshold matches the
              // user-facing offers gate so behavior is consistent across
              // bot-vs-bot and the panel.
              // eslint-disable-next-line no-console
              console.info(
                `[bot-vs-bot] BLOCKED #${currentSlot.pick_number} ${currentSlot.team}: reluctance ${reluctance.toFixed(2)} (${offer.buyerTeam} wanted ${offer.wantedPlayer?.name || 'pick'})`
              );
            } else {
            // Seller surplusPct is user-side-positive convention; from the
            // seller's perspective a positive surplus means they're getting
            // MORE than fair, so flip the sign for the acceptance curve.
            const sellerSurplus = -offer.summary.surplusPct / 100;
            const p = acceptanceProbability(sellerSurplus) * (1 - reluctance);
            const roll = tradeHash(offer.sellerTeam, offer.buyerTeam, offer.yourPicks, offer.theirPicks);
            if (roll < p) {
              roundState.count += 1;
              applyTradeLocal({
                teamA: offer.sellerTeam,
                teamB: offer.buyerTeam,
                yourPicks: offer.yourPicks,     // seller → buyer
                theirPicks: offer.theirPicks,   // buyer → seller
                initiator: 'cpu',
              });
              const forWho = offer.wantedPlayer?.name
                ? ` for ${offer.wantedPlayer.name}`
                : '';
              // No toast — at Fast speed they stacked up and clogged the
              // screen. The trade still shows via the Draft Board ⇄ glyph,
              // the Trades Made summary, and the console log below.
              // eslint-disable-next-line no-console
              console.info(
                `[bot-vs-bot] pick #${offer.sellerPick}: ${offer.sellerTeam} → ${offer.buyerTeam}${forWho} (urgency ${offer.summary.urgency}, reluctance ${reluctance.toFixed(2)})`
              );
              // Don't pick this tick — the swap will re-render and the new
              // owner picks on the next engine iteration.
              return;
            }
            } // end of !reluctant else branch
          }
        } catch (err) {
          console.warn('[bot-vs-bot] generate failed:', err?.message);
        }
      }

      // Compute the live pool right now, pick, then advance.
      // effectivePlayers reflects any custom board the user loaded before start.
      const taken = new Set(picks.map((p) => p.player_id));
      const available = effectivePlayers.filter((p) => !taken.has(p.id));
      const algoCfg = getAlgoConfig();
      const picked = pickForTeam({
        available,
        teamNeeds: currentSlot.team_needs || [],
        randomness,
        pickNumber: currentSlot.pick_number,
        draftContext: {
          allPlayers: effectivePlayers,
          teamDraftedPos: picks
            .filter((pk) => pk.team === currentSlot.team)
            .map((pk) => normalizePos(byId.get(pk.player_id)?.position || '')),
          recentPicks: picks
            .slice(-(algoCfg.runWindowSize || 8))
            .map((pk) => ({ position: normalizePos(byId.get(pk.player_id)?.position || '') })),
        },
      });
      if (!picked) { setPhase(PHASE_DONE); return; }
      setPicks((prev) => [
        ...prev,
        {
          pick_number: currentSlot.pick_number,
          team: currentSlot.team,
          player_id: picked.id,
          round: currentSlot.round,
          is_user: false,
        },
      ]);
    }, delay);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentSlot, picks, effectivePlayers, team, randomness, speedIdx, botBotEnabled, liveOrder, futureOwnership, byId]);

  // Auto-switch mobile to Prospects tab when it's the user's turn to pick
  useEffect(() => {
    if (phase === PHASE_ON_CLOCK) setMobileTab('prospects');
  }, [phase]);

  // ── Generate bot trade offers when the user enters PHASE_ON_CLOCK ─────
  // Real GMs field calls every time they're on the clock — same idea here.
  // We only recompute when a NEW user pick comes up so the offer set is
  // stable across unrelated re-renders (typing in the search box, etc.).
  // Dismissed offers stay dismissed for that same pick.
  useEffect(() => {
    if (phase !== PHASE_ON_CLOCK || !currentSlot) return;
    if (offersForPickRef.current === currentSlot.pick_number) return;

    offersForPickRef.current = currentSlot.pick_number;
    setDismissedOfferIds(new Set());
    // Auto-expand the panel for a fresh on-clock slot so the user sees
    // the first ring even if they previously collapsed it.
    setOffersCollapsed(false);
    // Toggled off by the user — short-circuit. We still bumped the ref
    // above so re-enabling mid-pick doesn't replay stale generation.
    if (!offersEnabled) {
      setIncomingOffers([]);
      return;
    }
    try {
      // Diagnostic — flip on with `window.__btDebug = true` in DevTools to
      // see why offers do or don't fire. Always log the result count so we
      // can confirm the effect is at least running.
      const offers = generateBotTradeOffers({
        userTeam: team,
        liveOrder,
        picks,
        effectivePlayers,
        futureOwnership,
        randomness,
        byId,
      });
      // eslint-disable-next-line no-console
      console.info(
        `[trade offers] pick #${currentSlot.pick_number} (${team}) → ${offers?.length || 0} offer(s)`
      );
      setIncomingOffers(offers || []);
    } catch (err) {
      // Never let offer generation crash the on-clock UI — fail soft so
      // the user can still draft normally.
      console.warn('[trade offers] generate failed:', err?.message, err);
      setIncomingOffers([]);
    }
  }, [phase, currentSlot, team, liveOrder, picks, effectivePlayers, futureOwnership, randomness, byId, offersEnabled]);

  // If the user flips the toggle mid-pick, clear or regenerate immediately
  // without waiting for the next on-clock slot.
  useEffect(() => {
    if (!offersEnabled) {
      setIncomingOffers([]);
      return;
    }
    if (phase !== PHASE_ON_CLOCK || !currentSlot) return;
    if (incomingOffers.length > 0) return;
    try {
      const offers = generateBotTradeOffers({
        userTeam: team,
        liveOrder,
        picks,
        effectivePlayers,
        futureOwnership,
        randomness,
        byId,
      });
      setIncomingOffers(offers || []);
    } catch {
      setIncomingOffers([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offersEnabled]);

  // Clear offers when leaving the on-clock state (pick made, restart, etc.).
  useEffect(() => {
    if (phase !== PHASE_ON_CLOCK) {
      setIncomingOffers([]);
      offersForPickRef.current = null;
    }
  }, [phase]);

  function handleAcceptOffer(offer) {
    // The TradeOffersPanel emits the canonical { yourPicks, theirPicks }
    // shape so we can route it straight into applyTradeLocal — same path
    // used by the manual TradeModal. partnerTeam = bot.
    applyTradeLocal({
      partnerTeam: offer.botTeam,
      yourPicks: offer.yourPicks,
      theirPicks: offer.theirPicks,
    });
    setIncomingOffers([]);
    offersForPickRef.current = null;
    // Pin the just-traded slot so the new owner (bot) doesn't immediately
    // try to flip it again via the bot-vs-bot path — realistic teams hold
    // the pick they just acquired.
    if (currentSlot?.pick_number != null) {
      botBotTriedRef.current.add(currentSlot.pick_number);
    }
    toast.success(`Trade accepted with ${offer.botTeam}`);
    // Resume auto-run — the on-clock slot now belongs to the partner bot,
    // and without this the draft would stall on PHASE_ON_CLOCK waiting for
    // the user to pick a player for someone else's team.
    setPhase(PHASE_RUNNING);
  }

  function handleDismissOffer(offerId) {
    setDismissedOfferIds((prev) => {
      const next = new Set(prev);
      next.add(offerId);
      return next;
    });
  }

  function handleDismissAllOffers() {
    setDismissedOfferIds(new Set(incomingOffers.map((o) => o.id)));
  }

  // Counter/rebuttal — open the standard TradeModal pre-filled with the
  // offer's picks so the user can tweak the terms and propose back. The
  // original offer is intentionally NOT dismissed: if the user closes the
  // modal without proposing, the card is still there to accept/reject.
  // A successful counter clears offers via the phase change below; a
  // rejected counter just closes the modal with offers intact.
  const [counterSeed, setCounterSeed] = useState(null);
  function handleCounterOffer(offer) {
    setCounterSeed({
      partnerTeam: offer.botTeam,
      yourPicks: offer.yourPicks,
      theirPicks: offer.theirPicks,
    });
    setTradeOpen(true);
  }

  // The visible-offer set is whatever we generated minus what the user
  // explicitly dismissed for this on-clock pick.
  const visibleOffers = useMemo(
    () => incomingOffers.filter((o) => !dismissedOfferIds.has(o.id)),
    [incomingOffers, dismissedOfferIds]
  );

  // ── Confetti celebration when the draft finishes ────────────────────────
  useEffect(() => {
    if (phase !== PHASE_DONE) return;
    import('canvas-confetti').then(({ default: confetti }) => {
      confetti({
        particleCount: 120, spread: 80, startVelocity: 50,
        origin: { y: 0.7 },
        colors: ['#00e5ff', '#fbbf24', '#3b82f6', '#f97316'],
      });
      setTimeout(() => {
        confetti({ particleCount: 60, angle: 60, spread: 55, origin: { x: 0, y: 0.65 }, colors: ['#00e5ff', '#fbbf24', '#3b82f6', '#f97316'] });
        confetti({ particleCount: 60, angle: 120, spread: 55, origin: { x: 1, y: 0.65 }, colors: ['#00e5ff', '#fbbf24', '#3b82f6', '#f97316'] });
      }, 300);
    });
  }, [phase]);

  // Brief interstitial before showing full results
  useEffect(() => {
    if (phase !== PHASE_DONE) { setShowResults(false); return; }
    const timer = setTimeout(() => setShowResults(true), 1800);
    return () => clearTimeout(timer);
  }, [phase]);

  // ── Telemetry: lazily create a session and flush picks in batches ────────
  // Runs whenever picks.length changes. First call lazy-creates the session
  // (uuid minted client-side, server returns id), then flushes everything
  // between sentCount and picks.length. Subsequent picks during a debounce
  // window are coalesced into a single POST.
  useEffect(() => {
    if (picks.length === 0) return;
    const t = telemetry.current;

    // Lazy session create — happens once per draft run. The uuid persists
    // across retries so the ON CONFLICT DO UPDATE path on the server keeps
    // us idempotent if the first POST partially fails.
    async function ensureSession() {
      if (t.sessionId) return t.sessionId;
      if (t.creating) return t.creating;

      if (!t.uuid) {
        // crypto.randomUUID is supported in every modern browser; fall back
        // to a timestamp+random string if unavailable (ancient iOS Safari).
        t.uuid =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `fallback-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      }

      t.creating = api
        .createDraftSession({
          session_uuid: t.uuid,
          user_id: user?.id || null,
          mock_type: 'team',
          user_team: team,
          randomness,
          algo_config_snapshot: getAlgoConfig(),
          draft_year: 2026,
        })
        .then((r) => {
          t.sessionId = r?.session_id ?? null;
          return t.sessionId;
        })
        .catch((e) => {
          console.warn('[telemetry] createDraftSession failed:', e.message);
          return null;
        })
        .finally(() => {
          t.creating = null;
        });
      return t.creating;
    }

    // Debounced flush: batch rapid picks into one POST. 600ms matches the
    // upper end of the current SPEED_STEPS so a "Fast" auto-run coalesces
    // several bot picks of advancement into one flush cycle.
    //
    // Only USER picks are actually sent to the server. Bot picks are
    // deterministic output of the algorithm we control, so they're noise
    // for consensus/ADP analysis — the signal is what humans chose. The
    // session row itself is still created on the first pick so we capture
    // "this draft was attempted" + the algo_config snapshot regardless.
    if (t.flushTimer) clearTimeout(t.flushTimer);
    t.flushTimer = setTimeout(async () => {
      t.flushTimer = null;
      const sessionId = await ensureSession();
      if (!sessionId) return; // session create failed — drop this flush

      const startIdx = t.sentCount;
      const slice = picks.slice(startIdx);
      if (slice.length === 0) return;

      const batch = slice.filter((p) => p.is_user);

      // Optimistically advance sentCount so a concurrent effect run doesn't
      // re-send the same picks. Advance past the whole slice (including bot
      // picks we intentionally dropped) — those are processed, not pending.
      t.sentCount = picks.length;

      if (batch.length === 0) return; // nothing to send this cycle

      try {
        await api.logDraftSessionPicks(sessionId, batch);
      } catch (e) {
        console.warn('[telemetry] logDraftSessionPicks failed:', e.message);
        t.sentCount = startIdx; // retry on next flush
      }
    }, 600);
  }, [picks, team, randomness, user]);

  // When the draft completes, flush any trailing user picks immediately
  // and mark the session complete so we can distinguish "finished" from
  // "abandoned" in later analysis.
  useEffect(() => {
    if (phase !== PHASE_DONE) return;
    const t = telemetry.current;
    (async () => {
      if (t.flushTimer) { clearTimeout(t.flushTimer); t.flushTimer = null; }
      const sessionId = t.sessionId || (t.creating ? await t.creating : null);
      if (!sessionId) return;
      const trailing = picks.slice(t.sentCount).filter((p) => p.is_user);
      if (trailing.length > 0) {
        try {
          await api.logDraftSessionPicks(sessionId, trailing);
          t.sentCount = picks.length;
        } catch (e) {
          console.warn('[telemetry] final flush failed:', e.message);
        }
      } else {
        // Nothing user-side left to send, but still mark all picks processed.
        t.sentCount = picks.length;
      }
      try {
        await api.completeDraftSession(sessionId);
      } catch (e) {
        console.warn('[telemetry] completeDraftSession failed:', e.message);
      }
    })();
  }, [phase, picks]);

  // ── Actions ────────────────────────────────────────────────────────────────
  function start() {
    // activePlayers is already set by the selectedBoardId useEffect above;
    // simply kick the draft engine into motion.
    setPhase(PHASE_RUNNING);
  }
  function pause() { if (phase === PHASE_RUNNING) setPhase(PHASE_PAUSED); }
  function resume() { if (phase === PHASE_PAUSED) setPhase(PHASE_RUNNING); }

  function handleUserPick(player) {
    if (phase !== PHASE_ON_CLOCK || !currentSlot) return;
    if (usedIds.has(player.id)) { toast.error('Player already drafted'); return; }
    setPicks((prev) => [
      ...prev,
      {
        pick_number: currentSlot.pick_number,
        team: currentSlot.team,
        player_id: player.id,
        round: currentSlot.round,
        is_user: true,
      },
    ]);
    setPhase(PHASE_RUNNING);
  }

  function restart() {
    // Clear telemetry state so the next run mints a fresh session uuid
    // and starts its own row in draft_sessions — otherwise "restart" would
    // silently append picks to the previous (already-completed) session.
    const t = telemetry.current;
    if (t.flushTimer) { clearTimeout(t.flushTimer); t.flushTimer = null; }
    t.uuid = null;
    t.sessionId = null;
    t.sentCount = 0;
    t.creating = null;

    setPicks([]);
    setTrades([]);
    setSaved(false);
    setActivePlayers(null);
    setSelectedBoardId('');
    setPhase(PHASE_READY);
    setLiveOrder([...draftOrder].sort((a, b) => a.pick_number - b.pick_number));
    botBotTriedRef.current = new Set();
    botBotRoundRef.current = { round: null, count: 0 };
  }

  // Wrap restart with a confirm dialog whenever the user has actually made
  // progress. A bare Restart during PHASE_READY (no picks yet) just fires
  // immediately — no point confirming an empty board.
  function requestRestart() {
    if (picks.length === 0) { restart(); return; }
    setShowRestart(true);
  }

  // Change-team bailout — same idea. If they haven't made any picks yet we
  // let them bounce back to the picker without a prompt.
  function requestChangeTeam() {
    if (picks.length === 0) { onChangeTeam(); return; }
    setShowChangeTeam(true);
  }

  // Apply a trade: swap team ownership on the affected pick ids.
  //
  // Pick ids are a union: numeric pick_numbers (current-year picks living in
  // liveOrder) or string ids (future-year picks living in futureOwnership).
  // We split the lists by type so each storage layer only sees its own ids.
  // Only upcoming current-year picks can change hands — past picks are
  // locked. Future-year picks are always "upcoming" by definition.
  //
  // `teamA` / `teamB` override the default (user ↔ partnerTeam) swap so
  // CPU-to-CPU trades can reuse this same code path. `yourPicks` always
  // refers to picks leaving teamA and going to teamB (and vice versa).
  function applyTradeLocal({
    partnerTeam,
    yourPicks,
    theirPicks,
    teamA,
    teamB,
    initiator,       // 'user' | 'cpu' — recorded on the trade entry only
  }) {
    const sideA = teamA ?? team;
    const sideB = teamB ?? partnerTeam;
    const yourCurrent = (yourPicks || []).filter((p) => typeof p === 'number');
    const theirCurrent = (theirPicks || []).filter((p) => typeof p === 'number');
    const yourFuture = (yourPicks || []).filter(isFuturePickId);
    const theirFuture = (theirPicks || []).filter(isFuturePickId);

    const yourSet = new Set(yourCurrent);
    const theirSet = new Set(theirCurrent);
    setLiveOrder((prev) => {
      // Build a team → team_needs lookup so swapped picks carry the new owner's
      // needs rather than staying tied to the original team.
      const needsByTeam = new Map();
      for (const row of prev) {
        if (!needsByTeam.has(row.team) && Array.isArray(row.team_needs) && row.team_needs.length) {
          needsByTeam.set(row.team, row.team_needs);
        }
      }
      return prev.map((row) => {
        // Don't touch picks already made
        if (row.pick_number <= picks.length) return row;
        if (yourSet.has(row.pick_number)) {
          return { ...row, team: sideB, team_needs: needsByTeam.get(sideB) ?? row.team_needs };
        }
        if (theirSet.has(row.pick_number)) {
          return { ...row, team: sideA, team_needs: needsByTeam.get(sideA) ?? row.team_needs };
        }
        return row;
      });
    });

    // Future-year ownership swap. Two-pass via swapFutureOwnership so each
    // call sees a consistent snapshot — never tries to read mid-mutation.
    if (yourFuture.length > 0 || theirFuture.length > 0) {
      setFutureOwnership((prev) => {
        let next = swapFutureOwnership(prev, yourFuture, sideB);
        next = swapFutureOwnership(next, theirFuture, sideA);
        return next;
      });
    }

    // Record trade for the results view. Sort current-year picks numerically
    // and future picks lexicographically so the display order is stable.
    const sortMixed = (arr) => {
      const nums = arr.filter((p) => typeof p === 'number').sort((a, b) => a - b);
      const strs = arr.filter((p) => typeof p === 'string').sort();
      return [...nums, ...strs];
    };
    setTrades((prev) => [
      ...prev,
      {
        partnerTeam: sideB,              // legacy field — downstream uses this for "You ↔ X"
        teamA: sideA,
        teamB: sideB,
        gave: sortMixed(yourPicks),
        got: sortMixed(theirPicks),
        initiator: initiator || (sideA === team ? 'user' : 'cpu'),
      },
    ]);
  }

  async function handleSave(customTitle) {
    if (phase !== PHASE_DONE) return;
    const defaultTitle = `${team} · ${new Date().toLocaleDateString(undefined, {
      month: 'short', day: 'numeric',
    })}`;
    const title = (typeof customTitle === 'string' && customTitle.trim()) || defaultTitle;

    // Guest: stash the completed mock in localStorage so it can be auto-saved
    // after sign-in, then send the user to the join page.
    if (!user) {
      const payload = picks.map((p) => ({
        pick_number: p.pick_number,
        player_id: p.player_id,
        round: p.round,
        team: p.team,
      }));
      try {
        localStorage.setItem('mds_pending_team_mock', JSON.stringify({ team, title, picks: payload, trades }));
      } catch {}
      nav('/join');
      return;
    }

    setSaving(true);
    try {
      const payload = picks.map((p) => ({
        pick_number: p.pick_number,
        player_id: p.player_id,
        round: p.round,
        team: p.team,
      }));
      await api.submitTeamMock(user.id, team, payload, title, trades);
      toast.success('Team mock saved!');
      setSaved(true);
    } catch (e) {
      toast.error(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  // ── Derived data ───────────────────────────────────────────────────────────
  // Prospect list: by default hide already-drafted players; toggle to show.
  const pickOrder = useMemo(() => {
    // Map player_id → the pick row that took them, so we can show "who took who"
    const m = new Map();
    for (const p of picks) m.set(p.player_id, p);
    return m;
  }, [picks]);

  const filteredProspects = useMemo(() => {
    let list = effectivePlayers;
    if (!showUsed) list = list.filter((p) => !usedIds.has(p.id));
    if (posFilter !== 'ALL') list = list.filter((p) => p.position === posFilter);
    if (debouncedSearch) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(debouncedSearch) ||
          p.school?.toLowerCase().includes(debouncedSearch)
      );
    }
    return list;
  }, [effectivePlayers, showUsed, usedIds, posFilter, debouncedSearch]);

  // Draft history — most recent first so users see the latest pick at top
  const recentPicks = useMemo(() => [...picks].reverse(), [picks]);
  // Pick numbers that changed hands in any trade (user or CPU). Used by
  // the draft board to badge traded picks so the user can tell at a
  // glance which rows were swapped.
  const tradedPickNumbers = useMemo(() => {
    const s = new Set();
    for (const t of trades) {
      for (const id of t.gave || []) if (typeof id === 'number') s.add(id);
      for (const id of t.got || []) if (typeof id === 'number') s.add(id);
    }
    return s;
  }, [trades]);
  // Only the user's picks, in draft order (not reversed — small list, easier to
  // read chronologically so users can see their roster build out top to bottom)
  const myPicks = useMemo(() => picks.filter((p) => p.is_user), [picks]);

  const FILTERS = ['ALL', ...POSITIONS];

  // ── Status banner (on the clock) ───────────────────────────────────────────
  function StatusBanner({ compact = false }) {
    // Remaining user pick slots — filters out each pick as it's made
    const madeUserPickNumbers = new Set(picks.filter((p) => p.is_user).map((p) => p.pick_number));
    const remainingUserSlots = liveOrder.filter(
      (s) => s.team === team && !madeUserPickNumbers.has(s.pick_number)
    );

    const pickPillStyle = {
      backgroundColor: 'rgba(0,229,255,0.10)',
      color: 'var(--accent)',
      boxShadow: 'inset 0 0 0 1px rgba(0,229,255,0.22)',
    };

    if (phase === PHASE_READY) {
      return (
        <div className={`${compact ? 'px-3 py-2' : 'px-4 py-3'} flex items-center gap-3 flex-wrap`}>
          <TeamLogo abbr={team} size={compact ? 'sm' : 'md'} />
          <div className="flex-1 min-w-0">
            <div className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
              Drafting for
            </div>
            <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
              <span className={`font-display font-bold ${compact ? 'text-[13px]' : 'text-[16px]'} text-text-primary shrink-0`}>
                {team} · {userSlotCount} picks
              </span>
              {remainingUserSlots.map((slot) => (
                <span
                  key={slot.pick_number}
                  className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold rounded font-mono shrink-0"
                  style={pickPillStyle}
                >
                  {slot.pick_number}
                </span>
              ))}
            </div>
          </div>
          {userBoards.length > 0 && (
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="font-display text-[10px] uppercase tracking-[0.12em] text-text-muted">Board:</span>
              <select
                value={selectedBoardId}
                onChange={(e) => setSelectedBoardId(e.target.value)}
                className="bg-bg-deep/80 border border-border-subtle rounded-md px-2 py-1 text-text-primary text-[11px] font-display uppercase tracking-wide focus:border-accent outline-none"
              >
                <option value="">Default</option>
                {userBoards.map((b) => (
                  <option key={b.id} value={b.id}>{b.title}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      );
    }
    if (phase === PHASE_DONE) {
      return (
        <div className={`${compact ? 'px-3 py-2' : 'px-4 py-3'} flex items-center gap-3`}>
          <TeamLogo abbr={team} size={compact ? 'sm' : 'md'} />
          <div className="flex-1 min-w-0">
            <div className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
              Mock complete
            </div>
            <div className="text-[11px] text-text-muted">
              {userPicksMade} picks for {team} · {picks.length} total
            </div>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="shrink-0 font-display font-bold uppercase tracking-[0.14em] text-[11px] text-bg-deep rounded-lg px-4 py-2 transition hover:brightness-110 disabled:opacity-50"
            style={{ background: 'var(--gradient-accent)' }}
          >
            {!user ? 'Sign in to Save' : saving ? 'Saving…' : 'Save Mock'}
          </button>
        </div>
      );
    }
    // RUNNING or ON_CLOCK
    const isYou = phase === PHASE_ON_CLOCK;
    const slot = currentSlot;
    const slotNeeds = Array.isArray(slot?.team_needs) ? slot.team_needs : [];
    return (
      <div
        className={`${compact ? 'px-3 py-2' : 'px-4 py-3'} flex items-center gap-3 border-l-[3px] transition-colors`}
        style={{
          borderLeftColor: isYou ? 'var(--accent)' : 'transparent',
          background: isYou ? 'rgba(0,229,255,0.06)' : undefined,
        }}
      >
        <TeamLogo abbr={slot?.team} size={compact ? 'sm' : 'md'} />
        <div className="flex-1 min-w-0">
          <div className={`font-display text-[10px] font-semibold uppercase tracking-[0.14em] ${isYou ? 'text-accent' : 'text-text-muted'}`}>
            {isYou ? 'You are on the clock' : 'On the clock'}
          </div>
          <div className={`font-display font-bold ${compact ? 'text-[12.5px]' : 'text-[15px]'} text-text-primary truncate`}>
            {slot?.team} · Pick #{slot?.pick_number}
            <span className="ml-2 text-text-muted font-mono text-[11px]">
              {ROUND_LABELS[slot?.round] || `R${slot?.round}`}
            </span>
          </div>
          {slotNeeds.length > 0 && (
            <div className="flex items-center gap-1 mt-1 flex-wrap">
              {slotNeeds.slice(0, 5).map((need) => {
                const done = satisfiedNeeds.has(need);
                return (
                  <span
                    key={need}
                    title={done ? `${need} need addressed` : undefined}
                    className={done ? 'line-through opacity-50' : ''}
                  >
                    <PositionBadge position={need} muted={done} />
                  </span>
                );
              })}
            </div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[10px] font-mono text-text-muted">
            {picks.length}/{liveOrder.length}
          </div>
          <div className="flex items-center justify-end gap-1 flex-wrap mt-0.5">
            {remainingUserSlots.map((slot) => (
              <span
                key={slot.pick_number}
                className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold rounded font-mono"
                style={pickPillStyle}
              >
                {slot.pick_number}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Prospect list item ─────────────────────────────────────────────────────
  function renderProspect(p) {
    const taken = usedIds.has(p.id);
    const takenBy = taken ? pickOrder.get(p.id) : null;
    const locked = taken || phase !== PHASE_ON_CLOCK;
    return (
      <li
        key={p.id}
        onClick={() => !locked && handleUserPick(p)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all duration-150 ${
          taken
            ? 'border-transparent bg-bg-surface/20 opacity-50 cursor-not-allowed'
            : phase === PHASE_ON_CLOCK
            ? 'border-border-subtle bg-bg-surface/40 hover:border-accent hover:bg-accent/[0.05] cursor-pointer'
            : 'border-border-subtle bg-bg-surface/30 cursor-default'
        }`}
      >
        <span className="font-mono text-[10px] text-text-muted w-5 shrink-0 text-right">
          {p.rank ?? ''}
        </span>
        <PlayerHeadshot url={p.headshot_url} name={p.name} position={p.position} size="xs" />
        <div className="flex-1 min-w-0">
          <div className={`text-[13px] font-semibold truncate ${taken ? 'line-through text-text-muted' : 'text-text-primary'}`}>
            {p.name}
          </div>
          <div className="text-[10.5px] text-text-muted truncate">
            {taken && takenBy
              ? `${takenBy.team} · #${takenBy.pick_number}`
              : p.school}
          </div>
        </div>
        <PositionBadge position={p.position} muted={taken} />
      </li>
    );
  }

  // ── Draft history row ──────────────────────────────────────────────────────
  function renderHistoryPick(pick) {
    const player = byId.get(pick.player_id);
    if (!player) return null;
    const color = posHex(player.position);
    return (
      <div
        key={pick.pick_number}
        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border ${
          pick.is_user ? 'border-accent/40 bg-accent/[0.06]' : 'border-border-subtle bg-bg-surface/30'
        }`}
        style={pick.is_user ? { borderLeft: `3px solid ${color}` } : undefined}
      >
        <span className="font-mono text-[9.5px] text-text-muted w-7 text-right shrink-0">
          #{pick.pick_number}
        </span>
        <TeamLogo abbr={pick.team} size="xs" />
        {tradedPickNumbers.has(pick.pick_number) && (
          <span className="font-mono text-[9px] text-gold shrink-0" title="Pick changed hands in a trade" aria-label="traded pick">⇄</span>
        )}
        <PlayerHeadshot url={player.headshot_url} name={player.name} position={player.position} size="xs" />
        <div className="flex-1 min-w-0">
          <div className={`text-[12px] font-semibold truncate ${pick.is_user ? 'text-text-primary' : 'text-text-secondary'}`}>
            {player.name}
          </div>
          <div className="text-[10px] text-text-muted truncate">{player.school}</div>
        </div>
        <PositionBadge position={player.position} muted={!pick.is_user} />
      </div>
    );
  }

  // Compact "My Picks" row — denser than the history row since the panel is
  // height-constrained and this list only ever has ~6-10 entries.
  function renderMyPick(pick) {
    const player = byId.get(pick.player_id);
    if (!player) return null;
    const color = posHex(player.position);
    return (
      <div
        key={pick.pick_number}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-accent/[0.05] border border-accent/20"
        style={{ borderLeft: `3px solid ${color}` }}
      >
        <span className="font-mono text-[9px] text-text-muted w-8 text-right shrink-0">
          {ROUND_LABELS[pick.round] || `R${pick.round}`} · {pick.pick_number}
        </span>
        {tradedPickNumbers.has(pick.pick_number) && (
          <span className="font-mono text-[9px] text-gold shrink-0" title="Pick acquired via trade" aria-label="traded pick">⇄</span>
        )}
        <PlayerHeadshot url={player.headshot_url} name={player.name} position={player.position} size="xs" />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold truncate text-text-primary leading-tight">
            {player.name}
          </div>
          <div className="text-[9px] text-text-muted truncate leading-tight">
            {player.school}
          </div>
        </div>
        <PositionBadge position={player.position} />
      </div>
    );
  }

  // ── Layout ─────────────────────────────────────────────────────────────────
  // Celebration interstitial — shows for ~1.8s while confetti fires, then
  // fades into the full results view.
  if (phase === PHASE_DONE && !showResults) {
    return (
      <div className="fixed inset-0 top-[40px] sm:top-[56px] z-20 bg-bg-deep flex items-center justify-center">
        <div className="text-center animate-pop-in">
          <TeamLogo abbr={team} size="xl" className="mx-auto" />
          <div className="font-display text-3xl sm:text-4xl font-bold uppercase tracking-[0.12em] text-text-primary mt-4">
            Mock Complete!
          </div>
          <div className="font-display text-sm uppercase tracking-[0.14em] text-accent mt-2">
            {userPicksMade} picks across 7 rounds
          </div>
        </div>
      </div>
    );
  }

  // Dedicated results screen once the draft is complete — swaps the in-draft
  // two-panel layout for a "Mock complete" summary with save controls.
  // ResultsView needs to scroll freely — break out of the parent's
  // viewport-locked overflow:hidden wrapper with fixed positioning.
  if (phase === PHASE_DONE) {
    return (
      <div
        className="fixed inset-0 top-[40px] sm:top-[56px] z-20 bg-bg-deep overscroll-contain animate-fade-in"
        style={{
          // Use scroll (not auto) so Chrome doesn't toggle scrollability on
          // re-renders and snap back to the top. Also force smooth scrolling
          // via WebKit for momentum.
          overflowY: 'scroll',
          WebkitOverflowScrolling: 'touch',
        }}
      >
      <ResultsView
        team={team}
        picks={picks}
        byId={byId}
        userPicksMade={userPicksMade}
        userSlotCount={userSlotCount}
        saving={saving}
        saved={saved}
        trades={trades}
        draftOrder={draftOrder}
        onSave={handleSave}
        onRestart={restart}
        onChangeTeam={onChangeTeam}
        onDone={onSaved}
        isGuest={!user}
      />
      {/* Generous bottom padding so Chrome keeps the scroll container tall
          even during re-renders when data URLs load and content height
          briefly changes. Without this, Chrome occasionally recalculates
          the scrollable area as shorter and snaps to top. */}
      <div className="h-32" aria-hidden />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Desktop ── */}
      <div className="hidden md:flex flex-1 overflow-hidden gap-0">
        {/* Left: My picks + Draft history */}
        <div className="w-80 shrink-0 flex flex-col border-r border-border-subtle overflow-hidden">
          {/* My Picks — compact, fixed height */}
          <div className="shrink-0 border-b border-border-subtle">
            <div className="px-4 py-2 flex items-center gap-2">
              <TeamLogo abbr={team} size="xs" />
              <span className="font-display text-[11px] font-bold uppercase tracking-[0.14em] text-text-primary flex-1">
                My Picks
              </span>
              <span className="font-mono text-[10px] text-text-muted">
                {myPicks.length}/{userSlotCount}
              </span>
              <button
                onClick={requestChangeTeam}
                className="text-[10px] font-display uppercase tracking-wider text-text-muted hover:text-text-primary transition"
              >
                Change
              </button>
            </div>
            <div className="px-2 pb-2 max-h-52 overflow-y-auto space-y-1">
              {myPicks.length === 0 ? (
                <div className="text-center text-text-muted text-[10.5px] py-3">
                  No picks yet
                </div>
              ) : (
                myPicks.map(renderMyPick)
              )}
            </div>
          </div>
          {/* Draft Board — all picks, most recent first */}
          <div className="px-4 py-2 border-b border-border-subtle flex items-center gap-2">
            <div className="font-display text-[11px] font-bold uppercase tracking-[0.14em] text-text-primary flex-1">
              Draft Board
            </div>
            <span className="font-mono text-[10px] text-text-muted">
              {picks.length}/{liveOrder.length}
            </span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
            {recentPicks.length === 0 ? (
              <div className="text-center text-text-muted text-xs py-8">
                Click Start Mock Draft to begin
              </div>
            ) : (
              recentPicks.map((pick, i) => {
                const prev = i > 0 ? recentPicks[i - 1] : null;
                const showHeader = !prev || prev.round !== pick.round;
                return (
                  <div key={`wrap-${pick.pick_number}`}>
                    {showHeader && (
                      <div className="flex items-center gap-2 py-1 px-1 opacity-55">
                        <div className="flex-1 h-px bg-border-subtle" />
                        <span className="font-display text-[9px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                          {ROUND_LABELS[pick.round] || `Round ${pick.round}`}
                        </span>
                        <div className="flex-1 h-px bg-border-subtle" />
                      </div>
                    )}
                    {renderHistoryPick(pick)}
                  </div>
                );
              })
            )}
          </div>
          {/* Controls */}
          <div className="shrink-0 px-4 py-3 border-t border-border-subtle space-y-3">
            {/* Speed slider */}
            <div>
              <div className="flex justify-between text-[10px] text-text-muted mb-1">
                <span>Speed</span>
                <span>{SPEED_LABELS[speedIdx]}</span>
              </div>
              <input
                type="range" min="0" max={SPEED_STEPS.length - 1} step="1"
                value={speedIdx}
                onChange={(e) => setSpeedIdx(Number(e.target.value))}
                className="w-full h-1 accent-accent cursor-pointer"
              />
            </div>
            {/* Bot chaos slider — only meaningful pre-draft; once picks are
                running the score curves are already baked in. */}
            {phase === PHASE_READY && (
              <div>
                <div className="flex justify-between text-[10px] text-text-muted mb-1">
                  <span>Bot Chaos</span>
                  <span>{Math.round(randomness * 100)}%</span>
                </div>
                <input
                  type="range" min="0" max="1" step="0.05"
                  value={randomness}
                  onChange={(e) => setRandomness(Number(e.target.value))}
                  className="w-full h-1 accent-accent cursor-pointer"
                />
              </div>
            )}
            {/* Trade feature toggles — pre-draft only. Locked mid-run would
                leave a half-applied state, and they take a lot of vertical
                space on the left panel. */}
            {phase === PHASE_READY && (
              <div className="space-y-1.5">
                <label className="flex items-center justify-between gap-2 text-[10px] font-display uppercase tracking-wider text-text-muted cursor-pointer select-none">
                  <span>Trade Offers</span>
                  <input
                    type="checkbox"
                    checked={offersEnabled}
                    onChange={(e) => setOffersEnabled(e.target.checked)}
                    className="w-3.5 h-3.5 accent-accent cursor-pointer"
                    title="Incoming trade offers from bot teams when you're on the clock"
                  />
                </label>
                <label className="flex items-center justify-between gap-2 text-[10px] font-display uppercase tracking-wider text-text-muted cursor-pointer select-none">
                  <span>Bot-vs-Bot Trades</span>
                  <input
                    type="checkbox"
                    checked={botBotEnabled}
                    onChange={(e) => setBotBotEnabled(e.target.checked)}
                    className="w-3.5 h-3.5 accent-accent cursor-pointer"
                    title="CPU teams trade amongst themselves during auto-run"
                  />
                </label>
              </div>
            )}
            {/* Start / Pause / Resume / Trade */}
            {phase === PHASE_READY ? (
              <button
                onClick={start}
                className="w-full font-display font-bold uppercase tracking-[0.14em] text-[12px] text-bg-deep rounded-lg px-4 py-2.5 transition hover:brightness-110 active:scale-[0.99]"
                style={{ background: 'var(--gradient-accent)', boxShadow: '0 0 18px -6px rgba(0,229,255,0.55)' }}
              >
                Start Mock Draft
              </button>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {phase === PHASE_RUNNING && (
                  <button
                    onClick={pause}
                    className="font-display font-semibold text-[10px] uppercase tracking-[0.12em] text-text-primary rounded-lg px-3 py-1.5 border border-border-subtle hover:border-border-focus transition"
                  >
                    Pause
                  </button>
                )}
                {phase === PHASE_PAUSED && (
                  <button
                    onClick={resume}
                    className="font-display font-semibold text-[10px] uppercase tracking-[0.12em] text-bg-deep rounded-lg px-3 py-1.5 transition hover:brightness-110"
                    style={{ background: 'var(--gradient-accent)' }}
                  >
                    Resume
                  </button>
                )}
                {(phase === PHASE_RUNNING || phase === PHASE_PAUSED || phase === PHASE_ON_CLOCK) && (
                  <button
                    onClick={() => { if (phase === PHASE_RUNNING) setPhase(PHASE_PAUSED); setTradeOpen(true); }}
                    className="font-display font-semibold text-[10px] uppercase tracking-[0.12em] text-text-primary rounded-lg px-3 py-1.5 border border-accent/40 hover:bg-accent/[0.08] transition"
                  >
                    Propose Trade
                  </button>
                )}
              </div>
            )}
            {phase !== PHASE_READY && (
              <button
                onClick={requestRestart}
                className="w-full font-display font-semibold text-[10px] uppercase tracking-[0.12em] text-text-muted hover:text-text-primary rounded-lg px-3 py-1.5 border border-border-subtle hover:border-border-focus transition"
              >
                Restart
              </button>
            )}
          </div>
        </div>

        {/* Right: Status + prospect pool */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="border-b border-border-subtle">
            <StatusBanner />
          </div>
          {phase === PHASE_ON_CLOCK && visibleOffers.length > 0 && (
            <div className="px-4 py-3 border-b border-border-subtle bg-bg-deep/40">
              <TradeOffersPanel
                offers={visibleOffers}
                onAccept={handleAcceptOffer}
                onDismiss={handleDismissOffer}
                onDismissAll={handleDismissAllOffers}
                onCounter={handleCounterOffer}
                collapsed={offersCollapsed}
                onToggleCollapsed={() => setOffersCollapsed((v) => !v)}
              />
            </div>
          )}
          <div className="px-4 py-2 flex items-center gap-2 border-b border-border-subtle">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={phase === PHASE_ON_CLOCK ? 'Search prospects…' : 'Prospects'}
              disabled={phase === PHASE_READY}
              aria-label="Search prospects by name"
              autoComplete="off"
              spellCheck={false}
              className="flex-1 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[12px] text-text-primary placeholder-text-muted focus:border-accent/60 outline-none transition disabled:opacity-50"
            />
            <label className="flex items-center gap-1.5 shrink-0 text-[10px] font-display uppercase tracking-[0.1em] text-text-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showUsed}
                onChange={(e) => setShowUsed(e.target.checked)}
                className="w-3.5 h-3.5 accent-accent cursor-pointer"
              />
              Show drafted
            </label>
          </div>
          <div className="flex gap-1 px-4 py-2 overflow-x-auto scrollbar-none border-b border-border-subtle">
            {FILTERS.map((f) => {
              const isActive = posFilter === f;
              const isOnClockNeed = phase === PHASE_ON_CLOCK && f !== 'ALL' && Array.isArray(currentSlot?.team_needs) && currentSlot.team_needs.includes(f);
              const isSatisfied = isOnClockNeed && satisfiedNeeds.has(f);
              const isNeed = isOnClockNeed && !isActive && !isSatisfied;
              return (
                <button
                  key={f}
                  onClick={() => setPosFilter(f)}
                  title={isSatisfied ? `${f} need addressed` : undefined}
                  className={`shrink-0 px-2 py-0.5 rounded-md font-display text-[10px] font-semibold uppercase tracking-[0.1em] transition ${
                    isActive ? 'bg-accent text-bg-deep' : isNeed ? 'border border-yellow-400/40' : 'text-text-muted hover:text-text-primary'
                  } ${isSatisfied && !isActive ? 'line-through opacity-60' : ''}`}
                  style={isNeed ? { background: 'rgba(251,191,36,0.15)', color: 'var(--gold)' } : undefined}
                >
                  {f}
                </button>
              );
            })}
          </div>
          <ul className="flex-1 overflow-y-auto p-3 space-y-1">
            {filteredProspects.map(renderProspect)}
            {filteredProspects.length === 0 && (
              <li className="text-center text-text-muted text-sm py-12">
                {showUsed ? 'No prospects match' : 'No available prospects match'}
              </li>
            )}
          </ul>
        </div>
      </div>

      {/* ── Mobile ── */}
      {/* ── Mobile: tab-based layout ── */}
      <div className="flex flex-col md:hidden" style={{ flex: 1, overflow: 'hidden' }}>
        {/* Fixed top: status banner + action bar */}
        <div className="shrink-0 border-b border-border-subtle">
          {phase === PHASE_READY ? (
            /* ── Mobile pre-draft panel ──────────────────────────────────
               Clean stacked layout: team identity → optional board
               selector → sliders → full-width start button.
               Replaces the cramped flex-wrap StatusBanner for this phase. */
            <div className="px-3 py-3 space-y-3">
              {/* Team identity row */}
              <div className="flex items-center gap-2.5">
                <TeamLogo abbr={team} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">Drafting for</div>
                  <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                    <span className="font-display font-bold text-[14px] text-text-primary shrink-0">
                      {team} · {userSlotCount} picks
                    </span>
                    {liveOrder
                      .filter((s) => s.team === team)
                      .map((s) => (
                        <span
                          key={s.pick_number}
                          className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold rounded font-mono shrink-0"
                          style={{ backgroundColor: 'rgba(0,229,255,0.10)', color: 'var(--accent)', boxShadow: 'inset 0 0 0 1px rgba(0,229,255,0.22)' }}
                        >
                          {s.pick_number}
                        </span>
                      ))
                    }
                  </div>
                </div>
              </div>
              {/* Board selector — only when the user has saved boards */}
              {userBoards.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="font-display text-[10px] font-semibold uppercase tracking-wider text-text-muted w-12 shrink-0">Board</span>
                  <select
                    value={selectedBoardId}
                    onChange={(e) => setSelectedBoardId(e.target.value)}
                    className="flex-1 bg-bg-deep/80 border border-border-subtle rounded-md px-2 py-1.5 text-text-primary text-[11px] font-display uppercase tracking-wide focus:border-accent outline-none"
                  >
                    <option value="">Default</option>
                    {userBoards.map((b) => (
                      <option key={b.id} value={b.id}>{b.title}</option>
                    ))}
                  </select>
                </div>
              )}
              {/* Speed slider */}
              <div className="flex items-center gap-2">
                <span className="font-display text-[10px] font-semibold uppercase tracking-wider text-text-muted w-12 shrink-0">Speed</span>
                <input type="range" min="0" max={SPEED_STEPS.length - 1} step="1" value={speedIdx}
                  onChange={(e) => setSpeedIdx(Number(e.target.value))}
                  className="flex-1 h-1 accent-accent cursor-pointer" />
                <span className="font-mono text-[10px] text-text-muted w-14 text-right shrink-0">{SPEED_LABELS[speedIdx]}</span>
              </div>
              {/* Chaos slider */}
              <div className="flex items-center gap-2">
                <span className="font-display text-[10px] font-semibold uppercase tracking-wider text-text-muted w-12 shrink-0">Chaos</span>
                <input type="range" min="0" max="1" step="0.05" value={randomness}
                  onChange={(e) => setRandomness(Number(e.target.value))}
                  className="flex-1 h-1 accent-accent cursor-pointer" />
                <span className="font-mono text-[10px] text-text-muted w-14 text-right shrink-0">{Math.round(randomness * 100)}%</span>
              </div>
              {/* Trade feature toggles — mobile pre-draft. Parallels the
                  desktop controls column so users can silence offers or
                  bot-vs-bot trades before starting. */}
              <label className="flex items-center justify-between gap-2 text-[10px] font-display uppercase tracking-wider text-text-muted cursor-pointer select-none">
                <span>Trade Offers</span>
                <input
                  type="checkbox"
                  checked={offersEnabled}
                  onChange={(e) => setOffersEnabled(e.target.checked)}
                  className="w-4 h-4 accent-accent cursor-pointer"
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-[10px] font-display uppercase tracking-wider text-text-muted cursor-pointer select-none">
                <span>Bot-vs-Bot Trades</span>
                <input
                  type="checkbox"
                  checked={botBotEnabled}
                  onChange={(e) => setBotBotEnabled(e.target.checked)}
                  className="w-4 h-4 accent-accent cursor-pointer"
                />
              </label>
              {/* Full-width start button */}
              <button
                onClick={start}
                className="w-full font-display font-bold uppercase tracking-[0.14em] text-[12px] text-bg-deep rounded-lg px-4 py-3 transition hover:brightness-110 active:scale-[0.99]"
                style={{ background: 'var(--gradient-accent)', boxShadow: '0 0 18px -6px rgba(0,229,255,0.55)' }}
              >
                Start Mock Draft
              </button>
            </div>
          ) : (
            <div>
              {phase === PHASE_ON_CLOCK ? (
                /* Gold urgency card */
                <div style={{ background: 'linear-gradient(135deg, rgba(251,191,36,0.12) 0%, rgba(0,229,255,0.06) 100%)', borderBottom: '1px solid rgba(251,191,36,0.25)' }}>
                  <div className="px-3 pt-3 pb-2 flex items-start gap-3">
                    <TeamLogo abbr={team} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="font-display text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: 'var(--gold)' }}>
                        Your Pick
                      </div>
                      <div className="font-display font-bold text-[17px] uppercase tracking-[0.06em] text-text-primary leading-tight">
                        {team} · Pick #{currentSlot?.pick_number}
                      </div>
                      <div className="font-display text-[11px] text-text-muted uppercase tracking-wider mt-0.5">
                        {ROUND_LABELS[currentSlot?.round] || `Round ${currentSlot?.round}`}
                      </div>
                    </div>
                    <div className="shrink-0 text-right font-mono text-[10px] text-text-muted">
                      {picks.length}/{liveOrder.length}
                    </div>
                  </div>
                  {/* Team needs row */}
                  {Array.isArray(currentSlot?.team_needs) && currentSlot.team_needs.length > 0 && (
                    <div className="px-3 pb-2 flex items-center gap-1.5 flex-wrap">
                      <span className="font-display text-[9px] uppercase tracking-[0.14em] text-text-muted mr-1">Needs:</span>
                      {currentSlot.team_needs.slice(0, 6).map((n) => {
                        const done = satisfiedNeeds.has(n);
                        return (
                          <span
                            key={n}
                            title={done ? `${n} need addressed` : undefined}
                            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase font-mono transition-opacity ${done ? 'line-through opacity-50' : ''}`}
                            style={{ background: `${posHex(n)}22`, color: posHex(n), boxShadow: `inset 0 0 0 1px ${posHex(n)}55` }}
                          >
                            {n}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {/* Action row */}
                  <div className="px-3 pb-2.5 flex items-center gap-2">
                    <button onClick={() => { setPhase(PHASE_PAUSED); setTradeOpen(true); }}
                      className="font-display text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-md border text-text-primary"
                      style={{ borderColor: 'rgba(251,191,36,0.4)', background: 'rgba(251,191,36,0.07)' }}>
                      Trade
                    </button>
                    <div className="flex-1" />
                    <button onClick={() => setSettingsOpen((v) => !v)}
                      className="w-8 h-8 flex items-center justify-center rounded-md border border-border-subtle text-text-muted">
                      <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8.34 1.804A1 1 0 019.32 1h1.36a1 1 0 01.98.804l.295 1.473c.497.144.971.342 1.416.587l1.25-.834a1 1 0 011.262.125l.962.962a1 1 0 01.125 1.262l-.834 1.25c.245.445.443.919.587 1.416l1.473.294a1 1 0 01.804.98v1.362a1 1 0 01-.804.98l-1.473.295a6.95 6.95 0 01-.587 1.416l.834 1.25a1 1 0 01-.125 1.262l-.962.962a1 1 0 01-1.262.125l-1.25-.834a6.953 6.953 0 01-1.416.587l-.294 1.473a1 1 0 01-.98.804H9.32a1 1 0 01-.98-.804l-.295-1.473a6.957 6.957 0 01-1.416-.587l-1.25.834a1 1 0 01-1.262-.125l-.962-.962a1 1 0 01-.125-1.262l.834-1.25a6.957 6.957 0 01-.587-1.416l-1.473-.294A1 1 0 011 11.18V9.82a1 1 0 01.804-.98l1.473-.295c.144-.497.342-.971.587-1.416l-.834-1.25a1 1 0 01.125-1.262l.962-.962A1 1 0 015.38 3.53l1.25.834a6.957 6.957 0 011.416-.587l.294-1.473zM13 10a3 3 0 11-6 0 3 3 0 016 0z" clipRule="evenodd" /></svg>
                    </button>
                  </div>
                  {/* Incoming trade offers (bot-initiated) */}
                  {visibleOffers.length > 0 && (
                    <div className="px-3 pb-3">
                      <TradeOffersPanel
                        offers={visibleOffers}
                        onAccept={handleAcceptOffer}
                        onDismiss={handleDismissOffer}
                        onDismissAll={handleDismissAllOffers}
                        onCounter={handleCounterOffer}
                        collapsed={offersCollapsed}
                        onToggleCollapsed={() => setOffersCollapsed((v) => !v)}
                      />
                    </div>
                  )}
                </div>
              ) : (
                /* RUNNING / PAUSED — compact progress header */
                <div className="px-3 py-2.5 flex flex-col gap-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <div className="flex items-center gap-2.5">
                    <TeamLogo abbr={currentSlot?.team || team} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="font-display text-[10px] uppercase tracking-[0.14em] text-text-muted">
                        {phase === PHASE_PAUSED ? 'Paused' : 'On the clock'}
                      </div>
                      <div className="font-display font-bold text-[13px] text-text-primary truncate">
                        {currentSlot?.team} · Pick #{currentSlot?.pick_number}
                        <span className="ml-1.5 text-text-muted font-mono text-[10px]">
                          {ROUND_LABELS[currentSlot?.round] || `R${currentSlot?.round}`}
                        </span>
                      </div>
                    </div>
                    <span className="font-mono text-[10px] text-text-muted shrink-0">{picks.length}/{liveOrder.length}</span>
                  </div>
                  {/* Progress bar */}
                  <div className="h-0.5 rounded-full bg-bg-elevated overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-300"
                      style={{ width: `${(picks.length / Math.max(liveOrder.length, 1)) * 100}%`, background: 'var(--gradient-accent)' }} />
                  </div>
                  {/* Controls row */}
                  <div className="flex items-center gap-2">
                    {phase === PHASE_RUNNING && (
                      <button onClick={pause}
                        className="font-display text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-md border border-border-subtle text-text-primary">
                        Pause
                      </button>
                    )}
                    {phase === PHASE_PAUSED && (
                      <button onClick={resume}
                        className="font-display text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-md text-bg-deep"
                        style={{ background: 'var(--gradient-accent)' }}>
                        Resume
                      </button>
                    )}
                    <button onClick={() => { if (phase === PHASE_RUNNING) setPhase(PHASE_PAUSED); setTradeOpen(true); }}
                      className="font-display text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-md border border-accent/40 text-text-primary">
                      Trade
                    </button>
                    <div className="flex-1" />
                    <button onClick={() => setSettingsOpen((v) => !v)}
                      className="w-8 h-8 flex items-center justify-center rounded-md border border-border-subtle text-text-muted">
                      <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8.34 1.804A1 1 0 019.32 1h1.36a1 1 0 01.98.804l.295 1.473c.497.144.971.342 1.416.587l1.25-.834a1 1 0 011.262.125l.962.962a1 1 0 01.125 1.262l-.834 1.25c.245.445.443.919.587 1.416l1.473.294a1 1 0 01.804.98v1.362a1 1 0 01-.804.98l-1.473.295a6.95 6.95 0 01-.587 1.416l.834 1.25a1 1 0 01-.125 1.262l-.962.962a1 1 0 01-1.262.125l-1.25-.834a6.953 6.953 0 01-1.416.587l-.294 1.473a1 1 0 01-.98.804H9.32a1 1 0 01-.98-.804l-.295-1.473a6.957 6.957 0 01-1.416-.587l-1.25.834a1 1 0 01-1.262-.125l-.962-.962a1 1 0 01-.125-1.262l.834-1.25a6.957 6.957 0 01-.587-1.416l-1.473-.294A1 1 0 011 11.18V9.82a1 1 0 01.804-.98l1.473-.295c.144-.497.342-.971.587-1.416l-.834-1.25a1 1 0 01.125-1.262l.962-.962A1 1 0 015.38 3.53l1.25.834a6.957 6.957 0 011.416-.587l.294-1.473zM13 10a3 3 0 11-6 0 3 3 0 016 0z" clipRule="evenodd" /></svg>
                    </button>
                  </div>
                </div>
              )}
              {/* Collapsible settings drawer (during draft only) — same content as before */}
              {settingsOpen && (
                <div className="px-3 pb-3 pt-2 space-y-2 border-t border-border-subtle bg-bg-surface/30">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-[10px] font-semibold uppercase tracking-wider text-text-muted w-12 shrink-0">Speed</span>
                    <input type="range" min="0" max={SPEED_STEPS.length - 1} step="1" value={speedIdx}
                      onChange={(e) => setSpeedIdx(Number(e.target.value))}
                      className="flex-1 h-1 accent-accent cursor-pointer" />
                    <span className="font-mono text-[10px] text-text-muted w-14 text-right shrink-0">{SPEED_LABELS[speedIdx]}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-display text-[10px] font-semibold uppercase tracking-wider text-text-muted w-12 shrink-0">Chaos</span>
                    <input type="range" min="0" max="1" step="0.05" value={randomness}
                      onChange={(e) => setRandomness(Number(e.target.value))}
                      className="flex-1 h-1 accent-accent cursor-pointer" />
                    <span className="font-mono text-[10px] text-text-muted w-14 text-right shrink-0">{Math.round(randomness * 100)}%</span>
                  </div>
                  <label className={`flex items-center justify-between gap-2 text-[10px] font-display uppercase tracking-wider text-text-muted select-none ${phase !== PHASE_READY ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                    <span>Trade Offers</span>
                    <input type="checkbox" checked={offersEnabled}
                      disabled={phase !== PHASE_READY}
                      onChange={(e) => setOffersEnabled(e.target.checked)}
                      title={phase !== PHASE_READY ? 'Locked during an active draft — restart to change' : undefined}
                      className={`w-3.5 h-3.5 accent-accent ${phase !== PHASE_READY ? 'cursor-not-allowed' : 'cursor-pointer'}`} />
                  </label>
                  <label className={`flex items-center justify-between gap-2 text-[10px] font-display uppercase tracking-wider text-text-muted select-none ${phase !== PHASE_READY ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                    <span>Bot-vs-Bot Trades</span>
                    <input type="checkbox" checked={botBotEnabled}
                      disabled={phase !== PHASE_READY}
                      onChange={(e) => setBotBotEnabled(e.target.checked)}
                      title={phase !== PHASE_READY ? 'Locked during an active draft — restart to change' : undefined}
                      className={`w-3.5 h-3.5 accent-accent ${phase !== PHASE_READY ? 'cursor-not-allowed' : 'cursor-pointer'}`} />
                  </label>
                  <button onClick={requestRestart}
                    className="w-full font-display font-semibold text-[10px] uppercase tracking-[0.12em] text-text-muted hover:text-text-primary rounded-lg px-3 py-1.5 border border-border-subtle hover:border-border-focus transition">
                    Restart Draft
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Tab content — single scroll area per tab */}
        <div className="flex-1 overflow-hidden">
          {mobileTab === 'board' && (
            <div className="h-full overflow-y-auto overscroll-contain p-2 space-y-1.5">
              {recentPicks.length === 0 ? (
                <div className="text-center text-text-muted text-xs py-8">
                  {phase === PHASE_READY ? 'Tap Start Mock Draft above to begin' : 'Draft in progress…'}
                </div>
              ) : (
                recentPicks.map((pick, i) => {
                  const player = byId.get(pick.player_id);
                  if (!player) return null;
                  const prev = i > 0 ? recentPicks[i - 1] : null;
                  const showHeader = !prev || prev.round !== pick.round;
                  return (
                    <div key={`wrap-${pick.pick_number}`}>
                      {showHeader && (
                        <div className="flex items-center gap-2 py-1.5 px-1 opacity-55">
                          <div className="flex-1 h-px bg-border-subtle" />
                          <span className="font-display text-[9px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                            {ROUND_LABELS[pick.round] || `Round ${pick.round}`}
                          </span>
                          <div className="flex-1 h-px bg-border-subtle" />
                        </div>
                      )}
                      <div className={`flex items-center gap-2.5 px-2.5 py-2 rounded-xl border transition-all ${
                        pick.is_user ? 'border-accent/30 bg-accent/[0.05]' : 'border-border-subtle bg-bg-surface/20'
                      }`} style={pick.is_user ? { borderLeft: `3px solid ${posHex(player?.position)}` } : undefined}>
                        <span className="font-mono text-[9px] text-text-muted w-6 text-right shrink-0">#{pick.pick_number}</span>
                        <TeamLogo abbr={pick.team} size="xs" />
                        {tradedPickNumbers.has(pick.pick_number) && (
                          <span className="font-mono text-[9px] text-gold shrink-0" title="Pick changed hands in a trade" aria-label="traded pick">⇄</span>
                        )}
                        <PlayerHeadshot url={player?.headshot_url} name={player?.name} position={player?.position} size="xs" />
                        <div className="flex-1 min-w-0">
                          <div className={`text-[12px] font-semibold truncate leading-tight ${pick.is_user ? 'text-text-primary' : 'text-text-secondary'}`}>{player?.name}</div>
                          <div className="text-[9.5px] text-text-muted">{player?.school}</div>
                        </div>
                        {pick.is_user && <span className="shrink-0 font-display text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: 'rgba(0,229,255,0.12)', color: 'var(--accent)' }}>Your Pick</span>}
                        {!pick.is_user && <PositionBadge position={player?.position} muted />}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {mobileTab === 'picks' && (
            <div className="h-full overflow-y-auto overscroll-contain p-2 space-y-1">
              {/* Header stat row */}
              <div className="flex items-center gap-2 px-1 py-2">
                <TeamLogo abbr={team} size="xs" />
                <span className="font-display text-[11px] font-bold uppercase tracking-wider text-text-primary flex-1">
                  My Picks
                </span>
                <span className="font-mono text-[10px] text-text-muted">
                  {myPicks.length}/{userSlotCount}
                </span>
              </div>
              {/* Progress bar */}
              <div className="mx-1 h-1 rounded-full bg-bg-elevated overflow-hidden mb-2">
                <div className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${(myPicks.length / Math.max(userSlotCount, 1)) * 100}%`, background: 'var(--gradient-accent)' }} />
              </div>
              {myPicks.length === 0 ? (
                <div className="text-center text-text-muted text-xs py-8">No picks yet</div>
              ) : (
                myPicks.map(renderMyPick)
              )}
            </div>
          )}

          {mobileTab === 'prospects' && (
            <div className="h-full flex flex-col overflow-hidden">
              <div className="px-3 py-2 flex gap-2 border-b border-border-subtle shrink-0">
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={phase === PHASE_ON_CLOCK ? 'Search prospects…' : 'Prospects'}
                  disabled={phase === PHASE_READY}
                  aria-label="Search prospects by name"
                  autoComplete="off"
                  spellCheck={false}
                  className="flex-1 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[12px] text-text-primary placeholder-text-muted focus:border-accent/60 outline-none transition disabled:opacity-50"
                />
                <label className="flex items-center gap-1 shrink-0 text-[10px] font-display uppercase tracking-[0.1em] text-text-muted cursor-pointer select-none">
                  <input type="checkbox" checked={showUsed} onChange={(e) => setShowUsed(e.target.checked)}
                    className="w-3.5 h-3.5 accent-accent cursor-pointer" />
                  Drafted
                </label>
              </div>
              <div className="flex gap-1 px-3 py-1.5 overflow-x-auto scrollbar-none border-b border-border-subtle shrink-0">
                {FILTERS.map((f) => {
                  const isActive = posFilter === f;
                  const isOnClockNeed = phase === PHASE_ON_CLOCK && f !== 'ALL' && Array.isArray(currentSlot?.team_needs) && currentSlot.team_needs.includes(f);
                  const isSatisfied = isOnClockNeed && satisfiedNeeds.has(f);
                  const isNeed = isOnClockNeed && !isActive && !isSatisfied;
                  return (
                    <button key={f} onClick={() => setPosFilter(f)}
                      title={isSatisfied ? `${f} need addressed` : undefined}
                      className={`shrink-0 px-2 py-0.5 rounded-md font-display text-[10px] font-semibold uppercase tracking-[0.1em] transition ${
                        isActive ? 'bg-accent text-bg-deep' : isNeed ? 'border border-yellow-400/40' : 'text-text-muted hover:text-text-primary'
                      } ${isSatisfied && !isActive ? 'line-through opacity-60' : ''}`}
                      style={isNeed ? { background: 'rgba(251,191,36,0.15)', color: 'var(--gold)' } : undefined}>
                      {f}
                    </button>
                  );
                })}
              </div>
              <ul className="flex-1 overflow-y-auto overscroll-contain">
                {filteredProspects.map((p) => {
                  const taken = pickOrder.has(p.id);
                  const takenBy = taken ? pickOrder.get(p.id) : null;
                  const locked = taken || phase !== PHASE_ON_CLOCK;
                  return (
                    <li key={p.id} onClick={() => !locked && handleUserPick(p)}
                      className={`flex items-center gap-3 px-3 py-2.5 border-b border-border-subtle/40 transition-all duration-100 ${
                        taken ? 'opacity-40 cursor-not-allowed' :
                        phase === PHASE_ON_CLOCK ? 'cursor-pointer active:bg-accent/10' : 'cursor-default'
                      }`}
                      style={phase === PHASE_ON_CLOCK && !taken ? { touchAction: 'manipulation' } : undefined}
                    >
                      <span className="font-mono text-[10px] text-text-muted w-6 shrink-0 text-right">{p.rank ?? ''}</span>
                      <PlayerHeadshot url={p.headshot_url} name={p.name} position={p.position} size="sm" />
                      <div className="flex-1 min-w-0">
                        <div className={`text-[13px] font-semibold truncate leading-tight ${taken ? 'line-through text-text-muted' : 'text-text-primary'}`}>
                          {p.name}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[10px] text-text-muted truncate">
                            {taken && takenBy ? `${takenBy.team} · #${takenBy.pick_number}` : p.school}
                          </span>
                          {!taken && p.projected_round && (
                            <span className="shrink-0 text-[9px] font-bold font-mono px-1 py-0.5 rounded"
                              style={{ background: 'rgba(0,229,255,0.1)', color: 'var(--accent)' }}>
                              R{p.projected_round}
                            </span>
                          )}
                        </div>
                      </div>
                      <PositionBadge position={p.position} muted={taken} />
                      {phase === PHASE_ON_CLOCK && !taken && (
                        <svg className="shrink-0 text-accent/60" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="m9 18 6-6-6-6"/>
                        </svg>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {/* Bottom tab bar */}
        <div className="shrink-0 bg-bg-deep/95 flex border-t border-border-subtle"
          style={{ backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          {[
            {
              key: 'board',
              label: 'Board',
              badge: picks.length > 0 ? String(picks.length) : null,
              icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>,
            },
            {
              key: 'picks',
              label: 'My Picks',
              badge: myPicks.length > 0 ? `${myPicks.length}/${userSlotCount}` : null,
              icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>,
            },
            {
              key: 'prospects',
              label: 'Prospects',
              badge: phase === PHASE_ON_CLOCK ? '!' : null,
              urgent: phase === PHASE_ON_CLOCK,
              icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>,
            },
          ].map((t) => (
            <button key={t.key} onClick={() => setMobileTab(t.key)}
              className={`flex-1 pt-2 pb-1 flex flex-col items-center gap-0.5 transition-colors relative ${
                mobileTab === t.key ? 'text-accent' : 'text-text-muted'
              }`}
            >
              {/* top border indicator */}
              {mobileTab === t.key && <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-accent" />}
              <div className={`relative ${t.urgent && mobileTab !== t.key ? 'animate-pulse' : ''}`}>
                {t.icon}
                {t.badge && (
                  <span className={`absolute -top-1 -right-2 min-w-[14px] h-[14px] rounded-full flex items-center justify-center text-[8px] font-bold font-mono px-0.5 ${
                    t.urgent ? 'bg-gold text-bg-deep' : 'bg-bg-elevated text-text-muted'
                  }`}
                  style={t.urgent ? { background: 'var(--gold)' } : undefined}>
                    {t.badge}
                  </span>
                )}
              </div>
              <span className={`font-display text-[9px] font-bold uppercase tracking-[0.1em] ${mobileTab === t.key ? 'text-accent' : 'text-text-muted'}`}>
                {t.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Trade modal ── */}
      {tradeOpen && (
        <TradeModal
          userTeam={team}
          liveOrder={liveOrder}
          picksMadeCount={picks.length}
          onClockTeam={currentSlot?.team}
          futureOwnership={futureOwnership}
          initialPartnerTeam={counterSeed?.partnerTeam}
          initialYourPicks={counterSeed?.yourPicks}
          initialTheirPicks={counterSeed?.theirPicks}
          onClose={() => { setTradeOpen(false); setCounterSeed(null); }}
          onAccepted={(swap) => {
            applyTradeLocal(swap);
            setTradeOpen(false);
            setCounterSeed(null);
            toast.success('Trade accepted!');
            // Always resume after a trade. The engine effect will detect
            // whether the current slot still belongs to the user (stays on
            // clock) or to someone else (bot picks next). Without this,
            // trading during PHASE_ON_CLOCK leaves the draft stuck.
            setPhase(PHASE_RUNNING);
          }}
        />
      )}

      <ConfirmModal
        open={showRestart}
        onClose={() => setShowRestart(false)}
        onConfirm={() => { restart(); setShowRestart(false); }}
        title="Restart the draft?"
        description={`This clears all ${picks.length} picks${trades.length ? ` and ${trades.length} trade${trades.length === 1 ? '' : 's'}` : ''}. You can't undo this.`}
        confirmLabel="Restart"
        confirmVariant="danger"
      />

      <ConfirmModal
        open={showChangeTeam}
        onClose={() => setShowChangeTeam(false)}
        onConfirm={() => { setShowChangeTeam(false); onChangeTeam(); }}
        title="Change teams?"
        description={`Switching teams will throw out this in-progress mock (${picks.length} picks so far). Save it first if you want to keep it.`}
        confirmLabel="Change team"
        confirmVariant="danger"
      />
    </div>
  );
}

// ─── Saved Mocks List ─────────────────────────────────────────────────────────
function SavedMocksList({ mocks, onOpen, onDelete, onNew }) {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold uppercase tracking-[0.12em] text-text-primary">
            Team Mocks
          </h1>
          <p className="text-text-secondary text-[11px] mt-1">
            {mocks.length} saved · unlimited
          </p>
        </div>
        <button
          onClick={onNew}
          className="font-display font-bold uppercase tracking-[0.14em] text-[11px] text-bg-deep rounded-lg px-4 py-2 transition hover:brightness-110 active:scale-[0.98]"
          style={{ background: 'var(--gradient-accent)', boxShadow: '0 0 18px -6px rgba(0,229,255,0.55)' }}
        >
          + New Team Mock
        </button>
      </div>

      {mocks.length === 0 ? (
        <div className="text-center py-16 text-text-muted">
          <p className="text-sm mb-2">No team mocks yet.</p>
          <p className="text-[11px]">Start one to build your first sandbox draft.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {mocks.map((m) => (
            <div
              key={m.id}
              className="group relative flex items-center gap-3 p-3 rounded-xl border border-border-subtle bg-bg-surface/40 hover:border-accent/50 hover:bg-white/[0.02] transition-all cursor-pointer"
              onClick={() => onOpen(m)}
            >
              <TeamLogo abbr={m.team_abbr} size="lg" />
              <div className="flex-1 min-w-0">
                <div className="font-display font-bold text-[13px] uppercase tracking-[0.08em] text-text-primary truncate">
                  {m.title || `${m.team_abbr} Mock`}
                </div>
                <div className="text-[10.5px] text-text-muted">
                  {new Date(m.submitted_at).toLocaleString(undefined, {
                    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                  })}
                </div>
                <div className="text-[10px] text-text-muted mt-0.5">
                  {m.pick_count} picks{m.trade_count > 0 && ` · ${m.trade_count} trade${m.trade_count === 1 ? '' : 's'}`}
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(m); }}
                className="opacity-0 group-hover:opacity-100 font-display text-[9px] uppercase tracking-wider text-text-muted hover:text-[color:var(--color-danger,#ef4444)] transition px-2 py-1"
                title="Delete mock"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page Shell ───────────────────────────────────────────────────────────────
export default function TeamMock() {
  usePageMeta({
    title: 'Team Mock Draft',
    description:
      "GM your favorite NFL team through all 7 rounds of the 2026 Draft. Trade up, trade down, and get a full draft grade on pick value, roster build, and league ranking.",
  });
  const { user } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [players, setPlayers] = useState(null);
  const [draftOrder, setDraftOrder] = useState(null);
  // undefined = loading, [] = none yet
  const [savedMocks, setSavedMocks] = useState(undefined);
  const [activeMock, setActiveMock] = useState(null); // currently-viewed saved mock
  const [team, setTeam] = useState(null); // currently drafting for

  // Load players + full draft order (all 7 rounds) on mount. Always pull the
  // draft order fresh so admin syncs of R2-R7 show up without a hard refresh.
  function loadData() {
    setPlayers(null);
    setDraftOrder(null);
    Promise.all([api.getPlayers(), api.getDraftOrderAll({ fresh: true }), loadAlgoConfig()])
      .then(([pl, order]) => {
        setPlayers(pl);
        setDraftOrder(order);
      })
      .catch((e) => {
        setPlayers([]);
        setDraftOrder([]);
        toast.error(`Couldn't load draft data: ${e?.message || 'unknown error'}`);
      });
  }
  useEffect(() => { loadData(); }, []);

  // Load the user's saved team mocks list
  function loadSavedMocks() {
    if (!user) { setSavedMocks([]); return; }
    api.listTeamMocks(user.id)
      .then((list) => setSavedMocks(Array.isArray(list) ? list : []))
      .catch(() => setSavedMocks([]));
  }
  useEffect(() => { loadSavedMocks(); }, [user]);

  // Auto-save a pending guest mock after the user signs in.
  // The pending mock is stashed in localStorage by DraftSimulator.handleSave
  // when a guest clicks "Sign in to Save".
  useEffect(() => {
    if (!user) return;
    const raw = localStorage.getItem('mds_pending_team_mock');
    if (!raw) return;
    localStorage.removeItem('mds_pending_team_mock');
    try {
      const pending = JSON.parse(raw);
      api.submitTeamMock(user.id, pending.team, pending.picks, pending.title, pending.trades)
        .then(() => {
          toast.success('Team mock saved!');
          loadSavedMocks();
        })
        .catch((e) => toast.error(e?.message || 'Could not save your mock'));
    } catch {
      // Invalid stored data — ignore
    }
  }, [user]);

  function handleTeamSelect(abbr) {
    setTeam(abbr);
  }

  function handleSaved() {
    // Refresh list, drop out of draft mode
    setTeam(null);
    setShowPickerExplicit(false);
    loadSavedMocks();
  }

  async function handleOpen(mockSummary) {
    // Fetch full picks for the clicked mock
    const loadToast = toast.loading('Loading mock…');
    try {
      const full = await api.getTeamMockById(mockSummary.id);
      setActiveMock(full);
      toast.dismiss(loadToast);
    } catch (e) {
      console.error('[open team mock]', e);
      toast.dismiss(loadToast);
      toast.error(`Couldn't open mock: ${e?.message || 'unknown error'}`);
    }
  }

  async function handleDelete(mockSummary) {
    const ok = window.confirm(`Delete "${mockSummary.title || mockSummary.team_abbr + ' Mock'}"?`);
    if (!ok) return;
    try {
      await api.deleteTeamMock(mockSummary.id);
      toast.success('Mock deleted');
      loadSavedMocks();
      if (activeMock?.id === mockSummary.id) setActiveMock(null);
    } catch (e) {
      console.error('[delete team mock]', e);
      toast.error(`Couldn't delete mock: ${e?.message || 'unknown error'}`);
    }
  }

  // When the user clicks the "Team Mock" nav link while already on /team-mock,
  // the Navbar navigates with { state: { reset } }. Reset all drill-in state
  // so the user lands back on the mocks list / team picker.
  useEffect(() => {
    if (location.state?.reset) {
      setTeam(null);
      setActiveMock(null);
      setShowPickerExplicit(false);
    }
  }, [location.state?.reset]);

  const [showPickerExplicit, setShowPickerExplicit] = useState(false);
  function startNew() {
    setActiveMock(null);
    setTeam(null);
    setShowPickerExplicit(true);
  }

  const loading = players === null || draftOrder === null || savedMocks === undefined;

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-3">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 mt-6">
          {Array.from({ length: 32 }, (_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
        </div>
      </div>
    );
  }

  // 1) Actively drafting — needs the viewport-locked two-panel layout.
  // Use dvh (dynamic viewport height) so mobile browser chrome doesn't
  // throw off the math. The draft simulator is the only view that needs
  // to be clamped to the viewport.
  if (team) {
    return (
      <div className="h-full flex flex-col" style={{ overflow: 'hidden' }}>
        <DraftSimulator
          team={team}
          players={players}
          draftOrder={draftOrder}
          onSaved={handleSaved}
          onChangeTeam={() => { setTeam(null); setShowPickerExplicit(true); }}
        />
      </div>
    );
  }

  // 2) Viewing a saved mock — let the body scroll naturally. The previous
  // fixed-height wrapper (calc(100vh - 56px) + overflow-y:auto) created
  // double-scroll on mobile because the navbar wraps past 56px and both
  // the wrapper AND the body tried to scroll.
  if (activeMock) {
    return (
      <SavedView
        savedMock={activeMock}
        players={players}
        draftOrder={draftOrder}
        onRestart={() => setActiveMock(null)}
      />
    );
  }

  // 3) Explicit "new mock" picker
  if (showPickerExplicit || savedMocks.length === 0) {
    return (
      <div>
        {savedMocks.length > 0 && (
          <div className="max-w-3xl mx-auto px-4 pt-4">
            <button
              onClick={() => setShowPickerExplicit(false)}
              className="font-display text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted hover:text-text-primary transition"
            >
              ← Back to My Mocks
            </button>
          </div>
        )}
        <TeamPicker onSelect={handleTeamSelect} draftOrder={draftOrder} onRefresh={loadData} />
      </div>
    );
  }

  // 4) Default: saved-mocks list
  return (
    <SavedMocksList
      mocks={savedMocks}
      onOpen={handleOpen}
      onDelete={handleDelete}
      onNew={startNew}
    />
  );
}
