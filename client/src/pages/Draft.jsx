import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.js';

const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'OT', 'OG', 'OC', 'EDGE', 'DT', 'LB', 'CB', 'S'];

export default function Draft() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [players, setPlayers] = useState([]);
  const [settings, setSettings] = useState(null);
  const [picks, setPicks] = useState({}); // { pickNumber: playerId }
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [search, setSearch] = useState('');
  const [posFilter, setPosFilter] = useState('ALL');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) {
      nav('/join');
      return;
    }
    api.getPlayers().then(setPlayers);
    api.getSettings().then(setSettings);
    api.getMock(user.id).then((m) => {
      const map = {};
      m.picks.forEach((p) => (map[p.pick_number] = p.player_id));
      setPicks(map);
    }).catch(() => {});
  }, [user, nav]);

  const playerById = useMemo(() => {
    const m = new Map();
    players.forEach((p) => m.set(p.id, p));
    return m;
  }, [players]);

  const usedPlayerIds = useMemo(() => new Set(Object.values(picks)), [picks]);

  const filtered = players.filter((p) => {
    if (posFilter !== 'ALL' && p.position !== posFilter) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  function assignToSlot(slot) {
    if (settings?.is_locked) return;
    setPicks((prev) => {
      const next = { ...prev };
      if (selectedPlayer == null) {
        delete next[slot];
        return next;
      }
      // remove the player if already placed elsewhere
      for (const [k, v] of Object.entries(next)) {
        if (v === selectedPlayer) delete next[k];
      }
      next[slot] = selectedPlayer;
      return next;
    });
    setSelectedPlayer(null);
  }

  const filledCount = Object.keys(picks).length;
  const canSubmit = filledCount === 32 && !settings?.is_locked && !busy;

  async function submit() {
    setBusy(true);
    setMsg('');
    try {
      const payload = Object.entries(picks).map(([pn, pid]) => ({
        pick_number: Number(pn),
        player_id: pid,
      }));
      await api.submitMock(user.id, payload);
      setMsg('Mock submitted!');
    } catch (e) {
      setMsg(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  if (!user) return null;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-white">Build Your Mock</h1>
        <div className="text-slate-400 text-sm">
          {filledCount}/32 picks filled
        </div>
      </div>
      {settings?.is_locked && (
        <div className="bg-amber-900/40 text-amber-300 px-4 py-2 rounded mb-4">
          Submissions are locked. View the <Link to="/leaderboard" className="underline">leaderboard</Link>.
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Pick slots */}
        <div className="bg-panel rounded-lg p-3 max-h-[70vh] overflow-y-auto">
          <h2 className="font-semibold text-slate-200 mb-2">Round 1</h2>
          <ul className="space-y-1">
            {Array.from({ length: 32 }, (_, i) => i + 1).map((slot) => {
              const pid = picks[slot];
              const p = pid ? playerById.get(pid) : null;
              return (
                <li
                  key={slot}
                  onClick={() => assignToSlot(slot)}
                  className={`flex items-center gap-3 p-2 rounded cursor-pointer border ${
                    p ? 'border-accent/60 bg-ink' : 'border-slate-700 hover:border-slate-500'
                  }`}
                >
                  <div className="w-8 text-center font-mono text-accent">{slot}</div>
                  {p ? (
                    <div className="flex-1">
                      <div className="text-white font-medium">{p.name}</div>
                      <div className="text-xs text-slate-400">{p.position} · {p.school}</div>
                    </div>
                  ) : (
                    <div className="text-slate-500 text-sm">— empty —</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Prospect list */}
        <div className="bg-panel rounded-lg p-3 max-h-[70vh] flex flex-col">
          <div className="flex gap-2 mb-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search prospects…"
              className="flex-1 bg-ink border border-slate-700 rounded px-3 py-2 text-white text-sm"
            />
            <select
              value={posFilter}
              onChange={(e) => setPosFilter(e.target.value)}
              className="bg-ink border border-slate-700 rounded px-2 py-2 text-white text-sm"
            >
              {POSITIONS.map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
          <ul className="overflow-y-auto flex-1 space-y-1">
            {filtered.map((p) => {
              const used = usedPlayerIds.has(p.id);
              const selected = selectedPlayer === p.id;
              return (
                <li
                  key={p.id}
                  onClick={() => setSelectedPlayer(selected ? null : p.id)}
                  className={`p-2 rounded cursor-pointer border ${
                    selected
                      ? 'border-accent bg-accent/10'
                      : used
                      ? 'border-slate-800 opacity-50'
                      : 'border-slate-700 hover:border-slate-500'
                  }`}
                >
                  <div className="text-white text-sm font-medium">{p.name}</div>
                  <div className="text-xs text-slate-400">{p.position} · {p.school}</div>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 text-xs text-slate-500">
            Tip: select a prospect, then click an empty pick slot. Click a filled slot (with no prospect selected) to clear it.
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="bg-accent text-ink font-semibold px-6 py-3 rounded disabled:opacity-40"
        >
          {busy ? 'Submitting…' : 'Submit Mock'}
        </button>
        {msg && <div className="text-sm text-slate-300">{msg}</div>}
      </div>
    </div>
  );
}
