import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { DndContext, PointerSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core';
import { snapCenterToCursor } from '../lib/dndModifiers.js';
import { DndScrollSync } from '../lib/DndScrollSync.jsx';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { POSITIONS, posHex } from '../lib/positions.js';
import { PickSlot } from '../components/PickSlot.jsx';
import { ProspectCard } from '../components/ProspectCard.jsx';
import { Card } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { ConfirmModal } from '../components/ui/ConfirmModal.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { ProgressBar } from '../components/ui/ProgressBar.jsx';
import { TeamLogo } from '../components/ui/TeamLogo.jsx';
import { PlayerHeadshot } from '../components/ui/PlayerHeadshot.jsx';
import { PositionBadge } from '../components/ui/Badge.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { TradeModal } from '../components/TradeModal.jsx';
import { CountdownTimer, DRAFT_START_2026 } from '../components/ui/CountdownTimer.jsx';
import { Round1ExportCard, useRound1ShareExport } from '../components/Round1Export.jsx';
import { PredictionSlotsModal } from '../components/PredictionSlotsModal.jsx';
import { prettyName } from '../lib/displayName.js';
import { usePageMeta } from '../hooks/usePageMeta.js';

// Max number of picks a user can flag as "confidence" picks. Each confident
// pick that lands as an exact match gets a 1.5x scoring multiplier.
const MAX_CONFIDENCE_PICKS = 3;

const FILTERS = ['ALL', ...POSITIONS];

export default function Draft() {
  usePageMeta({
    title: 'Predictive Draft',
    description:
      'Build a 32-pick predictive mock of the 2026 NFL Draft and score live against the real picks. Mark confidence picks for a 1.5× multiplier.',
  });
  const { user } = useAuth();
  const nav = useNavigate();

  // ── Draft Mode ──────────────────────────────────────────────────────────
  // Competition: single scored mock, server-backed, submit to leaderboard.
  // Prediction:  sandbox, trades + exports, up to 10 saved slots in local
  //              storage, resets on page leave unless explicitly saved.
  const [draftMode, setDraftMode] = useState(() => {
    if (typeof window === 'undefined') return 'prediction';
    // Anonymous users default to prediction — they can't submit to the
    // leaderboard anyway. Logged-in users respect their stored preference.
    if (!user) return 'prediction';
    return localStorage.getItem('mds_draft_mode') === 'prediction' ? 'prediction' : 'competition';
  });
  useEffect(() => {
    localStorage.setItem('mds_draft_mode', draftMode);
  }, [draftMode]);

  // Snapshot bundles for the *inactive* mode's state so switching modes
  // doesn't wipe work. A null bundle means the mode hasn't been visited
  // yet — switching to it initialises a fresh state from the API order.
  const compBundleRef = useRef(null);
  const predBundleRef = useRef(null);
  // Immutable copy of the API-delivered draft order, used to reset trades
  // when creating a fresh prediction bundle.
  const baseOrderRef = useRef([]);

  const [players, setPlayers] = useState(null);
  const [draftOrder, setDraftOrder] = useState([]);
  // Snapshot of the original owner of each pick_number as delivered by the API.
  // Frozen on first successful load so we can detect traded picks even after
  // `draftOrder` has been mutated by `applyTradeLocal` — the PNG export uses
  // this to visually mark both teams on each side of every trade.
  const [originalTeamByPick, setOriginalTeamByPick] = useState(() => new Map());
  const [settings, setSettings] = useState(null);
  const [picks, setPicks] = useState({});
  // Confidence picks — a Set of pick_number. Max 3 per mock. Toggling is
  // additive; clearing a slot also clears its confidence flag.
  const [confidentSlots, setConfidentSlots] = useState(() => new Set());
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
  const [showSlots, setShowSlots] = useState(false);
  // Mobile: which pick slot is currently being drafted for. Always non-null
  // on mobile once data has loaded — initialized from on-the-clock.
  const [draftingForSlot, setDraftingForSlot] = useState(null);
  // Mobile: top "Your Board" panel height in px (resizable via drag handle).
  // Persisted across sessions. Each panel can also be independently collapsed
  // to a header-only strip.
  const [topHeight, setTopHeight] = useState(() => {
    if (typeof window === 'undefined') return 220;
    const v = parseInt(localStorage.getItem('mds_mobile_top_h') || '', 10);
    return Number.isFinite(v) && v >= 60 && v <= 1500 ? v : 220;
  });
  const [topCollapsed, setTopCollapsed] = useState(false);
  const [bottomCollapsed, setBottomCollapsed] = useState(false);
  const mobileContainerRef = useRef(null);
  const boardRowRefs = useRef({}); // pick_number → li element, for scroll-into-view
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [tradeOpen, setTradeOpen] = useState(false);
  // Custom big board (Phase 8) — re-orders the prospect sidebar
  const [userBoards, setUserBoards] = useState([]);
  const [selectedBoardId, setSelectedBoardId] = useState('');

  // ── Mode switch ─────────────────────────────────────────────────────────
  // Snapshot current state into the appropriate bundle, then restore the
  // target mode's bundle (or start fresh if first visit).
  function switchMode(newMode) {
    if (newMode === draftMode) return;
    const snap = { picks, confidentSlots, draftOrder, submitted };
    if (draftMode === 'competition') compBundleRef.current = snap;
    else predBundleRef.current = snap;

    const target = newMode === 'competition' ? compBundleRef.current : predBundleRef.current;
    if (target) {
      setPicks(target.picks);
      setConfidentSlots(target.confidentSlots);
      setDraftOrder(target.draftOrder);
      setSubmitted(target.submitted ?? false);
    } else {
      // Fresh bundle — reset to blank board with original NFL order.
      setPicks({});
      setConfidentSlots(new Set());
      setDraftOrder(baseOrderRef.current);
      setSubmitted(false);
    }
    setDraftMode(newMode);
  }

  const isCompetition = draftMode === 'competition';
  const isPrediction = draftMode === 'prediction';

  // Prediction mode: track whether the user has made progress (any picks).
  // This gates the "are you sure?" prompt when navigating away.
  const predHasProgress = isPrediction && Object.keys(picks).length > 0;

  // Persist resize across reloads
  useEffect(() => {
    try { localStorage.setItem('mds_mobile_top_h', String(topHeight)); } catch {}
  }, [topHeight]);

  // Drag handle: starts a pointer capture session, clamps the new top height
  // between min and (container - bottomMin - gap). Window-level listeners are
  // attached/detached per drag so we don't leak handlers.
  function onResizeStart(e) {
    if (topCollapsed || bottomCollapsed) return;
    e.preventDefault();
    const startY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
    const startH = topHeight;
    const containerH = mobileContainerRef.current?.clientHeight || 600;
    const min = 80;
    const max = containerH - 100; // 80 for bottom + 16 gap + 4 fudge
    document.body.classList.add('dragging');

    function onMove(ev) {
      const y = ev.clientY ?? ev.touches?.[0]?.clientY ?? startY;
      const next = Math.max(min, Math.min(max, startH + (y - startY)));
      setTopHeight(next);
    }
    function onUp() {
      document.body.classList.remove('dragging');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

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
    (async () => {
      try {
        // Fetch all 7 rounds of the draft order even though we only render
        // 32 R1 slots. The extra ~230 rows give the trade simulator real
        // chips to work with — users can include R2-R7 picks in hypothetical
        // trades without the page having to track them for player selection.
        const [p, o, s] = await Promise.all([
          api.getPlayers(),
          api.getDraftOrderAll(),
          api.getSettings(),
        ]);
        setPlayers(p);
        setDraftOrder(o);
        // Keep an immutable snapshot of the NFL order so prediction mode
        // can always reset to a clean slate when first entered.
        if (baseOrderRef.current.length === 0) baseOrderRef.current = o;
        // Capture the original owner of every pick exactly once — subsequent
        // trade applies only mutate `draftOrder`, not this snapshot.
        setOriginalTeamByPick((prev) => {
          if (prev.size > 0) return prev;
          const m = new Map();
          o.forEach((row) => m.set(row.pick_number, row.team));
          return m;
        });
        setSettings(s);
        // Only logged-in users in Competition mode have a saved mock to
        // resume. In Prediction mode the board starts blank.
        if (user && draftMode === 'competition') {
          try {
            const m = await api.getMock(user.id);
            const map = {};
            const conf = new Set();
            m.picks.forEach((pk) => {
              map[pk.pick_number] = pk.player_id;
              if (pk.is_confident) conf.add(pk.pick_number);
            });
            setPicks(map);
            setConfidentSlots(conf);
            setSubmitted(true);
          } catch { /* no existing mock */ }
        } else if (user && draftMode === 'prediction') {
          // In prediction mode, still pre-load the comp mock into its
          // bundle so toggling to competition later has it ready.
          try {
            const m = await api.getMock(user.id);
            const map = {};
            const conf = new Set();
            m.picks.forEach((pk) => {
              map[pk.pick_number] = pk.player_id;
              if (pk.is_confident) conf.add(pk.pick_number);
            });
            compBundleRef.current = { picks: map, confidentSlots: conf, draftOrder: o, submitted: true };
          } catch { /* no comp mock */ }
        }
      } catch (e) {
        toast.error('Failed to load: ' + e.message);
      }
    })();
  }, [user]);

  // ── Prediction leave guard ───────────────────────────────────────────────
  // Browser refresh / tab close: native confirm dialog via beforeunload.
  // In-app navigation: the app uses BrowserRouter (not a data router) so
  // useBlocker isn't available — the beforeunload handler is the safety net.
  useEffect(() => {
    if (!predHasProgress) return;
    function onBeforeUnload(e) {
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [predHasProgress]);

  // Load the user's boards so they can optionally reorder the prospect sidebar.
  useEffect(() => {
    if (!user) return;
    api.listBoards()
      .then((list) => setUserBoards(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, [user]);

  // When a board is selected, replace the player list with the board-ordered list.
  // When cleared (empty string), restore the original player list.
  async function handleBoardChange(boardId) {
    setSelectedBoardId(boardId);
    if (!boardId) {
      // Reload default player order
      try {
        const list = await api.getPlayers();
        setPlayers(list);
      } catch { /* keep current */ }
      return;
    }
    try {
      const data = await api.getBoardById(boardId);
      if (data?.players?.length) setPlayers(data.players);
    } catch (e) {
      toast.error('Could not load board — showing default order');
      setSelectedBoardId('');
    }
  }

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

  // On mobile, ensure draftingForSlot is always set so the prospect list
  // knows what pick it's drafting for. Defaults to on-the-clock when null.
  useEffect(() => {
    if (!isMobile) return;
    if (draftingForSlot == null && onClockSlot != null) {
      setDraftingForSlot(onClockSlot);
    }
  }, [isMobile, draftingForSlot, onClockSlot]);

  // Mobile: pull-to-refresh from inside the panels is killed via
  // `overscroll-behavior: contain` on each panel's scroll container (set on
  // the <ul> inline below). The body itself stays unlocked so iOS Safari's
  // pull-to-refresh still works when you swipe down from the navbar area.
  // Deep empty scroll past the bottom bar is prevented because nothing in
  // normal flow extends past the viewport (the mobile two-panel layout is
  // position: fixed).

  // Mobile: when the active pick changes (or top panel uncollapses), scroll
  // its row into view inside the top board panel.
  useEffect(() => {
    if (!isMobile || draftingForSlot == null || topCollapsed) return;
    const el = boardRowRefs.current[draftingForSlot];
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    }
  }, [isMobile, draftingForSlot, topCollapsed, topHeight]);

  // Desktop: auto-scroll the on-the-clock row into view after each pick.
  // Uses a DOM query + getBoundingClientRect so we don't depend on ref
  // wiring through the memoised PickSlot component.
  useEffect(() => {
    if (isMobile || onClockSlot == null || locked) return;
    const timer = setTimeout(() => {
      const el = document.querySelector(`li[data-pick-slot="${onClockSlot}"]`);
      if (!el) return;
      const container = el.parentElement;
      if (!container || container.scrollHeight <= container.clientHeight) return;
      const cRect = container.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      const delta = eRect.top - cRect.top - cRect.height / 2 + eRect.height / 2;
      container.scrollBy({ top: delta, behavior: 'smooth' });
    }, 50);
    return () => clearTimeout(timer);
  }, [isMobile, onClockSlot, locked]);

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

  // ── Stable callback pattern ────────────────────────────────────────────────
  // All user-facing event callbacks (prospect click, slot click, draft-to-
  // on-clock, etc.) have EMPTY useCallback deps so their identity never
  // changes. They read the latest state via `latestRef.current` which is
  // updated on every render. This keeps ProspectCard/PickSlot memoization
  // stable, so making a pick no longer invalidates all ~700 prospect rows.
  const latestRef = useRef({});
  latestRef.current = {
    locked,
    isMobile,
    onClockSlot,
    picks,
    usedPlayerIds,
    orderByPick,
    selectedPlayer,
    draftingForSlot,
  };

  const assignPlayerToSlot = useCallback((playerId, slot) => {
    if (latestRef.current.locked) return;
    setPicks((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(next)) {
        if (v === playerId) delete next[k];
      }
      next[slot] = playerId;
      return next;
    });
    setSubmitted(false);
  }, []);

  const clearSlot = useCallback((slot) => {
    setPicks((prev) => { const next = { ...prev }; delete next[slot]; return next; });
    // Clearing a slot also clears its confidence flag — a confidence pick
    // without a player selected would be nonsensical on submit.
    setConfidentSlots((prev) => {
      if (!prev.has(slot)) return prev;
      const next = new Set(prev);
      next.delete(slot);
      return next;
    });
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
    // Swapping two slots carries the confidence flag with the player — the
    // user flagged the PLAYER's expected pick, so when the slot number
    // changes, the flag should move with the pick to match expectation.
    setConfidentSlots((prev) => {
      const hasA = prev.has(a);
      const hasB = prev.has(b);
      if (hasA === hasB) return prev;
      const next = new Set(prev);
      if (hasA) { next.delete(a); next.add(b); }
      else      { next.delete(b); next.add(a); }
      return next;
    });
  }, []);

  // Toggle a slot's confidence flag. Caps at MAX_CONFIDENCE_PICKS (3) —
  // attempts beyond the cap show a toast so the user understands why.
  const toggleConfidence = useCallback((slot) => {
    if (latestRef.current.locked) return;
    setConfidentSlots((prev) => {
      const next = new Set(prev);
      if (next.has(slot)) {
        next.delete(slot);
        return next;
      }
      if (next.size >= MAX_CONFIDENCE_PICKS) {
        toast.error(`Max ${MAX_CONFIDENCE_PICKS} confidence picks`);
        return prev;
      }
      next.add(slot);
      return next;
    });
    setSubmitted(false);
  }, []);

  // Apply an accepted trade: swap team ownership on the affected pick numbers.
  // Only picks that haven't been assigned yet can change hands — swapping a
  // pick that's already been made would orphan the player.
  const applyTradeLocal = useCallback(({ fromTeam, partnerTeam, yourPicks, theirPicks }) => {
    const yourSet = new Set(yourPicks);
    const theirSet = new Set(theirPicks);
    setDraftOrder((prev) =>
      prev.map((row) => {
        if (latestRef.current.picks[row.pick_number]) return row; // already drafted — locked
        if (yourSet.has(row.pick_number)) {
          return { ...row, team: partnerTeam };
        }
        if (theirSet.has(row.pick_number)) {
          return { ...row, team: fromTeam };
        }
        return row;
      })
    );
    toast.success(`Trade accepted: ${fromTeam} ↔ ${partnerTeam}`);
  }, []);

  const handleSlotClick = useCallback((slot) => {
    const s = latestRef.current;
    if (s.locked) return;
    if (s.isMobile) {
      setDraftingForSlot(slot);
      return;
    }
    if (s.selectedPlayer != null) {
      assignPlayerToSlot(s.selectedPlayer, slot);
      setSelectedPlayer(null);
    } else if (s.picks[slot]) {
      clearSlot(slot);
    }
  }, [assignPlayerToSlot, clearSlot]);

  // Mobile prospect tap: assign to the current pick, then auto-advance.
  const pickForDrawerSlot = useCallback((player) => {
    const s = latestRef.current;
    if (s.draftingForSlot == null || s.locked) return;
    const justFilled = s.draftingForSlot;
    assignPlayerToSlot(player.id, justFilled);
    const team = s.orderByPick.get(justFilled);
    // Shared toast id — fast drafts replace the previous pick banner instead
    // of stacking them up and covering the Draft button.
    toast.success(`Pick ${justFilled}${team ? ` · ${team.team}` : ''}: ${player.name}`, { id: 'draft-pick' });
    const isEmpty = (i) => i !== justFilled && !s.picks[i];
    let next = null;
    for (let i = justFilled + 1; i <= 32; i++) {
      if (isEmpty(i)) { next = i; break; }
    }
    if (next == null) {
      for (let i = 1; i < justFilled; i++) {
        if (isEmpty(i)) { next = i; break; }
      }
    }
    setDraftingForSlot(next ?? justFilled);
  }, [assignPlayerToSlot]);

  const handleProspectClick = useCallback((player) => {
    setSelectedPlayer((prev) => {
      if (prev === player.id) return null;
      if (latestRef.current.usedPlayerIds.has(player.id)) return prev;
      return player.id;
    });
  }, []);

  const draftToOnClockCb = useCallback((player) => {
    const s = latestRef.current;
    if (s.locked || !s.onClockSlot) return;
    assignPlayerToSlot(player.id, s.onClockSlot);
    const team = s.orderByPick.get(s.onClockSlot);
    toast.success(`Pick ${s.onClockSlot}${team ? ` · ${team.team}` : ''}: ${player.name}`, { id: 'draft-pick' });
  }, [assignPlayerToSlot]);

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
            toast.success(`Pick ${onClockSlot}${team ? ` · ${team.team}` : ''}: ${p.name}`, { id: 'draft-pick' });
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

  // Submit button entry point — anonymous users can build a mock freely,
  // but submitting to the competition leaderboard requires auth. Redirect
  // them to /join instead of popping the confirm modal.
  function handleSubmitClick() {
    if (!user) {
      toast('Log in to submit your mock to the leaderboard');
      nav('/join');
      return;
    }
    setShowConfirm(true);
  }

  async function submit() {
    setBusy(true);
    try {
      const payload = Object.entries(picks).map(([pn, pid]) => ({
        pick_number: Number(pn),
        player_id: pid,
        is_confident: confidentSlots.has(Number(pn)),
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

  // Shape the current picks for the export card. Unlike the submit payload,
  // partial mocks are allowed here — someone "just doing the exercise" may
  // want to export whatever they have so far without a full 32-pick board.
  const exportPicks = useMemo(
    () =>
      Object.entries(picks).map(([pn, pid]) => ({
        pick_number: Number(pn),
        player_id: pid,
      })),
    [picks]
  );
  const exportTeamByPickNumber = useMemo(() => {
    const m = new Map();
    draftOrder.forEach((o) => m.set(o.pick_number, o.team));
    return m;
  }, [draftOrder]);
  // Picks whose current owner differs from the original owner — i.e. picks
  // involved in a trade. Passed to the export card so each row on either
  // side of a trade gets a visual "traded" marker.
  const exportTradedPicks = useMemo(() => {
    const s = new Set();
    exportTeamByPickNumber.forEach((team, pn) => {
      const orig = originalTeamByPick.get(pn);
      if (orig && orig !== team) s.add(pn);
    });
    return s;
  }, [exportTeamByPickNumber, originalTeamByPick]);
  const {
    exportRef,
    exporting,
    theme: exportTheme,
    teamLogoDataUrls,
    headshotDataUrls,
    handleShare: handleExportShare,
    handleDownload: handleExportDownload,
    isMobile: exportIsMobile,
  } = useRound1ShareExport({
    picks: exportPicks,
    playerById,
    teamByPickNumber: exportTeamByPickNumber,
    originalTeamByPickNumber: originalTeamByPick,
    tradedPicks: exportTradedPicks,
  });

  const activePlayer = activeDragId?.startsWith('player-')
    ? playerById.get(Number(activeDragId.replace('player-', '')))
    : null;

  return (
    <div className="h-full flex flex-col overflow-hidden route-fade">
      {/* Hidden export card — kept in-viewport with opacity:0 so mobile
          browsers still decode images; html-to-image captures it on demand. */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          opacity: 0,
          zIndex: -1,
          pointerEvents: 'none',
        }}
        aria-hidden
      >
        <Round1ExportCard
          ref={exportRef}
          picks={exportPicks}
          playerById={playerById}
          teamByPickNumber={exportTeamByPickNumber}
          originalTeamByPickNumber={originalTeamByPick}
          tradedPicks={exportTradedPicks}
          userLabel={user ? prettyName(user.display_name) : ''}
          theme={exportTheme}
          teamLogoDataUrls={teamLogoDataUrls}
          headshotDataUrls={headshotDataUrls}
        />
      </div>

      {/* Compact desktop header — single row with title, mode toggle,
          on-the-clock status, countdown, and board selector. */}
      <div className="hidden md:block shrink-0 border-b border-border-subtle bg-bg-surface/20">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4 min-w-0">
            <div className="min-w-0">
              <div className="caption text-accent text-[10px]">War Room · 2026</div>
              <h1 className="font-display font-bold text-[22px] text-text-primary leading-none mt-0.5">
                Build Your Mock
              </h1>
            </div>
            {/* See-saw mode toggle */}
            <div className="flex rounded-lg border border-border-subtle overflow-hidden shrink-0">
              <button
                onClick={() => switchMode('competition')}
                className={`font-display text-[10px] font-bold uppercase tracking-[0.1em] px-3 py-1.5 transition ${
                  isCompetition
                    ? 'bg-accent text-bg-deep'
                    : 'text-text-muted hover:text-text-primary'
                }`}
              >
                Competition
              </button>
              <button
                onClick={() => switchMode('prediction')}
                className={`font-display text-[10px] font-bold uppercase tracking-[0.1em] px-3 py-1.5 transition ${
                  isPrediction
                    ? 'bg-accent text-bg-deep'
                    : 'text-text-muted hover:text-text-primary'
                }`}
              >
                Prediction
              </button>
            </div>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            {onClockSlot && !locked && (
              <div className="text-right">
                <div className="caption text-[9px]">On the clock</div>
                <div className="font-display font-bold uppercase tracking-wide text-text-primary text-[12px] mt-0.5">
                  Pick <span className="text-accent">{onClockSlot}</span>
                  {orderByPick.get(onClockSlot) && (
                    <span className="text-text-secondary"> · {orderByPick.get(onClockSlot).team}</span>
                  )}
                </div>
              </div>
            )}
            {!locked && (
              <div className="text-right">
                <div className="caption text-[9px]">Deadline</div>
                <div className="mt-0.5">
                  <CountdownTimer target={DRAFT_START_2026} compact />
                </div>
              </div>
            )}
            {!locked && userBoards.length > 0 && (
              <div className="text-right">
                <div className="caption text-[9px]">Prospect Board</div>
                {filledCount > 0 ? (
                  <div className="text-[11px] text-text-muted mt-0.5">
                    {selectedBoardId
                      ? (userBoards.find((b) => String(b.id) === selectedBoardId)?.title ?? 'Custom')
                      : 'Default'}
                  </div>
                ) : (
                  <select
                    value={selectedBoardId}
                    onChange={(e) => handleBoardChange(e.target.value)}
                    className="mt-0.5 bg-bg-deep/70 border border-border-subtle rounded-md px-2 py-0.5 text-text-primary text-[11px] font-display uppercase tracking-wide focus:border-accent outline-none"
                  >
                    <option value="">Default</option>
                    {userBoards.map((b) => (
                      <option key={b.id} value={b.id}>{b.title}</option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {locked && (
        <div className="hidden md:block shrink-0">
          <Card className="banner-warn mx-4 mt-3 px-4 py-2 text-[13px]">
            Submissions are locked. Head to the{' '}
            <Link to="/leaderboard" className="underline">leaderboard</Link>.
          </Card>
        </div>
      )}

      <DndContext
        sensors={sensors}
        modifiers={[snapCenterToCursor]}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <DndScrollSync />
        {/* ============= MOBILE LAYOUT — viewport-locked two-panel ============= */}
        {/* Fixed between navbar (top-14 = 56px) and bottom action bar
            (bottom-20 = 80px). No page scroll possible — only the two
            panels scroll internally. */}
        <div
          ref={mobileContainerRef}
          className="md:hidden fixed inset-x-0 z-10 flex flex-col p-2"
          style={{ top: '56px', bottom: '76px' }}
        >
          {/* TOP PANEL — Your Board */}
          <Card
            glass
            className="p-0 overflow-hidden flex flex-col"
            style={{
              flex: topCollapsed
                ? '0 0 auto'
                : bottomCollapsed
                ? '1 1 0'
                : `0 0 ${topHeight}px`,
              minHeight: 0,
            }}
          >
            <button
              type="button"
              onClick={() => setTopCollapsed((x) => !x)}
              className="w-full flex items-center justify-between px-4 py-2.5 border-b border-border-subtle shrink-0"
              aria-expanded={!topCollapsed}
              aria-label={topCollapsed ? 'Expand board' : 'Collapse board'}
            >
              <div className="flex items-center gap-2">
                <span className="caption text-[10px]">Your Board</span>
                <span className="font-mono text-[11px] text-text-muted tabular">
                  <span className={complete ? 'text-accent' : 'text-gold'}>{filledCount}</span>
                  <span>/32</span>
                </span>
                {confidentSlots.size > 0 && (
                  <span className="font-mono text-[10px] text-gold tabular">
                    ★ {confidentSlots.size}/{MAX_CONFIDENCE_PICKS}
                  </span>
                )}
              </div>
              <svg
                viewBox="0 0 24 24"
                className={`w-4 h-4 text-text-secondary transition-transform duration-300 ${topCollapsed ? '-rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {!topCollapsed && (
            <ul
              className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5 min-h-0"
              style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}
            >
              {Array.from({ length: 32 }, (_, i) => i + 1).map((slot) => {
                const team = orderByPick.get(slot);
                const player = picks[slot] ? playerById.get(picks[slot]) : null;
                const isActive = slot === draftingForSlot;
                const posColor = player ? posHex(player.position) : '#64748b';
                return (
                  <li
                    key={slot}
                    ref={(el) => { if (el) boardRowRefs.current[slot] = el; }}
                    onClick={() => setDraftingForSlot(slot)}
                    className="flex items-center gap-2.5 p-2 rounded-lg border cursor-pointer transition-all"
                    style={{
                      background: isActive ? 'rgb(var(--accent-rgb) / 0.08)' : 'var(--bg-surface)',
                      borderColor: isActive ? 'rgb(var(--accent-rgb) / 0.45)' : 'var(--border-subtle)',
                      borderLeft: `4px solid ${player ? posColor : 'var(--border-subtle)'}`,
                      boxShadow: isActive ? '0 0 18px -8px rgb(var(--accent-rgb) / 0.55)' : 'none',
                    }}
                  >
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center font-mono font-bold text-[12px] shrink-0"
                      style={{
                        backgroundColor: player ? posColor : 'transparent',
                        color: player ? '#04080f' : 'var(--text-secondary)',
                        boxShadow: player ? `0 0 14px -6px ${posColor}` : 'inset 0 0 0 1.5px rgba(255,255,255,0.1)',
                      }}
                    >
                      {slot}
                    </div>
                    <TeamLogo abbr={team?.team} size="sm" />
                    {player ? (
                      <>
                        <PlayerHeadshot
                          url={player.headshot_url}
                          name={player.name}
                          position={player.position}
                          size="xs"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <div className="text-text-primary font-semibold truncate text-[13px]">{player.name}</div>
                            <PositionBadge position={player.position} />
                          </div>
                          <div className="text-[10px] text-text-muted truncate">{player.school}</div>
                        </div>
                      </>
                    ) : (
                      <div className="flex-1 min-w-0">
                        <div className="caption text-[9px] text-text-muted truncate">{team?.team || '—'}</div>
                        <div className="text-[12px] text-text-secondary truncate">
                          {isActive ? 'On the clock — pick a player below' : (team?.team_name || 'Empty')}
                        </div>
                        {Array.isArray(team?.team_needs) && team.team_needs.length > 0 && (
                          <div className="flex items-center gap-1 mt-1 flex-wrap">
                            {team.team_needs.slice(0, 4).map((need) => (
                              <PositionBadge key={need} position={need} />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {player && isCompetition && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleConfidence(slot); }}
                        className={`rounded-full w-7 h-7 flex items-center justify-center shrink-0 transition-all ${
                          confidentSlots.has(slot)
                            ? 'text-gold shadow-glow-gold bg-gold/10 ring-1 ring-gold/50'
                            : 'text-text-muted hover:text-gold hover:bg-gold/5 opacity-60'
                        }`}
                        aria-label={confidentSlots.has(slot) ? `Remove confidence pick ${slot}` : `Mark pick ${slot} as confidence`}
                        title="Confidence pick (1.5× on exact match)"
                      >
                        <span className="font-display text-[14px] leading-none">★</span>
                      </button>
                    )}
                    {isActive && player && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); clearSlot(slot); }}
                        className="text-text-muted hover:text-red-400 text-sm px-1 shrink-0"
                        aria-label={`Clear pick ${slot}`}
                      >
                        ✕
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            )}
          </Card>

          {/* DRAG HANDLE — only shown when both panels are expanded */}
          {!topCollapsed && !bottomCollapsed && (
            <div
              onPointerDown={onResizeStart}
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize panels"
              className="h-3 my-1 flex items-center justify-center cursor-row-resize touch-none select-none"
              style={{ touchAction: 'none' }}
            >
              <div className="w-12 h-1 rounded-full bg-text-muted/40 hover:bg-accent/60 transition-colors" />
            </div>
          )}

          {/* BOTTOM PANEL — Available Players */}
          <Card
            glass
            className="p-0 overflow-hidden flex flex-col"
            style={{
              flex: bottomCollapsed
                ? '0 0 auto'
                : topCollapsed
                ? '1 1 0'
                : '1 1 0',
              minHeight: 0,
            }}
          >
            <button
              type="button"
              onClick={() => setBottomCollapsed((x) => !x)}
              className="w-full flex items-center justify-between px-4 py-2.5 border-b border-border-subtle shrink-0"
              aria-expanded={!bottomCollapsed}
              aria-label={bottomCollapsed ? 'Expand prospects' : 'Collapse prospects'}
            >
              <div className="flex items-center gap-2">
                <span className="caption text-[10px]">Available Players</span>
                <span className="font-mono text-[11px] text-text-muted tabular">
                  {filteredProspects.length}
                </span>
              </div>
              <svg
                viewBox="0 0 24 24"
                className={`w-4 h-4 text-text-secondary transition-transform duration-300 ${bottomCollapsed ? '-rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {!bottomCollapsed && (
            <div className="flex-1 min-h-0 flex flex-col p-3">
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
            )}
          </Card>
        </div>

        {/* ============= DESKTOP LAYOUT — viewport-locked two-panel grid =============
            The outer wrapper takes remaining vertical space (flex-1 min-h-0)
            and hides its own overflow so only the two Cards scroll internally.
            Each Card is flex-col with a shrink-0 header and a flex-1 min-h-0
            scrollable body — no max-h vh values that would let the page
            itself scroll. */}
        <div className="hidden md:block flex-1 min-h-0 overflow-hidden">
          <div className="max-w-6xl mx-auto w-full h-full px-4 py-3 grid md:grid-cols-2 gap-3 min-h-0">
            {/* Pick slots */}
            <Card glass className="p-3 flex flex-col overflow-hidden min-h-0">
              <div className="flex items-center justify-between mb-3 px-1 shrink-0">
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
              <ul
                className="stagger space-y-1.5 flex-1 min-h-0 overflow-y-auto pr-1"
                style={{ overscrollBehavior: 'contain' }}
              >
                {!players ? (
                  Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-[58px] w-full rounded-lg" />)
                ) : (
                  Array.from({ length: 32 }, (_, i) => i + 1).map((slot) => (
                    <PickSlot
                      key={slot}
                      slot={slot}
                      team={orderByPick.get(slot)}
                      player={picks[slot] ? playerById.get(picks[slot]) : null}
                      onClear={clearSlot}
                      onClick={handleSlotClick}
                      isActive={selectedPlayer != null}
                      isConfident={isCompetition && confidentSlots.has(slot)}
                      onToggleConfident={isCompetition ? toggleConfidence : undefined}
                      boardRef={boardRowRefs}
                    />
                  ))
                )}
              </ul>
            </Card>

            {/* Prospect list — desktop */}
            <Card glass className="p-3 flex flex-col overflow-hidden min-h-0">
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
        </div>

        {createPortal(
          <DragOverlay dropAnimation={null}>
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

      {/* Footer / Submit (desktop) — compact sticky bar at the bottom of the
          viewport-locked layout. Shows progress, trade/auto-fill actions,
          and the submit CTA. shrink-0 so it doesn't compress when the
          panels above get tall. */}
      <div className="hidden md:block shrink-0 border-t border-border-subtle bg-bg-surface/20">
        <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center gap-4">
          <div className="flex-1 min-w-0 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between text-[10px] mb-1">
                <span className="caption">Progress</span>
                <span className="font-mono tabular text-text-secondary">
                  <span className={complete ? 'text-accent' : 'text-gold'}>{filledCount}</span>
                  <span className="text-text-muted">/32</span>
                  {confidentSlots.size > 0 && (
                    <span className="ml-2 text-gold">
                      ★ {confidentSlots.size}/{MAX_CONFIDENCE_PICKS}
                    </span>
                  )}
                </span>
              </div>
              <ProgressBar picks={picks} playerById={playerById} max={32} />
            </div>
            <Button size="xs" variant="outline" onClick={() => setTradeOpen(true)} disabled={locked} className="shrink-0">
              Simulate Trade
            </Button>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={handleExportShare}
              disabled={!complete || exporting}
              title={
                !complete
                  ? 'Fill all 32 picks to export'
                  : exportIsMobile
                  ? 'Share a PNG of your Round 1 mock'
                  : 'Copy a PNG of your Round 1 mock to clipboard'
              }
            >
              {exporting ? 'Rendering…' : exportIsMobile ? 'Share Mock' : 'Export Mock'}
            </Button>
            {!exportIsMobile && (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleExportDownload}
                disabled={!complete || exporting}
                title="Download PNG"
              >
                Download
              </Button>
            )}
            {isCompetition ? (
              <Button
                size="md"
                onClick={handleSubmitClick}
                disabled={!complete || locked || busy}
                className={`${complete && !submitted ? 'animate-pulse-glow' : ''}`}
              >
                {submitted ? 'Submitted ✓' : complete ? (user ? 'Submit Mock →' : 'Log in & Submit →') : `${32 - filledCount} to go`}
              </Button>
            ) : (
              <Button
                size="md"
                variant="outline"
                onClick={() => setShowSlots(true)}
              >
                Save / Load
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Mobile — fixed bottom action bar */}
      <div className="md:hidden fixed left-0 right-0 bottom-0 z-30 bg-bg-deep/95 backdrop-blur-md border-t border-border-subtle">
        {/* Compact mode toggle row */}
        <div className="flex justify-center pt-2 pb-1 px-3">
          <div className="flex rounded-lg border border-border-subtle overflow-hidden">
            <button
              onClick={() => switchMode('competition')}
              className={`font-display text-[9px] font-bold uppercase tracking-[0.1em] px-3 py-1 transition ${
                isCompetition ? 'bg-accent text-bg-deep' : 'text-text-muted'
              }`}
            >
              Competition
            </button>
            <button
              onClick={() => switchMode('prediction')}
              className={`font-display text-[9px] font-bold uppercase tracking-[0.1em] px-3 py-1 transition ${
                isPrediction ? 'bg-accent text-bg-deep' : 'text-text-muted'
              }`}
            >
              Prediction
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 pb-3">
          <Button size="xs" variant="outline" onClick={autoFill} disabled={locked || complete} className="shrink-0">
            Auto-fill
          </Button>
          <Button size="xs" variant="outline" onClick={() => setShowClearAll(true)} disabled={locked || filledCount === 0} className="shrink-0">
            Clear
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={handleExportShare}
            disabled={!complete || exporting}
            className="shrink-0"
          >
            {exporting ? '…' : 'Export'}
          </Button>
          {isCompetition ? (
            <Button
              size="lg"
              className="flex-1"
              onClick={handleSubmitClick}
              disabled={!complete || locked || busy}
            >
              {submitted ? 'Submitted ✓' : complete ? (user ? 'Submit Mock' : 'Log in & Submit') : `${filledCount}/32`}
            </Button>
          ) : (
            <Button
              size="lg"
              variant="outline"
              className="flex-1"
              onClick={() => setShowSlots(true)}
            >
              Save / Load
            </Button>
          )}
        </div>
      </div>

      <ConfirmModal
        open={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={submit}
        title="Lock in your mock?"
        description="Your mock will be saved. You can edit and resubmit until the admin locks submissions."
        confirmLabel={submitted ? 'Resubmit' : 'Submit'}
        confirmVariant="primary"
        busy={busy}
      />

      <ConfirmModal
        open={showClearAll}
        onClose={() => setShowClearAll(false)}
        onConfirm={() => {
          setPicks({});
          setConfidentSlots(new Set());
          setShowClearAll(false);
          setSubmitted(false);
          toast.success('All picks cleared');
        }}
        title="Clear all picks?"
        description="This removes every prospect from your current mock. Confidence flags will also be cleared."
        confirmLabel="Clear all"
        confirmVariant="danger"
      />


      {/* Trade simulator modal — lets the user swap picks between any two
          teams. Trades are local to this session; only the final picks are
          persisted when the user submits their mock. */}
      {tradeOpen && (
        <TradeModal
          userTeam={orderByPick.get(onClockSlot || 1)?.team || 'TBD'}
          fromTeamEditable
          liveOrder={draftOrder}
          lockedPicks={new Set(Object.keys(picks).map(Number))}
          onClockTeam={orderByPick.get(onClockSlot || 1)?.team}
          onClose={() => setTradeOpen(false)}
          onAccepted={(swap) => {
            applyTradeLocal(swap);
            setTradeOpen(false);
          }}
        />
      )}

      {/* Prediction slots modal (save / load) */}
      {showSlots && (
        <PredictionSlotsModal
          currentPicks={picks}
          currentConfidentSlots={confidentSlots}
          currentDraftOrder={draftOrder}
          filledCount={filledCount}
          onLoad={({ picks: p, confidentSlots: c, draftOrder: o }) => {
            setPicks(p);
            setConfidentSlots(c);
            if (o?.length) setDraftOrder(o);
          }}
          onClose={() => setShowSlots(false)}
        />
      )}

      {/* No mobile bottom spacer needed — the mobile two-panel layout is
          fixed-positioned and the body scroll is locked via useEffect. */}
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

      <ul
        className="overflow-y-auto flex-1 space-y-1.5 pr-1 stagger"
        style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}
      >
        {!players ? (
          Array.from({ length: 14 }, (_, i) => <Skeleton key={i} className="h-[46px] w-full rounded-lg" />)
        ) : filtered.length === 0 ? (
          <li>
            <EmptyState
              compact
              title="No prospects match"
              description={
                search
                  ? `Nothing matches “${search}”. Try a different name or clear the filter.`
                  : 'All prospects at this position are drafted. Switch filters to see more.'
              }
              action={
                (search || posFilter !== 'ALL') && (
                  <button
                    type="button"
                    onClick={() => { setSearch(''); setPosFilter('ALL'); }}
                    className="font-display uppercase tracking-[0.14em] text-[11px] text-accent hover:underline"
                  >
                    Reset filters
                  </button>
                )
              }
            />
          </li>
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
