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
import { api, invalidateCache } from '../lib/api.js';
import { isAdmin } from '../lib/admin.js';
import { useAuth } from '../hooks/useAuth.js';
import { Card } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Modal } from '../components/ui/Modal.jsx';
import { PositionBadge } from '../components/ui/Badge.jsx';
import { TeamLogo } from '../components/ui/TeamLogo.jsx';
import { PlayerHeadshot } from '../components/ui/PlayerHeadshot.jsx';
import { Avatar } from '../components/ui/Avatar.jsx';
import { prettyName } from '../lib/displayName.js';

const TABS = [
  ['results', 'Enter Results'],
  ['order', 'Draft Order'],
  ['players', 'Prospects'],
  ['users', 'Users'],
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
  const [users, setUsers] = useState([]);
  const [settings, setSettings] = useState(null);
  const [scoreSummary, setScoreSummary] = useState(null);

  // Enter Results state
  const [pickNum, setPickNum] = useState(1);
  const [pickQuery, setPickQuery] = useState('');
  const [pickOpen, setPickOpen] = useState(false);
  const [playerSearch, setPlayerSearch] = useState('');
  const [playerOpen, setPlayerOpen] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState(null);

  // Draft Order drag state
  const [activeDragId, setActiveDragId] = useState(null);
  const orderSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  // Players tab state
  const [newP, setNewP] = useState({ name: '', position: '', school: '' });
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [fetchingHeadshots, setFetchingHeadshots] = useState(false);

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

  async function loadUsers() {
    try {
      const u = await api.adminListUsers(key);
      setUsers(u);
    } catch (e) { toast.error(e.message); }
  }

  // Fetch users lazily the first time the Users tab opens, and refresh on
  // subsequent opens so a newly signed-up Discord user shows up without reload.
  useEffect(() => {
    if (unlocked && tab === 'users') loadUsers();
    // eslint-disable-next-line
  }, [unlocked, tab]);

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

  // Exclude players already entered as an actual pick so they don't clutter
  // the typeahead after they've been drafted.
  const draftedPlayerIds = new Set((actuals || []).map((a) => a.player_id));
  const availablePlayers = players.filter((p) => !draftedPlayerIds.has(p.id));
  const filteredPlayers = availablePlayers.filter((p) => {
    const q = playerSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      (p.school || '').toLowerCase().includes(q) ||
      (p.position || '').toLowerCase().includes(q)
    );
  });

  // Picks matching the current typeahead query (or all when query is empty)
  function matchingPicks() {
    const q = pickQuery.trim().toLowerCase();
    if (!q) return order;
    return order.filter((o) =>
      String(o.pick_number).includes(q) ||
      (o.team || '').toLowerCase().includes(q) ||
      (o.team_name || '').toLowerCase().includes(q)
    );
  }

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
      invalidateCache('players');
      setNewP({ name: '', position: '', school: '' });
      toast.success('Added');
      loadAll();
    } catch (e) { toast.error(e.message); }
  }

  async function deletePlayer(id) {
    try {
      await api.deletePlayer(key, id);
      invalidateCache('players');
      toast.success('Deleted');
      setConfirmDelete(null);
      loadAll();
    } catch (e) { toast.error(e.message); }
  }

  async function setPlayerHeadshot(id, url) {
    try {
      await api.updatePlayer(key, id, { headshot_url: url || null });
      invalidateCache('players');
      toast.success('Headshot saved');
      loadAll();
    } catch (e) { toast.error(e.message); }
  }

  async function fetchHeadshots(overwrite = false) {
    if (fetchingHeadshots) return;
    setFetchingHeadshots(true);
    const id = toast.loading(overwrite ? 'Refetching all from ESPN…' : 'Fetching missing headshots from ESPN…');
    try {
      const r = await api.fetchHeadshots(key, { overwrite });
      toast.dismiss(id);
      toast.success(`Scanned ${r.scanned} · updated ${r.updated} · missed ${r.failed}`, { duration: 5000 });
      if (r.samples?.length) {
        // Log sample URLs so you can click them in the devtools console to verify
        // eslint-disable-next-line no-console
        console.log('[fetch-headshots] sample saved URLs:', r.samples);
        toast(`Sample: ${r.samples[0].name} → ${r.samples[0].url}`, { duration: 10000 });
      }
      invalidateCache('players');
      loadAll();
    } catch (e) {
      toast.dismiss(id);
      toast.error(e.message);
    } finally {
      setFetchingHeadshots(false);
    }
  }

  async function importProspects() {
    try {
      const r = await api.importProspects(key);
      invalidateCache('players');
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
              {/* Pick typeahead — type pick #, team abbr, or team name */}
              <div className="relative">
                <input
                  value={pickOpen ? pickQuery : (
                    (() => {
                      const o = order.find((x) => x.pick_number === Number(pickNum));
                      return o ? `Pick ${o.pick_number} — ${o.team}` : `Pick ${pickNum}`;
                    })()
                  )}
                  onChange={(e) => { setPickQuery(e.target.value); setPickOpen(true); }}
                  onFocus={(e) => { setPickQuery(''); setPickOpen(true); e.target.select(); }}
                  onBlur={() => setTimeout(() => setPickOpen(false), 150)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const matches = matchingPicks();
                      if (matches.length > 0) {
                        setPickNum(matches[0].pick_number);
                        setPickQuery('');
                        setPickOpen(false);
                      }
                    } else if (e.key === 'Escape') {
                      setPickOpen(false);
                    }
                  }}
                  placeholder="Pick number, team abbr, or team name…"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full bg-bg-deep border border-border-focus rounded-lg px-3 py-2 text-text-primary focus:border-accent outline-none"
                />
                {pickOpen && (
                  <ul className="absolute z-20 left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-bg-deep border border-border-focus rounded-lg shadow-card divide-y divide-border-subtle">
                    {matchingPicks().map((o) => (
                      <li
                        key={o.pick_number}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setPickNum(o.pick_number);
                          setPickQuery('');
                          setPickOpen(false);
                        }}
                        className={`px-3 py-2 hover:bg-accent/10 cursor-pointer flex items-center gap-2 text-sm ${
                          o.pick_number === Number(pickNum) ? 'bg-accent/[0.07]' : ''
                        }`}
                      >
                        <span className="font-mono text-accent w-7 text-right">{o.pick_number}</span>
                        <TeamLogo abbr={o.team} size="xs" />
                        <span className="font-display font-semibold text-text-primary w-10">{o.team}</span>
                        <span className="text-text-secondary truncate">{o.team_name}</span>
                      </li>
                    ))}
                    {matchingPicks().length === 0 && (
                      <li className="px-3 py-3 text-text-muted text-sm text-center">No matches</li>
                    )}
                  </ul>
                )}
              </div>
              {/* Player typeahead — rank-ordered, excludes drafted, opens on focus */}
              <div className="relative">
                <input
                  ref={playerSearchRef}
                  value={playerSearch}
                  onChange={(e) => {
                    setPlayerSearch(e.target.value);
                    setSelectedPlayer(null);
                    setPlayerOpen(true);
                  }}
                  onFocus={(e) => {
                    setPlayerOpen(true);
                    // If a player is already selected, clear search so the full list shows again
                    if (selectedPlayer) { setPlayerSearch(''); setSelectedPlayer(null); }
                    e.target.select?.();
                  }}
                  onBlur={() => setTimeout(() => setPlayerOpen(false), 150)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (filteredPlayers.length > 0) {
                        const first = filteredPlayers[0];
                        setSelectedPlayer(first);
                        setPlayerSearch(first.name);
                        setPlayerOpen(false);
                      }
                    } else if (e.key === 'Escape') {
                      setPlayerOpen(false);
                    }
                  }}
                  placeholder="Search player by name, school, or position…"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full bg-bg-deep border border-border-focus rounded-lg px-3 py-2 text-text-primary focus:border-accent outline-none"
                />
                {playerOpen && (
                  <ul className="absolute z-20 left-0 right-0 mt-1 max-h-80 overflow-y-auto bg-bg-deep border border-border-focus rounded-lg shadow-card divide-y divide-border-subtle">
                    {filteredPlayers.length === 0 ? (
                      <li className="px-3 py-3 text-text-muted text-sm text-center">
                        {availablePlayers.length === 0 ? 'All prospects drafted' : 'No matches'}
                      </li>
                    ) : (
                      filteredPlayers.slice(0, 50).map((p) => (
                        <li
                          key={p.id}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setSelectedPlayer(p);
                            setPlayerSearch(p.name);
                            setPlayerOpen(false);
                          }}
                          className="px-3 py-2 hover:bg-accent/10 cursor-pointer flex items-center gap-2.5 text-sm"
                        >
                          <span className="font-mono text-text-muted w-7 text-right text-[11px]">
                            {p.rank ?? ''}
                          </span>
                          <PlayerHeadshot
                            url={p.headshot_url}
                            name={p.name}
                            position={p.position}
                            size="xs"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-text-primary truncate">{p.name}</div>
                            <div className="text-[10.5px] text-text-muted truncate">{p.school}</div>
                          </div>
                          <PositionBadge position={p.position} />
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </div>
              {selectedPlayer && (
                <div className="text-sm text-text-secondary flex items-center gap-2">
                  <PlayerHeadshot
                    url={selectedPlayer.headshot_url}
                    name={selectedPlayer.name}
                    position={selectedPlayer.position}
                    size="xs"
                  />
                  <span>
                    <span className="text-text-primary">{selectedPlayer.name}</span>
                    {' · '}
                    <span className="text-text-muted">
                      {order.find((o) => o.pick_number === Number(pickNum))?.team || '—'}
                    </span>
                  </span>
                </div>
              )}
              <Button type="submit" className="w-full" disabled={!selectedPlayer}>Save Pick</Button>
            </form>
          </Card>
          <Card className="p-5">
            <h3 className="font-semibold text-text-primary mb-3">Entered ({actuals.length}/32)</h3>
            <ul className="space-y-1 max-h-[55vh] overflow-y-auto">
              {actuals.map((a) => (
                <li key={a.pick_number} className="flex items-center gap-2 py-1.5 border-b border-border-subtle">
                  <span className="font-mono text-accent w-7 text-sm">{a.pick_number}</span>
                  <TeamLogo abbr={a.team} size="xs" />
                  <PlayerHeadshot url={a.headshot_url} name={a.name} position={a.position} size="xs" />
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
                  onNeedsChange={(val) =>
                    setOrder((prev) => prev.map((x, i) => i === idx ? {
                      ...x,
                      team_needs: val
                        .split(',')
                        .map((s) => s.trim().toUpperCase())
                        .filter(Boolean),
                    } : x))
                  }
                />
              ))}
            </ul>
            <DragOverlay>
              {draggingRow ? (
                <div className="flex items-center gap-2 p-2 bg-bg-elevated rounded border border-accent shadow-glow text-sm">
                  <div className="w-8 font-mono text-accent">{draggingRow.pick_number}</div>
                  <TeamLogo abbr={draggingRow.team} size="xs" />
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
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="font-semibold text-text-primary">Prospects ({players.length})</h3>
              <div className="flex gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => fetchHeadshots(false)}
                  disabled={fetchingHeadshots}
                  title="Query ESPN for any prospect without a headshot"
                >
                  {fetchingHeadshots ? 'Fetching…' : 'Fetch from ESPN'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (window.confirm('Re-query ESPN for ALL prospects (overwrites existing headshots)?')) {
                      fetchHeadshots(true);
                    }
                  }}
                  disabled={fetchingHeadshots}
                  title="Re-query ESPN for every prospect and overwrite"
                >
                  Refetch all
                </Button>
                <Button size="sm" variant="secondary" onClick={importProspects}>Import from JSON</Button>
              </div>
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
            <div className="text-[11px] text-text-muted mb-2">
              Click a headshot to paste a URL (or leave blank to remove).
            </div>
            <ul className="max-h-[50vh] overflow-y-auto divide-y divide-border-subtle">
              {filteredPlayers.map((p) => (
                <li key={p.id} className="flex items-center gap-2 py-2 text-sm">
                  <button
                    type="button"
                    title="Set headshot URL"
                    onClick={() => {
                      const url = window.prompt(`Headshot URL for ${p.name}`, p.headshot_url || '');
                      if (url !== null) setPlayerHeadshot(p.id, url.trim());
                    }}
                    className="rounded-full hover:ring-2 hover:ring-accent/60 transition"
                  >
                    <PlayerHeadshot url={p.headshot_url} name={p.name} position={p.position} size="xs" />
                  </button>
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

      {/* Users */}
      {tab === 'users' && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div>
              <h3 className="font-semibold text-text-primary">Signed Up ({users.length})</h3>
              <p className="text-text-muted text-xs mt-0.5">
                {users.filter((u) => u.has_mock).length} have submitted a mock.
              </p>
            </div>
            <Button size="sm" variant="secondary" onClick={loadUsers}>Refresh</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left caption">
                  <th className="px-3 py-2 font-display">Name</th>
                  <th className="px-3 py-2 font-display text-center hidden sm:table-cell">Mock</th>
                  <th className="px-3 py-2 font-display text-right">Score</th>
                  <th className="px-3 py-2 font-display text-right hidden md:table-cell">Joined</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-text-muted">
                      No users yet.
                    </td>
                  </tr>
                ) : (
                  users.map((u) => (
                    <tr key={u.id} className="border-t border-border-subtle hover:bg-white/[0.02]">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2.5">
                          <Avatar url={u.avatar_url} name={u.display_name} size="xs" />
                          <span className="text-text-primary font-semibold truncate">
                            {prettyName(u.display_name)}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center hidden sm:table-cell">
                        {u.has_mock ? (
                          <span className="text-emerald-400" title="Submitted a mock">✓</span>
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular">
                        {u.has_mock ? (
                          <span className={u.total_score > 0 ? 'text-gold' : 'text-text-secondary'}>
                            {u.total_score}
                          </span>
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-text-muted text-[11.5px] hidden md:table-cell">
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
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
function DraftOrderRow({ row, onTeamChange, onTeamNameChange, onNeedsChange }) {
  const id = `order-${row.pick_number}`;
  const drag = useDraggable({ id });
  const drop = useDroppable({ id });
  const setRefs = (node) => { drag.setNodeRef(node); drop.setNodeRef(node); };

  const ringCls = drop.isOver
    ? 'ring-2 ring-accent shadow-glow'
    : 'border border-border-subtle';
  const dragCls = drag.isDragging ? 'opacity-30' : '';

  const needsStr = Array.isArray(row.team_needs) ? row.team_needs.join(', ') : '';

  return (
    <li
      ref={setRefs}
      className={`p-2 bg-bg-deep rounded transition-all ${ringCls} ${dragCls}`}
    >
      <div className="flex items-center gap-2">
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
        <TeamLogo abbr={row.team} size="xs" />
        <input
          value={row.team}
          onChange={(e) => onTeamChange(e.target.value)}
          placeholder="TEAM"
          className="w-14 bg-bg-deep border border-border-focus rounded px-2 py-1 text-text-primary text-sm uppercase"
        />
        <input
          value={row.team_name}
          onChange={(e) => onTeamNameChange(e.target.value)}
          placeholder="Team name"
          className="flex-1 bg-bg-deep border border-border-focus rounded px-2 py-1 text-text-primary text-sm min-w-0"
        />
      </div>
      <div className="flex items-center gap-2 mt-1.5 pl-10">
        <span className="caption text-[9px] shrink-0">Needs</span>
        <input
          value={needsStr}
          onChange={(e) => onNeedsChange(e.target.value)}
          placeholder="QB, WR, OT, EDGE"
          className="flex-1 bg-bg-deep border border-border-focus rounded px-2 py-1 text-text-primary text-xs uppercase min-w-0"
        />
      </div>
    </li>
  );
}
