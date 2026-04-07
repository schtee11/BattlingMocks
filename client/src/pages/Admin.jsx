import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';
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
  const [key, setKey] = useState(localStorage.getItem('mds_admin') || '');
  const [unlocked, setUnlocked] = useState(false);
  const [tab, setTab] = useState('results');

  const [players, setPlayers] = useState([]);
  const [actuals, setActuals] = useState([]);
  const [order, setOrder] = useState([]);
  const [settings, setSettings] = useState(null);
  const [scoreSummary, setScoreSummary] = useState(null);

  // Enter Results state
  const [pickNum, setPickNum] = useState(1);
  const [playerSearch, setPlayerSearch] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [team, setTeam] = useState('');

  // Players tab state
  const [newP, setNewP] = useState({ name: '', position: '', school: '' });
  const [confirmDelete, setConfirmDelete] = useState(null);

  async function unlock() {
    try {
      await api.adminGetActualPicks(key);
      localStorage.setItem('mds_admin', key);
      setUnlocked(true);
    } catch (e) { toast.error(e.message); }
  }

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

  if (!unlocked) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 route-fade">
        <Card className="p-6">
          <h1 className="text-2xl font-bold text-white mb-3">Admin</h1>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Admin key"
            className="w-full bg-ink border border-slate-700 rounded-lg px-4 py-3 text-white mb-3 focus:border-accent outline-none"
            onKeyDown={(e) => e.key === 'Enter' && unlock()}
          />
          <Button className="w-full" size="lg" onClick={unlock}>Unlock</Button>
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
      await api.setActualPick(key, {
        pick_number: Number(pickNum),
        player_id: selectedPlayer.id,
        team,
      });
      toast.success(`Pick ${pickNum} saved`);
      setSelectedPlayer(null);
      setPlayerSearch('');
      loadAll();
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

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 route-fade">
      <h1 className="text-3xl font-bold text-white mb-5">Admin</h1>
      <div className="flex gap-1 border-b border-slate-800 mb-5 overflow-x-auto">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm whitespace-nowrap border-b-2 transition ${
              tab === id ? 'border-accent text-white' : 'border-transparent text-slate-400 hover:text-white'
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
            <h3 className="font-semibold text-white mb-3">Enter a pick</h3>
            <form onSubmit={saveActual} className="space-y-3">
              <select
                value={pickNum}
                onChange={(e) => setPickNum(e.target.value)}
                className="w-full bg-ink border border-slate-700 rounded-lg px-3 py-2 text-white"
              >
                {Array.from({ length: 32 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>Pick {n} — {order.find((o) => o.pick_number === n)?.team || ''}</option>
                ))}
              </select>
              <input
                value={playerSearch}
                onChange={(e) => { setPlayerSearch(e.target.value); setSelectedPlayer(null); }}
                placeholder="Search player…"
                className="w-full bg-ink border border-slate-700 rounded-lg px-3 py-2 text-white"
              />
              {playerSearch && !selectedPlayer && (
                <ul className="max-h-48 overflow-y-auto bg-ink border border-slate-700 rounded-lg divide-y divide-slate-800">
                  {filteredPlayers.slice(0, 20).map((p) => (
                    <li
                      key={p.id}
                      onClick={() => { setSelectedPlayer(p); setPlayerSearch(p.name); }}
                      className="px-3 py-2 hover:bg-white/5 cursor-pointer flex items-center gap-2"
                    >
                      <span className="text-white text-sm flex-1">{p.name}</span>
                      <PositionBadge position={p.position} />
                    </li>
                  ))}
                </ul>
              )}
              {selectedPlayer && (
                <div className="text-sm text-slate-300">
                  Selected: <span className="text-white">{selectedPlayer.name}</span>
                </div>
              )}
              <input
                value={team}
                onChange={(e) => setTeam(e.target.value.toUpperCase())}
                placeholder="Team abbr (e.g. NYJ)"
                maxLength={5}
                className="w-full bg-ink border border-slate-700 rounded-lg px-3 py-2 text-white uppercase"
              />
              <Button type="submit" className="w-full">Save Pick</Button>
            </form>
          </Card>
          <Card className="p-5">
            <h3 className="font-semibold text-white mb-3">Entered ({actuals.length}/32)</h3>
            <ul className="space-y-1 max-h-[55vh] overflow-y-auto">
              {actuals.map((a) => (
                <li key={a.pick_number} className="flex items-center gap-2 py-1.5 border-b border-slate-800">
                  <span className="font-mono text-accent w-8 text-sm">{a.pick_number}</span>
                  <span className="text-white text-sm flex-1 truncate">{a.name}</span>
                  <PositionBadge position={a.position} />
                  <span className="text-slate-500 text-xs w-10 text-right">{a.team}</span>
                </li>
              ))}
              {actuals.length === 0 && <li className="text-slate-500 text-sm">No picks entered yet.</li>}
            </ul>
          </Card>
        </div>
      )}

      {/* Draft order */}
      {tab === 'order' && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-white">2026 Round 1 Draft Order</h3>
            <Button size="sm" onClick={saveDraftOrder}>Save</Button>
          </div>
          <ul className="grid md:grid-cols-2 gap-2">
            {order.map((o, idx) => (
              <li key={o.pick_number} className="flex items-center gap-2 p-2 bg-ink rounded border border-slate-800">
                <div className="w-8 font-mono text-accent text-sm">{o.pick_number}</div>
                <input
                  value={o.team}
                  onChange={(e) => setOrder((prev) => prev.map((x, i) => i === idx ? { ...x, team: e.target.value.toUpperCase().slice(0, 5) } : x))}
                  placeholder="TEAM"
                  className="w-16 bg-ink border border-slate-700 rounded px-2 py-1 text-white text-sm uppercase"
                />
                <input
                  value={o.team_name}
                  onChange={(e) => setOrder((prev) => prev.map((x, i) => i === idx ? { ...x, team_name: e.target.value } : x))}
                  placeholder="Team name"
                  className="flex-1 bg-ink border border-slate-700 rounded px-2 py-1 text-white text-sm"
                />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Players */}
      {tab === 'players' && (
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-white">Prospects ({players.length})</h3>
              <Button size="sm" variant="secondary" onClick={importProspects}>Import from JSON</Button>
            </div>
            <form onSubmit={addPlayer} className="grid md:grid-cols-4 gap-2 mb-4">
              <input required value={newP.name} onChange={(e) => setNewP({ ...newP, name: e.target.value })} placeholder="Name" className="bg-ink border border-slate-700 rounded px-2 py-2 text-sm md:col-span-2" />
              <input required value={newP.position} onChange={(e) => setNewP({ ...newP, position: e.target.value.toUpperCase() })} placeholder="Pos" className="bg-ink border border-slate-700 rounded px-2 py-2 text-sm uppercase" />
              <input value={newP.school} onChange={(e) => setNewP({ ...newP, school: e.target.value })} placeholder="School" className="bg-ink border border-slate-700 rounded px-2 py-2 text-sm" />
              <Button type="submit" className="md:col-span-4">Add Prospect</Button>
            </form>
            <input
              value={playerSearch}
              onChange={(e) => setPlayerSearch(e.target.value)}
              placeholder="Search…"
              className="w-full bg-ink border border-slate-700 rounded px-2 py-2 text-sm mb-2"
            />
            <ul className="max-h-[50vh] overflow-y-auto divide-y divide-slate-800">
              {filteredPlayers.map((p) => (
                <li key={p.id} className="flex items-center gap-2 py-2 text-sm">
                  <span className="text-white flex-1 truncate">{p.name}</span>
                  <PositionBadge position={p.position} />
                  <span className="text-slate-500 truncate w-32 hidden sm:block">{p.school}</span>
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
            <h3 className="font-semibold text-white mb-3">Run scoring</h3>
            <p className="text-slate-400 text-sm mb-3">
              Safe to re-run as more actual picks are entered.
            </p>
            <Button onClick={runScore}>Score all mocks</Button>
            {settings?.scoring_run_at && (
              <div className="mt-3 text-xs text-slate-500">
                Last run: {new Date(settings.scoring_run_at).toLocaleString()}
              </div>
            )}
            {scoreSummary && (
              <div className="mt-4 text-sm text-slate-300 space-y-0.5">
                <div>Total mocks: {scoreSummary.total_mocks}</div>
                <div>Scored (non-zero): {scoreSummary.scored}</div>
                <div>Average: {scoreSummary.avg_score}</div>
                <div>Highest: {scoreSummary.max_score}</div>
              </div>
            )}
          </Card>
          <Card className="p-5">
            <h3 className="font-semibold text-white mb-3">Submissions lock</h3>
            <div className="text-sm text-slate-400 mb-3">
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
        This removes <span className="text-white">{confirmDelete?.name}</span>. Players referenced by
        any submitted mock can't be deleted.
      </Modal>
    </div>
  );
}
