import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { ALGO_DEFAULTS } from '../lib/algoConfig.js';
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
import { posHex } from '../lib/positions.js';
import { Skeleton } from '../components/ui/Skeleton.jsx';

const TABS = [
  ['results', 'Enter Results'],
  ['order', 'Draft Order'],
  ['players', 'Prospects'],
  ['users', 'Users'],
  ['scoring', 'Scoring & Lock'],
  ['algo', 'Algo Tuning'],
  ['consensus', 'Consensus'],
  ['volume', 'Volume Stats'],
];

export default function Admin() {
  // ----- Hooks (must run unconditionally) -----
  const { user } = useAuth();
  const [key, setKey] = useState(localStorage.getItem('mds_admin') || '');
  const [unlocked, setUnlocked] = useState(false);
  const [unlockBusy, setUnlockBusy] = useState(false);
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
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [bulkImportText, setBulkImportText] = useState('');
  const [bulkImportBusy, setBulkImportBusy] = useState(false);
  const [syncProspectsBusy, setSyncProspectsBusy] = useState(false);
  const [syncYear, setSyncYear] = useState(2026);
  const [syncing, setSyncing] = useState(false);
  const [pollStatus, setPollStatus] = useState(null);
  const [pollInterval, setPollInterval] = useState(20);
  // Trade calculator state
  const [tradeValues, setTradeValues] = useState([]);
  const [sideAPicks, setSideAPicks] = useState([]);
  const [sideBPicks, setSideBPicks] = useState([]);
  const [sideATeam, setSideATeam] = useState('');
  const [sideBTeam, setSideBTeam] = useState('');
  const [tradeResult, setTradeResult] = useState(null);
  const [tradePickSearch, setTradePickSearch] = useState('');

  // Algo tuning tab
  const [algoForm, setAlgoForm] = useState(null); // null = not yet loaded
  const [algoBusy, setAlgoBusy] = useState(false);

  // Run-scoring busy flag — hoisted here with every other hook so it
  // declares before any early returns. Rules of Hooks demands every
  // render call the same number of hooks in the same order.
  const [scoreBusy, setScoreBusy] = useState(false);

  // Consensus analytics tab
  const [consensusR1, setConsensusR1] = useState(null);
  const [consensusPos, setConsensusPos] = useState(null);
  const [consensusLoading, setConsensusLoading] = useState(false);
  const [consensusTeam, setConsensusTeam] = useState('');
  const [consensusTeamData, setConsensusTeamData] = useState(null);
  const [consensusTeamLoading, setConsensusTeamLoading] = useState(false);

  // Volume stats tab
  const [volumeStats, setVolumeStats] = useState(null);
  const [volumeLoading, setVolumeLoading] = useState(false);

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

  // Poll the server-side auto-sync status while the Results tab is visible.
  // Keeps the "last sync" indicator fresh without hammering when inactive.
  useEffect(() => {
    if (!unlocked || tab !== 'results') return undefined;
    let cancelled = false;
    async function fetchOnce() {
      try {
        const s = await api.pollStatus(key);
        if (!cancelled) setPollStatus(s);
      } catch { /* ignore transient errors */ }
    }
    fetchOnce();
    const id = setInterval(fetchOnce, 5000);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line
  }, [unlocked, tab, key]);

  async function startPolling() {
    try {
      const s = await api.pollStart(key, { year: syncYear, intervalSec: pollInterval });
      setPollStatus(s);
      toast.success(`Auto-sync ON · every ${s.interval_sec}s`);
    } catch (e) { toast.error(e.message); }
  }
  async function stopPolling() {
    try {
      const s = await api.pollStop(key);
      setPollStatus(s);
      toast('Auto-sync OFF');
    } catch (e) { toast.error(e.message); }
  }

  // ---------- Trades ----------
  useEffect(() => {
    if (!unlocked || tab !== 'trades') return;
    if (tradeValues.length > 0) return;
    api.tradeValues(key)
      .then(setTradeValues)
      .catch((e) => toast.error(e.message));
    // eslint-disable-next-line
  }, [unlocked, tab]);

  // Recalculate whenever either side changes
  useEffect(() => {
    if (tab !== 'trades') return;
    if (sideAPicks.length === 0 && sideBPicks.length === 0) {
      setTradeResult(null);
      return;
    }
    let cancelled = false;
    api.tradeCalculate(key, { side_a_picks: sideAPicks, side_b_picks: sideBPicks })
      .then((r) => { if (!cancelled) setTradeResult(r); })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [sideAPicks, sideBPicks, tab]);

  function addPickToSide(side, pickNum) {
    const setter = side === 'a' ? setSideAPicks : setSideBPicks;
    setter((prev) => (prev.includes(pickNum) ? prev : [...prev, pickNum]));
  }
  function removePickFromSide(side, pickNum) {
    const setter = side === 'a' ? setSideAPicks : setSideBPicks;
    setter((prev) => prev.filter((p) => p !== pickNum));
  }
  function clearTrade() {
    setSideAPicks([]);
    setSideBPicks([]);
    setSideATeam('');
    setSideBTeam('');
    setTradeResult(null);
  }

  function selectConsensusTeam(abbr) {
    if (consensusTeam === abbr) return;
    setConsensusTeam(abbr);
    setConsensusTeamData(null);
    setConsensusTeamLoading(true);
    api.getTeamPickBreakdown(abbr)
      .then(setConsensusTeamData)
      .catch((e) => toast.error(e.message))
      .finally(() => setConsensusTeamLoading(false));
  }

  async function applyTradeAction() {
    if (!sideATeam || !sideBTeam) return toast.error('Set both team abbreviations');
    if (sideAPicks.length === 0 && sideBPicks.length === 0) return toast.error('Add picks to trade');
    if (!window.confirm(`Apply trade? ${sideATeam} ↔ ${sideBTeam}`)) return;
    try {
      const r = await api.tradeApply(key, {
        side_a_team: sideATeam.toUpperCase(),
        side_a_picks: sideAPicks,
        side_b_team: sideBTeam.toUpperCase(),
        side_b_picks: sideBPicks,
      });
      toast.success(`Applied ${r.applied.length} pick changes${r.skipped.length ? ` · ${r.skipped.length} skipped` : ''}`);
      if (r.skipped.length) {
        console.log('[trade apply] skipped', r.skipped);
      }
      invalidateCache('draft-order');
      clearTrade();
      loadAll();
    } catch (e) {
      toast.error(e.message);
    }
  }

  // ---------- Algo tuning ----------
  useEffect(() => {
    if (!unlocked || tab !== 'algo') return;
    if (algoForm) return; // already loaded
    api.adminGetAlgoConfig(key)
      .then((stored) => setAlgoForm({ ...ALGO_DEFAULTS, ...stored }))
      .catch((e) => toast.error(e.message));
    // eslint-disable-next-line
  }, [unlocked, tab]);

  // ---------- Consensus analytics ----------
  useEffect(() => {
    if (!unlocked || tab !== 'consensus') return;
    if (consensusR1) return; // already loaded
    setConsensusLoading(true);
    Promise.all([api.getR1Consensus(), api.getPositionConsensus()])
      .then(([r1, pos]) => { setConsensusR1(r1); setConsensusPos(pos); })
      .catch((e) => toast.error(e.message))
      .finally(() => setConsensusLoading(false));
    // eslint-disable-next-line
  }, [unlocked, tab]);

  // ---------- Volume stats ----------
  function loadVolumeStats() {
    setVolumeLoading(true);
    api.volumeStats(key, syncYear)
      .then(setVolumeStats)
      .catch((e) => toast.error(e.message))
      .finally(() => setVolumeLoading(false));
  }
  useEffect(() => {
    if (!unlocked || tab !== 'volume') return;
    if (volumeStats) return;
    loadVolumeStats();
    // eslint-disable-next-line
  }, [unlocked, tab]);

  function algoField(fieldKey, label, opts = {}) {
    const { step = 0.01, min, max, pct = false } = opts;
    const rawVal = algoForm?.[fieldKey] ?? ALGO_DEFAULTS[fieldKey];
    const displayVal = pct ? Math.round(rawVal * 1000) / 10 : rawVal;
    return (
      <label key={fieldKey} className="flex items-center justify-between gap-3">
        <span className="text-[12px] text-text-secondary">{label}</span>
        <div className="flex items-center gap-1 shrink-0">
          <input
            type="number"
            step={pct ? 0.1 : step}
            min={min}
            max={max}
            value={displayVal}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v)) {
                setAlgoForm((f) => ({ ...f, [fieldKey]: pct ? v / 100 : v }));
              }
            }}
            className="w-20 bg-bg-deep border border-border-focus rounded px-2 py-1 text-text-primary text-xs font-mono text-right"
          />
          {pct && <span className="text-text-muted text-[11px]">%</span>}
        </div>
      </label>
    );
  }

  async function saveAlgoConfig() {
    if (!algoForm) return;
    setAlgoBusy(true);
    try {
      await api.adminSaveAlgoConfig(key, algoForm);
      invalidateCache('algo-config');
      toast.success('Algo config saved — takes effect on next draft start');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setAlgoBusy(false);
    }
  }

  async function resetAlgoConfig() {
    if (!window.confirm('Reset all algo settings to defaults?')) return;
    setAlgoBusy(true);
    try {
      await api.adminResetAlgoConfig(key);
      invalidateCache('algo-config');
      setAlgoForm({ ...ALGO_DEFAULTS });
      toast.success('Reset to defaults');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setAlgoBusy(false);
    }
  }

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
    if (scoreBusy) return;
    setScoreBusy(true);
    const id = toast.loading('Scoring every mock…');
    try {
      const r = await api.runScore(key);
      setScoreSummary(r);
      toast.dismiss(id);
      toast.success(`Scored ${r.total_mocks} mocks`);
      loadAll();
    } catch (e) {
      toast.dismiss(id);
      toast.error(e.message);
    } finally {
      setScoreBusy(false);
    }
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
      loadAll({ fresh: true });
    } catch (e) { toast.error(e.message); }
  }

  async function deletePlayer(id) {
    try {
      await api.deletePlayer(key, id);
      invalidateCache('players');
      toast.success('Deleted');
      setConfirmDelete(null);
      loadAll({ fresh: true });
    } catch (e) { toast.error(e.message); }
  }

  async function setPlayerHeadshot(id, url) {
    try {
      await api.updatePlayer(key, id, { headshot_url: url || null });
      invalidateCache('players');
      toast.success('Headshot saved');
      loadAll({ fresh: true });
    } catch (e) { toast.error(e.message); }
  }

  async function syncDraftOrderFromEspn(dry) {
    if (syncing) return;
    setSyncing(true);
    const id = toast.loading(dry ? 'Previewing from ESPN…' : 'Syncing draft order from ESPN…');
    try {
      const r = await api.syncDraftOrderFromEspn(key, { year: syncYear, dry });
      toast.dismiss(id);
      // eslint-disable-next-line no-console
      console.log('[sync draft-order] result', r);
      if (dry) {
        toast(`Preview: ${r.round1} R1 picks fetched (${r.fetched} total)`, { duration: 8000 });
        if (r.samples?.[0]) {
          toast(`Sample: Pick ${r.samples[0].pick} → ${r.samples[0].team_abbr}`, { duration: 8000 });
        }
      } else {
        toast.success(`Updated ${r.updated}/${r.round1} picks`);
        invalidateCache('draft-order');
        loadAll();
      }
    } catch (e) {
      toast.dismiss(id);
      toast.error(e.message);
    } finally {
      setSyncing(false);
    }
  }

  async function syncAllRoundsFromEspn(dry) {
    if (syncing) return;
    setSyncing(true);
    const id = toast.loading(dry ? 'Previewing all 7 rounds…' : 'Syncing all 7 rounds from ESPN…');
    try {
      const r = await api.syncAllRoundsFromEspn(key, { year: syncYear, dry, includeR1: false });
      toast.dismiss(id);
      // eslint-disable-next-line no-console
      console.log('[sync all-rounds] result', r);
      const byRound = r.by_round ? Object.entries(r.by_round).map(([k, v]) => `R${k}:${v}`).join(' ') : '';
      if (dry) {
        toast(`Preview: ${r.would_update} picks across rounds · ${byRound}`, { duration: 10000 });
      } else {
        toast.success(`Inserted ${r.inserted}, updated ${r.updated} · ${byRound}`);
        invalidateCache('draft-order');
        loadAll();
      }
    } catch (e) {
      toast.dismiss(id);
      toast.error(e.message);
    } finally {
      setSyncing(false);
    }
  }

  async function syncPicksFromEspn(dry) {
    if (syncing) return;
    setSyncing(true);
    const id = toast.loading(dry ? 'Previewing picks from ESPN…' : 'Syncing picks from ESPN…');
    try {
      const r = await api.syncPicksFromEspn(key, { year: syncYear, dry });
      toast.dismiss(id);
      // eslint-disable-next-line no-console
      console.log('[sync picks] result', r);
      const head = `Fetched ${r.round1_with_player} · matched ${r.matched}${r.unmatched ? ` · ${r.unmatched} unmatched` : ''}`;
      if (dry) {
        toast(head, { duration: 8000 });
        if (r.unmatched_samples?.length) {
          toast(`Unmatched: ${r.unmatched_samples.map((x) => x.player_name).join(', ')}`, { duration: 10000 });
        }
      } else {
        toast.success(`Saved ${r.saved} picks · scored ${r.scored_mocks} mocks`);
        invalidateCache('actual-picks');
        loadAll();
      }
    } catch (e) {
      toast.dismiss(id);
      toast.error(e.message);
    } finally {
      setSyncing(false);
    }
  }

  async function fetchHeadshots(overwrite = false) {
    if (fetchingHeadshots) return;
    setFetchingHeadshots(true);
    const id = toast.loading(overwrite ? 'Refetching all from ESPN…' : 'Fetching missing headshots from ESPN…');
    try {
      const r = await api.fetchHeadshots(key, { overwrite });
      toast.dismiss(id);
      toast.success(`Scanned ${r.scanned} · updated ${r.updated} · missed ${r.failed}`, { duration: 5000 });
      // Force fresh fetch so the new headshots actually appear in the UI
      loadAll({ fresh: true });
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
    const id = toast.loading('Importing prospects from seed…');
    try {
      const r = await api.importProspects(key);
      invalidateCache('players');
      toast.dismiss(id);
      toast.success(`Added ${r.added}, updated ${r.updated}, unchanged ${r.unchanged}`);
      loadAll({ fresh: true });
    } catch (e) {
      toast.dismiss(id);
      toast.error(e.message);
    }
  }

  async function syncProspectsFromEspn(dry = false) {
    if (syncProspectsBusy) return;
    setSyncProspectsBusy(true);
    const id = toast.loading(dry ? 'Previewing prospects from ESPN…' : 'Syncing prospects from ESPN…');
    try {
      const r = await api.syncProspectsFromEspn(key, { year: syncYear, limit: 400, dry });
      toast.dismiss(id);
      // eslint-disable-next-line no-console
      console.log('[sync prospects] result', r);
      if (dry) {
        toast(`Preview: ${r.fetched} prospects · first=${r.samples?.[0]?.name}`, { duration: 10000 });
      } else {
        toast.success(`Added ${r.added}, updated ${r.updated}, unchanged ${r.unchanged}`);
        invalidateCache('players');
        loadAll({ fresh: true });
      }
    } catch (e) {
      toast.dismiss(id);
      toast.error(e.message);
    } finally {
      setSyncProspectsBusy(false);
    }
  }

  async function submitBulkImport() {
    setBulkImportBusy(true);
    try {
      let parsed;
      try {
        parsed = JSON.parse(bulkImportText);
      } catch {
        throw new Error('Invalid JSON — paste a JSON array of { name, position, school?, headshot_url? }');
      }
      const prospects = Array.isArray(parsed) ? parsed : parsed.prospects;
      if (!Array.isArray(prospects)) {
        throw new Error('Expected an array of prospects');
      }
      const r = await api.bulkImportProspects(key, prospects);
      toast.success(`Received ${r.received} · added ${r.added}, updated ${r.updated}, unchanged ${r.unchanged}${r.invalid_count ? ` · ${r.invalid_count} invalid` : ''}`);
      invalidateCache('players');
      setBulkImportText('');
      setBulkImportOpen(false);
      loadAll({ fresh: true });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBulkImportBusy(false);
    }
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

  // Group team pick breakdown by round for rendering
  const teamPicksByRound = consensusTeamData?.picks
    ? consensusTeamData.picks.reduce((acc, pick) => {
        (acc[pick.round] = acc[pick.round] || []).push(pick);
        return acc;
      }, {})
    : {};

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
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h3 className="font-semibold text-text-primary">One-shot sync from ESPN</h3>
                <p className="text-text-muted text-xs mt-0.5">
                  Manual trigger · Round 1 only · preview first, then sync to save + re-score.
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-[11px] text-text-muted font-display uppercase tracking-wide">Year</label>
                <input
                  type="number"
                  value={syncYear}
                  onChange={(e) => setSyncYear(parseInt(e.target.value, 10) || 2026)}
                  className="w-20 bg-bg-deep border border-border-focus rounded px-2 py-1.5 text-text-primary text-sm font-mono"
                />
                <Button size="sm" variant="secondary" onClick={() => syncPicksFromEspn(true)} disabled={syncing}>
                  {syncing ? '…' : 'Preview'}
                </Button>
                <Button size="sm" onClick={() => syncPicksFromEspn(false)} disabled={syncing}>
                  {syncing ? 'Syncing…' : 'Sync Picks'}
                </Button>
              </div>
            </div>
          </Card>

          {/* Auto-sync poller */}
          <Card className="p-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-text-primary">Draft-night auto-sync</h3>
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] font-display uppercase tracking-[0.14em] px-2 py-0.5 rounded-full ${
                      pollStatus?.running
                        ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30'
                        : 'bg-white/5 text-text-muted ring-1 ring-border-subtle'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${pollStatus?.running ? 'bg-emerald-400 animate-pulse' : 'bg-text-muted'}`} />
                    {pollStatus?.running ? 'Running' : 'Off'}
                  </span>
                </div>
                <p className="text-text-muted text-xs mt-0.5">
                  Server hits ESPN every N seconds, saves new picks, re-scores every mock.
                </p>
                {pollStatus?.running && (
                  <div className="text-[11px] text-text-secondary mt-2 flex flex-wrap gap-x-4 gap-y-0.5 font-mono tabular">
                    <span>year: <span className="text-text-primary">{pollStatus.year}</span></span>
                    <span>interval: <span className="text-text-primary">{pollStatus.interval_sec}s</span></span>
                    <span>ticks: <span className="text-text-primary">{pollStatus.ticks}</span></span>
                    <span>saved this run: <span className="text-gold">{pollStatus.total_saved}</span></span>
                    {pollStatus.last_sync_at && (
                      <span>last: <span className="text-text-primary">{new Date(pollStatus.last_sync_at).toLocaleTimeString()}</span></span>
                    )}
                  </div>
                )}
                {pollStatus?.last_error && (
                  <div className="text-[11px] text-red-400 mt-1 break-all">
                    last error: {pollStatus.last_error}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-[11px] text-text-muted font-display uppercase tracking-wide">Every</label>
                <input
                  type="number"
                  min={10}
                  max={300}
                  value={pollInterval}
                  onChange={(e) => setPollInterval(parseInt(e.target.value, 10) || 20)}
                  disabled={pollStatus?.running}
                  className="w-16 bg-bg-deep border border-border-focus rounded px-2 py-1.5 text-text-primary text-sm font-mono disabled:opacity-50"
                />
                <span className="text-[11px] text-text-muted">sec</span>
                {pollStatus?.running ? (
                  <Button size="sm" variant="danger" onClick={stopPolling}>Stop</Button>
                ) : (
                  <Button size="sm" onClick={startPolling}>Start</Button>
                )}
              </div>
            </div>
          </Card>
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
                  aria-label="Find pick by number or team"
                  aria-expanded={pickOpen}
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
                  aria-label="Search prospect to assign to this pick"
                  aria-expanded={playerOpen}
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
        </div>
      )}

      {/* Draft order */}
      {tab === 'order' && (
        <div className="space-y-4">
        <Card className="p-4">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
            <div>
              <h3 className="font-semibold text-text-primary">Sync draft order from ESPN</h3>
              <p className="text-text-muted text-xs mt-0.5">
                Round 1 only · overwrites team abbr + name. Team needs are left untouched.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-[11px] text-text-muted font-display uppercase tracking-wide">Year</label>
              <input
                type="number"
                value={syncYear}
                onChange={(e) => setSyncYear(parseInt(e.target.value, 10) || 2026)}
                className="w-20 bg-bg-deep border border-border-focus rounded px-2 py-1.5 text-text-primary text-sm font-mono"
              />
              <Button size="sm" variant="secondary" onClick={() => syncDraftOrderFromEspn(true)} disabled={syncing}>
                {syncing ? '…' : 'Preview R1'}
              </Button>
              <Button size="sm" onClick={() => syncDraftOrderFromEspn(false)} disabled={syncing}>
                {syncing ? 'Syncing…' : 'Sync R1'}
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-between flex-wrap gap-3 pt-3 border-t border-border-subtle">
            <div>
              <h4 className="text-text-primary text-[13px] font-semibold">All 7 rounds (team-mock prep)</h4>
              <p className="text-text-muted text-xs mt-0.5">
                Pulls rounds 2-7 from ESPN and seeds the DB. R1 is preserved (hand-curated + team needs intact).
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="secondary" onClick={() => syncAllRoundsFromEspn(true)} disabled={syncing}>
                {syncing ? '…' : 'Preview R2-R7'}
              </Button>
              <Button size="sm" onClick={() => syncAllRoundsFromEspn(false)} disabled={syncing}>
                {syncing ? 'Syncing…' : 'Sync R2-R7'}
              </Button>
            </div>
          </div>
        </Card>
        <TeamNeedsCard adminKey={key} />
        </div>
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
                  onClick={() => syncProspectsFromEspn(false)}
                  disabled={syncProspectsBusy}
                  title="Pull the draft prospect list from ESPN (up to 400)"
                >
                  {syncProspectsBusy ? 'Syncing…' : 'Sync Prospects from ESPN'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => syncProspectsFromEspn(true)}
                  disabled={syncProspectsBusy}
                  title="Dry-run preview — see what ESPN returns without writing"
                >
                  Preview
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setBulkImportOpen(true)}>
                  Paste JSON
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => fetchHeadshots(false)}
                  disabled={fetchingHeadshots}
                  title="Batch-fetch headshots for prospects without one"
                >
                  {fetchingHeadshots ? 'Fetching…' : 'Headshots'}
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
                  Refetch
                </Button>
                <Button size="sm" variant="secondary" onClick={importProspects}>Import JSON file</Button>
              </div>
            </div>
            <form onSubmit={addPlayer} className="grid md:grid-cols-4 gap-2 mb-4">
              <input
                required
                value={newP.name}
                onChange={(e) => setNewP({ ...newP, name: e.target.value })}
                placeholder="Name"
                aria-label="Prospect name"
                className="bg-bg-deep border border-border-focus rounded px-2 py-2 text-sm md:col-span-2"
              />
              <input
                required
                value={newP.position}
                onChange={(e) => setNewP({ ...newP, position: e.target.value.toUpperCase() })}
                placeholder="Pos"
                aria-label="Prospect position"
                className="bg-bg-deep border border-border-focus rounded px-2 py-2 text-sm uppercase"
              />
              <input
                value={newP.school}
                onChange={(e) => setNewP({ ...newP, school: e.target.value })}
                placeholder="School"
                aria-label="Prospect school (optional)"
                className="bg-bg-deep border border-border-focus rounded px-2 py-2 text-sm"
              />
              <Button type="submit" className="md:col-span-4">Add Prospect</Button>
            </form>
            <input
              type="search"
              value={playerSearch}
              onChange={(e) => setPlayerSearch(e.target.value)}
              placeholder="Search prospects…"
              aria-label="Search prospects"
              autoComplete="off"
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
            <Button onClick={runScore} disabled={scoreBusy}>
              {scoreBusy ? 'Scoring…' : 'Score all mocks'}
            </Button>
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

      {/* Algo Tuning */}
      {tab === 'algo' && (
        <div className="space-y-4">
          {!algoForm ? (
            <Card className="p-5"><div className="text-text-muted text-sm">Loading…</div></Card>
          ) : (
            <>
              {/* Draft Engine */}
              <Card className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-semibold text-text-primary">Draft Engine</h3>
                    <p className="text-text-muted text-xs mt-0.5">
                      Controls how the bot picker scores and selects players. Takes effect on the next draft run.
                    </p>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted mb-1">Scoring curve</div>
                  {algoField('decayRate', 'Decay rate (higher = top players dominate more)', { step: 0.005, min: 0.005, max: 0.15 })}
                  <div className="font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted mt-4 mb-1">Positional needs boost</div>
                  {algoField('needsBoost1', '1st need boost', { pct: true, min: 0, max: 100 })}
                  {algoField('needsBoost2', '2nd need boost', { pct: true, min: 0, max: 100 })}
                  {algoField('needsBoost3', '3rd need boost', { pct: true, min: 0, max: 100 })}
                  <div className="font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted mt-4 mb-1">
                    Hard fall caps <span className="normal-case tracking-normal font-normal text-text-muted">(player gets score ×boost after falling maxFall picks past their rank)</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[11px] text-text-muted font-display uppercase tracking-wide mb-1">
                    <span>Rank range</span><span className="text-center">Max fall</span><span className="text-center">Boost ×</span>
                  </div>
                  {[
                    ['fallCap1MaxRank', 'fallCap1MaxFall', 'fallCap1Boost', '1 –'],
                    ['fallCap2MaxRank', 'fallCap2MaxFall', 'fallCap2Boost', '6 –'],
                    ['fallCap3MaxRank', 'fallCap3MaxFall', 'fallCap3Boost', '11 –'],
                  ].map(([rankKey, fallKey, boostKey, prefix]) => (
                    <div key={rankKey} className="grid grid-cols-3 gap-2 items-center">
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] text-text-secondary font-mono">{prefix}</span>
                        <input
                          type="number"
                          step={1}
                          min={1}
                          max={500}
                          value={algoForm[rankKey]}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10);
                            if (Number.isFinite(v)) setAlgoForm((f) => ({ ...f, [rankKey]: v }));
                          }}
                          className="w-14 bg-bg-deep border border-border-focus rounded px-2 py-1 text-text-primary text-xs font-mono text-right"
                        />
                      </div>
                      <input
                        type="number"
                        step={1}
                        min={0}
                        max={100}
                        value={algoForm[fallKey]}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          if (Number.isFinite(v)) setAlgoForm((f) => ({ ...f, [fallKey]: v }));
                        }}
                        className="w-full bg-bg-deep border border-border-focus rounded px-2 py-1 text-text-primary text-xs font-mono text-right"
                      />
                      <input
                        type="number"
                        step={1}
                        min={1}
                        max={100}
                        value={algoForm[boostKey]}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          if (Number.isFinite(v)) setAlgoForm((f) => ({ ...f, [boostKey]: v }));
                        }}
                        className="w-full bg-bg-deep border border-border-focus rounded px-2 py-1 text-text-primary text-xs font-mono text-right"
                      />
                    </div>
                  ))}
                </div>
              </Card>

              {/* Trade Acceptance */}
              <Card className="p-5">
                <div className="mb-4">
                  <h3 className="font-semibold text-text-primary">Trade Acceptance</h3>
                  <p className="text-text-muted text-xs mt-0.5">
                    Controls how the CPU evaluates trade proposals. Takes effect immediately on the next trade.
                  </p>
                </div>
                <div className="space-y-3">
                  {algoField('tradeBasePremium', 'Base moving-up premium', { pct: true, min: 0, max: 50 })}
                  {algoField('tradeTop5Bonus', 'Extra premium for top-5 pick in deal', { pct: true, min: 0, max: 30 })}
                  {algoField('hardUnderpayLimit', 'Hard-reject threshold (underpay %)', { pct: true, min: 1, max: 90 })}
                </div>
              </Card>

              {/* Actions */}
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" onClick={resetAlgoConfig} disabled={algoBusy}>
                  Reset to Defaults
                </Button>
                <Button onClick={saveAlgoConfig} disabled={algoBusy}>
                  {algoBusy ? 'Saving…' : 'Save Config'}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Consensus Analytics */}
      {tab === 'consensus' && (
        <div className="space-y-5">

          {/* ── MAIN: Team Pick Breakdown ── */}
          <Card className="p-5">
            <div className="mb-4">
              <h3 className="font-display font-semibold text-text-primary text-sm uppercase tracking-[0.12em]">
                Team Pick Breakdown
              </h3>
              <p className="text-text-muted text-[11px] mt-0.5">
                Select a team to see top player choices at every pick slot across all 7-round team mocks
              </p>
            </div>

            {/* Team selector */}
            {order.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 mb-5">
                {[...new Map(order.map((o) => [o.team, o])).values()]
                  .filter((o) => o.team)
                  .sort((a, b) => a.team.localeCompare(b.team))
                  .map((o) => (
                    <button
                      key={o.team}
                      onClick={() => selectConsensusTeam(o.team)}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[11px] font-display font-semibold uppercase transition-all ${
                        consensusTeam === o.team
                          ? 'border-accent/60 bg-accent/[0.08] text-text-primary'
                          : 'border-border-subtle text-text-secondary hover:text-text-primary hover:border-border-focus'
                      }`}
                    >
                      <TeamLogo abbr={o.team} size="xs" />
                      {o.team}
                    </button>
                  ))}
              </div>
            ) : (
              <p className="text-text-muted text-[11px] mb-4">Load the Draft Order tab first to populate teams.</p>
            )}

            {/* No team selected */}
            {!consensusTeam && (
              <p className="text-text-muted text-sm text-center py-6">Select a team above to view their picks.</p>
            )}

            {/* Loading */}
            {consensusTeam && consensusTeamLoading && (
              <div className="space-y-2">
                {Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-24 w-full" />)}
              </div>
            )}

            {/* No data for team */}
            {consensusTeam && !consensusTeamLoading && consensusTeamData?.picks?.length === 0 && (
              <p className="text-text-muted text-sm text-center py-6">
                No team mocks saved for {consensusTeam} yet.
              </p>
            )}

            {/* Pick breakdown grouped by round */}
            {consensusTeam && !consensusTeamLoading && consensusTeamData?.picks?.length > 0 && (
              <div className="space-y-5">
                <p className="text-text-muted text-[11px]">
                  {consensusTeamData.total_team_mocks} team mock{consensusTeamData.total_team_mocks !== 1 ? 's' : ''} included {consensusTeam} picks
                </p>
                {Object.entries(teamPicksByRound)
                  .sort(([a], [b]) => Number(a) - Number(b))
                  .map(([round, picks]) => (
                    <div key={round}>
                      {/* Round header */}
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-display font-bold text-[11px] uppercase tracking-[0.16em] text-accent">
                          Round {round}
                        </span>
                        <div className="flex-1 h-px bg-border-subtle" />
                      </div>
                      {/* Picks in this round */}
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {picks.map((pick) => (
                          <div
                            key={pick.pick_number}
                            className="rounded border border-border-subtle bg-bg-deep overflow-hidden"
                          >
                            {/* Pick slot header */}
                            <div className="flex items-center justify-between px-3 py-1.5 bg-bg-elevated border-b border-border-subtle">
                              <span className="font-mono font-bold text-[12px] text-text-primary">
                                Pick {pick.pick_number}
                              </span>
                              <span className="text-[10px] text-text-muted font-mono">
                                {pick.slot_total}/{consensusTeamData.total_team_mocks} mocks
                              </span>
                            </div>
                            {/* Player options */}
                            <div className="divide-y divide-border-subtle">
                              {pick.options.map((opt) => {
                                const hex = posHex(opt.position);
                                return (
                                  <div key={opt.player_id} className="flex items-center gap-2 px-3 py-2">
                                    <PlayerHeadshot
                                      url={opt.headshot_url}
                                      name={opt.name}
                                      position={opt.position}
                                      size="sm"
                                    />
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-1 mb-1">
                                        <span className="text-[12px] font-semibold text-text-primary truncate">
                                          {opt.name}
                                        </span>
                                        <PositionBadge position={opt.position} />
                                      </div>
                                      <div className="flex items-center gap-1.5">
                                        <div className="flex-1 h-1 rounded-full bg-white/[0.06]">
                                          <div
                                            className="h-full rounded-full transition-all duration-500"
                                            style={{
                                              width: `${opt.pct}%`,
                                              backgroundColor: hex,
                                              boxShadow: `0 0 6px -1px ${hex}99`,
                                            }}
                                          />
                                        </div>
                                        <span className="font-mono text-[11px] text-text-secondary tabular-nums shrink-0 w-9 text-right">
                                          {opt.pct}%
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </Card>

          {/* ── Most Picked Players (all team mocks) ── */}
          <Card className="p-5">
            <div className="mb-4">
              <h3 className="font-display font-semibold text-text-primary text-sm uppercase tracking-[0.12em]">
                Most Picked Players
              </h3>
              <p className="text-text-muted text-[11px] mt-0.5">
                {consensusR1
                  ? `Based on ${consensusR1.total_mocks} team mock${consensusR1.total_mocks !== 1 ? 's' : ''} · all rounds`
                  : 'Most-drafted players across all saved team mocks'}
              </p>
            </div>

            {consensusLoading && (
              <div className="space-y-2">
                {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            )}

            {!consensusLoading && consensusR1?.total_mocks === 0 && (
              <p className="text-text-muted text-sm text-center py-6">No team mocks saved yet.</p>
            )}

            {!consensusLoading && consensusR1?.players?.length > 0 && (
              <div className="divide-y divide-border-subtle">
                {consensusR1.players.map((p, i) => {
                  const pct = consensusR1.total_mocks > 0
                    ? Math.round((p.pick_count / consensusR1.total_mocks) * 100)
                    : 0;
                  return (
                    <div key={p.id} className="flex items-center gap-3 py-2.5 hover:bg-white/[0.02] rounded px-1">
                      <span className="font-mono text-[11px] text-text-muted w-5 text-right shrink-0">{i + 1}</span>
                      <PlayerHeadshot url={p.headshot_url} name={p.name} position={p.position} size="sm" />
                      <div className="min-w-0 w-28 shrink-0">
                        <div className="text-[12px] font-semibold text-text-primary truncate">{p.name}</div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <PositionBadge position={p.position} />
                          <span className="text-text-muted text-[10px] truncate">{p.school}</span>
                        </div>
                      </div>
                      <div className="flex-1 flex items-center gap-2 min-w-0">
                        <div className="flex-1 h-1.5 rounded-full bg-white/[0.06]">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${pct}%`,
                              background: 'linear-gradient(90deg, var(--accent), #3b82f6)',
                            }}
                          />
                        </div>
                        <span className="font-mono text-[11px] text-text-muted tabular-nums shrink-0">
                          {p.pick_count}/{consensusR1.total_mocks}
                        </span>
                      </div>
                      <span className="font-mono text-[11px] text-text-secondary shrink-0 w-14 text-right">
                        Avg #{p.avg_pick}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* ── Position Distribution ── */}
          <Card className="p-5">
            <h3 className="font-display font-semibold text-text-primary text-sm uppercase tracking-[0.12em] mb-4">
              Position Distribution
            </h3>

            {consensusLoading && (
              <div className="space-y-2">
                {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}
              </div>
            )}

            {!consensusLoading && consensusPos?.total_r1_picks === 0 && (
              <p className="text-text-muted text-sm text-center py-6">No team mock picks to analyze yet.</p>
            )}

            {!consensusLoading && consensusPos?.positions?.length > 0 && (
              <div className="space-y-2">
                {consensusPos.positions.map((pos) => {
                  const pct = consensusPos.total_r1_picks > 0
                    ? (pos.pick_count / consensusPos.total_r1_picks) * 100
                    : 0;
                  const hex = posHex(pos.position);
                  return (
                    <div key={pos.position} className="flex items-center gap-3">
                      <PositionBadge position={pos.position} />
                      <div className="flex-1 h-2 rounded-full bg-white/[0.06]">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: hex,
                            boxShadow: `0 0 8px -2px ${hex}88`,
                          }}
                        />
                      </div>
                      <span className="font-mono text-[11px] text-text-muted tabular-nums w-20 text-right shrink-0">
                        {pos.pick_count} picks · {Math.round(pct)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

        </div>
      )}

      {/* Volume Stats */}
      {tab === 'volume' && (
        <div className="space-y-5">

          {/* Header + refresh */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-display font-semibold text-text-primary text-sm uppercase tracking-[0.12em]">
                Volume Stats — {syncYear}
              </h3>
              <p className="text-text-muted text-[11px] mt-0.5">
                Draft session telemetry · how much data we have and where the gaps are
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => { setVolumeStats(null); loadVolumeStats(); }} disabled={volumeLoading}>
              {volumeLoading ? 'Loading…' : 'Refresh'}
            </Button>
          </div>

          {volumeLoading && !volumeStats && (
            <div className="space-y-3">
              <Skeleton className="h-24" />
              <Skeleton className="h-40" />
              <Skeleton className="h-40" />
            </div>
          )}

          {volumeStats && (
            <>
              {/* ── Overview cards ── */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  ['Total Sessions', volumeStats.overview.total_sessions],
                  ['Completed', volumeStats.overview.completed],
                  ['Abandoned', volumeStats.overview.abandoned],
                  ['Completion Rate', volumeStats.overview.total_sessions > 0
                    ? `${Math.round((volumeStats.overview.completed / volumeStats.overview.total_sessions) * 100)}%`
                    : '—'],
                  ['Unique Users', volumeStats.overview.unique_users],
                  ['Anonymous', volumeStats.overview.anonymous_sessions],
                  ['Avg Duration', volumeStats.overview.avg_duration_sec != null
                    ? `${Math.floor(volumeStats.overview.avg_duration_sec / 60)}m ${volumeStats.overview.avg_duration_sec % 60}s`
                    : '—'],
                  ['Data Range', volumeStats.overview.earliest_session
                    ? `${new Date(volumeStats.overview.earliest_session).toLocaleDateString()} → ${new Date(volumeStats.overview.latest_session).toLocaleDateString()}`
                    : '—'],
                ].map(([label, value]) => (
                  <Card key={label} className="p-3 text-center">
                    <div className="text-text-muted text-[10px] uppercase tracking-widest font-display">{label}</div>
                    <div className="text-text-primary font-display font-bold text-lg mt-1">{value}</div>
                  </Card>
                ))}
              </div>

              {/* ── Team mock breakdown (the money table) ── */}
              <Card className="p-5">
                <h4 className="font-display font-semibold text-text-primary text-xs uppercase tracking-[0.12em] mb-1">
                  Completed Team Mocks by Team
                </h4>
                <p className="text-text-muted text-[10px] mb-3">
                  This is the data set that powers consensus analytics. More completed mocks = better data.
                </p>
                {volumeStats.byTeam.length === 0 ? (
                  <p className="text-text-muted text-xs">No team mock sessions yet.</p>
                ) : (
                  <>
                    {/* Summary bar */}
                    {(() => {
                      const totalCompleted = volumeStats.byTeam.reduce((s, r) => s + r.completed, 0);
                      const teamCount = volumeStats.byTeam.filter((r) => r.completed > 0).length;
                      return (
                        <div className="flex gap-4 mb-4 text-[11px]">
                          <span className="text-text-muted">
                            Total completed team mocks: <span className="text-text-primary font-bold">{totalCompleted}</span>
                          </span>
                          <span className="text-text-muted">
                            Teams with data: <span className="text-text-primary font-bold">{teamCount}/32</span>
                          </span>
                        </div>
                      );
                    })()}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 max-h-[420px] overflow-y-auto">
                      {volumeStats.byTeam.map((row) => {
                        const maxCompleted = volumeStats.byTeam[0]?.completed || 1;
                        const barW = Math.max((row.completed / maxCompleted) * 100, 2);
                        return (
                          <div key={row.user_team} className="flex items-center gap-2 p-1.5 rounded border border-border-subtle bg-bg-surface/40">
                            <TeamLogo abbr={row.user_team} size="xs" />
                            <span className="font-display font-bold text-[11px] uppercase tracking-wide text-text-primary w-10 shrink-0">
                              {row.user_team}
                            </span>
                            <div className="flex-1 h-4 rounded bg-bg-deep overflow-hidden">
                              <div
                                className="h-full rounded transition-all"
                                style={{
                                  width: `${barW}%`,
                                  backgroundColor: row.completed >= 10 ? '#22c55e' : row.completed >= 5 ? '#eab308' : '#ef4444',
                                }}
                              />
                            </div>
                            <span className="font-mono text-[10px] text-text-muted tabular-nums w-24 text-right shrink-0">
                              {row.completed} done · {row.total} total
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex gap-4 mt-3 text-[10px] text-text-muted">
                      <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#22c55e' }} /> 10+ (good)</span>
                      <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#eab308' }} /> 5-9 (building)</span>
                      <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#ef4444' }} /> &lt;5 (needs more)</span>
                    </div>
                  </>
                )}
              </Card>

              {/* ── Daily trend (last 30 days) ── */}
              <Card className="p-5">
                <h4 className="font-display font-semibold text-text-primary text-xs uppercase tracking-[0.12em] mb-3">
                  Daily Volume — Last 30 Days
                </h4>
                {volumeStats.daily.length === 0 ? (
                  <p className="text-text-muted text-xs">No sessions in the last 30 days.</p>
                ) : (
                  <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
                    {(() => {
                      const maxDay = Math.max(...volumeStats.daily.map((d) => d.total));
                      return volumeStats.daily.map((row) => {
                        const totalBarW = maxDay > 0 ? Math.max((row.total / maxDay) * 100, 3) : 0;
                        const completedBarW = maxDay > 0 ? Math.max((row.completed / maxDay) * 100, 1) : 0;
                        // Append T12:00:00 to avoid any timezone-boundary day shift
                        const dayDate = new Date(row.day + 'T12:00:00');
                        return (
                          <div key={row.day} className="flex items-center gap-2">
                            <span className="font-mono text-[10px] text-text-muted w-20 shrink-0">
                              {dayDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', weekday: 'short' })}
                            </span>
                            <div className="flex-1 h-5 rounded bg-bg-deep overflow-hidden relative">
                              <div
                                className="h-full absolute left-0 top-0 rounded"
                                style={{ width: `${totalBarW}%`, backgroundColor: '#3b82f6', opacity: 0.15 }}
                              />
                              <div
                                className="h-full absolute left-0 top-0 rounded"
                                style={{ width: `${completedBarW}%`, backgroundColor: '#3b82f6' }}
                              />
                            </div>
                            <span className="font-mono text-[10px] text-text-muted tabular-nums w-32 text-right shrink-0">
                              {row.completed}/{row.total} done · {row.distinct_teams} teams
                            </span>
                          </div>
                        );
                      });
                    })()}
                  </div>
                )}
              </Card>

              {/* ── Top contributors ── */}
              {volumeStats.topUsers.length > 0 && (
                <Card className="p-5">
                  <h4 className="font-display font-semibold text-text-primary text-xs uppercase tracking-[0.12em] mb-3">
                    Top Contributors — Completed Team Mocks
                  </h4>
                  <div className="space-y-1.5">
                    {volumeStats.topUsers.map((u, i) => (
                      <div key={u.user_id} className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-text-muted w-5 text-right shrink-0">{i + 1}.</span>
                        <span className={`text-xs font-medium truncate flex-1 ${u.user_id === 'guest' ? 'text-text-muted italic' : 'text-text-primary'}`}>
                          {u.display_name}
                        </span>
                        <span className="font-mono text-[11px] text-accent tabular-nums font-bold">
                          {u.completed_team_mocks}
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* ── Recent sessions ── */}
              {volumeStats.recent?.length > 0 && (
                <Card className="p-5">
                  <h4 className="font-display font-semibold text-text-primary text-xs uppercase tracking-[0.12em] mb-3">
                    Latest 20 Sessions
                  </h4>
                  <div className="space-y-1">
                    {volumeStats.recent.map((s) => {
                      const time = new Date(s.started_at);
                      return (
                        <div key={s.id} className="flex items-center gap-2 py-1 border-b border-border-subtle/50 last:border-0">
                          <TeamLogo abbr={s.user_team} size="xs" />
                          <span className="font-display font-bold text-[11px] uppercase tracking-wide text-text-primary w-10 shrink-0">
                            {s.user_team}
                          </span>
                          <span className={`text-[11px] w-20 shrink-0 font-medium ${s.completed_at ? 'text-green-500' : 'text-text-muted'}`}>
                            {s.completed_at ? 'Completed' : 'Abandoned'}
                          </span>
                          <span className={`text-[11px] w-14 shrink-0 ${s.is_guest ? 'text-text-muted italic' : 'text-text-primary'}`}>
                            {s.is_guest ? 'Guest' : s.display_name}
                          </span>
                          <span className="font-mono text-[10px] text-text-muted ml-auto shrink-0">
                            {time.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{' '}
                            {time.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              )}
            </>
          )}
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

      <Modal
        open={bulkImportOpen}
        onClose={() => setBulkImportOpen(false)}
        title="Bulk Import Prospects"
        footer={
          <>
            <Button variant="secondary" onClick={() => setBulkImportOpen(false)} disabled={bulkImportBusy}>
              Cancel
            </Button>
            <Button onClick={submitBulkImport} disabled={bulkImportBusy || !bulkImportText.trim()}>
              {bulkImportBusy ? 'Importing…' : 'Import'}
            </Button>
          </>
        }
      >
        <p className="mb-3">
          Paste a JSON array of prospects. Required fields: <code className="text-accent font-mono text-[11px]">name</code>,{' '}
          <code className="text-accent font-mono text-[11px]">position</code>. Optional:{' '}
          <code className="text-accent font-mono text-[11px]">school</code>,{' '}
          <code className="text-accent font-mono text-[11px]">headshot_url</code>.
        </p>
        <p className="mb-3 text-text-muted text-[11px]">
          Existing players (matched case-insensitive by name) get updated. No deletes.
        </p>
        <textarea
          value={bulkImportText}
          onChange={(e) => setBulkImportText(e.target.value)}
          placeholder={'[\n  { "name": "Cam Ward", "position": "QB", "school": "Miami (FL)" },\n  { "name": "Travis Hunter", "position": "WR", "school": "Colorado" }\n]'}
          className="w-full bg-bg-deep border border-border-focus rounded px-3 py-2 text-text-primary text-[12px] font-mono h-48"
          spellCheck={false}
        />
      </Modal>
    </div>
  );
}

// One row in the Draft Order grid. Both draggable (can be picked up) and
// droppable (can receive another row dropped on it). Editing the team
// fields inline still works — drag is initiated by the grab handle.
function TradesPanel({
  values,
  sideAPicks,
  sideBPicks,
  sideATeam,
  sideBTeam,
  setSideATeam,
  setSideBTeam,
  addPickToSide,
  removePickFromSide,
  tradeResult,
  clearTrade,
  applyTradeAction,
  tradePickSearch,
  setTradePickSearch,
}) {
  const byPick = new Map(values.map((v) => [v.pick, v]));
  const q = tradePickSearch.trim().toLowerCase();
  const filtered = values.filter((v) => {
    if (!q) return true;
    return (
      String(v.pick).includes(q) ||
      (v.team || '').toLowerCase().includes(q)
    );
  });

  const verdictLabel = tradeResult?.verdict
    ? { fair: 'Fair', slight_lean: 'Slight lean', lopsided: 'Lopsided' }[tradeResult.verdict]
    : null;
  const verdictColor = {
    fair: 'text-emerald-400',
    slight_lean: 'text-gold',
    lopsided: 'text-red-400',
  }[tradeResult?.verdict] || 'text-text-secondary';

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h3 className="font-semibold text-text-primary mb-1">Trade Calculator · Rich Hill Chart</h3>
        <p className="text-text-muted text-xs">
          Add picks to each side. Calculator updates live. Apply only affects picks 1-32 in the draft board; picks outside R1 are counted in value but skipped on apply.
        </p>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <TradeSide
          label="Side A"
          team={sideATeam}
          setTeam={setSideATeam}
          picks={sideAPicks}
          byPick={byPick}
          onRemove={(p) => removePickFromSide('a', p)}
          total={tradeResult?.side_a?.total ?? 0}
        />
        <TradeSide
          label="Side B"
          team={sideBTeam}
          setTeam={setSideBTeam}
          picks={sideBPicks}
          byPick={byPick}
          onRemove={(p) => removePickFromSide('b', p)}
          total={tradeResult?.side_b?.total ?? 0}
        />
      </div>

      {/* Verdict bar */}
      <Card className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-4 font-mono tabular">
            <div>
              <div className="caption text-[9px]">Side A</div>
              <div className="text-2xl font-bold text-text-primary">{tradeResult?.side_a?.total ?? 0}</div>
            </div>
            <div className="text-text-muted text-xl">↔</div>
            <div>
              <div className="caption text-[9px]">Side B</div>
              <div className="text-2xl font-bold text-text-primary">{tradeResult?.side_b?.total ?? 0}</div>
            </div>
            {tradeResult && (
              <div className="ml-4">
                <div className="caption text-[9px]">Diff</div>
                <div className={`text-xl font-bold ${verdictColor}`}>
                  {tradeResult.diff > 0 ? '+' : ''}{tradeResult.diff}
                  <span className="text-text-muted text-xs ml-1">({tradeResult.pct_diff}%)</span>
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {verdictLabel && (
              <span className={`font-display uppercase tracking-[0.14em] text-[11px] ${verdictColor}`}>
                {verdictLabel}
                {tradeResult.favors && (
                  <span className="ml-1 text-text-secondary">
                    · favors {tradeResult.favors.toUpperCase()}
                  </span>
                )}
              </span>
            )}
            <Button size="sm" variant="ghost" onClick={clearTrade}>Clear</Button>
            <Button size="sm" onClick={applyTradeAction} disabled={!sideATeam || !sideBTeam || (sideAPicks.length === 0 && sideBPicks.length === 0)}>
              Apply
            </Button>
          </div>
        </div>
      </Card>

      {/* Pick browser */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="font-semibold text-text-primary">Pick browser</h3>
          <input
            value={tradePickSearch}
            onChange={(e) => setTradePickSearch(e.target.value)}
            placeholder="Search by pick # or team…"
            autoComplete="off"
            className="w-64 bg-bg-deep border border-border-focus rounded px-3 py-1.5 text-text-primary text-sm"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 max-h-[60vh] overflow-y-auto">
          {filtered.map((v) => {
            const inA = sideAPicks.includes(v.pick);
            const inB = sideBPicks.includes(v.pick);
            const used = inA || inB;
            return (
              <div
                key={v.pick}
                className={`flex items-center gap-2 p-2 rounded border text-sm ${
                  used ? 'border-accent/40 bg-accent/[0.05]' : 'border-border-subtle bg-bg-deep'
                }`}
              >
                <span className="font-mono text-accent w-8 text-right text-xs">{v.pick}</span>
                <TeamLogo abbr={v.team} size="xs" />
                <span className="font-display font-semibold text-text-primary text-xs w-10">{v.team}</span>
                <span className="font-mono text-gold text-xs flex-1 text-right">{v.value}</span>
                {used ? (
                  <button
                    onClick={() => (inA ? removePickFromSide('a', v.pick) : removePickFromSide('b', v.pick))}
                    className="text-[10px] text-red-400 hover:text-red-300 px-1 font-display uppercase"
                  >
                    Remove
                  </button>
                ) : (
                  <div className="flex gap-1">
                    <button
                      onClick={() => addPickToSide('a', v.pick)}
                      className="text-[10px] text-text-secondary hover:text-text-primary px-1.5 py-0.5 rounded border border-border-subtle hover:border-border-focus font-display uppercase"
                      title="Add to Side A"
                    >
                      A
                    </button>
                    <button
                      onClick={() => addPickToSide('b', v.pick)}
                      className="text-[10px] text-text-secondary hover:text-text-primary px-1.5 py-0.5 rounded border border-border-subtle hover:border-border-focus font-display uppercase"
                      title="Add to Side B"
                    >
                      B
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-full text-center text-text-muted text-sm py-4">No matches</div>
          )}
        </div>
      </Card>
    </div>
  );
}

function TradeSide({ label, team, setTeam, picks, byPick, onRemove, total }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="caption text-[10px]">{label}</div>
        <input
          value={team}
          onChange={(e) => setTeam(e.target.value.toUpperCase().slice(0, 5))}
          placeholder="TEAM"
          className="w-16 bg-bg-deep border border-border-focus rounded px-2 py-1 text-text-primary text-sm uppercase font-display font-semibold"
        />
        {team && <TeamLogo abbr={team} size="xs" />}
        <div className="flex-1 text-right">
          <span className="font-mono text-2xl font-bold text-gold tabular">{total}</span>
        </div>
      </div>
      <ul className="space-y-1 min-h-[60px]">
        {picks.length === 0 ? (
          <li className="text-text-muted text-xs text-center py-3">No picks yet</li>
        ) : (
          picks.map((p) => {
            const row = byPick.get(p);
            if (!row) return null;
            return (
              <li key={p} className="flex items-center gap-2 p-2 bg-bg-deep rounded border border-border-subtle text-sm">
                <span className="font-mono text-accent w-8 text-right text-xs">{p}</span>
                <TeamLogo abbr={row.team} size="xs" />
                <span className="font-display font-semibold text-text-primary w-10 text-xs">{row.team}</span>
                <span className="font-mono text-gold flex-1 text-right text-xs">{row.value}</span>
                <button
                  onClick={() => onRemove(p)}
                  className="text-[10px] text-red-400 hover:text-red-300 px-1 font-display uppercase"
                >
                  ✕
                </button>
              </li>
            );
          })
        )}
      </ul>
    </Card>
  );
}

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

// Per-team needs editor. Loads all draft_order rows (all rounds), groups by
// team (keeping the first non-empty needs we see since needs are logically
// per-team, not per-pick), and posts a bulk update via /admin/team-needs.
function TeamNeedsCard({ adminKey }) {
  const [rows, setRows] = useState(null);
  const [needsMap, setNeedsMap] = useState({}); // team → comma-separated string
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    if (!adminKey) return;
    try {
      const data = await api.adminGetDraftOrder(adminKey, { round: 'all' });
      setRows(data);
      // Build initial needsMap from the first row seen per team with non-empty needs
      const map = {};
      const seen = new Set();
      for (const r of data) {
        if (seen.has(r.team)) continue;
        seen.add(r.team);
        const needs = Array.isArray(r.team_needs) ? r.team_needs.join(', ') : '';
        map[r.team] = needs;
      }
      // Also include teams that have only empty needs (ensure every team has an entry)
      for (const r of data) if (!(r.team in map)) map[r.team] = '';
      setNeedsMap(map);
      setDirty(false);
    } catch (e) {
      console.error('[team-needs load]', e);
      toast.error('Failed to load draft order');
    }
  }, [adminKey]);

  useEffect(() => { load(); }, [load]);

  // Unique team list sorted by their earliest pick number — matches the order
  // teams will actually pick in, so the editor reads like a draft order.
  const teamsInOrder = useMemo(() => {
    if (!rows) return [];
    const firstPick = new Map();
    for (const r of rows) {
      if (!firstPick.has(r.team) || r.pick_number < firstPick.get(r.team)) {
        firstPick.set(r.team, r.pick_number);
      }
    }
    return [...firstPick.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([team, pick]) => ({ team, firstPick: pick }));
  }, [rows]);

  function updateNeeds(team, value) {
    setNeedsMap((prev) => ({ ...prev, [team]: value }));
    setDirty(true);
  }

  async function saveAll() {
    if (!adminKey) return;
    setBusy(true);
    try {
      const payload = {};
      for (const [team, str] of Object.entries(needsMap)) {
        payload[team] = str
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean);
      }
      const res = await api.adminSetTeamNeeds(adminKey, payload);
      toast.success(`Updated ${res.rows_updated} draft_order rows`);
      setDirty(false);
      // Also bust any cached draft order so the team-mock page picks up the
      // new needs on next visit.
      invalidateCache('draft-order');
    } catch (e) {
      console.error('[team-needs save]', e);
      toast.error(e.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  if (!rows) {
    return (
      <Card className="p-5">
        <div className="text-text-muted text-sm">Loading draft order…</div>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h3 className="font-semibold text-text-primary">Team Needs</h3>
          <p className="text-text-muted text-xs mt-0.5">
            Propagates to every draft_order row for that team across all 7 rounds.
            The team-mock bot uses these to weight BPA picks toward positions of need.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={load} disabled={busy}>
            Reload
          </Button>
          <Button size="sm" onClick={saveAll} disabled={busy || !dirty}>
            {busy ? 'Saving…' : dirty ? 'Save Needs' : 'Saved'}
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {teamsInOrder.map(({ team, firstPick }) => (
          <div key={team} className="flex items-center gap-2 p-2 rounded-md border border-border-subtle bg-bg-surface/40">
            <span className="font-mono text-[10px] text-text-muted w-6 text-right shrink-0">
              #{firstPick}
            </span>
            <TeamLogo abbr={team} size="xs" />
            <span className="font-display font-bold text-[11px] uppercase tracking-wide text-text-primary w-10 shrink-0">
              {team}
            </span>
            <input
              value={needsMap[team] || ''}
              onChange={(e) => updateNeeds(team, e.target.value)}
              placeholder="QB, WR, OT, EDGE"
              className="flex-1 bg-bg-deep border border-border-focus rounded px-2 py-1 text-text-primary text-xs uppercase min-w-0"
            />
          </div>
        ))}
      </div>
    </Card>
  );
}
