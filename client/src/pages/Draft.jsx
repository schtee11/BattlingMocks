import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DndContext, PointerSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core';
import toast from 'react-hot-toast';
import confetti from 'canvas-confetti';
import { api } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { POSITIONS } from '../lib/positions.js';
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
  const [picks, setPicks] = useState({}); // { pickNumber: playerId }
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [activeDragId, setActiveDragId] = useState(null);
  const [search, setSearch] = useState('');
  const [posFilter, setPosFilter] = useState('ALL');
  const [view, setView] = useState('bigboard'); // 'bigboard' | 'byposition'
  const [showConfirm, setShowConfirm] = useState(false);
  const [showClearAll, setShowClearAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const leftRef = useRef(null);

  useEffect(() => {
    if (!user) { nav('/join'); return; }
    (async () => {
      try {
        const [p, o, s] = await Promise.all([
          api.getPlayers(),
          api.getDraftOrder(),
          api.getSettings(),
        ]);
        // Preserve input ordering from server (rank-ish) by index if not set
        setPlayers(p.map((pl, i) => ({ ...pl, rank: pl.rank ?? i + 1 })));
        setDraftOrder(o);
        setSettings(s);
        try {
          const m = await api.getMock(user.id);
          const map = {};
          m.picks.forEach((pk) => (map[pk.pick_number] = pk.player_id));
          setPicks(map);
        } catch { /* no existing mock */ }
      } catch (e) {
        toast.error('Failed to load draft data: ' + e.message);
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

  const filteredProspects = useMemo(() => {
    const list = players || [];
    return list.filter((p) => {
      if (posFilter !== 'ALL' && p.position !== posFilter) return false;
      if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [players, posFilter, search]);

  const grouped = useMemo(() => {
    if (view !== 'byposition') return null;
    const g = {};
    filteredProspects.forEach((p) => {
      (g[p.position] ||= []).push(p);
    });
    return g;
  }, [view, filteredProspects]);

  function assignPlayerToSlot(playerId, slot) {
    if (locked) return;
    setPicks((prev) => {
      const next = { ...prev };
      // remove player if in another slot
      for (const [k, v] of Object.entries(next)) {
        if (v === playerId) delete next[k];
      }
      next[slot] = playerId;
      return next;
    });
  }

  function clearSlot(slot) {
    setPicks((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
  }

  function swapSlots(a, b) {
    setPicks((prev) => {
      const next = { ...prev };
      const av = next[a];
      const bv = next[b];
      if (av) next[b] = av; else delete next[b];
      if (bv) next[a] = bv; else delete next[a];
      return next;
    });
  }

  function handleSlotClick(slot) {
    if (locked) return;
    if (selectedPlayer != null) {
      assignPlayerToSlot(selectedPlayer, slot);
      setSelectedPlayer(null);
    } else if (picks[slot]) {
      clearSlot(slot);
    }
  }

  function handleProspectClick(player) {
    if (player.id === selectedPlayer) {
      setSelectedPlayer(null);
    } else if (!usedPlayerIds.has(player.id)) {
      setSelectedPlayer(player.id);
    }
  }

  // dnd-kit
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  function handleDragStart(e) { setActiveDragId(e.active.id); }
  function handleDragEnd(e) {
    setActiveDragId(null);
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    // Drag from player list onto a slot
    if (activeId.startsWith('player-') && overId.startsWith('slot-')) {
      const playerId = Number(activeId.replace('player-', ''));
      const slot = Number(overId.replace('slot-', ''));
      assignPlayerToSlot(playerId, slot);
    }
    // Drag a filled slot onto another slot → swap
    if (activeId.startsWith('slot-') && overId.startsWith('slot-')) {
      const a = Number(activeId.replace('slot-', ''));
      const b = Number(overId.replace('slot-', ''));
      if (a !== b) swapSlots(a, b);
    }
  }

  function autoFill() {
    if (locked) return;
    const available = (players || []).filter((p) => !usedPlayerIds.has(p.id));
    const emptySlots = Array.from({ length: 32 }, (_, i) => i + 1).filter((s) => !picks[s]);
    // Shuffle remaining prospects
    const pool = [...available].sort(() => Math.random() - 0.5);
    const next = { ...picks };
    emptySlots.forEach((slot, i) => {
      if (pool[i]) next[slot] = pool[i].id;
    });
    setPicks(next);
    toast.success(`Filled ${Math.min(emptySlots.length, pool.length)} picks`);
  }

  async function submit() {
    setBusy(true);
    try {
      const payload = Object.entries(picks).map(([pn, pid]) => ({
        pick_number: Number(pn),
        player_id: pid,
      }));
      await api.submitMock(user.id, payload);
      toast.success('Mock submitted!');
      confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 } });
      setShowConfirm(false);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
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
            <h1 className="text-3xl font-bold text-white">Build Your Mock</h1>
            <p className="text-slate-400 text-sm mt-1">
              Drag prospects into slots, or click to assign. Submit when all 32 are filled.
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500 uppercase tracking-wide">Progress</div>
            <div className="text-2xl font-bold text-white">
              {filledCount}<span className="text-slate-500">/32</span>
            </div>
          </div>
        </div>
        <div className="mt-3"><ProgressBar value={filledCount} max={32} /></div>
      </div>

      {locked && (
        <Card className="mb-4 px-4 py-3 text-amber-300 bg-amber-900/20 border-amber-700/40">
          Submissions are locked. View the{' '}
          <Link to="/leaderboard" className="underline">leaderboard</Link>.
        </Card>
      )}

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="grid md:grid-cols-2 gap-4">
          {/* Pick slots */}
          <Card className="p-3">
            <div className="flex items-center justify-between mb-2 px-1">
              <h2 className="font-semibold text-slate-200">Round 1 — 2026</h2>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={autoFill} disabled={locked || filledCount === 32}>
                  Auto-fill
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowClearAll(true)} disabled={locked || filledCount === 0}>
                  Clear all
                </Button>
              </div>
            </div>
            <ul ref={leftRef} className="space-y-1.5 max-h-[68vh] overflow-y-auto pr-1">
              {!players ? (
                Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-14 w-full" />)
              ) : (
                Array.from({ length: 32 }, (_, i) => i + 1).map((slot) => (
                  <PickSlot
                    key={slot}
                    slot={slot}
                    team={orderByPick.get(slot)}
                    player={picks[slot] ? playerById.get(picks[slot]) : null}
                    onClear={() => clearSlot(slot)}
                    onClick={() => handleSlotClick(slot)}
                    isActive={selectedPlayer != null && !picks[slot]}
                  />
                ))
              )}
            </ul>
          </Card>

          {/* Prospect list */}
          <Card className="p-3 flex flex-col max-h-[76vh]">
            <div className="sticky top-0 bg-panel z-10 pb-2 space-y-2">
              <div className="flex gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search prospects…"
                  className="flex-1 bg-ink border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:border-accent outline-none"
                />
                <select
                  value={posFilter}
                  onChange={(e) => setPosFilter(e.target.value)}
                  className="bg-ink border border-slate-700 rounded-lg px-2 py-2 text-white text-sm"
                  aria-label="Position filter"
                >
                  {FILTERS.map((p) => <option key={p}>{p}</option>)}
                </select>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500 px-1">
                <span>
                  {filteredProspects.filter((p) => !usedPlayerIds.has(p.id)).length} of{' '}
                  {filteredProspects.length} available
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setView('bigboard')}
                    className={`px-2 py-1 rounded ${view === 'bigboard' ? 'bg-accent/20 text-accent' : 'text-slate-400 hover:text-white'}`}
                  >
                    Big Board
                  </button>
                  <button
                    onClick={() => setView('byposition')}
                    className={`px-2 py-1 rounded ${view === 'byposition' ? 'bg-accent/20 text-accent' : 'text-slate-400 hover:text-white'}`}
                  >
                    By Position
                  </button>
                </div>
              </div>
            </div>

            <ul className="overflow-y-auto flex-1 space-y-1.5">
              {!players ? (
                Array.from({ length: 12 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)
              ) : view === 'bigboard' ? (
                filteredProspects.map((p) => (
                  <ProspectCard
                    key={p.id}
                    player={p}
                    used={usedPlayerIds.has(p.id)}
                    selected={selectedPlayer === p.id}
                    onClick={() => handleProspectClick(p)}
                  />
                ))
              ) : (
                Object.entries(grouped).map(([pos, list]) => (
                  <li key={pos}>
                    <div className="flex items-center gap-2 mt-2 mb-1 px-1">
                      <PositionBadge position={pos} />
                      <span className="text-xs text-slate-500">{list.length}</span>
                    </div>
                    <ul className="space-y-1.5">
                      {list.map((p) => (
                        <ProspectCard
                          key={p.id}
                          player={p}
                          used={usedPlayerIds.has(p.id)}
                          selected={selectedPlayer === p.id}
                          onClick={() => handleProspectClick(p)}
                        />
                      ))}
                    </ul>
                  </li>
                ))
              )}
            </ul>
          </Card>
        </div>

        <DragOverlay>
          {activePlayer ? (
            <div className="px-3 py-2 rounded-lg bg-ink border border-accent shadow-glow text-sm text-white">
              {activePlayer.name}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <div className="mt-5 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="text-sm text-slate-400">
          Tip: select a prospect and click a slot, or drag and drop. Drag a filled slot to another to swap.
        </div>
        <Button
          size="lg"
          onClick={() => setShowConfirm(true)}
          disabled={filledCount !== 32 || locked || busy}
        >
          {filledCount === 32 ? 'Submit Mock' : `${32 - filledCount} picks to go`}
        </Button>
      </div>

      <Modal
        open={showConfirm}
        onClose={() => setShowConfirm(false)}
        title="Lock in your mock?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowConfirm(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? 'Submitting…' : 'Submit'}
            </Button>
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
            <Button
              variant="danger"
              onClick={() => {
                setPicks({});
                setShowClearAll(false);
                toast('Cleared all picks');
              }}
            >
              Clear all
            </Button>
          </>
        }
      >
        This removes every prospect from your current mock. You can undo by reassigning them.
      </Modal>
    </div>
  );
}
