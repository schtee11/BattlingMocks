import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';
import { isAdmin } from '../lib/admin.js';
import { useAuth } from '../hooks/useAuth.js';
import { Card } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';

import VolumeStatsTab from './admin/tabs/VolumeStatsTab.jsx';
import EnterResultsTab from './admin/tabs/EnterResultsTab.jsx';
import DraftOrderTab from './admin/tabs/DraftOrderTab.jsx';
import ProspectsTab from './admin/tabs/ProspectsTab.jsx';
import PlayerRanksTab from './admin/tabs/PlayerRanksTab.jsx';
import UsersTab from './admin/tabs/UsersTab.jsx';
import ScoringTab from './admin/tabs/ScoringTab.jsx';
import AlgoTuningTab from './admin/tabs/AlgoTuningTab.jsx';
import ConsensusTab from './admin/tabs/ConsensusTab.jsx';
import BoardsTab from './admin/tabs/BoardsTab.jsx';

const TABS = [
  ['volume', 'Volume Stats'],
  ['results', 'Enter Results'],
  ['order', 'Draft Order'],
  ['players', 'Prospects'],
  ['ranks', 'Player Ranks'],
  ['users', 'Users'],
  ['scoring', 'Scoring & Lock'],
  ['algo', 'Algo Tuning'],
  ['consensus', 'Consensus'],
  ['boards', 'Boards'],
];

export default function Admin() {
  // ----- Hooks (must run unconditionally) -----
  const { user } = useAuth();
  const [key, setKey] = useState(localStorage.getItem('mds_admin') || '');
  const [unlocked, setUnlocked] = useState(false);
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [tab, setTab] = useState('volume');

  // Shared state loaded from the backend once on unlock + on explicit refresh.
  const [players, setPlayers] = useState([]);
  const [actuals, setActuals] = useState([]);
  const [order, setOrder] = useState([]);
  const [settings, setSettings] = useState(null);
  const [syncYear, setSyncYear] = useState(2026);

  const userIsAdmin = isAdmin(user);

  async function unlock(candidateKey) {
    const trying = candidateKey ?? key;
    if (!trying) return;
    setUnlockBusy(true);
    try {
      await api.adminGetActualPicks(trying);
      localStorage.setItem('mds_admin', trying);
      setKey(trying);
      setUnlocked(true);
    } catch (e) {
      // Stored key was rejected — clear it so we don't loop forever
      if (candidateKey) localStorage.removeItem('mds_admin');
      else toast.error(e.message);
    } finally {
      setUnlockBusy(false);
    }
  }

  // Auto-unlock on mount if we already have a valid stored key
  useEffect(() => {
    if (!userIsAdmin) return;
    const stored = localStorage.getItem('mds_admin');
    if (stored && !unlocked) unlock(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userIsAdmin]);

  async function loadAll(opts = {}) {
    try {
      const [p, a, o, s] = await Promise.all([
        api.getPlayers({ fresh: !!opts.fresh }),
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
          <div className="caption text-accent mb-1">Control Room</div>
          <h1 className="font-display display-xl text-[24px] text-text-primary mb-1">Admin</h1>
          <p className="text-text-secondary text-[12.5px] mb-4 leading-relaxed">
            Enter the admin key to manage prospects, actual picks, and scoring.
          </p>
          <label htmlFor="admin-key" className="caption block mb-1.5">
            Admin Key
          </label>
          <input
            id="admin-key"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            disabled={unlockBusy}
            className="w-full bg-bg-deep border border-border-focus rounded-lg px-4 py-3 text-text-primary mb-3 focus:border-accent outline-none disabled:opacity-60"
            onKeyDown={(e) => e.key === 'Enter' && !unlockBusy && unlock()}
          />
          <Button
            className="w-full"
            size="lg"
            onClick={() => unlock()}
            disabled={unlockBusy || !key}
          >
            {unlockBusy ? 'Unlocking…' : 'Unlock'}
          </Button>
        </Card>
      </div>
    );
  }

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

      {tab === 'volume' && (
        <VolumeStatsTab adminKey={key} syncYear={syncYear} />
      )}

      {tab === 'results' && (
        <EnterResultsTab
          adminKey={key}
          syncYear={syncYear}
          setSyncYear={setSyncYear}
          players={players}
          actuals={actuals}
          order={order}
          refresh={loadAll}
        />
      )}

      {tab === 'order' && (
        <DraftOrderTab
          adminKey={key}
          syncYear={syncYear}
          setSyncYear={setSyncYear}
          refresh={loadAll}
        />
      )}

      {tab === 'players' && (
        <ProspectsTab
          adminKey={key}
          syncYear={syncYear}
          players={players}
          refresh={loadAll}
        />
      )}

      {tab === 'ranks' && (
        <PlayerRanksTab adminKey={key} refresh={loadAll} />
      )}

      {tab === 'users' && (
        <UsersTab adminKey={key} />
      )}

      {tab === 'scoring' && (
        <ScoringTab
          adminKey={key}
          settings={settings}
          setSettings={setSettings}
          refresh={loadAll}
        />
      )}

      {tab === 'algo' && (
        <AlgoTuningTab adminKey={key} />
      )}

      {tab === 'consensus' && (
        <ConsensusTab order={order} />
      )}

      {tab === 'boards' && (
        <BoardsTab adminKey={key} />
      )}
    </div>
  );
}
