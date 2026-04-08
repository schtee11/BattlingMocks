import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  DragOverlay,
} from '@dnd-kit/core';
import { api } from '../lib/api.js';
import { isAdmin } from '../lib/admin.js';
import { useAuth } from '../hooks/useAuth.js';
import { Card } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { PositionBadge } from '../components/ui/Badge.jsx';

const TABS = [
  ['results', 'Enter Results'],
  ['order', 'Draft Order'],
  ['players', 'Prospects'],
  ['scoring', 'Scoring & Lock'],
];

export default function Admin() {
  // ----- Hooks (must run unconditionally) -----
  const { user } = useAuth();
  const [key, setKey] = useState(localStorage.getItem('mds_admin') || '');
  const [unlocked, setUnlocked] = useState(false);
  const [tab, setTab] = useState('results');
  const playerSearchRef = useRef(null);

  const [players, setPlayers] = useState([]);
  const [actuals, setActuals] = useState([]);
  const [order, setOrder] = useState([]);
  const [settings, setSettings] = useState(null);
  const [scoreSummary, setScoreSummary] = useState(null);

  // Enter Results state
  const [pickNum, setPickNum] = useState(1);
  const [playerSearch, setPlayerSearch] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState(null);

  // Draft Order drag state
  const [activeDragId, setActiveDragId] = useState(null);
  const orderSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  // Players tab state
  const [newP, setNewP] = useState({ name: '', position: '', school: '' });
  const [confirmDelete, setConfirmDelete] = useState(null);

  const userIsAdmin = isAdmin(user);

  async function unlock(candidateKey) {
    const trying = candidateKey ?? key;
    if (!trying) return;
    try {
      await api.adminGetActualPicks(trying);
      localStorage.setItem('mds_admin', trying);
      setKey(trying);
      setUnlocked(true);
    } catch (e) {
      // Stored key was rejected — clear it so we don't loop forever
      if (candidateKey) localStorage.removeItem('mds_admin');
      else toast.error(e.message);
    }
  }

  // Auto-unlock on mount if we already have a valid stored key
  useEffect(() => {
    if (!userIsAdmin) return;
    const stored = localStorage.getItem('mds_admin');
    if (stored && !unlocked) unlock(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userIsAdmin]);

  async function loadAll() {
    try {
      const [p, a, o, s] = await Promise.all([
        api.getPlayers(),
        api.adminGetActualPicks(key),
        api.adminGetDraftOrder(key),
        api.getSettings(),
      ]);
      setPlayers(p);
      setActuals(a);
      setOrder(o.length ? o : Array.from({ length: 32 }, (_, i) => ({ pick_number: i + 1, team: '', team_name: '' })));
      setSettings(s);
    } catch (e) { toast.error(e.message); }
  }

  useEffect(() => { if (unlocked) loadAll(); /* eslint-disable-next-line */ }, [unlocked]);

  // Access gate (after hooks): non-admins see a 404. Backend X-Admin-Key
  // is still the real security boundary; this just hides the UI.
  if (!userIsAdmin) {
    return (
      <div className="max-w-md mx-auto px-4 py-32 text-center route-fade">
        <div className="caption text-accent">Cut in Round 1</div>
        <div className="font-mono font-bold text-7xl text-accent mt-2">404</div>
        <div className="text-text-secondary mt-4 mb-6">That page doesn't exist.</div>
        <Link to="/"><Button>Back to Home</Button></Link>
      </div>
    );
  }

  if (!unlocked) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 route-fade">
        <Card className="p-6">
          <h1 className="text-2xl font-bold text-text-primary mb-3">Admin</h1>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Admin key"
            autoComplete="current-password"
            className="w-full bg-bg-deep border border-border-focus rounded-lg px-4 py-3 text-text-primary mb-3 focus:border-accent outline-none"
            onKeyDown={(e) => e.key === 'Enter' && unlock()}
          />
          <Button className="w-full" size="lg" onClick={() => unlock()}>Unlock</Button>
        </Card>
      </div>
    );
  }

  const filteredPlayers = players.filter((p) =>
    p.name.toLowerCase().includes(playerSearch.toLowerCase())
  );

  async function saveActual(e) {
    e.preventDefault();
    if (!selectedPlayer) return toast.error('Select a player');
    try {
      // Team is derived from the draft order — no need for the user to type it.
      const teamForPick = order.find((o) => o.pick_number === Number(pickNum))?.team || null;
      await api.setActualPick(key, {
        pick_number: Number(pickNum),
        player_id: selectedPlayer.id,
        team: teamForPick,
      });
      const savedPick = Number(pickNum);
      toast.success(`Pick ${savedPick} saved · scored live`);
      // Auto-advance to the next pick, reset inputs, refocus search.
      const next = savedPick >= 32 ? savedPick : savedPick + 1;
      setPickNum(next);
      setSelectedPlayer(null);
      setPlayerSearch('');
      loadAll();
      // Focus the player search so you can just start typing
      setTimeout(() => playerSearchRef.current?.focus(), 0);
    } catch (e) { toast.error(e.message); }
  }

  async function runScore() {
    try {
      const r = await api.runScore(key);
      setScoreSummary(r);
      toast.success(`Scored ${r.total_mocks} mocks`);
      loadAll();
    } catch (e) { toast.error(e.message); }
  }

  async function setLock(val) {
    try {
      const r = await api.toggleLock(key, val);
      setSettings((s) => ({ ...s, is_locked: r.is_locked }));
      toast.success(r.is_locked ? 'Locked' : 'Unlocked');
    } catch (e) { toast.error(e.message); }
  }

  async function addPlayer(e) {
    e.preventDefault();
    try {
      await api.addPlayer(key, newP);
      setNewP({ name: '', position: '', school: '' });
      toast.success('Added');
      loadAll();
    } catch (e) { toast.error(e.message); }
  }

  async function deletePlayer(id) {
    try {
      await api.deletePlayer(key, id);
      toast.success('Deleted');
      setConfirmDelete(null);
      loadAll();
    } catch (e) { toast.error(e.message); }
  }

  async function importProspects() {
    try {
      const r = await api.importProspects(key);
      toast.success(`Added ${r.added}, updated ${r.updated}, unchanged ${r.unchanged}`);
      loadAll();
    } catch (e) { toast.error(e.message); }
  }

  async function saveDraftOrder() {
    try {
      await api.adminSetDraftOrder(key, order);
      toast.success('Draft order saved');
    } catch (e) { toast.error(e.message); }
  }

  // Swap the team data between two pick numbers (the pick_number positions
  // stay fixed, only the team/team_name fields move). Use this when a trade
  // sends pick A to the team that owned pick B, and vice versa.
  function swapOrderTeams(pickA, pickB) {
    setOrder((prev) => {
      const next = prev.map((o) => ({ ...o }));
      const aIdx = next.findIndex((o) => o.pick_number === pickA);
      const bIdx = next.findIndex((o) => o.pick_number === pickB);
      if (aIdx < 0 || bIdx < 0) return prev;
      const aTeam = next[aIdx].team;
      const aName = next[aIdx].team_name;
      next[aIdx].team = next[bIdx].team;
      next[aIdx].team_name = next[bIdx].team_name;
      next[bIdx].team = aTeam;
      next[bIdx].team_name = aName;
      return next;
    });
  }

  function onOrderDragStart(e) { setActiveDragId(String(e.active.id)); }
  function onOrderDragEnd(e) {
    setActiveDragId(null);
    const { active, over } = e;
    if (!over) return;
    const a = Number(String(active.id).replace('order-', ''));
    const b = Number(String(over.id).replace('order-', ''));
    if (Number.isInteger(a) && Number.isInteger(b) && a !== b) {
      swapOrderTeams(a, b);
    }
  }
  const draggingRow = activeDragId
    ? order.find((o) => String(o.pick_number) === activeDragId.replace('order-', ''))
    : null;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 route-fade">
      <div className="caption text-accent">Control Room</div>
      <h1 className="font-display display-xl text-display text-text-primary mt-1 mb-5">Admin</h1>
      <div className="flex gap-1 border-b border-border-subtle mb-5 overflow-x-auto">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-3 whitespace-nowrap border-b-2 transition font-display font-semibold text-[11px] uppercase tracking-[0.16em] ${
              tab === id ? 'border-accent text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Results */}
      {tab === 'results' && (
        <div className="grid md:grid-cols-2 gap-4">
          <Card className="p-5">
            <h3 className="font-semibold text-text-primary mb-3">Enter a pick</h3>
            <form onSubmit={saveActual} className="space-y-3">
              <select
                value={pickNum}
                onChange={(e) => setPickNum(e.target.value)}
                className="w-full bg-bg-deep border border-border-focus rounded-lg px-3 py-2 text-text-primary"
              >
                {Array.from({ length: 32 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>Pick {n} — {order.find((o) => o.pick_number === n)?.team || ''}</option>
                ))}
              </select>
              <input
                ref={playerSearchRef}
                value={playerSearch}
                onChange={(e) => { setPlayerSearch(e.target.value); setSelectedPlayer(null); }}
                onKeyDown={(e) => {
                  // Enter while typing = pick the top result, then Enter again = submit
                  if (e.key === 'Enter' && !selectedPlayer && filteredPlayers.length > 0) {
                    e.preventDefault();
                    const first = filteredPlayers[0];
                    setSelectedPlayer(first);
                    setPlayerSearch(first.name);
                  }
                }}
                placeholder="Search player…"
                autoComplete="off"
                spellCheck={false}
                className="w-full bg-bg-deep border border-border-focus rounded-lg px-3 py-2 text-text-primary"
              />
              {playerSearch && !selectedPlayer && (
                <ul className="max-h-48 overflow-y-auto bg-bg-deep border border-border-focus rounded-lg divide-y divide-border-subtle">
                  {filteredPlayers.slice(0, 20).map((p) => (
                    <li
                      key={p.id}
                      onClick={() => { setSelectedPlayer(p); setPlayerSearch(p.name); }}
                      className="px-3 py-2 hover:bg-white/5 cursor-pointer flex items-center gap-2"
                    >
                      <span className="text-text-primary text-sm flex-1">{p.name}</span>
                      <PositionBadge position={p.position} />
                    </li>
                  ))}
                </ul>
              )}
              {selectedPlayer && (
                <div className="text-sm text-text-secondary">
                  Selected: <span className="text-text-primary">{selectedPlayer.name}</span>
                  {' · '}
                  <span className="text-text-muted">
                    {order.find((o) => o.pick_number === Number(pickNum))?.team || '—'}
                  </span>
                </div>
              )}
              <Button type="submit" className="w-full">Save Pick</Button>
            </form>
          </Card>
          <Card className="p-5">
            <h3 className="font-semibold text-text-primary mb-3">Entered ({actuals.length}/32)</h3>
            <ul className="space-y-1 max-h-[55vh] overflow-y-auto">
              {actuals.map((a) => (
                <li key={a.pick_number} className="flex items-center gap-2 py-1.5 border-b border-border-subtle">
                  <span className="font-mono text-accent w-8 text-sm">{a.pick_number}</span>
                  <span className="text-text-primary text-sm flex-1 truncate">{a.name}</span>
                  <PositionBadge position={a.position} />
                  <span className="text-text-muted text-xs w-10 text-right">{a.team}</span>
                </li>
              ))}
              {actuals.length === 0 && <li className="text-text-muted text-sm">No picks entered yet.</li>}
            </ul>
          </Card>
        </div>
      )}

      {/* Draft order */}
      {tab === 'order' && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold text-text-primary">2026 Round 1 Draft Order</h3>
              <p className="text-text-muted text-xs mt-0.5">
                Drag a row onto another to swap teams (use after a trade). Or edit team fields inline.
              </p>
            </div>
            <Button size="sm" onClick={saveDraftOrder}>Save</Button>
          </div>
          <DndContext
            sensors={orderSensors}
            onDragStart={onOrderDragStart}
            onDragEnd={onOrderDragEnd}
            onDragCancel={() => setActiveDragId(null)}
          >
            <ul className="grid md:grid-cols-2 gap-2">
              {order.map((o, idx) => (
                <DraftOrderRow
                  key={o.pick_number}
                  row={o}
                  onTeamChange={(val) =>
                    setOrder((prev) => prev.map((x, i) => i === idx ? { ...x, team: val.toUpperCase().slice(0, 5) } : x))
                  }
                  onTeamNameChange={(val) =>
                    setOrder((prev) => prev.map((x, i) => i === idx ? { ...x, team_name: val } : x))
                  }
                />
              ))}
            </ul>
            <DragOverlay>
              {draggingRow ? (
                <div className="flex items-center gap-2 p-2 bg-bg-elevated rounded border border-accent shadow-glow text-sm">
                  <div className="w-8 font-mono text-accent">{draggingRow.pick_number}</div>
                  <div className="font-display font-semibold text-text-primary">{draggingRow.team}</div>
                  <div className="text-text-secondary">{draggingRow.team_name}</div>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </Card>
      )}

      {/* Players */}
      {tab === 'players' && (
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-text-primary">Prospects ({players.length})</h3>
              <Button size="sm" variant="secondary" onClick={importProspects}>Import from JSON</Button>
            </div>
            <form onSubmit={addPlayer} className="grid md:grid-cols-4 gap-2 mb-4">
              <input required value={newP.name} onChange={(e) => setNewP({ ...newP, name: e.target.value })} placeholder="Name" className="bg-bg-deep border border-border-focus rounded px-2 py-2 text-sm md:col-span-2" />
              <input required value={newP.position} onChange={(e) => setNewP({ ...newP, position: e.target.value.toUpperCase() })} placeholder="Pos" className="bg-bg-deep border border-border-focus rounded px-2 py-2 text-sm uppercase" />
              <input value={newP.school} onChange={(e) => setNewP({ ...newP, school: e.target.value })} placeholder="School" className="bg-bg-deep border border-border-focus rounded px-2 py-2 text-sm" />
              <Button type="submit" className="md:col-span-4">Add Prospect</Button>
            </form>
            <input
              value={playerSearch}
              onChange={(e) => setPlayerSearch(e.target.value)}
              placeholder="Search…"
              className="w-full bg-bg-deep border border-border-focus rounded px-2 py-2 text-sm mb-2"
            />
            <ul className="max-h-[50vh] overflow-y-auto divide-y divide-border-subtle">
              {filteredPlayers.map((p) => (
                <li key={p.id} className="flex items-center gap-2 py-2 text-sm">
                  <span className="text-text-primary flex-1 truncate">{p.name}</span>
                  <PositionBadge position={p.position} />
                  <span className="text-text-muted truncate w-32 hidden sm:block">{p.school}</span>
                  <button onClick={() => setConfirmDelete(p)} className="text-red-400 hover:text-red-300 text-xs">Delete</button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {/* Scoring */}
      {tab === 'scoring' && (
        <div className="grid md:grid-cols-2 gap-4">
          <Card className="p-5">
            <h3 className="font-semibold text-text-primary mb-3">Run scoring</h3>
            <p className="text-text-secondary text-sm mb-3">
              Safe to re-run as more actual picks are entered.
            </p>
            <Button onClick={runScore}>Score all mocks</Button>
            {settings?.scoring_run_at && (
              <div className="mt-3 text-xs text-text-muted">
                Last run: {new Date(settings.scoring_run_at).toLocaleString()}
              </div>
            )}
            {scoreSummary && (
              <div className="mt-4 text-sm text-text-secondary space-y-0.5">
                <div>Total mocks: {scoreSummary.total_mocks}</div>
                <div>Scored (non-zero): {scoreSummary.scored}</div>
                <div>Average: {scoreSummary.avg_score}</div>
                <div>Highest: {scoreSummary.max_score}</div>
              </div>
            )}
          </Card>
          <Card className="p-5">
            <h3 className="font-semibold text-text-primary mb-3">Submissions lock</h3>
            <div className="text-sm text-text-secondary mb-3">
              Current status: <span className={settings?.is_locked ? 'text-amber-300' : 'text-emerald-300'}>
                {settings?.is_locked ? 'Locked' : 'Open'}
              </span>
            </div>
            <div className="flex gap-2">
              <Button variant="danger" onClick={() => setLock(true)} disabled={settings?.is_locked}>Lock</Button>
              <Button variant="secondary" onClick={() => setLock(false)} disabled={!settings?.is_locked}>Unlock</Button>
            </div>
          </Card>
        </div>
      )}

      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete prospect?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => deletePlayer(confirmDelete.id)}>Delete</Button>
          </>
        }
      >
        This removes <span className="text-text-primary">{confirmDelete?.name}</span>. Players referenced by
        any submitted mock can't be deleted.
      </Modal>
    </div>
  );
}

// One row in the Draft Order grid. Both draggable (can be picked up) and
// droppable (can receive another row dropped on it). Editing the team
// fields inline still works — drag is initiated by the grab handle.
function DraftOrderRow({ row, onTeamChange, onTeamNameChange }) {
  const id = `order-${row.pick_number}`;
  const drag = useDraggable({ id });
  const drop = useDroppable({ id });
  const setRefs = (node) => { drag.setNodeRef(node); drop.setNodeRef(node); };

  const ringCls = drop.isOver
    ? 'ring-2 ring-accent shadow-glow'
    : 'border border-border-subtle';
  const dragCls = drag.isDragging ? 'opacity-30' : '';

  return (
    <li
      ref={setRefs}
      className={`flex items-center gap-2 p-2 bg-bg-deep rounded transition-all ${ringCls} ${dragCls}`}
    >
      {/* Drag handle — only this triggers the drag, so the inputs stay clickable */}
      <button
        type="button"
        {...drag.listeners}
        {...drag.attributes}
        aria-label={`Drag pick ${row.pick_number}`}
        className="cursor-grab active:cursor-grabbing text-text-muted hover:text-text-primary px-1 select-none touch-none"
        title="Drag to swap with another pick"
      >
        ⋮⋮
      </button>
      <div className="w-7 font-mono text-accent text-sm shrink-0">{row.pick_number}</div>
      <input
        value={row.team}
        onChange={(e) => onTeamChange(e.target.value)}
        placeholder="TEAM"
        className="w-16 bg-bg-deep border border-border-focus rounded px-2 py-1 text-text-primary text-sm uppercase"
      />
      <input
        value={row.team_name}
        onChange={(e) => onTeamNameChange(e.target.value)}
        placeholder="Team name"
        className="flex-1 bg-bg-deep border border-border-focus rounded px-2 py-1 text-text-primary text-sm min-w-0"
      />
    </li>
  );
}
