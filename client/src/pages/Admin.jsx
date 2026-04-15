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
  ['ranks', 'Player Ranks'],
  ['users', 'Users'],
  ['scoring', 'Scoring & Lock'],
  ['algo', 'Algo Tuning'],
  ['consensus', 'Consensus'],
  ['volume', 'Volume Stats'],
  ['boards', 'Boards'],
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
  // Player Ranks tab state
  const [rankCsvText, setRankCsvText] = useState('');
  const [rankCsvFileName, setRankCsvFileName] = useState('');
  const [rankDraftYear, setRankDraftYear] = useState(2026);
  const [rankPreview, setRankPreview] = useState(null); // { rows, errors }
  const [rankBusy, setRankBusy] = useState(false);
  const [rankResult, setRankResult] = useState(null);
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
  const [consensusPosFilter, setConsensusPosFilter] = useState('ALL');
  const [expandedRounds, setExpandedRounds] = useState(new Set());

  // Volume stats tab
  const [volumeStats, setVolumeStats] = useState(null);
  const [volumeLoading, setVolumeLoading] = useState(false);

  // Boards tab
  const [boardStats, setBoardStats] = useState(null);
  const [boardsLoading, setBoardsLoading] = useState(false);

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
    setExpandedRounds(new Set());
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

  // ---------- Boards ----------
  function loadBoardStats() {
    setBoardsLoading(true);
    api.adminBoardStats(key)
      .then(setBoardStats)
      .catch((e) => toast.error(e.message))
      .finally(() => setBoardsLoading(false));
  }
  useEffect(() => {
    if (!unlocked || tab !== 'boards') return;
    if (boardStats) return;
    loadBoardStats();
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

  // Parse a CSV (or TSV) into rank rows. Accepts flexible header names:
  // rank | consensus_rank | overall_rank, name | player | player_name,
  // position | pos, school | team | college, projected_round | round.
  // Returns { rows, errors, headers }.
  function parsePlayerRankCsv(text) {
    const errors = [];
    const rows = [];
    if (!text || !text.trim()) return { rows, errors: ['empty file'], headers: [] };

    // Normalize newlines + strip UTF-8 BOM if present.
    const clean = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const lines = clean.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length < 2) return { rows, errors: ['need header + at least one row'], headers: [] };

    // Autodetect delimiter — comma or tab. Prefer tab if it appears more
    // often than comma in the header line.
    const head = lines[0];
    const delim = (head.match(/\t/g) || []).length > (head.match(/,/g) || []).length ? '\t' : ',';

    const splitRow = (line) => {
      // Minimal RFC-4180-ish CSV split supporting double-quoted fields. TSV
      // path is simpler — we just split on tab since tabs don't appear
      // inside exported fields in practice.
      if (delim === '\t') return line.split('\t').map((c) => c.trim());
      const out = [];
      let cur = '';
      let q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (q) {
          if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
          else if (ch === '"') { q = false; }
          else { cur += ch; }
        } else if (ch === '"') {
          q = true;
        } else if (ch === ',') {
          out.push(cur.trim()); cur = '';
        } else {
          cur += ch;
        }
      }
      out.push(cur.trim());
      return out;
    };

    const headerCells = splitRow(head).map((h) =>
      h.toLowerCase().replace(/^"|"$/g, '').trim().replace(/[\s-]+/g, '_')
    );
    const findIdx = (aliases) => headerCells.findIndex((h) => aliases.includes(h));
    const idxRank = findIdx(['rank', 'consensus_rank', 'overall_rank', 'overall', 'ovr']);
    const idxName = findIdx(['name', 'player', 'player_name', 'full_name']);
    const idxPos = findIdx(['position', 'pos']);
    const idxSchool = findIdx(['school', 'college', 'team']);
    const idxRound = findIdx(['projected_round', 'proj_round', 'round']);

    if (idxName === -1) errors.push('CSV must have a "name" (or "player") column');
    if (idxRank === -1) errors.push('CSV must have a "rank" (or "consensus_rank") column');
    if (errors.length) return { rows, errors, headers: headerCells };

    for (let i = 1; i < lines.length; i++) {
      const cells = splitRow(lines[i]).map((c) => c.replace(/^"|"$/g, ''));
      const name = (cells[idxName] || '').trim();
      const rankStr = (cells[idxRank] || '').trim();
      const rank = parseInt(rankStr, 10);
      if (!name) { errors.push(`row ${i + 1}: missing name`); continue; }
      if (!Number.isFinite(rank) || rank <= 0) {
        errors.push(`row ${i + 1}: invalid rank "${rankStr}" for ${name}`);
        continue;
      }
      const row = { name, rank };
      if (idxPos !== -1 && cells[idxPos]) row.position = cells[idxPos].trim();
      if (idxSchool !== -1 && cells[idxSchool]) row.school = cells[idxSchool].trim();
      if (idxRound !== -1 && cells[idxRound]) {
        const rd = parseInt(cells[idxRound], 10);
        if (Number.isFinite(rd)) row.projected_round = rd;
      }
      rows.push(row);
    }
    return { rows, errors, headers: headerCells };
  }

  function onRankCsvFile(file) {
    if (!file) return;
    setRankCsvFileName(file.name);
    setRankResult(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result || '');
      setRankCsvText(text);
      setRankPreview(parsePlayerRankCsv(text));
    };
    reader.onerror = () => toast.error('Could not read file');
    reader.readAsText(file);
  }

  function previewRankText() {
    setRankPreview(parsePlayerRankCsv(rankCsvText));
    setRankResult(null);
  }

  async function submitPlayerRanks() {
    const preview = rankPreview || parsePlayerRankCsv(rankCsvText);
    setRankPreview(preview);
    if (!preview.rows.length) {
      toast.error('No valid rows to upload');
      return;
    }
    setRankBusy(true);
    const id = toast.loading(`Uploading ${preview.rows.length} ranks…`);
    try {
      const r = await api.bulkImportPlayerRanks(key, preview.rows, {
        draft_year: Number(rankDraftYear) || undefined,
      });
      toast.dismiss(id);
      toast.success(
        `Updated ${r.updated} · inserted ${r.inserted} · unchanged ${r.unchanged}` +
        (r.not_found_count ? ` · ${r.not_found_count} not found` : '')
      );
      setRankResult(r);
      invalidateCache('players');
      loadAll({ fresh: true });
    } catch (e) {
      toast.dismiss(id);
      toast.error(e.message);
    } finally {
      setRankBusy(false);
    }
  }

  function clearRankCsv() {
    setRankCsvText('');
    setRankCsvFileName('');
    setRankPreview(null);
    setRankResult(null);
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
  // Aggregate all player options across pick slots within each round,
  // summing pick_count so that a player drafted at any slot in that round
  // counts once. Sorted by total pick_count desc.
  const playersByRound = consensusTeamData?.picks
    ? (() => {
        const byRound = {};
        for (const pick of consensusTeamData.picks) {
          const r = pick.round;
          if (!byRound[r]) byRound[r] = new Map();
          for (const opt of pick.options) {
            const existing = byRound[r].get(opt.player_id);
            if (existing) {
              existing.pick_count += opt.pick_count;
            } else {
              byRound[r].set(opt.player_id, { ...opt });
            }
          }
        }
        // Convert each round's map to a sorted array
        const result = {};
        for (const [r, map] of Object.entries(byRound)) {
          result[r] = [...map.values()].sort((a, b) => b.pick_count - a.pick_count);
        }
        return result;
      })()
    : {};

  // Derive the unique positions present in the r1 consensus data for filter pills
  const consensusPositions = consensusR1?.players
    ? [...new Set(consensusR1.players.map((p) => p.position))].sort()
    : [];

  // Apply position filter client-side
  const filteredConsensusPlayers = consensusR1?.players
    ? (consensusPosFilter === 'ALL'
        ? consensusR1.players
        : consensusR1.players.filter((p) => p.position === consensusPosFilter))
    : [];

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

      {/* Player Ranks — upload updated consensus ranks via CSV */}
      {tab === 'ranks' && (
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div>
                <h3 className="font-semibold text-text-primary">Upload Player Ranks</h3>
                <p className="text-text-muted text-[11.5px] mt-0.5 leading-relaxed">
                  Upload a CSV to upsert <code className="text-accent font-mono">consensus_rank</code> on
                  existing players (matched case-insensitive by name). Required columns:{' '}
                  <code className="text-accent font-mono">name</code>,{' '}
                  <code className="text-accent font-mono">rank</code>. Optional:{' '}
                  <code className="text-accent font-mono">position</code>,{' '}
                  <code className="text-accent font-mono">school</code>,{' '}
                  <code className="text-accent font-mono">projected_round</code>. Rows with a position
                  will insert new players when the name isn't found.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="caption">
                  Draft Year
                  <input
                    type="number"
                    value={rankDraftYear}
                    onChange={(e) => setRankDraftYear(e.target.value)}
                    className="ml-2 bg-bg-deep border border-border-focus rounded px-2 py-1 text-sm w-24 tabular"
                    aria-label="Draft year"
                  />
                </label>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 mb-3">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="file"
                  accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
                  onChange={(e) => onRankCsvFile(e.target.files?.[0])}
                  className="block text-sm text-text-secondary file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-accent/20 file:text-accent hover:file:bg-accent/30 file:cursor-pointer cursor-pointer"
                  aria-label="Select CSV file"
                />
              </label>
              {rankCsvFileName && (
                <span className="text-text-muted text-xs truncate max-w-[240px]" title={rankCsvFileName}>
                  {rankCsvFileName}
                </span>
              )}
              {(rankCsvText || rankPreview) && (
                <Button size="sm" variant="ghost" onClick={clearRankCsv} disabled={rankBusy}>
                  Clear
                </Button>
              )}
            </div>

            <textarea
              value={rankCsvText}
              onChange={(e) => {
                setRankCsvText(e.target.value);
                setRankPreview(null);
                setRankResult(null);
              }}
              placeholder={'rank,name,position,school\n1,Cam Ward,QB,Miami (FL)\n2,Travis Hunter,WR,Colorado'}
              className="w-full bg-bg-deep border border-border-focus rounded px-3 py-2 text-text-primary text-[12px] font-mono h-40 mb-3"
              spellCheck={false}
              aria-label="CSV contents"
            />

            <div className="flex flex-wrap gap-2 mb-3">
              <Button
                size="sm"
                variant="secondary"
                onClick={previewRankText}
                disabled={rankBusy || !rankCsvText.trim()}
              >
                Preview
              </Button>
              <Button
                size="sm"
                onClick={submitPlayerRanks}
                disabled={rankBusy || !rankCsvText.trim() || !!(rankPreview?.errors?.length && !rankPreview?.rows?.length)}
              >
                {rankBusy ? 'Uploading…' : 'Upload Ranks'}
              </Button>
            </div>

            {rankPreview && (
              <div className="border border-border-subtle rounded p-3 bg-bg-deep/40">
                <div className="flex flex-wrap items-center gap-4 mb-2 text-[12px]">
                  <span className="text-text-primary font-semibold">
                    Parsed: <span className="text-accent tabular">{rankPreview.rows.length}</span>
                  </span>
                  {rankPreview.errors.length > 0 && (
                    <span className="text-red-400">
                      {rankPreview.errors.length} parse error{rankPreview.errors.length === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                {rankPreview.errors.length > 0 && (
                  <ul className="text-[11.5px] text-red-300 list-disc pl-4 mb-2 max-h-32 overflow-y-auto">
                    {rankPreview.errors.slice(0, 25).map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                    {rankPreview.errors.length > 25 && (
                      <li className="text-text-muted">…and {rankPreview.errors.length - 25} more</li>
                    )}
                  </ul>
                )}
                {rankPreview.rows.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="text-left caption">
                          <th className="px-2 py-1 font-display">Rank</th>
                          <th className="px-2 py-1 font-display">Name</th>
                          <th className="px-2 py-1 font-display">Pos</th>
                          <th className="px-2 py-1 font-display">School</th>
                          <th className="px-2 py-1 font-display text-right">Proj Rd</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rankPreview.rows.slice(0, 20).map((r, i) => (
                          <tr key={i} className="border-t border-border-subtle">
                            <td className="px-2 py-1 tabular">{r.rank}</td>
                            <td className="px-2 py-1 text-text-primary">{r.name}</td>
                            <td className="px-2 py-1">{r.position || <span className="text-text-muted">—</span>}</td>
                            <td className="px-2 py-1 text-text-muted">{r.school || '—'}</td>
                            <td className="px-2 py-1 text-right tabular">
                              {r.projected_round ?? <span className="text-text-muted">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {rankPreview.rows.length > 20 && (
                      <div className="text-text-muted text-[11px] mt-1">
                        …and {rankPreview.rows.length - 20} more rows
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {rankResult && (
              <div className="mt-3 border border-border-subtle rounded p-3 bg-bg-deep/40 text-[12.5px]">
                <div className="font-semibold text-text-primary mb-2">Upload Result</div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-2">
                  <div><span className="caption">Received</span><div className="tabular">{rankResult.received}</div></div>
                  <div><span className="caption">Updated</span><div className="tabular text-accent">{rankResult.updated}</div></div>
                  <div><span className="caption">Inserted</span><div className="tabular text-emerald-400">{rankResult.inserted}</div></div>
                  <div><span className="caption">Unchanged</span><div className="tabular text-text-muted">{rankResult.unchanged}</div></div>
                  <div><span className="caption">Not Found</span><div className="tabular text-yellow-400">{rankResult.not_found_count}</div></div>
                </div>
                {rankResult.not_found?.length > 0 && (
                  <details className="text-[11.5px]">
                    <summary className="cursor-pointer text-text-muted hover:text-text-primary">
                      Show first {rankResult.not_found.length} not-found names
                    </summary>
                    <ul className="list-disc pl-4 mt-1 max-h-40 overflow-y-auto">
                      {rankResult.not_found.map((n, i) => (
                        <li key={i}>{n.name} <span className="text-text-muted">(rank {n.rank})</span></li>
                      ))}
                    </ul>
                  </details>
                )}
                {rankResult.invalid_count > 0 && (
                  <div className="text-red-400 mt-1">
                    {rankResult.invalid_count} invalid rows rejected by the server.
                  </div>
                )}
              </div>
            )}
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
                  <span className="text-text-primary font-semibold">{consensusTeamData.total_team_mocks}</span>{' '}
                  GM{consensusTeamData.total_team_mocks !== 1 ? 's' : ''} drafted {consensusTeam}
                </p>
                {Object.entries(playersByRound)
                  .sort(([a], [b]) => Number(a) - Number(b))
                  .map(([round, players]) => {
                    const topCount = players[0]?.pick_count ?? 1;
                    return (
                      <div key={round}>
                        {/* Round header */}
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-display font-bold text-[10px] uppercase tracking-[0.18em] text-text-muted px-2 py-0.5 rounded border border-border-subtle">
                            Round {round}
                          </span>
                          <div className="flex-1 h-px bg-border-subtle" />
                        </div>
                        {/* Player list */}
                        {(() => {
                          const LIMIT = 5;
                          const isExpanded = expandedRounds.has(round);
                          const visible = isExpanded ? players : players.slice(0, LIMIT);
                          const hasMore = players.length > LIMIT;
                          return (
                            <>
                              <div className="divide-y divide-border-subtle">
                                {visible.map((p) => {
                                  const hex = posHex(p.position);
                                  const pct = consensusTeamData.total_team_mocks > 0
                                    ? Math.round((p.pick_count / consensusTeamData.total_team_mocks) * 100)
                                    : 0;
                                  const barW = Math.round((p.pick_count / topCount) * 100);
                                  return (
                                    <div key={p.player_id} className="flex items-center gap-3 py-2 px-1 hover:bg-white/[0.02] rounded">
                                      <PositionBadge position={p.position} />
                                      <div className="min-w-0 flex-1">
                                        <div className="text-[12px] font-semibold text-text-primary truncate">{p.name}</div>
                                        <div className="text-[10px] text-text-muted truncate">{p.school}</div>
                                      </div>
                                      <div className="w-24 shrink-0">
                                        <div className="h-1 w-full rounded-full bg-white/[0.06]">
                                          <div
                                            className="h-full rounded-full transition-all duration-500"
                                            style={{ width: `${barW}%`, backgroundColor: hex, boxShadow: `0 0 6px -1px ${hex}66` }}
                                          />
                                        </div>
                                      </div>
                                      <span
                                        className="font-mono font-semibold text-[13px] tabular-nums w-10 text-right shrink-0"
                                        style={{ color: hex }}
                                      >
                                        {pct}%
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                              {hasMore && (
                                <button
                                  onClick={() => setExpandedRounds((prev) => {
                                    const next = new Set(prev);
                                    if (isExpanded) next.delete(round);
                                    else next.add(round);
                                    return next;
                                  })}
                                  className="flex items-center gap-1 mt-1 px-1 text-[10.5px] text-text-muted hover:text-text-primary transition-colors"
                                >
                                  <svg
                                    className={`w-3 h-3 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                                    viewBox="0 0 12 12"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <polyline points="2 4 6 8 10 4" />
                                  </svg>
                                  {isExpanded
                                    ? 'Show less'
                                    : `${players.length - LIMIT} more player${players.length - LIMIT !== 1 ? 's' : ''}`}
                                </button>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    );
                  })}
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
                  ? `Players drafted most often across ${consensusR1.total_mocks} team mock${consensusR1.total_mocks !== 1 ? 's' : ''} · all rounds`
                  : 'Most-drafted players across all saved team mocks'}
              </p>
            </div>

            {/* Position filter pills */}
            {!consensusLoading && consensusPositions.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-4">
                <button
                  onClick={() => setConsensusPosFilter('ALL')}
                  className={`px-2.5 py-0.5 rounded-full text-[10.5px] font-display font-semibold uppercase tracking-[0.1em] border transition-all ${
                    consensusPosFilter === 'ALL'
                      ? 'bg-accent/[0.15] border-accent/50 text-accent'
                      : 'border-border-subtle text-text-muted hover:text-text-primary hover:border-border-focus'
                  }`}
                >
                  All
                </button>
                {consensusPositions.map((pos) => {
                  const hex = posHex(pos);
                  const isActive = consensusPosFilter === pos;
                  return (
                    <button
                      key={pos}
                      onClick={() => setConsensusPosFilter(pos)}
                      className="px-2.5 py-0.5 rounded-full text-[10.5px] font-display font-semibold uppercase tracking-[0.1em] border transition-all"
                      style={isActive
                        ? { backgroundColor: `${hex}22`, borderColor: `${hex}88`, color: hex }
                        : { borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }
                      }
                    >
                      {pos}
                    </button>
                  );
                })}
              </div>
            )}

            {consensusLoading && (
              <div className="space-y-2">
                {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            )}

            {!consensusLoading && consensusR1?.total_mocks === 0 && (
              <p className="text-text-muted text-sm text-center py-6">No team mocks saved yet.</p>
            )}

            {!consensusLoading && filteredConsensusPlayers.length === 0 && consensusR1?.players?.length > 0 && (
              <p className="text-text-muted text-sm text-center py-6">No players at that position yet.</p>
            )}

            {!consensusLoading && filteredConsensusPlayers.length > 0 && (
              <div className="divide-y divide-border-subtle">
                {filteredConsensusPlayers.map((p, i) => {
                  const pct = consensusR1.total_mocks > 0
                    ? Math.round((p.pick_count / consensusR1.total_mocks) * 100)
                    : 0;
                  const hex = posHex(p.position);
                  // Expert rank chip: compare avg draft slot to consensus rank
                  const delta = p.consensus_rank ? Math.round(p.avg_pick) - p.consensus_rank : null;
                  const rankChip = delta !== null && Math.abs(delta) >= 3
                    ? delta >= 3
                      ? { label: `Value — expert rank #${p.consensus_rank}`, color: '#22d3ee' }
                      : { label: `Reaches early — expert rank #${p.consensus_rank}`, color: '#f59e0b' }
                    : null;
                  return (
                    <div key={p.id} className="py-3 hover:bg-white/[0.02] rounded px-1">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-[11px] text-text-muted w-5 text-right shrink-0">{i + 1}</span>
                        <PlayerHeadshot url={p.headshot_url} name={p.name} position={p.position} size="sm" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[12px] font-semibold text-text-primary">{p.name}</span>
                            <PositionBadge position={p.position} />
                            <span className="text-text-muted text-[10px]">{p.school}</span>
                            {rankChip && (
                              <span
                                className="text-[10px] font-mono px-1.5 py-px rounded"
                                style={{ backgroundColor: `${rankChip.color}18`, color: rankChip.color, border: `1px solid ${rankChip.color}44` }}
                              >
                                {rankChip.label}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1.5">
                            <div className="flex-1 h-1.5 rounded-full bg-white/[0.06]">
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{ width: `${pct}%`, backgroundColor: hex, boxShadow: `0 0 6px -1px ${hex}66` }}
                              />
                            </div>
                            <span className="font-mono text-[11px] font-semibold tabular-nums shrink-0" style={{ color: hex }}>
                              {pct}%
                            </span>
                          </div>
                          <div className="mt-1 font-mono text-[10px] text-text-muted tabular-nums">
                            Drafted in {p.pick_count} of {consensusR1.total_mocks} mocks
                            {' · '}Avg pick: #{p.avg_pick}
                            {p.earliest_pick != null && p.latest_pick != null && (
                              <> · Range: #{p.earliest_pick}–#{p.latest_pick}</>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* ── Position Distribution ── */}
          <Card className="p-5">
            <div className="mb-4">
              <h3 className="font-display font-semibold text-text-primary text-sm uppercase tracking-[0.12em]">
                Position Distribution
              </h3>
              <p className="text-text-muted text-[11px] mt-0.5">
                All user picks across completed team mocks
                {consensusPos?.total_r1_picks > 0 && ` · ${consensusPos.total_r1_picks.toLocaleString()} total picks`}
              </p>
            </div>

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
                      <span className="font-mono text-[11px] text-text-muted tabular-nums w-24 text-right shrink-0">
                        {Math.round(pct)}% · {pos.pick_count} picks
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

      {/* Boards */}
      {tab === 'boards' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-display font-semibold text-text-primary text-sm uppercase tracking-[0.12em]">
                User Boards Activity
              </h3>
              <p className="text-text-muted text-xs mt-0.5">
                Big Board usage · who is ranking prospects and how actively
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => { setBoardStats(null); loadBoardStats(); }} disabled={boardsLoading}>
              {boardsLoading ? 'Loading…' : 'Refresh'}
            </Button>
          </div>

          {boardsLoading && !boardStats && (
            <div className="space-y-3">
              <Skeleton className="h-24" />
              <Skeleton className="h-40" />
            </div>
          )}

          {boardStats && (
            <>
              {/* Overview cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  ['Total Boards', boardStats.overview.total_boards],
                  ['Unique Users', boardStats.overview.unique_users],
                  ['Total Rankings', boardStats.overview.total_rankings],
                  ['Avg Rankings/Board', boardStats.overview.avg_rankings_per_board ?? '—'],
                ].map(([label, value]) => (
                  <Card key={label} className="p-3 text-center">
                    <div className="text-2xl font-bold font-display text-text-primary">{value}</div>
                    <div className="text-[10px] text-text-muted mt-0.5 uppercase tracking-wide">{label}</div>
                  </Card>
                ))}
              </div>

              {/* Top users */}
              {boardStats.topUsers.length > 0 && (
                <Card className="p-5">
                  <h4 className="font-display font-semibold text-text-primary text-xs uppercase tracking-[0.12em] mb-3">
                    Top Users by Board Count
                  </h4>
                  <div className="space-y-1.5">
                    {boardStats.topUsers.map((u, i) => (
                      <div key={u.display_name} className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-text-muted w-5 text-right shrink-0">{i + 1}.</span>
                        <Avatar url={u.avatar_url} name={u.display_name} size="sm" />
                        <span className="text-xs font-medium text-text-primary flex-1 truncate">{u.display_name}</span>
                        <span className="text-[11px] text-text-muted shrink-0">
                          {u.board_count} {u.board_count === 1 ? 'board' : 'boards'} · {u.total_rankings ?? 0} rankings
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* Daily creation trend */}
              {boardStats.daily.length > 0 && (
                <Card className="p-5">
                  <h4 className="font-display font-semibold text-text-primary text-xs uppercase tracking-[0.12em] mb-3">
                    Boards Created — Last 30 Days
                  </h4>
                  <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
                    {(() => {
                      const maxDay = Math.max(...boardStats.daily.map((d) => d.boards_created));
                      return boardStats.daily.map((row) => {
                        const barW = maxDay > 0 ? Math.max((row.boards_created / maxDay) * 100, 3) : 0;
                        return (
                          <div key={row.day} className="flex items-center gap-2">
                            <span className="font-mono text-[10px] text-text-muted w-20 shrink-0">
                              {new Date(row.day + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                            </span>
                            <div className="flex-1 h-4 bg-bg-surface rounded-sm overflow-hidden">
                              <div
                                className="h-full bg-accent/70 rounded-sm transition-all"
                                style={{ width: `${barW}%` }}
                              />
                            </div>
                            <span className="font-mono text-[10px] text-text-muted w-6 text-right shrink-0">
                              {row.boards_created}
                            </span>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </Card>
              )}

              {/* Recent boards */}
              {boardStats.recentBoards.length > 0 && (
                <Card className="p-5">
                  <h4 className="font-display font-semibold text-text-primary text-xs uppercase tracking-[0.12em] mb-3">
                    Recent Boards
                  </h4>
                  <div className="space-y-1">
                    {boardStats.recentBoards.map((b) => {
                      const created = new Date(b.created_at);
                      const updated = new Date(b.updated_at);
                      const wasEdited = Math.abs(updated - created) > 5000;
                      return (
                        <div key={b.id} className="flex items-center gap-2 py-1.5 border-b border-border-subtle/50 last:border-0">
                          <Avatar url={b.avatar_url} name={b.display_name} size="sm" />
                          <span className="text-xs font-medium text-text-primary shrink-0 w-28 truncate">{b.display_name}</span>
                          <span className="text-xs text-text-secondary flex-1 truncate">{b.title || 'Untitled Board'}</span>
                          <span className="text-[10px] text-text-muted shrink-0">{b.ranking_count} ranked</span>
                          <span className="text-[10px] text-text-muted shrink-0 ml-2">
                            {wasEdited ? 'updated ' : 'created '}
                            {(wasEdited ? updated : created).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              )}

              {boardStats.overview.total_boards === 0 && (
                <p className="text-text-muted text-sm text-center py-8">No boards created yet.</p>
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
