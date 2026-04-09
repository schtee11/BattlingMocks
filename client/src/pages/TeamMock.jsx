import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { simulateDraft } from '../lib/botPicker.js';
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

// ─── Sub-components ───────────────────────────────────────────────────────────
function OrdinalPick({ pick }) {
  const label = ROUND_LABELS[pick.round] || `R${pick.round}`;
  return (
    <span className="font-mono text-[10px] text-text-muted">
      {label} · #{pick.pick_number}
    </span>
  );
}

function PickSlotCard({ pick, isActive, onClick, player }) {
  const color = player ? posHex(player.position) : undefined;
  const filled = !!player;
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-lg border transition-all duration-150 ${
        isActive
          ? 'border-accent bg-accent/[0.08] shadow-glow'
          : filled
          ? 'border-border-subtle bg-bg-elevated/60 hover:border-border-focus'
          : 'border-dashed border-border-subtle bg-bg-surface/30 hover:border-accent/50'
      }`}
      style={filled && !isActive ? { borderLeft: `3px solid ${color}` } : undefined}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <OrdinalPick pick={pick} />
        {filled ? (
          <>
            <PlayerHeadshot
              url={player.headshot_url}
              name={player.name}
              position={player.position}
              size="xs"
            />
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-semibold truncate text-text-primary">{player.name}</div>
              <div className="text-[10px] text-text-muted truncate">{player.school}</div>
            </div>
            <PositionBadge position={player.position} />
          </>
        ) : (
          <span className={`text-[12px] flex-1 ${isActive ? 'text-accent font-semibold' : 'text-text-muted'}`}>
            {isActive ? 'Select a prospect →' : 'Empty'}
          </span>
        )}
      </div>
    </button>
  );
}

function ProspectRow({ player, used, onClick }) {
  return (
    <li
      onClick={() => !used && onClick(player)}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all duration-150 cursor-pointer ${
        used
          ? 'border-transparent opacity-35 cursor-not-allowed'
          : 'border-border-subtle bg-bg-surface/40 hover:border-border-focus hover:bg-white/[0.03]'
      }`}
    >
      <span className="font-mono text-[10px] text-text-muted w-5 shrink-0 text-right">
        {player.rank ?? ''}
      </span>
      <PlayerHeadshot url={player.headshot_url} name={player.name} position={player.position} size="xs" />
      <div className="flex-1 min-w-0">
        <div className={`text-[13px] font-semibold truncate ${used ? 'line-through text-text-muted' : 'text-text-primary'}`}>
          {player.name}
        </div>
        <div className="text-[10.5px] text-text-muted truncate">{player.school}</div>
      </div>
      <PositionBadge position={player.position} muted={used} />
    </li>
  );
}

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
  const byTeam = savedMock.picks.filter((p) => p.is_user !== false);
  // savedMock.picks are already filtered when we show only "user" picks... actually
  // the saved mock stores all picks. We need to know which picks are the user's team.
  // The team_abbr is stored on savedMock. For display, let's show all picks grouped by round.
  const byRound = useMemo(() => {
    const map = {};
    for (const p of savedMock.picks) {
      if (!map[p.round]) map[p.round] = [];
      map[p.round].push(p);
    }
    return map;
  }, [savedMock.picks]);

  const rounds = Object.keys(byRound).map(Number).sort((a, b) => a - b);
  const userTeam = savedMock.team_abbr;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <TeamLogo abbr={userTeam} size="lg" />
          <div>
            <h2 className="font-display text-xl font-bold uppercase tracking-[0.1em] text-text-primary">
              Your Team Mock
            </h2>
            <p className="text-text-secondary text-xs">
              Saved · {new Date(savedMock.submitted_at).toLocaleDateString()}
            </p>
          </div>
        </div>
        <button
          onClick={onRestart}
          className="font-display font-semibold text-[10px] uppercase tracking-[0.12em] px-3 py-1.5 rounded-lg border border-border-subtle text-text-secondary hover:border-border-focus hover:text-text-primary transition"
        >
          Start Over
        </button>
      </div>
      <div className="space-y-5">
        {rounds.map((r) => (
          <div key={r}>
            <div className="text-[10px] font-display font-semibold uppercase tracking-[0.16em] text-text-muted mb-2">
              {ROUND_LABELS[r] || `Round ${r}`} Round
            </div>
            <div className="space-y-1.5">
              {byRound[r].map((pick) => {
                const player = byId.get(pick.player_id) || pick;
                const isUserPick = pick.team === userTeam;
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
                    <span className="font-mono text-[9.5px] text-text-muted w-5 text-right shrink-0">
                      {pick.pick_number}
                    </span>
                    {isUserPick && (
                      <TeamLogo abbr={pick.team} size="xs" />
                    )}
                    {!isUserPick && (
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
  );
}

// ─── Draft Simulator ──────────────────────────────────────────────────────────
function DraftSimulator({ team, players, draftOrder, savedPicks, onSaved, onChangeTeam }) {
  // userDraft: pick_number → player_id
  const [userDraft, setUserDraft] = useState(() => {
    if (!savedPicks) return {};
    // Re-hydrate only the user team's picks
    const map = {};
    for (const p of savedPicks) {
      if (p.team === team && p.player_id) map[p.pick_number] = p.player_id;
    }
    return map;
  });
  const [activeSlot, setActiveSlot] = useState(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim().toLowerCase()), 200);
    return () => clearTimeout(t);
  }, [search]);
  const [posFilter, setPosFilter] = useState('ALL');
  const [randomness, setRandomness] = useState(0.15);
  const [busy, setSaving] = useState(false);

  // User's pick slots
  const userSlots = useMemo(
    () => draftOrder.filter((s) => s.team === team).sort((a, b) => a.pick_number - b.pick_number),
    [draftOrder, team]
  );

  // Run bot simulation any time userDraft changes or randomness changes
  const simulation = useMemo(
    () => simulateDraft({ draftOrder, players, userTeam: team, userPicks: userDraft, randomness }),
    [draftOrder, players, team, userDraft, randomness]
  );

  // Set of player_ids already used (bot picks + user picks)
  const usedIds = useMemo(() => {
    const s = new Set();
    for (const p of simulation) {
      if (p.player_id) s.add(p.player_id);
    }
    return s;
  }, [simulation]);

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  // Auto-select next empty user slot when no slot is active
  useEffect(() => {
    if (activeSlot !== null) return;
    const next = userSlots.find((s) => !userDraft[s.pick_number]);
    if (next) setActiveSlot(next.pick_number);
  }, [userDraft, userSlots, activeSlot]);

  const filledCount = userSlots.filter((s) => userDraft[s.pick_number]).length;
  const allFilled = filledCount === userSlots.length;

  function assignPlayer(player) {
    if (!activeSlot) return;
    if (usedIds.has(player.id)) { toast.error('Player already drafted'); return; }
    setUserDraft((prev) => ({ ...prev, [activeSlot]: player.id }));
    // Advance to next empty slot
    const idx = userSlots.findIndex((s) => s.pick_number === activeSlot);
    const next = userSlots.slice(idx + 1).find((s) => !userDraft[s.pick_number] && s.pick_number !== activeSlot);
    setActiveSlot(next ? next.pick_number : null);
  }

  function clearSlot(pickNum) {
    setUserDraft((prev) => {
      const next = { ...prev };
      delete next[pickNum];
      return next;
    });
    setActiveSlot(pickNum);
  }

  async function handleSave() {
    const { user } = useAuthRef.current;
    if (!user) { toast.error('Sign in to save'); return; }
    if (!allFilled) { toast.error('Fill all your picks first'); return; }
    setSaving(true);
    try {
      // Build full picks list: user picks + bot picks from simulation
      const picks = simulation
        .filter((p) => p.player_id !== null)
        .map((p) => ({ pick_number: p.pick_number, player_id: p.player_id, round: p.round }));
      await api.submitTeamMock(user.id, team, picks);
      toast.success('Team mock saved!');
      onSaved();
    } catch (e) {
      toast.error(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  // useAuth in event handler — store ref to avoid stale closure
  const { user } = useAuth();
  const useAuthRef = useRef({ user });
  useEffect(() => { useAuthRef.current = { user }; }, [user]);

  // Filtered prospect list
  const filteredPlayers = useMemo(() => {
    let list = players;
    if (posFilter !== 'ALL') list = list.filter((p) => p.position === posFilter);
    if (debouncedSearch) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(debouncedSearch) ||
          p.school?.toLowerCase().includes(debouncedSearch)
      );
    }
    return list;
  }, [players, posFilter, debouncedSearch]);

  // Mobile: top panel height
  const [topH, setTopH] = useState(() => {
    if (typeof window === 'undefined') return 240;
    const v = parseInt(localStorage.getItem('mds_team_top_h') || '', 10);
    return Number.isFinite(v) && v >= 60 && v <= 600 ? v : 240;
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

  return (
    <div className="flex flex-col h-full">
      {/* ── Desktop ── */}
      <div className="hidden md:flex flex-1 overflow-hidden gap-0">
        {/* Left: Your picks */}
        <div className="w-80 shrink-0 flex flex-col border-r border-border-subtle overflow-hidden">
          <div className="px-4 py-3 border-b border-border-subtle flex items-center gap-2.5">
            <TeamLogo abbr={team} size="sm" />
            <div className="flex-1 min-w-0">
              <div className="font-display text-[12px] font-bold uppercase tracking-[0.14em] text-text-primary">
                Your Picks
              </div>
              <div className="text-[10px] text-text-muted">{filledCount} / {userSlots.length} filled</div>
            </div>
            <button
              onClick={onChangeTeam}
              className="text-[10px] font-display uppercase tracking-wider text-text-muted hover:text-text-primary transition"
            >
              Change
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
            {userSlots.map((slot) => {
              const pid = userDraft[slot.pick_number];
              const player = pid ? byId.get(pid) : null;
              return (
                <PickSlotCard
                  key={slot.pick_number}
                  pick={slot}
                  isActive={activeSlot === slot.pick_number}
                  player={player}
                  onClick={() => {
                    if (activeSlot === slot.pick_number) { clearSlot(slot.pick_number); }
                    else { setActiveSlot(slot.pick_number); }
                  }}
                />
              );
            })}
          </div>
          {/* Progress + Save */}
          <div className="px-4 py-3 border-t border-border-subtle space-y-2">
            <div className="flex justify-between text-[10px] text-text-muted mb-1">
              <span>Progress</span>
              <span>{filledCount}/{userSlots.length}</span>
            </div>
            <div className="h-1.5 rounded-full bg-bg-elevated overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${(filledCount / Math.max(1, userSlots.length)) * 100}%`, background: 'var(--gradient-accent)' }}
              />
            </div>
            {/* Randomness slider */}
            <div className="pt-1">
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
            <button
              onClick={handleSave}
              disabled={!allFilled || busy}
              className="w-full mt-1 font-display font-semibold text-[11px] uppercase tracking-[0.12em] text-bg-deep rounded-lg px-4 py-2.5 transition hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'var(--gradient-accent)' }}
            >
              {busy ? 'Saving…' : allFilled ? 'Save Mock' : `${userSlots.length - filledCount} picks left`}
            </button>
          </div>
        </div>

        {/* Right: Prospect pool */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-border-subtle flex items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search prospects…"
              className="flex-1 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[12px] text-text-primary placeholder-text-muted focus:border-accent/60 outline-none transition"
            />
          </div>
          {/* Position filter */}
          <div className="flex gap-1 px-4 py-2 overflow-x-auto scrollbar-none border-b border-border-subtle">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setPosFilter(f)}
                className={`shrink-0 px-2 py-0.5 rounded-md font-display text-[10px] font-semibold uppercase tracking-[0.1em] transition ${
                  posFilter === f
                    ? 'bg-accent text-bg-deep'
                    : 'text-text-muted hover:text-text-primary'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <ul className="flex-1 overflow-y-auto p-3 space-y-1">
            {filteredPlayers.map((p) => (
              <ProspectRow key={p.id} player={p} used={usedIds.has(p.id)} onClick={assignPlayer} />
            ))}
            {filteredPlayers.length === 0 && (
              <li className="text-center text-text-muted text-sm py-12">No prospects match</li>
            )}
          </ul>
        </div>
      </div>

      {/* ── Mobile ── */}
      <div ref={containerRef} className="flex flex-col md:hidden" style={{ flex: 1, overflow: 'hidden' }}>
        {/* Top: Your picks */}
        <div
          className="flex flex-col border-b border-border-subtle overflow-hidden"
          style={{ height: topCollapsed ? 40 : topH }}
        >
          {/* Header */}
          <button
            onClick={() => setTopCollapsed((v) => !v)}
            className="flex items-center gap-2 px-3 h-10 shrink-0 border-b border-border-subtle"
          >
            <TeamLogo abbr={team} size="xs" />
            <span className="font-display text-[11px] font-bold uppercase tracking-wider text-text-primary flex-1">
              Your Picks ({filledCount}/{userSlots.length})
            </span>
            <span className="text-text-muted text-[10px]">{topCollapsed ? '▼' : '▲'}</span>
          </button>
          {!topCollapsed && (
            <div className="flex-1 overflow-y-auto overscroll-contain p-2 space-y-1.5">
              {userSlots.map((slot) => {
                const pid = userDraft[slot.pick_number];
                const player = pid ? byId.get(pid) : null;
                return (
                  <PickSlotCard
                    key={slot.pick_number}
                    pick={slot}
                    isActive={activeSlot === slot.pick_number}
                    player={player}
                    onClick={() => {
                      if (activeSlot === slot.pick_number) clearSlot(slot.pick_number);
                      else setActiveSlot(slot.pick_number);
                    }}
                  />
                );
              })}
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
            <span className="font-display text-[11px] font-bold uppercase tracking-wider text-text-primary flex-1">
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
                  placeholder="Search prospects…"
                  className="flex-1 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[12px] text-text-primary placeholder-text-muted focus:border-accent/60 outline-none transition"
                />
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
                {filteredPlayers.map((p) => (
                  <ProspectRow key={p.id} player={p} used={usedIds.has(p.id)} onClick={assignPlayer} />
                ))}
              </ul>
              {/* Mobile save bar */}
              <div className="px-3 py-2 border-t border-border-subtle flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-bg-elevated overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${(filledCount / Math.max(1, userSlots.length)) * 100}%`, background: 'var(--gradient-accent)' }}
                  />
                </div>
                <button
                  onClick={handleSave}
                  disabled={!allFilled || busy}
                  className="shrink-0 font-display font-semibold text-[10px] uppercase tracking-[0.12em] text-bg-deep rounded-lg px-3 py-2 transition hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: 'var(--gradient-accent)' }}
                >
                  {busy ? 'Saving…' : allFilled ? 'Save' : `${userSlots.length - filledCount} left`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Page Shell ───────────────────────────────────────────────────────────────
export default function TeamMock() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [players, setPlayers] = useState(null);
  const [draftOrder, setDraftOrder] = useState(null);
  const [savedMock, setSavedMock] = useState(undefined); // undefined = loading, null = none
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

  // Load saved team mock if user is signed in
  useEffect(() => {
    if (!user) { setSavedMock(null); return; }
    api.getTeamMock(user.id)
      .then((m) => setSavedMock(m))
      .catch(() => setSavedMock(null));
  }, [user]);

  function handleTeamSelect(abbr) {
    if (!user) { nav('/join'); return; }
    // draftOrder is guaranteed loaded by the time the grid renders (loading gate above)
    setTeam(abbr);
  }

  function handleSaved() {
    // Reload saved mock
    if (user) {
      api.getTeamMock(user.id).then(setSavedMock).catch(() => setSavedMock(null));
    }
    setTeam(null);
  }

  async function handleRestart() {
    if (!user) return;
    try {
      await api.deleteTeamMock(user.id);
    } catch { /* already gone */ }
    setSavedMock(null);
    setTeam(null);
  }

  const loading = players === null || draftOrder === null || savedMock === undefined;

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

  // Show saved mock (unless user clicked Change Team)
  if (savedMock && !team) {
    return (
      <div
        className="flex flex-col"
        style={{ height: 'calc(100vh - 56px)', overflowY: 'auto' }}
      >
        <SavedView savedMock={savedMock} players={players} onRestart={handleRestart} />
      </div>
    );
  }

  // Show draft simulator
  if (team) {
    return (
      <div
        className="flex flex-col"
        style={{ height: 'calc(100vh - 56px)', overflow: 'hidden' }}
      >
        <DraftSimulator
          team={team}
          players={players}
          draftOrder={draftOrder}
          savedPicks={savedMock?.picks ?? null}
          onSaved={handleSaved}
          onChangeTeam={() => setTeam(null)}
        />
      </div>
    );
  }

  // Show team picker
  return (
    <div style={{ minHeight: 'calc(100vh - 56px)', overflowY: 'auto' }}>
      <TeamPicker onSelect={handleTeamSelect} draftOrder={draftOrder} onRefresh={loadData} />
    </div>
  );
}
