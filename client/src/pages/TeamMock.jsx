import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { pickForTeam } from '../lib/botPicker.js';
import tradeValuesChart from '../lib/tradeValues2026.json';
import { POSITIONS, posHex } from '../lib/positions.js';
import { TeamLogo } from '../components/ui/TeamLogo.jsx';
import { PlayerHeadshot } from '../components/ui/PlayerHeadshot.jsx';
import { PositionBadge } from '../components/ui/Badge.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';

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
function SavedView({ savedMock, players, onRestart }) {
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

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <TeamLogo abbr={userTeam} size="lg" />
          <div>
            <h2 className="font-display text-xl font-bold uppercase tracking-[0.1em] text-text-primary">
              {savedMock.title || `${userTeam} Team Mock`}
            </h2>
            <p className="text-text-secondary text-xs">
              Saved · {new Date(savedMock.submitted_at).toLocaleString(undefined, {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
              })}
            </p>
            <p className="text-text-muted text-[10px] mt-0.5">
              {myPicks.length} {userTeam} pick{myPicks.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>
        <button
          onClick={onRestart}
          className="font-display font-semibold text-[10px] uppercase tracking-[0.12em] px-3 py-1.5 rounded-lg border border-border-subtle text-text-secondary hover:border-border-focus hover:text-text-primary transition"
        >
          ← Back
        </button>
      </div>
      <div className="space-y-5">
        {rounds.map((r) => (
          <div key={r}>
            <div className="text-[10px] font-display font-semibold uppercase tracking-[0.16em] text-text-muted mb-2">
              {ROUND_LABELS[r] || `Round ${r}`} Round
            </div>
            <div className="space-y-1.5">
              {myPicksByRound[r].map((pick) => {
                const player = byId.get(pick.player_id) || pick;
                const color = posHex(player.position);
                return (
                  <div
                    key={pick.pick_number}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-accent/30 bg-accent/[0.05]"
                    style={{ borderLeft: `3px solid ${color}` }}
                  >
                    <span className="font-mono text-[9.5px] text-text-muted w-6 text-right shrink-0">
                      {pick.pick_number}
                    </span>
                    <TeamLogo abbr={pick.team} size="xs" />
                    <PlayerHeadshot url={player.headshot_url} name={player.name} position={player.position} size="xs" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12.5px] font-semibold truncate text-text-primary">
                        {player.name}
                      </div>
                      {player.school && (
                        <div className="text-[10px] text-text-muted truncate">{player.school}</div>
                      )}
                    </div>
                    <PositionBadge position={player.position} />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Post-draft Results View ──────────────────────────────────────────────────
// Shown right after the draft finishes but before the user saves. Mirrors the
// SavedView layout so users get a consistent "here's your picks" read, with a
// prominent Save CTA + optional title rename.
function ResultsView({
  team,
  picks,
  byId,
  userPicksMade,
  userSlotCount,
  saving,
  onSave,
  onRestart,
  onChangeTeam,
}) {
  const [title, setTitle] = useState(
    `${team} · ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
  );

  const byRound = useMemo(() => {
    const map = {};
    for (const p of picks) {
      if (!map[p.round]) map[p.round] = [];
      map[p.round].push(p);
    }
    return map;
  }, [picks]);
  const rounds = Object.keys(byRound).map(Number).sort((a, b) => a - b);

  const myPicksOnly = useMemo(() => picks.filter((p) => p.is_user), [picks]);

  return (
    <div
      className="flex flex-col"
      style={{ height: 'calc(100vh - 56px)', overflowY: 'auto' }}
    >
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
              {userPicksMade} picks made · {picks.length} total in draft
            </p>
          </div>
        </div>

        {/* ── Save card ── */}
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
              onClick={() => onSave(title.trim() || `${team} · ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`)}
              disabled={saving}
              className="shrink-0 font-display font-bold text-[11px] uppercase tracking-[0.14em] text-bg-deep rounded-lg px-4 py-2 transition hover:brightness-110 disabled:opacity-50"
              style={{ background: 'var(--gradient-accent)', boxShadow: '0 0 18px -6px rgba(0,229,255,0.55)' }}
            >
              {saving ? 'Saving…' : 'Save Mock'}
            </button>
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
              Change Team
            </button>
          </div>
        </div>

        {/* ── My Picks (highlighted block) ── */}
        {myPicksOnly.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center gap-2 mb-2">
              <TeamLogo abbr={team} size="xs" />
              <span className="font-display text-[11px] font-bold uppercase tracking-[0.14em] text-text-primary">
                Your {team} Picks
              </span>
              <span className="font-mono text-[10px] text-text-muted ml-auto">
                {userPicksMade} / {userSlotCount}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {myPicksOnly.map((pick) => {
                const player = byId.get(pick.player_id);
                if (!player) return null;
                const color = posHex(player.position);
                return (
                  <div
                    key={pick.pick_number}
                    className="flex items-center gap-2.5 p-2.5 rounded-lg border border-accent/30 bg-accent/[0.06]"
                    style={{ borderLeft: `3px solid ${color}` }}
                  >
                    <span className="font-mono text-[10px] text-text-muted w-10 text-right shrink-0">
                      {ROUND_LABELS[pick.round] || `R${pick.round}`} · {pick.pick_number}
                    </span>
                    <PlayerHeadshot url={player.headshot_url} name={player.name} position={player.position} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold truncate text-text-primary">
                        {player.name}
                      </div>
                      <div className="text-[10px] text-text-muted truncate">{player.school}</div>
                    </div>
                    <PositionBadge position={player.position} />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Full draft board, grouped by round ── */}
        <div className="mt-8 space-y-5">
          <div className="font-display text-[11px] font-bold uppercase tracking-[0.14em] text-text-primary">
            Full Draft Board
          </div>
          {rounds.map((r) => (
            <div key={r}>
              <div className="text-[10px] font-display font-semibold uppercase tracking-[0.16em] text-text-muted mb-2">
                {ROUND_LABELS[r] || `Round ${r}`} Round
              </div>
              <div className="space-y-1.5">
                {byRound[r].map((pick) => {
                  const player = byId.get(pick.player_id);
                  if (!player) return null;
                  const isUserPick = pick.is_user;
                  return (
                    <div
                      key={pick.pick_number}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border ${
                        isUserPick
                          ? 'border-accent/30 bg-accent/[0.05]'
                          : 'border-border-subtle bg-bg-surface/30'
                      }`}
                      style={isUserPick ? { borderLeft: `3px solid ${posHex(player.position)}` } : undefined}
                    >
                      <span className="font-mono text-[9.5px] text-text-muted w-6 text-right shrink-0">
                        {pick.pick_number}
                      </span>
                      {isUserPick ? (
                        <TeamLogo abbr={pick.team} size="xs" />
                      ) : (
                        <span className="font-display text-[9px] font-semibold uppercase tracking-wide text-text-muted w-7 shrink-0">
                          {pick.team}
                        </span>
                      )}
                      <PlayerHeadshot url={player.headshot_url} name={player.name} position={player.position} size="xs" />
                      <div className="flex-1 min-w-0">
                        <div className={`text-[12.5px] font-semibold truncate ${isUserPick ? 'text-text-primary' : 'text-text-secondary'}`}>
                          {player.name}
                        </div>
                        {player.school && (
                          <div className="text-[10px] text-text-muted truncate">{player.school}</div>
                        )}
                      </div>
                      <PositionBadge position={player.position} muted={!isUserPick} />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
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

// Speed slider tick → ms per bot pick. Index 0 = instant, higher = slower.
const SPEED_STEPS = [0, 150, 400, 800, 1500, 2500];
const SPEED_LABELS = ['Instant', 'Fast', 'Normal', 'Slow', 'Slower', 'Max 2.5s'];

function DraftSimulator({ team, players, draftOrder, onSaved, onChangeTeam }) {
  const { user } = useAuth();

  // Live draft order — initialized from props but mutable so trades can swap
  // team ownership mid-draft without losing simulation state.
  const [liveOrder, setLiveOrder] = useState(() =>
    [...draftOrder].sort((a, b) => a.pick_number - b.pick_number)
  );
  useEffect(() => {
    // Reset whenever the source draftOrder changes (e.g. team change round-trip)
    setLiveOrder([...draftOrder].sort((a, b) => a.pick_number - b.pick_number));
  }, [draftOrder]);

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const userSlotCount = useMemo(
    () => liveOrder.filter((s) => s.team === team).length,
    [liveOrder, team]
  );

  const [picks, setPicks] = useState([]); // sequential: [{pick_number, team, player_id, round, is_user}]
  const [phase, setPhase] = useState(PHASE_READY);
  const [randomness, setRandomness] = useState(0.15);
  const [speedIdx, setSpeedIdx] = useState(1); // default "Fast"
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

  // Rich Hill trade value chart — imported directly from the client bundle
  // so the modal is always ready without a fetch round-trip.
  const tradeValues = tradeValuesChart;

  const currentIdx = picks.length; // next slot to fill
  const currentSlot = currentIdx < liveOrder.length ? liveOrder[currentIdx] : null;
  const usedIds = useMemo(() => new Set(picks.map((p) => p.player_id)), [picks]);

  const userPicksMade = picks.filter((p) => p.is_user).length;

  // Main engine: drive bot picks forward while phase is running. When the slot
  // on the clock belongs to the user's team, flip phase to ON_CLOCK and halt.
  useEffect(() => {
    if (phase !== PHASE_RUNNING) return;
    if (!currentSlot) { setPhase(PHASE_DONE); return; }
    if (currentSlot.team === team) { setPhase(PHASE_ON_CLOCK); return; }

    const delay = SPEED_STEPS[speedIdx] ?? 150;
    const timer = setTimeout(() => {
      // Compute the live pool right now, pick, then advance.
      const taken = new Set(picks.map((p) => p.player_id));
      const available = players.filter((p) => !taken.has(p.id));
      const picked = pickForTeam({
        available,
        teamNeeds: currentSlot.team_needs || [],
        randomness,
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
  }, [phase, currentSlot, picks, players, team, randomness, speedIdx]);

  // ── Actions ────────────────────────────────────────────────────────────────
  function start() { setPhase(PHASE_RUNNING); }
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
    setPicks([]);
    setPhase(PHASE_READY);
    setLiveOrder([...draftOrder].sort((a, b) => a.pick_number - b.pick_number));
  }

  // Apply a trade: swap team ownership on the affected pick_numbers.
  // Only upcoming (not-yet-made) picks can change hands — past picks are locked.
  function applyTradeLocal({ partnerTeam, yourPicks, theirPicks }) {
    const yourSet = new Set(yourPicks);
    const theirSet = new Set(theirPicks);
    setLiveOrder((prev) =>
      prev.map((row) => {
        // Don't touch picks already made
        if (row.pick_number <= picks.length) return row;
        if (yourSet.has(row.pick_number)) return { ...row, team: partnerTeam };
        if (theirSet.has(row.pick_number)) return { ...row, team };
        return row;
      })
    );
  }

  async function handleSave(customTitle) {
    if (!user) { toast.error('Sign in to save'); return; }
    if (phase !== PHASE_DONE) return;
    const defaultTitle = `${team} · ${new Date().toLocaleDateString(undefined, {
      month: 'short', day: 'numeric',
    })}`;
    const title = (typeof customTitle === 'string' && customTitle.trim()) || defaultTitle;
    setSaving(true);
    try {
      const payload = picks.map((p) => ({
        pick_number: p.pick_number,
        player_id: p.player_id,
        round: p.round,
      }));
      await api.submitTeamMock(user.id, team, payload, title);
      toast.success('Team mock saved!');
      onSaved();
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
    let list = players;
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
  }, [players, showUsed, usedIds, posFilter, debouncedSearch]);

  // Draft history — most recent first so users see the latest pick at top
  const recentPicks = useMemo(() => [...picks].reverse(), [picks]);
  // Only the user's picks, in draft order (not reversed — small list, easier to
  // read chronologically so users can see their roster build out top to bottom)
  const myPicks = useMemo(() => picks.filter((p) => p.is_user), [picks]);

  // Mobile: resizable top panel
  const [topH, setTopH] = useState(() => {
    if (typeof window === 'undefined') return 220;
    const v = parseInt(localStorage.getItem('mds_team_top_h') || '', 10);
    return Number.isFinite(v) && v >= 60 && v <= 600 ? v : 220;
  });
  const [topCollapsed, setTopCollapsed] = useState(false);
  const [bottomCollapsed, setBottomCollapsed] = useState(false);
  const containerRef = useRef(null);
  const dragging = useRef(false);
  const dragStartY = useRef(0);
  const dragStartH = useRef(0);
  function onHandlePointerDown(e) {
    e.preventDefault();
    dragging.current = true;
    dragStartY.current = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
    dragStartH.current = topH;
    const onMove = (ev) => {
      if (!dragging.current) return;
      const y = ev.clientY ?? ev.touches?.[0]?.clientY ?? 0;
      const delta = y - dragStartY.current;
      const containerH = containerRef.current?.clientHeight ?? window.innerHeight;
      const newH = Math.max(60, Math.min(containerH - 120, dragStartH.current + delta));
      setTopH(newH);
      localStorage.setItem('mds_team_top_h', String(Math.round(newH)));
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  const FILTERS = ['ALL', ...POSITIONS];

  // ── Status banner (on the clock) ───────────────────────────────────────────
  function StatusBanner({ compact = false }) {
    if (phase === PHASE_READY) {
      return (
        <div className={`${compact ? 'px-3 py-2' : 'px-4 py-3'} flex items-center gap-3`}>
          <TeamLogo abbr={team} size={compact ? 'sm' : 'md'} />
          <div className="flex-1 min-w-0">
            <div className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
              Drafting for
            </div>
            <div className={`font-display font-bold ${compact ? 'text-[13px]' : 'text-[16px]'} text-text-primary truncate`}>
              {team} · {userSlotCount} picks
            </div>
          </div>
          <button
            onClick={start}
            className="shrink-0 font-display font-bold uppercase tracking-[0.14em] text-[11px] text-bg-deep rounded-lg px-4 py-2 transition hover:brightness-110 active:scale-[0.98]"
            style={{ background: 'var(--gradient-accent)', boxShadow: '0 0 18px -6px rgba(0,229,255,0.55)' }}
          >
            Start Mock Draft
          </button>
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
            {saving ? 'Saving…' : 'Save Mock'}
          </button>
        </div>
      );
    }
    // RUNNING or ON_CLOCK
    const isYou = phase === PHASE_ON_CLOCK;
    const slot = currentSlot;
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
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] font-mono text-text-muted">
            {picks.length}/{liveOrder.length}
          </div>
          <div className="text-[10px] font-mono text-accent">
            You: {userPicksMade}/{userSlotCount}
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
  // Dedicated results screen once the draft is complete — swaps the in-draft
  // two-panel layout for a "Mock complete" summary with save controls.
  if (phase === PHASE_DONE) {
    return (
      <ResultsView
        team={team}
        picks={picks}
        byId={byId}
        userPicksMade={userPicksMade}
        userSlotCount={userSlotCount}
        saving={saving}
        onSave={handleSave}
        onRestart={restart}
        onChangeTeam={onChangeTeam}
      />
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
                onClick={onChangeTeam}
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
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {recentPicks.length === 0 ? (
              <div className="text-center text-text-muted text-xs py-8">
                Click Start Mock Draft to begin
              </div>
            ) : (
              recentPicks.map(renderHistoryPick)
            )}
          </div>
          {/* Controls */}
          <div className="px-4 py-3 border-t border-border-subtle space-y-3">
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
            {/* Bot chaos slider */}
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
            {/* Pause / Resume / Trade */}
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
                  disabled={!tradeValues}
                  className="font-display font-semibold text-[10px] uppercase tracking-[0.12em] text-text-primary rounded-lg px-3 py-1.5 border border-accent/40 hover:bg-accent/[0.08] transition disabled:opacity-40"
                >
                  Propose Trade
                </button>
              )}
            </div>
            {phase !== PHASE_READY && (
              <button
                onClick={restart}
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
          <div className="px-4 py-2 flex items-center gap-2 border-b border-border-subtle">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={phase === PHASE_ON_CLOCK ? 'Search prospects…' : 'Prospects'}
              disabled={phase === PHASE_READY}
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
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setPosFilter(f)}
                className={`shrink-0 px-2 py-0.5 rounded-md font-display text-[10px] font-semibold uppercase tracking-[0.1em] transition ${
                  posFilter === f ? 'bg-accent text-bg-deep' : 'text-text-muted hover:text-text-primary'
                }`}
              >
                {f}
              </button>
            ))}
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
      <div ref={containerRef} className="flex flex-col md:hidden" style={{ flex: 1, overflow: 'hidden' }}>
        {/* Sticky status banner + inline controls at top */}
        <div className="border-b border-border-subtle shrink-0">
          <StatusBanner compact />
          {phase !== PHASE_READY && phase !== PHASE_DONE && (
            <div className="px-2 pb-2 space-y-1.5">
              {/* Row 1: Speed + Pause/Resume + Trade */}
              <div className="flex items-center gap-1.5">
                <div className="flex-1 flex items-center gap-1.5 min-w-0">
                  <span className="font-display text-[9px] font-semibold uppercase tracking-wider text-text-muted shrink-0 w-9">
                    Speed
                  </span>
                  <input
                    type="range" min="0" max={SPEED_STEPS.length - 1} step="1"
                    value={speedIdx}
                    onChange={(e) => setSpeedIdx(Number(e.target.value))}
                    className="flex-1 h-1 accent-accent cursor-pointer min-w-0"
                  />
                  <span className="font-mono text-[9px] text-text-muted w-11 text-right shrink-0">
                    {SPEED_LABELS[speedIdx]}
                  </span>
                </div>
                {phase === PHASE_RUNNING && (
                  <button onClick={pause} className="shrink-0 font-display text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border border-border-subtle text-text-primary">
                    Pause
                  </button>
                )}
                {phase === PHASE_PAUSED && (
                  <button onClick={resume} className="shrink-0 font-display text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-md text-bg-deep" style={{ background: 'var(--gradient-accent)' }}>
                    Resume
                  </button>
                )}
                <button
                  onClick={() => { if (phase === PHASE_RUNNING) setPhase(PHASE_PAUSED); setTradeOpen(true); }}
                  disabled={!tradeValues?.length}
                  className="shrink-0 font-display text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border border-accent/40 text-text-primary disabled:opacity-40"
                >
                  Trade
                </button>
              </div>
              {/* Row 2: Bot Chaos + Restart */}
              <div className="flex items-center gap-1.5">
                <div className="flex-1 flex items-center gap-1.5 min-w-0">
                  <span className="font-display text-[9px] font-semibold uppercase tracking-wider text-text-muted shrink-0 w-9">
                    Chaos
                  </span>
                  <input
                    type="range" min="0" max="1" step="0.05"
                    value={randomness}
                    onChange={(e) => setRandomness(Number(e.target.value))}
                    className="flex-1 h-1 accent-accent cursor-pointer min-w-0"
                  />
                  <span className="font-mono text-[9px] text-text-muted w-11 text-right shrink-0">
                    {Math.round(randomness * 100)}%
                  </span>
                </div>
                <button
                  onClick={restart}
                  className="shrink-0 font-display text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border border-border-subtle text-text-muted hover:text-text-primary"
                >
                  Restart
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Top: Draft history */}
        <div
          className="flex flex-col border-b border-border-subtle overflow-hidden"
          style={{ height: topCollapsed ? 40 : topH }}
        >
          <button
            onClick={() => setTopCollapsed((v) => !v)}
            className="flex items-center gap-2 px-3 h-10 shrink-0 border-b border-border-subtle"
          >
            <span className="font-display text-[11px] font-bold uppercase tracking-wider text-text-primary flex-1 text-left">
              Draft Board ({picks.length}/{liveOrder.length})
            </span>
            <span className="text-text-muted text-[10px]">{topCollapsed ? '▼' : '▲'}</span>
          </button>
          {!topCollapsed && (
            <div className="flex-1 overflow-y-auto overscroll-contain p-2 space-y-2">
              {/* My Picks — sticky sub-section */}
              {myPicks.length > 0 && (
                <div className="space-y-1 pb-1 border-b border-border-subtle">
                  <div className="flex items-center gap-1.5 px-1">
                    <TeamLogo abbr={team} size="xs" />
                    <span className="font-display text-[9px] font-bold uppercase tracking-wider text-text-muted flex-1">
                      My Picks
                    </span>
                    <span className="font-mono text-[9px] text-text-muted">
                      {myPicks.length}/{userSlotCount}
                    </span>
                  </div>
                  {myPicks.map(renderMyPick)}
                </div>
              )}
              {/* Everyone else's picks */}
              {recentPicks.length === 0 ? (
                <div className="text-center text-text-muted text-xs py-6">
                  Tap Start Mock Draft above to begin
                </div>
              ) : (
                <div className="space-y-1">
                  {myPicks.length > 0 && (
                    <div className="px-1 font-display text-[9px] font-bold uppercase tracking-wider text-text-muted">
                      Full Board
                    </div>
                  )}
                  {recentPicks.map(renderHistoryPick)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Drag handle */}
        {!topCollapsed && !bottomCollapsed && (
          <div
            onPointerDown={onHandlePointerDown}
            className="h-3 shrink-0 flex items-center justify-center cursor-row-resize touch-none z-10 bg-bg-deep"
          >
            <div className="w-10 h-0.5 rounded-full bg-border-subtle" />
          </div>
        )}

        {/* Bottom: Prospects */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <button
            onClick={() => setBottomCollapsed((v) => !v)}
            className="flex items-center gap-2 px-3 h-10 shrink-0 border-b border-border-subtle"
          >
            <span className="font-display text-[11px] font-bold uppercase tracking-wider text-text-primary flex-1 text-left">
              Prospects
            </span>
            <span className="text-text-muted text-[10px]">{bottomCollapsed ? '▼' : '▲'}</span>
          </button>
          {!bottomCollapsed && (
            <>
              <div className="px-3 py-2 flex gap-2 border-b border-border-subtle">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={phase === PHASE_ON_CLOCK ? 'Search prospects…' : 'Prospects'}
                  disabled={phase === PHASE_READY}
                  className="flex-1 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[12px] text-text-primary placeholder-text-muted focus:border-accent/60 outline-none transition disabled:opacity-50"
                />
                <label className="flex items-center gap-1 shrink-0 text-[9.5px] font-display uppercase tracking-[0.1em] text-text-muted cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showUsed}
                    onChange={(e) => setShowUsed(e.target.checked)}
                    className="w-3.5 h-3.5 accent-accent cursor-pointer"
                  />
                  Drafted
                </label>
              </div>
              <div className="flex gap-1 px-3 py-1.5 overflow-x-auto scrollbar-none border-b border-border-subtle">
                {FILTERS.map((f) => (
                  <button
                    key={f}
                    onClick={() => setPosFilter(f)}
                    className={`shrink-0 px-2 py-0.5 rounded-md font-display text-[10px] font-semibold uppercase tracking-[0.1em] transition ${
                      posFilter === f ? 'bg-accent text-bg-deep' : 'text-text-muted hover:text-text-primary'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <ul className="flex-1 overflow-y-auto overscroll-contain p-2 space-y-1">
                {filteredProspects.map(renderProspect)}
              </ul>
            </>
          )}
        </div>
      </div>

      {/* ── Trade modal ── */}
      {tradeOpen && tradeValues?.length > 0 && (
        <TradeModal
          userTeam={team}
          liveOrder={liveOrder}
          picksMadeCount={picks.length}
          onClockTeam={currentSlot?.team}
          tradeValues={tradeValues}
          onClose={() => setTradeOpen(false)}
          onAccepted={(swap) => {
            applyTradeLocal(swap);
            setTradeOpen(false);
            toast.success('Trade accepted!');
            if (phase === PHASE_PAUSED) setPhase(PHASE_RUNNING);
          }}
        />
      )}
    </div>
  );
}

// ─── Trade Modal ──────────────────────────────────────────────────────────────
// Pure client-side trade proposal using the Rich Hill value chart. User picks
// which of their future picks go out and which incoming picks they want in
// return. Bot auto-accepts if the incoming value is >= outgoing * 0.92 (bot
// wants a slight win); otherwise it counters with rejection.
function TradeModal({ userTeam, liveOrder, picksMadeCount, onClockTeam, tradeValues, onClose, onAccepted }) {
  // Quick lookup pick_number → value
  const valueMap = useMemo(() => {
    const m = new Map();
    for (const r of tradeValues) m.set(r.pick, r.value);
    return m;
  }, [tradeValues]);

  // Future (not-yet-made) picks grouped by team
  const futurePicks = useMemo(
    () => liveOrder.filter((s) => s.pick_number > picksMadeCount),
    [liveOrder, picksMadeCount]
  );
  const myFuturePicks = useMemo(
    () => futurePicks.filter((s) => s.team === userTeam),
    [futurePicks, userTeam]
  );
  // Partner teams sorted by their NEXT pick (soonest-on-the-clock first). This
  // also puts the current on-clock team at the top of the row.
  const otherTeams = useMemo(() => {
    const nextPickByTeam = new Map();
    for (const s of futurePicks) {
      if (s.team === userTeam) continue;
      if (!nextPickByTeam.has(s.team)) nextPickByTeam.set(s.team, s.pick_number);
    }
    return [...nextPickByTeam.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([t]) => t);
  }, [futurePicks, userTeam]);

  // Default to whoever is currently on the clock (that's why the user opened
  // the modal — to trade up before the bot grabs their guy). If the user is
  // on the clock themselves, fall back to the next team after them.
  const initialPartner = useMemo(() => {
    if (onClockTeam && onClockTeam !== userTeam) return onClockTeam;
    return otherTeams[0] || null;
  }, [onClockTeam, userTeam, otherTeams]);

  const [partnerTeam, setPartnerTeam] = useState(initialPartner);
  const [yourSelected, setYourSelected] = useState(new Set());
  const [theirSelected, setTheirSelected] = useState(new Set());

  // Reset their selection when partner changes
  useEffect(() => { setTheirSelected(new Set()); }, [partnerTeam]);

  const partnerFuturePicks = useMemo(
    () => futurePicks.filter((s) => s.team === partnerTeam),
    [futurePicks, partnerTeam]
  );

  const yourTotal = [...yourSelected].reduce((n, p) => n + (valueMap.get(p) ?? 0), 0);
  const theirTotal = [...theirSelected].reduce((n, p) => n + (valueMap.get(p) ?? 0), 0);
  const diff = theirTotal - yourTotal;
  const max = Math.max(yourTotal, theirTotal, 1);
  const pctDiff = Math.round((Math.abs(diff) / max) * 1000) / 10;

  // Verdict (for the user's view): positive diff = favors you
  let verdict;
  if (pctDiff <= 5) verdict = 'fair';
  else if (pctDiff <= 15) verdict = 'slight_lean';
  else verdict = 'lopsided';

  // Bot accepts if they get >= 92% of outgoing value. More generous with
  // higher randomness would be nice but keep simple for V1.
  function handlePropose() {
    if (yourSelected.size === 0 || theirSelected.size === 0) {
      toast.error('Select picks from both sides');
      return;
    }
    // Bot perspective: bot gives up "their" picks, receives "your" picks.
    // Bot is happy if yourTotal >= theirTotal * 0.92 (≤ 8% loss for bot).
    const botHappy = yourTotal >= theirTotal * 0.92;
    if (!botHappy) {
      toast.error(`${partnerTeam} rejects — you need to add more value`);
      return;
    }
    onAccepted({
      partnerTeam,
      yourPicks: [...yourSelected],
      theirPicks: [...theirSelected],
    });
  }

  function togglePick(set, setter, pickNum) {
    const next = new Set(set);
    if (next.has(pickNum)) next.delete(pickNum);
    else next.add(pickNum);
    setter(next);
  }

  function pickButton(slot, selected, onClick) {
    const value = valueMap.get(slot.pick_number) ?? 0;
    return (
      <button
        key={slot.pick_number}
        onClick={onClick}
        className={`text-left px-2 py-1.5 rounded-md border text-[11px] transition ${
          selected
            ? 'border-accent bg-accent/[0.1] text-text-primary'
            : 'border-border-subtle bg-bg-surface/40 text-text-secondary hover:border-border-focus'
        }`}
      >
        <div className="font-mono font-semibold">
          #{slot.pick_number} <span className="text-text-muted">· R{slot.round}</span>
        </div>
        <div className="text-[9.5px] text-text-muted">val {value}</div>
      </button>
    );
  }

  const verdictColor =
    verdict === 'fair'
      ? '#22c55e'
      : verdict === 'slight_lean'
      ? '#eab308'
      : '#ef4444';
  const verdictText =
    verdict === 'fair'
      ? 'Fair Trade'
      : verdict === 'slight_lean'
      ? 'Slight Lean'
      : 'Lopsided';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[90vh] rounded-2xl border border-border-subtle bg-bg-deep flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border-subtle flex items-center justify-between">
          <div>
            <h2 className="font-display text-[16px] font-bold uppercase tracking-[0.1em] text-text-primary">
              Propose Trade
            </h2>
            <p className="text-[10.5px] text-text-muted">Rich Hill value chart</p>
          </div>
          <button
            onClick={onClose}
            className="font-display text-[11px] uppercase tracking-wider text-text-muted hover:text-text-primary transition px-2 py-1"
          >
            Close
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Partner team selector */}
          <div>
            <div className="font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted mb-2">
              Trade With
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {otherTeams.map((abbr) => (
                <button
                  key={abbr}
                  onClick={() => setPartnerTeam(abbr)}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10px] font-display font-semibold uppercase tracking-wider transition ${
                    partnerTeam === abbr
                      ? 'border-accent bg-accent/[0.1] text-text-primary'
                      : 'border-border-subtle text-text-secondary hover:border-border-focus'
                  }`}
                >
                  <TeamLogo abbr={abbr} size="xs" />
                  {abbr}
                </button>
              ))}
            </div>
          </div>

          {/* Two sides */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* You give */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <TeamLogo abbr={userTeam} size="xs" />
                <span className="font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                  You Give
                </span>
                <span className="ml-auto font-mono text-[11px] text-text-primary">{yourTotal}</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 max-h-60 overflow-y-auto pr-1">
                {myFuturePicks.map((s) =>
                  pickButton(s, yourSelected.has(s.pick_number), () =>
                    togglePick(yourSelected, setYourSelected, s.pick_number)
                  )
                )}
                {myFuturePicks.length === 0 && (
                  <div className="col-span-3 text-[11px] text-text-muted py-2">
                    No remaining picks.
                  </div>
                )}
              </div>
            </div>
            {/* You get */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <TeamLogo abbr={partnerTeam} size="xs" />
                <span className="font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                  You Get
                </span>
                <span className="ml-auto font-mono text-[11px] text-text-primary">{theirTotal}</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 max-h-60 overflow-y-auto pr-1">
                {partnerFuturePicks.map((s) =>
                  pickButton(s, theirSelected.has(s.pick_number), () =>
                    togglePick(theirSelected, setTheirSelected, s.pick_number)
                  )
                )}
                {partnerFuturePicks.length === 0 && (
                  <div className="col-span-3 text-[11px] text-text-muted py-2">
                    No picks remaining.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Verdict */}
          {(yourSelected.size > 0 || theirSelected.size > 0) && (
            <div className="flex items-center gap-3 p-3 rounded-lg border border-border-subtle bg-bg-surface/40">
              <div
                className="w-2 h-10 rounded-full shrink-0"
                style={{ background: verdictColor }}
              />
              <div className="flex-1">
                <div
                  className="font-display text-[12px] font-bold uppercase tracking-[0.12em]"
                  style={{ color: verdictColor }}
                >
                  {verdictText}
                </div>
                <div className="text-[10.5px] text-text-muted">
                  {diff > 0
                    ? `Favors you by ${pctDiff}%`
                    : diff < 0
                    ? `Favors ${partnerTeam} by ${pctDiff}%`
                    : 'Even value'}
                </div>
              </div>
              <div className="text-right text-[10.5px] font-mono text-text-muted">
                {yourTotal} ↔ {theirTotal}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border-subtle flex gap-2">
          <button
            onClick={onClose}
            className="font-display font-semibold text-[11px] uppercase tracking-[0.12em] text-text-secondary rounded-lg px-4 py-2 border border-border-subtle hover:border-border-focus transition"
          >
            Cancel
          </button>
          <button
            onClick={handlePropose}
            disabled={yourSelected.size === 0 || theirSelected.size === 0}
            className="flex-1 font-display font-bold text-[11px] uppercase tracking-[0.14em] text-bg-deep rounded-lg px-4 py-2 transition hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'var(--gradient-accent)' }}
          >
            Propose to {partnerTeam || '—'}
          </button>
        </div>
      </div>
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
                  {m.pick_count} picks
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
  const { user } = useAuth();
  const nav = useNavigate();
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
    Promise.all([api.getPlayers(), api.getDraftOrderAll({ fresh: true })])
      .then(([pl, order]) => {
        setPlayers(pl);
        setDraftOrder(order);
      })
      .catch(() => {
        setPlayers([]);
        setDraftOrder([]);
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

  function handleTeamSelect(abbr) {
    if (!user) { nav('/join'); return; }
    setTeam(abbr);
  }

  function handleSaved() {
    // Refresh list, drop out of draft mode
    setTeam(null);
    loadSavedMocks();
  }

  async function handleOpen(mockSummary) {
    // Fetch full picks for the clicked mock
    try {
      const full = await api.getTeamMockById(mockSummary.id);
      setActiveMock(full);
    } catch (e) {
      console.error('[open team mock]', e);
    }
  }

  async function handleDelete(mockSummary) {
    const ok = window.confirm(`Delete "${mockSummary.title || mockSummary.team_abbr + ' Mock'}"?`);
    if (!ok) return;
    try {
      await api.deleteTeamMock(mockSummary.id);
      loadSavedMocks();
      if (activeMock?.id === mockSummary.id) setActiveMock(null);
    } catch (e) {
      console.error('[delete team mock]', e);
    }
  }

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

  // 1) Actively drafting
  if (team) {
    return (
      <div className="flex flex-col" style={{ height: 'calc(100vh - 56px)', overflow: 'hidden' }}>
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

  // 2) Viewing a saved mock
  if (activeMock) {
    return (
      <div className="flex flex-col" style={{ height: 'calc(100vh - 56px)', overflowY: 'auto' }}>
        <SavedView
          savedMock={activeMock}
          players={players}
          onRestart={() => setActiveMock(null)}
        />
      </div>
    );
  }

  // 3) Explicit "new mock" picker
  if (showPickerExplicit || savedMocks.length === 0) {
    return (
      <div style={{ minHeight: 'calc(100vh - 56px)', overflowY: 'auto' }}>
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
    <div style={{ minHeight: 'calc(100vh - 56px)', overflowY: 'auto' }}>
      <SavedMocksList
        mocks={savedMocks}
        onOpen={handleOpen}
        onDelete={handleDelete}
        onNew={startNew}
      />
    </div>
  );
}
