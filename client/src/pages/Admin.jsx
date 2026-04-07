import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function Admin() {
  const [key, setKey] = useState(localStorage.getItem('mds_admin') || '');
  const [unlocked, setUnlocked] = useState(false);
  const [tab, setTab] = useState('results');
  const [players, setPlayers] = useState([]);
  const [actuals, setActuals] = useState([]);
  const [msg, setMsg] = useState('');

  const [pickNum, setPickNum] = useState(1);
  const [playerId, setPlayerId] = useState('');
  const [team, setTeam] = useState('');

  const [newP, setNewP] = useState({ name: '', position: '', school: '' });

  async function unlock() {
    try {
      await api.getActualPicks(key);
      localStorage.setItem('mds_admin', key);
      setUnlocked(true);
      load();
    } catch (e) {
      setMsg(e.message);
    }
  }

  async function load() {
    setPlayers(await api.getPlayers());
    setActuals(await api.getActualPicks(key));
  }

  useEffect(() => { if (unlocked) load(); /* eslint-disable-next-line */ }, [unlocked]);

  if (!unlocked) {
    return (
      <div className="max-w-md mx-auto px-4 py-16">
        <h1 className="text-2xl font-bold text-white mb-4">Admin</h1>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Admin key"
          className="w-full bg-panel border border-slate-700 rounded px-4 py-3 text-white mb-3"
        />
        <button onClick={unlock} className="w-full bg-accent text-ink font-semibold py-3 rounded">
          Unlock
        </button>
        {msg && <div className="text-red-400 mt-2">{msg}</div>}
      </div>
    );
  }

  async function submitActual(e) {
    e.preventDefault();
    try {
      await api.setActualPick(key, {
        pick_number: Number(pickNum),
        player_id: Number(playerId),
        team,
      });
      setMsg(`Pick ${pickNum} saved`);
      load();
    } catch (e) { setMsg(e.message); }
  }

  async function addPlayer(e) {
    e.preventDefault();
    try {
      await api.addPlayer(key, newP);
      setNewP({ name: '', position: '', school: '' });
      load();
      setMsg('Player added');
    } catch (e) { setMsg(e.message); }
  }

  async function deletePlayer(id) {
    if (!confirm('Delete?')) return;
    await api.deletePlayer(key, id);
    load();
  }

  async function runScore() {
    try {
      const r = await api.runScore(key);
      setMsg(`Scored ${r.scored} mocks`);
    } catch (e) { setMsg(e.message); }
  }

  async function toggleLock(val) {
    try {
      const r = await api.toggleLock(key, val);
      setMsg(`Locked: ${r.is_locked}`);
    } catch (e) { setMsg(e.message); }
  }

  const tabs = [
    ['results', 'Enter Results'],
    ['players', 'Manage Prospects'],
    ['scoring', 'Scoring & Lock'],
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-white mb-4">Admin</h1>
      <div className="flex gap-2 mb-4 border-b border-slate-800">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 ${tab === id ? 'border-b-2 border-accent text-white' : 'text-slate-400'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {msg && <div className="text-sm text-accent mb-3">{msg}</div>}

      {tab === 'results' && (
        <div className="space-y-4">
          <form onSubmit={submitActual} className="bg-panel rounded p-4 grid gap-3 md:grid-cols-4">
            <select value={pickNum} onChange={(e) => setPickNum(e.target.value)} className="bg-ink border border-slate-700 rounded px-2 py-2">
              {Array.from({ length: 32 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>Pick {n}</option>)}
            </select>
            <select value={playerId} onChange={(e) => setPlayerId(e.target.value)} required className="bg-ink border border-slate-700 rounded px-2 py-2 md:col-span-2">
              <option value="">Select player…</option>
              {players.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.position})</option>)}
            </select>
            <input value={team} onChange={(e) => setTeam(e.target.value)} placeholder="Team" maxLength={5} className="bg-ink border border-slate-700 rounded px-2 py-2" />
            <button className="md:col-span-4 bg-accent text-ink font-semibold py-2 rounded">Save Pick</button>
          </form>
          <div className="bg-panel rounded p-4">
            <h3 className="text-white font-semibold mb-2">Entered ({actuals.length}/32)</h3>
            <ul className="text-sm">
              {actuals.map((a) => (
                <li key={a.pick_number} className="flex gap-3 py-1 border-b border-slate-800">
                  <span className="font-mono text-accent w-8">{a.pick_number}</span>
                  <span className="text-white flex-1">{a.name}</span>
                  <span className="text-slate-400">{a.team}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {tab === 'players' && (
        <div className="space-y-4">
          <form onSubmit={addPlayer} className="bg-panel rounded p-4 grid gap-3 md:grid-cols-4">
            <input required value={newP.name} onChange={(e) => setNewP({ ...newP, name: e.target.value })} placeholder="Name" className="bg-ink border border-slate-700 rounded px-2 py-2 md:col-span-2" />
            <input required value={newP.position} onChange={(e) => setNewP({ ...newP, position: e.target.value })} placeholder="Pos" className="bg-ink border border-slate-700 rounded px-2 py-2" />
            <input value={newP.school} onChange={(e) => setNewP({ ...newP, school: e.target.value })} placeholder="School" className="bg-ink border border-slate-700 rounded px-2 py-2" />
            <button className="md:col-span-4 bg-accent text-ink font-semibold py-2 rounded">Add Player</button>
          </form>
          <ul className="bg-panel rounded p-4 max-h-96 overflow-y-auto">
            {players.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-1 border-b border-slate-800 text-sm">
                <span className="text-white flex-1">{p.name}</span>
                <span className="text-slate-400">{p.position}</span>
                <span className="text-slate-500">{p.school}</span>
                <button onClick={() => deletePlayer(p.id)} className="text-red-400 text-xs">delete</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'scoring' && (
        <div className="bg-panel rounded p-4 space-y-3">
          <button onClick={runScore} className="bg-accent text-ink font-semibold px-4 py-2 rounded">
            Run Scoring
          </button>
          <div className="flex gap-2">
            <button onClick={() => toggleLock(true)} className="bg-amber-600 text-white px-4 py-2 rounded">Lock Submissions</button>
            <button onClick={() => toggleLock(false)} className="bg-slate-700 text-white px-4 py-2 rounded">Unlock</button>
          </div>
        </div>
      )}
    </div>
  );
}
