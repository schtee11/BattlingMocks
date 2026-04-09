import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { DndContext, PointerSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core';

// Keep the drag overlay centered under the cursor.
// Uses draggingNodeRect (the live rect of the dragged element), NOT the
// activator target's rect — the target can be a nested child like a badge
// and would give the wrong origin.
function snapCenterToCursor({ activatorEvent, draggingNodeRect, transform }) {
  if (!draggingNodeRect || !activatorEvent) return transform;
  const ax =
    activatorEvent.clientX ??
    activatorEvent.touches?.[0]?.clientX ??
    activatorEvent.changedTouches?.[0]?.clientX;
  const ay =
    activatorEvent.clientY ??
    activatorEvent.touches?.[0]?.clientY ??
    activatorEvent.changedTouches?.[0]?.clientY;
  if (ax == null || ay == null) return transform;
  const offsetX = ax - draggingNodeRect.left;
  const offsetY = ay - draggingNodeRect.top;
  return {
    ...transform,
    x: transform.x + offsetX - draggingNodeRect.width / 2,
    y: transform.y + offsetY - draggingNodeRect.height / 2,
  };
}
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { POSITIONS, posHex } from '../lib/positions.js';
import { PickSlot } from '../components/PickSlot.jsx';
import { ProspectCard } from '../components/ProspectCard.jsx';
import { Card } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { ProgressBar } from '../components/ui/ProgressBar.jsx';
import { TeamLogo } from '../components/ui/TeamLogo.jsx';
import { PlayerHeadshot } from '../components/ui/PlayerHeadshot.jsx';
import { PositionBadge } from '../components/ui/Badge.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';

const FILTERS = ['ALL', ...POSITIONS];

export default function Draft() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [players, setPlayers] = useState(null);
  const [draftOrder, setDraftOrder] = useState([]);
  const [settings, setSettings] = useState(null);
  const [picks, setPicks] = useState({});
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [activeDragId, setActiveDragId] = useState(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim().toLowerCase()), 220);
    return () => clearTimeout(t);
  }, [search]);
  const [posFilter, setPosFilter] = useState('ALL');
  const [view, setView] = useState('bigboard');
  const [showConfirm, setShowConfirm] = useState(false);
  const [showClearAll, setShowClearAll] = useState(false);
  // Mobile: which pick slot is currently being drafted for. Always non-null
  // on mobile once data has loaded — initialized from on-the-clock.
  const [draftingForSlot, setDraftingForSlot] = useState(null);
  // Mobile: top "Your Board" panel collapse state. Default collapsed so the
  // bottom prospect list owns most of the viewport.
  const [boardExpanded, setBoardExpanded] = useState(false);
  const boardRowRefs = useRef({}); // pick_number → li element, for scroll-into-view
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Reactive isMobile flag — branches the slot click behavior.
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!user) { nav('/join'); return; }
    (async () => {
      try {
        const [p, o, s] = await Promise.all([
          api.getPlayers(),
          api.getDraftOrder(),
          api.getSettings(),
        ]);
        setPlayers(p);
        setDraftOrder(o);
        setSettings(s);
        try {
          const m = await api.getMock(user.id);
          const map = {};
          m.picks.forEach((pk) => (map[pk.pick_number] = pk.player_id));
          setPicks(map);
          setSubmitted(true);
        } catch { /* no existing mock */ }
      } catch (e) {
        toast.error('Failed to load: ' + e.message);
      }
    })();
  }, [user, nav]);

  const playerById = useMemo(() => {
    const m = new Map();
    (players || []).forEach((p) => m.set(p.id, p));
    return m;
  }, [players]);

  const orderByPick = useMemo(() => {
    const m = new Map();
    draftOrder.forEach((o) => m.set(o.pick_number, o));
    return m;
  }, [draftOrder]);

  const usedPlayerIds = useMemo(() => new Set(Object.values(picks)), [picks]);
  const filledCount = Object.keys(picks).length;
  const locked = !!settings?.is_locked;
  const complete = filledCount === 32;

  // "On the clock" = lowest pick number with no assignment yet
  const onClockSlot = useMemo(() => {
    for (let i = 1; i <= 32; i++) if (!picks[i]) return i;
    return null;
  }, [picks]);

  // On mobile, ensure draftingForSlot is always set so the prospect list
  // knows what pick it's drafting for. Defaults to on-the-clock when null.
  useEffect(() => {
    if (!isMobile) return;
    if (draftingForSlot == null && onClockSlot != null) {
      setDraftingForSlot(onClockSlot);
    }
  }, [isMobile, draftingForSlot, onClockSlot]);

  // Mobile: when the active pick changes, scroll its row into view inside the
  // top board panel. Centers it whether the panel is collapsed or expanded.
  useEffect(() => {
    if (!isMobile || draftingForSlot == null) return;
    const el = boardRowRefs.current[draftingForSlot];
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    }
  }, [isMobile, draftingForSlot, boardExpanded]);

  const filteredProspects = useMemo(() => {
    const list = players || [];
    return list.filter((p) => {
      if (usedPlayerIds.has(p.id)) return false;
      if (posFilter !== 'ALL' && p.position !== posFilter) return false;
      if (debouncedSearch && !p.name.toLowerCase().includes(debouncedSearch)) return false;
      return true;
    });
  }, [players, posFilter, debouncedSearch, usedPlayerIds]);

  const grouped = useMemo(() => {
    if (view !== 'byposition') return null;
    const g = {};
    filteredProspects.forEach((p) => { (g[p.position] ||= []).push(p); });
    return g;
  }, [view, filteredProspects]);

  const assignPlayerToSlot = useCallback((playerId, slot) => {
    if (locked) return;
    setPicks((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(next)) {
        if (v === playerId) delete next[k];
      }
      next[slot] = playerId;
      return next;
    });
    setSubmitted(false);
  }, [locked]);

  const clearSlot = useCallback((slot) => {
    setPicks((prev) => { const next = { ...prev }; delete next[slot]; return next; });
    setSubmitted(false);
  }, []);

  const swapSlots = useCallback((a, b) => {
    setPicks((prev) => {
      const next = { ...prev };
      const av = next[a], bv = next[b];
      if (av) next[b] = av; else delete next[b];
      if (bv) next[a] = bv; else delete next[a];
      return next;
    });
  }, []);

  const handleSlotClick = useCallback((slot) => {
    if (locked) return;
    // Mobile: tapping a slot in the board sheet sets it as the current pick
    // and closes the sheet. The user lands back in the drafting view.
    if (isMobile) {
      setDraftingForSlot(slot);
      setBoardOpen(false);
      return;
    }
    // Desktop: select-then-place flow.
    if (selectedPlayer != null) {
      assignPlayerToSlot(selectedPlayer, slot);
      setSelectedPlayer(null);
    } else if (picks[slot]) {
      clearSlot(slot);
    }
  }, [isMobile, locked, selectedPlayer, picks, assignPlayerToSlot, clearSlot]);

  // Mobile prospect tap: assign to the current pick, then auto-advance to
  // the next empty slot. Doesn't close anything — the prospect list is the
  // page itself on mobile, not a modal.
  const pickForDrawerSlot = useCallback((player) => {
    if (draftingForSlot == null || locked) return;
    const justFilled = draftingForSlot;
    assignPlayerToSlot(player.id, justFilled);
    const team = orderByPick.get(justFilled);
    toast.success(`Pick ${justFilled}${team ? ` · ${team.team}` : ''}: ${player.name}`);
    // Find the next empty slot — search forward, then wrap. Treat justFilled
    // as filled (it isn't yet in `picks` until React commits the state update).
    const isEmpty = (i) => i !== justFilled && !picks[i];
    let next = null;
    for (let i = justFilled + 1; i <= 32; i++) {
      if (isEmpty(i)) { next = i; break; }
    }
    if (next == null) {
      for (let i = 1; i < justFilled; i++) {
        if (isEmpty(i)) { next = i; break; }
      }
    }
    // When all 32 are filled, stay on the just-filled pick so the user can
    // see what they did and re-edit if they want — don't strand them on null.
    setDraftingForSlot(next ?? justFilled);
  }, [draftingForSlot, locked, orderByPick, assignPlayerToSlot, picks]);

  const handleProspectClick = useCallback((player) => {
    setSelectedPlayer((prev) => {
      if (prev === player.id) return null;
      if (usedPlayerIds.has(player.id)) return prev;
      return player.id;
    });
  }, [usedPlayerIds]);

  const draftToOnClockCb = useCallback((player) => {
    if (locked || !onClockSlot) return;
    assignPlayerToSlot(player.id, onClockSlot);
    const team = orderByPick.get(onClockSlot);
    toast.success(`Pick ${onClockSlot}${team ? ` · ${team.team}` : ''}: ${player.name}`);
  }, [locked, onClockSlot, orderByPick, assignPlayerToSlot]);

  // Mobile wrapper: draft + close the drawer

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function handleDragStart(e) {
    setActiveDragId(e.active.id);
    document.body.classList.add('dragging');
  }
  function handleDragCancel() {
    setActiveDragId(null);
    document.body.classList.remove('dragging');
  }
  function handleDragEnd(e) {
    setActiveDragId(null);
    document.body.classList.remove('dragging');
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId.startsWith('player-') && overId.startsWith('slot-')) {
      const playerId = Number(activeId.replace('player-', ''));
      const slot = Number(overId.replace('slot-', ''));
      assignPlayerToSlot(playerId, slot);
    }
    if (activeId.startsWith('slot-') && overId.startsWith('slot-')) {
      const a = Number(activeId.replace('slot-', ''));
      const b = Number(overId.replace('slot-', ''));
      if (a !== b) swapSlots(a, b);
    }
  }

  // Cleanup: make sure the body class doesn't stick if the component unmounts mid-drag
  useEffect(() => () => document.body.classList.remove('dragging'), []);

  // Keyboard shortcuts: ESC deselects, Enter drafts selected to on-clock
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        if (selectedPlayer != null) { setSelectedPlayer(null); e.preventDefault(); }
      } else if (e.key === 'Enter') {
        if (selectedPlayer != null && onClockSlot && !locked) {
          const p = playerById.get(selectedPlayer);
          if (p) {
            assignPlayerToSlot(selectedPlayer, onClockSlot);
            setSelectedPlayer(null);
            const team = orderByPick.get(onClockSlot);
            toast.success(`Pick ${onClockSlot}${team ? ` · ${team.team}` : ''}: ${p.name}`);
            e.preventDefault();
          }
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedPlayer, onClockSlot, locked, playerById, orderByPick]);

  function autoFill() {
    if (locked) return;
    const available = (players || []).filter((p) => !usedPlayerIds.has(p.id));
    const emptySlots = Array.from({ length: 32 }, (_, i) => i + 1).filter((s) => !picks[s]);
    const pool = [...available].sort(() => Math.random() - 0.5);
    const next = { ...picks };
    emptySlots.forEach((slot, i) => { if (pool[i]) next[slot] = pool[i].id; });
    setPicks(next);
    setSubmitted(false);
    toast.success(`Filled ${Math.min(emptySlots.length, pool.length)} picks`);
  }

  async function submit() {
    setBusy(true);
    try {
      const payload = Object.entries(picks).map(([pn, pid]) => ({
        pick_number: Number(pn), player_id: pid,
      }));
      await api.submitMock(user.id, payload);
      toast.success('Mock submitted!');
      setSubmitted(true);
      setShowConfirm(false);
      // Dynamic import — keeps confetti out of the initial Draft chunk
      import('canvas-confetti').then(({ default: confetti }) => {
        confetti({
          particleCount: 140,
          spread: 80,
          startVelocity: 55,
          origin: { y: 0.75 },
          colors: ['#00e5ff', '#fbbf24', '#3b82f6', '#f97316'],
        });
      });
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  if (!user) return null;

  const activePlayer = activeDragId?.startsWith('player-')
    ? playerById.get(Number(activeDragId.replace('player-', '')))
    : null;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 route-fade">
      {/* Header */}
      <div className="mb-5">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <div className="caption text-accent">War Room · 2026</div>
            <h1 className="font-display display-xl text-[30px] md:text-[38px] text-text-primary mt-1">
              Build Your Mock
            </h1>
            <p className="text-text-secondary text-[13px] mt-1">
              Drag, click, or use the Draft button to assign to the team on the clock.
            </p>
          </div>
          <div className="flex items-end gap-5">
            {onClockSlot && !locked && (
              <div className="text-right">
                <div className="caption text-[10px]">On the clock</div>
                <div className="font-display font-bold uppercase tracking-wide text-text-primary text-[14px] mt-1">
                  Pick <span className="text-accent">{onClockSlot}</span>
                  {orderByPick.get(onClockSlot) && (
                    <span className="text-text-secondary"> · {orderByPick.get(onClockSlot).team}</span>
                  )}
                </div>
              </div>
            )}
            <div className="text-right">
              <div className="caption text-[10px]">Progress</div>
              <div className="font-mono font-bold text-4xl tabular leading-none mt-1">
                <span className={complete ? 'text-accent' : 'text-gold'}>{filledCount}</span>
                <span className="text-text-muted">/32</span>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-3">
          <ProgressBar picks={picks} playerById={playerById} />
        </div>
      </div>

      {locked && (
        <Card className="banner-warn mb-4 px-4 py-3">
          Submissions are locked. Head to the{' '}
          <Link to="/leaderboard" className="underline">leaderboard</Link>.
        </Card>
      )}

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {/* ============= MOBILE LAYOUT — two-panel ============= */}
        <div className="md:hidden space-y-3">
          {/* TOP PANEL — Your Board (collapsible) */}
          <Card glass className="p-0 overflow-hidden">
            <button
              type="button"
              onClick={() => setBoardExpanded((x) => !x)}
              className="w-full flex items-center justify-between px-4 py-2.5 border-b border-border-subtle"
              aria-expanded={boardExpanded}
              aria-label={boardExpanded ? 'Collapse board' : 'Expand board'}
            >
              <div className="flex items-center gap-2">
                <span className="caption text-[10px]">Your Board</span>
                <span className="font-mono text-[11px] text-text-muted tabular">
                  <span className={complete ? 'text-accent' : 'text-gold'}>{filledCount}</span>
                  <span>/32</span>
                </span>
              </div>
              <svg
                viewBox="0 0 24 24"
                className={`w-4 h-4 text-text-secondary transition-transform duration-300 ${boardExpanded ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <ul
              className="overflow-y-auto px-3 py-2 space-y-1.5 transition-[max-height] duration-300 ease-out"
              style={{ maxHeight: boardExpanded ? '50vh' : '140px' }}
            >
              {Array.from({ length: 32 }, (_, i) => i + 1).map((slot) => {
                const team = orderByPick.get(slot);
                const player = picks[slot] ? playerById.get(picks[slot]) : null;
                const isActive = slot === draftingForSlot;
                const posColor = player ? posHex(player.position) : '#64748b';
                return (
                  <li
                    key={slot}
                    ref={(el) => { if (el) boardRowRefs.current[slot] = el; }}
                    onClick={() => setDraftingForSlot(slot)}
                    className="flex items-center gap-2.5 p-2 rounded-lg border cursor-pointer transition-all"
                    style={{
                      background: isActive ? 'rgb(var(--accent-rgb) / 0.08)' : 'var(--bg-surface)',
                      borderColor: isActive ? 'rgb(var(--accent-rgb) / 0.45)' : 'var(--border-subtle)',
                      borderLeft: `4px solid ${player ? posColor : 'var(--border-subtle)'}`,
                      boxShadow: isActive ? '0 0 18px -8px rgb(var(--accent-rgb) / 0.55)' : 'none',
                    }}
                  >
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center font-mono font-bold text-[12px] shrink-0"
                      style={{
                        backgroundColor: player ? posColor : 'transparent',
                        color: player ? '#04080f' : 'var(--text-secondary)',
                        boxShadow: player ? `0 0 14px -6px ${posColor}` : 'inset 0 0 0 1.5px rgba(255,255,255,0.1)',
                      }}
                    >
                      {slot}
                    </div>
                    <TeamLogo abbr={team?.team} size="sm" />
                    {player ? (
                      <>
                        <PlayerHeadshot
                          url={player.headshot_url}
                          name={player.name}
                          position={player.position}
                          size="xs"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <div className="text-text-primary font-semibold truncate text-[13px]">{player.name}</div>
                            <PositionBadge position={player.position} />
                          </div>
                          <div className="text-[10px] text-text-muted truncate">{player.school}</div>
                        </div>
                      </>
                    ) : (
                      <div className="flex-1 min-w-0">
                        <div className="caption text-[9px] text-text-muted truncate">{team?.team || '—'}</div>
                        <div className="text-[12px] text-text-secondary truncate">
                          {isActive ? 'On the clock — pick a player below' : (team?.team_name || 'Empty')}
                        </div>
                      </div>
                    )}
                    {isActive && player && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); clearSlot(slot); }}
                        className="text-text-muted hover:text-red-400 text-sm px-1 shrink-0"
                        aria-label={`Clear pick ${slot}`}
                      >
                        ✕
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>

          {/* BOTTOM PANEL — Available Players (persistent) */}
          <Card glass className="p-3 flex flex-col mb-4 transition-[max-height] duration-300 ease-out"
            style={{ maxHeight: boardExpanded ? '35vh' : '60vh', minHeight: '30vh' }}
          >
            <ProspectListInner
              players={players}
              filtered={filteredProspects}
              grouped={grouped}
              used={usedPlayerIds}
              selected={null}
              onClick={pickForDrawerSlot}
              onDraft={null}
              onClockSlot={null}
              search={search}
              setSearch={setSearch}
              posFilter={posFilter}
              setPosFilter={setPosFilter}
              view={view}
              setView={setView}
            />
          </Card>
        </div>

        {/* ============= DESKTOP LAYOUT ============= */}
        <div className="hidden md:grid md:grid-cols-2 gap-4">
          {/* Pick slots */}
          <Card glass className="p-3 overflow-hidden">
            <div className="flex items-center justify-between mb-3 px-1">
              <h2 className="font-display font-bold text-[15px] uppercase tracking-[0.18em] text-text-primary">
                Round 1 — 2026
              </h2>
              <div className="flex gap-1">
                <Button size="xs" variant="outline" onClick={autoFill} disabled={locked || complete}>
                  Auto-fill
                </Button>
                <Button size="xs" variant="outline" onClick={() => setShowClearAll(true)} disabled={locked || filledCount === 0}>
                  Clear
                </Button>
              </div>
            </div>
            <ul className="stagger space-y-1.5 max-h-[68vh] overflow-y-auto pr-1">
              {!players ? (
                Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-[58px] w-full rounded-lg" />)
              ) : (
                Array.from({ length: 32 }, (_, i) => i + 1).map((slot) => (
                  <PickSlot
                    key={slot}
                    slot={slot}
                    team={orderByPick.get(slot)}
                    player={picks[slot] ? playerById.get(picks[slot]) : null}
                    onClear={() => clearSlot(slot)}
                    onClick={() => handleSlotClick(slot)}
                    isActive={selectedPlayer != null}
                  />
                ))
              )}
            </ul>
          </Card>

          {/* Prospect list — desktop */}
          <Card glass className="p-3 flex flex-col max-h-[76vh]">
            <ProspectListInner
              players={players}
              filtered={filteredProspects}
              grouped={grouped}
              used={usedPlayerIds}
              selected={selectedPlayer}
              onClick={handleProspectClick}
              onDraft={draftToOnClockCb}
              onClockSlot={onClockSlot}
              search={search}
              setSearch={setSearch}
              posFilter={posFilter}
              setPosFilter={setPosFilter}
              view={view}
              setView={setView}
            />
          </Card>
        </div>

        {createPortal(
          <DragOverlay modifiers={[snapCenterToCursor]} dropAnimation={null}>
            {activePlayer ? (
              <div
                className="px-3 py-2 rounded-lg text-sm text-text-primary font-semibold shadow-glow pointer-events-none select-none"
                style={{
                  background: 'var(--bg-elevated)',
                  borderLeft: `3px solid ${posHex(activePlayer.position)}`,
                  border: `1px solid ${posHex(activePlayer.position)}55`,
                  maxWidth: 260,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {activePlayer.name}
              </div>
            ) : null}
          </DragOverlay>,
          document.body
        )}
      </DndContext>

      {/* Footer / Submit (desktop) */}
      <div className="mt-5 hidden md:flex items-center justify-between gap-3">
        <div className="text-[12px] text-text-secondary">
          Tip: select a prospect and click a slot, or drag. Drag a filled slot to another to swap.
        </div>
        <Button
          size="xl"
          onClick={() => setShowConfirm(true)}
          disabled={!complete || locked || busy}
          className={`${complete && !submitted ? 'animate-pulse-glow' : ''}`}
        >
          {submitted ? 'Mock Submitted ✓' : complete ? 'Submit Mock →' : `${32 - filledCount} picks to go`}
        </Button>
      </div>

      {/* Mobile — fixed bottom action bar */}
      <div className="md:hidden fixed left-0 right-0 bottom-0 z-30 p-3 bg-bg-deep/95 backdrop-blur-md border-t border-border-subtle">
        <div className="flex items-center gap-2">
          <Button size="xs" variant="outline" onClick={autoFill} disabled={locked || complete} className="shrink-0">
            Auto-fill
          </Button>
          <Button size="xs" variant="outline" onClick={() => setShowClearAll(true)} disabled={locked || filledCount === 0} className="shrink-0">
            Clear
          </Button>
          <Button
            size="lg"
            className="flex-1"
            onClick={() => setShowConfirm(true)}
            disabled={!complete || locked || busy}
          >
            {submitted ? 'Submitted ✓' : complete ? 'Submit Mock' : `${filledCount}/32`}
          </Button>
        </div>
      </div>

      <Modal
        open={showConfirm}
        onClose={() => setShowConfirm(false)}
        title="Lock in your mock?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowConfirm(false)} disabled={busy}>Cancel</Button>
            <Button onClick={submit} disabled={busy}>{busy ? 'Submitting…' : 'Submit'}</Button>
          </>
        }
      >
        Your mock will be saved. You can edit and resubmit until the admin locks submissions.
      </Modal>

      <Modal
        open={showClearAll}
        onClose={() => setShowClearAll(false)}
        title="Clear all picks?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowClearAll(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => {
              setPicks({}); setShowClearAll(false); setSubmitted(false);
              toast('Cleared');
            }}>Clear all</Button>
          </>
        }
      >
        This removes every prospect from your current mock.
      </Modal>

      {/* Padding for mobile fixed footer (account for the bottom action bar) */}
      <div className="h-24 md:hidden" />
    </div>
  );
}

function ProspectListInner({
  players, filtered, grouped, used, selected, onClick, onDraft, onClockSlot,
  search, setSearch, posFilter, setPosFilter, view, setView,
}) {
  return (
    <>
      <div className="sticky top-0 z-10 pb-2 space-y-2" style={{ backgroundColor: 'transparent' }}>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search prospects…"
              autoComplete="off"
              spellCheck={false}
              aria-label="Search prospects by name"
              className="w-full bg-bg-deep/70 border border-border-subtle rounded-lg pl-9 pr-3 py-2.5 text-text-primary text-[13px] focus:border-accent outline-none transition"
            />
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </div>
          <select
            value={posFilter}
            onChange={(e) => setPosFilter(e.target.value)}
            className="bg-bg-deep/70 border border-border-subtle rounded-lg px-2 py-2 text-text-primary text-[12px] font-display uppercase tracking-wide"
            aria-label="Position filter"
          >
            {['ALL', ...POSITIONS].map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div className="flex items-center justify-between text-[10.5px] px-1">
          <span className="caption text-[9.5px]">
            {filtered.length} available · {used.size} drafted
          </span>
          <div className="inline-flex rounded-lg bg-bg-deep/60 border border-border-subtle p-0.5">
            <button
              onClick={() => setView('bigboard')}
              className={`px-3 py-1 rounded-md font-display text-[10px] uppercase tracking-[0.14em] transition ${
                view === 'bigboard' ? 'bg-accent text-bg-deep' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Big Board
            </button>
            <button
              onClick={() => setView('byposition')}
              className={`px-3 py-1 rounded-md font-display text-[10px] uppercase tracking-[0.14em] transition ${
                view === 'byposition' ? 'bg-accent text-bg-deep' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              By Position
            </button>
          </div>
        </div>
      </div>

      <ul className="overflow-y-auto flex-1 space-y-1.5 pr-1 stagger">
        {!players ? (
          Array.from({ length: 14 }, (_, i) => <Skeleton key={i} className="h-[46px] w-full rounded-lg" />)
        ) : view === 'bigboard' ? (
          filtered.map((p) => (
            <ProspectCard
              key={p.id}
              player={p}
              used={used.has(p.id)}
              selected={selected === p.id}
              onClick={onClick}
              onDraft={onDraft}
              onClockSlot={onClockSlot}
            />
          ))
        ) : (
          Object.entries(grouped || {}).map(([pos, list]) => (
            <li key={pos} className="space-y-1.5">
              <div className="flex items-center gap-2 mt-1 mb-1 px-1">
                <PositionBadge position={pos} />
                <span className="caption text-[9.5px]">{list.length}</span>
              </div>
              <ul className="space-y-1.5">
                {list.map((p) => (
                  <ProspectCard
                    key={p.id}
                    player={p}
                    used={used.has(p.id)}
                    selected={selected === p.id}
                    onClick={onClick}
                    onDraft={onDraft}
                    onClockSlot={onClockSlot}
                  />
                ))}
              </ul>
            </li>
          ))
        )}
      </ul>
    </>
  );
}
