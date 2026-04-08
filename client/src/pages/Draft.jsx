import { useCallback, useEffect, useMemo, useState } from 'react';
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
  // Mobile-only: which pick slot the drawer is currently drafting for.
  // null means the drawer is closed.
  const [draftingForSlot, setDraftingForSlot] = useState(null);
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
    // Mobile: tap any slot to open the drawer for that specific slot.
    // Re-tapping a filled slot lets you replace that pick.
    if (isMobile) {
      setDraftingForSlot(slot);
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

  // Mobile drawer prospect tap: assign to the slot the drawer was opened for,
  // then close. No "select first" step needed.
  const pickForDrawerSlot = useCallback((player) => {
    if (draftingForSlot == null || locked) return;
    assignPlayerToSlot(player.id, draftingForSlot);
    const team = orderByPick.get(draftingForSlot);
    toast.success(`Pick ${draftingForSlot}${team ? ` · ${team.team}` : ''}: ${player.name}`);
    setDraftingForSlot(null);
  }, [draftingForSlot, locked, orderByPick, assignPlayerToSlot]);

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
        <div className="grid md:grid-cols-2 gap-4">
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
          <Card glass className="p-3 flex flex-col max-h-[76vh] hidden md:flex">
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
      <div className="md:hidden fixed left-0 right-0 bottom-0 z-30 p-3 bg-bg-deep/90 backdrop-blur-md border-t border-border-subtle">
        <div className="flex items-center gap-3">
          <div className="text-left shrink-0">
            <div className="caption text-[9px] leading-none">Picks</div>
            <div className="font-mono font-bold text-lg leading-tight">
              <span className={complete ? 'text-accent' : 'text-gold'}>{filledCount}</span>
              <span className="text-text-muted">/32</span>
            </div>
          </div>
          {complete ? (
            <Button
              className="flex-1"
              size="lg"
              onClick={() => setShowConfirm(true)}
              disabled={locked || busy}
            >
              {submitted ? 'Submitted ✓' : 'Submit Mock'}
            </Button>
          ) : (
            <Button
              className="flex-1"
              size="lg"
              onClick={() => onClockSlot && setDraftingForSlot(onClockSlot)}
              disabled={locked || !onClockSlot}
            >
              {onClockSlot ? `Pick #${onClockSlot}${orderByPick.get(onClockSlot) ? ` · ${orderByPick.get(onClockSlot).team}` : ''} →` : 'Done'}
            </Button>
          )}
        </div>
      </div>

      {/* Mobile prospect drawer — opens for a specific slot, tap to assign */}
      {draftingForSlot != null && (
        <div className="md:hidden fixed inset-0 z-40" onClick={() => setDraftingForSlot(null)}>
          <div className="absolute inset-0 bg-black/60 animate-fade-in" />
          <div
            className="absolute left-0 right-0 bottom-0 max-h-[88vh] glass rounded-t-2xl flex flex-col drawer-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mt-2 mb-2" />

            {/* Drawer header — shows what we're drafting for */}
            <div className="px-4 pb-3 border-b border-border-subtle">
              <div className="flex items-center justify-between">
                <div>
                  <div className="caption text-[9px]">Drafting</div>
                  <div className="font-display font-bold text-text-primary text-lg uppercase tracking-wide leading-tight">
                    Pick {draftingForSlot}
                    {orderByPick.get(draftingForSlot) && (
                      <span className="text-accent ml-2">{orderByPick.get(draftingForSlot).team}</span>
                    )}
                  </div>
                  {orderByPick.get(draftingForSlot)?.team_name && (
                    <div className="text-text-muted text-[11px] truncate">
                      {orderByPick.get(draftingForSlot).team_name}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setDraftingForSlot(null)}
                  aria-label="Close"
                  className="text-text-muted hover:text-text-primary text-2xl px-3 -mr-1"
                >
                  ✕
                </button>
              </div>
              {picks[draftingForSlot] && (
                <div className="mt-2 text-[11px] text-text-secondary">
                  Currently:{' '}
                  <span className="text-text-primary font-semibold">
                    {playerById.get(picks[draftingForSlot])?.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => { clearSlot(draftingForSlot); setDraftingForSlot(null); }}
                    className="ml-2 text-red-400 hover:text-red-300 text-[11px] underline"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>

            <div className="p-3 flex-1 overflow-hidden flex flex-col">
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
            </div>
          </div>
        </div>
      )}

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

      {/* Padding for mobile fixed footer */}
      <div className="h-20 md:hidden" />
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
