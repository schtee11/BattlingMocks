import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api, proxyImageUrl, fetchImageAsDataUrl } from '../lib/api.js';
import { snapCenterToCursor } from '../lib/dndModifiers.js';
import { useAuth } from '../hooks/useAuth.js';
import { POSITIONS, posHex } from '../lib/positions.js';
import { PlayerHeadshot } from '../components/ui/PlayerHeadshot.jsx';
import { PositionBadge } from '../components/ui/Badge.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { usePageMeta } from '../hooks/usePageMeta.js';

// Lazy-load html-to-image to keep initial bundle small
const loadToPng = () => import('html-to-image').then((m) => m.toPng);

// ─── Theme helpers (mirrors TeamMock.jsx) ────────────────────────────────────
const EXPORT_THEMES = {
  dark: {
    bg: '#04080f',
    bgGradientEnd: '#020408',
    surface: '#0b1120',
    subtle: '#1a2336',
    text: '#f0f4fc',
    muted: '#7a8ba8',
    accent: '#00e5ff',
    accentSoft: 'rgba(0,229,255,0.15)',
  },
  light: {
    bg: '#f0f2f7',
    bgGradientEnd: '#e3e8f1',
    surface: '#ffffff',
    subtle: 'rgba(15,23,42,0.12)',
    text: '#0f172a',
    muted: '#64748b',
    accent: '#0891b2',
    accentSoft: 'rgba(8,145,178,0.12)',
  },
};
function getCurrentTheme() {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

// ─── Top-50 Export Card ───────────────────────────────────────────────────────
// Layout: 4 columns × 13 rows (50 players).
// Uses flexbox-wrap with explicit pixel widths rather than CSS grid so that
// html-to-image's SVG foreignObject renderer — which has known quirks with
// fr units — produces a reliable, non-clipped result.
//
// Inner width:  900 - 2×40 = 820px
// Gap between items: 8px horizontal, 8px vertical
// Per-item width:  (820 - 3×8) / 4 = 199px  (set exactly via style.width)
const CARD_W = 199; // explicit pixel width avoids fr-unit issues in html-to-image
const CARD_GAP = 8;

const Top50ExportCard = forwardRef(function Top50ExportCard(
  { players, boardTitle, theme, headshotDataUrls = {}, exporting = false },
  ref
) {
  const C = EXPORT_THEMES[theme] || EXPORT_THEMES.dark;
  const top50 = players.slice(0, 50);
  const dateStr = new Date().toLocaleDateString(undefined, {
    month: 'long', day: 'numeric', year: 'numeric',
  });

  return (
    <div
      ref={ref}
      style={{
        width: 900,
        padding: 40,
        background: `linear-gradient(180deg, ${C.bg} 0%, ${C.bgGradientEnd} 100%)`,
        color: C.text,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 24, borderBottom: `1px solid ${C.subtle}`, paddingBottom: 18 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase', color: C.accent, marginBottom: 6 }}>
          MockDraft Showdown
        </div>
        <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: 1, color: C.text }}>
          {boardTitle || 'My Big Board'} — Top 50
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{dateStr}</div>
      </div>

      {/* 4-column flexbox-wrap layout.
          Each card has a fixed pixel width so there is no ambiguity for
          the renderer — no fr units, no calc(), just concrete numbers.
          justifyContent: center is a no-op on full rows (4×CARD_W + 3×GAP
          == container width) and centers the trailing partial row (49/50). */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: CARD_GAP, justifyContent: 'center' }}>
        {top50.map((p, i) => {
          const color = posHex(p.position);
          const headshot = headshotDataUrls[p.id];
          const initial = (p.name || '?')[0]?.toUpperCase() || '?';
          return (
            <div
              key={p.id}
              style={{
                width: CARD_W,
                background: C.surface,
                borderRadius: 10,
                padding: '9px 10px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                border: `1px solid ${C.subtle}`,
                boxSizing: 'border-box',
                overflow: 'hidden',
              }}
            >
              {/* Rank */}
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, width: 22, textAlign: 'right', flexShrink: 0 }}>
                {i + 1}
              </div>
              {/* Headshot — prefer pre-fetched base64 (no network). Only
                  fall back to the proxy URL while an export is actively in
                  flight; otherwise the idle card would fire 50 image
                  requests every time the editor mounts, saturating mobile
                  Safari's per-host connection pool and breaking every
                  subsequent page's API calls with "Load failed". */}
              {headshot ? (
                <img
                  src={headshot}
                  alt=""
                  style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, background: `${color}22` }}
                />
              ) : exporting && p.headshot_url ? (
                <img
                  src={proxyImageUrl(p.headshot_url)}
                  crossOrigin="anonymous"
                  alt=""
                  style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, background: `${color}22` }}
                />
              ) : (
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: `${color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 900, color, flexShrink: 0 }}>
                  {initial}
                </div>
              )}
              {/* Name / position / school — flex:1 + minWidth:0 enables
                  overflow:hidden + ellipsis on the child divs */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {p.name}
                </div>
                <div style={{ fontSize: 10, color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {p.position}{p.school ? ` · ${p.school}` : ''}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ marginTop: 22, textAlign: 'center', fontSize: 10, color: C.muted, letterSpacing: 1 }}>
        MOCKDRAFTSHOWDOWN.COM
      </div>
    </div>
  );
});

// ─── useTop50Export hook ──────────────────────────────────────────────────────
function useTop50Export({ players, boardTitle }) {
  const exportRef = useRef(null);
  const [exporting, setExporting] = useState(false);
  const [theme, setTheme] = useState(getCurrentTheme);
  const [headshotDataUrls, setHeadshotDataUrls] = useState({});
  // Tracks whether the current headshot fetch batch has completed (success or fail).
  // Used as a ref so handleExport can poll for it without stale-closure issues.
  const headshotsFetchedRef = useRef(false);
  // Mirror headshotDataUrls into a ref so the prefetch effect below can
  // consult the latest cache without taking it as a dependency (which would
  // re-run the effect — and refire network requests — every time a batch
  // finishes).
  const headshotDataUrlsRef = useRef(headshotDataUrls);
  useEffect(() => {
    headshotDataUrlsRef.current = headshotDataUrls;
  }, [headshotDataUrls]);

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(getCurrentTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const top50 = useMemo(() => (players || []).slice(0, 50), [players]);

  // Stable signature of the unique headshot URLs in top50. We re-fetch only
  // when the *set* of URLs changes — reordering within top50 (the common
  // edit action) must NOT re-fire 50 image-proxy fetches. Mobile Safari's
  // per-host connection pool (~6) gets pinned by those requests and then
  // every subsequent API call on the next page fails with "Load failed".
  const prefetchKey = useMemo(
    () =>
      [...new Set(top50.map((p) => p.headshot_url).filter(Boolean))]
        .sort()
        .join('|'),
    [top50]
  );

  useEffect(() => {
    if (!top50.length) {
      headshotsFetchedRef.current = true;
      return;
    }
    headshotsFetchedRef.current = false;
    const controller = new AbortController();
    let cancelled = false;

    // Only fetch headshots we don't already have cached in state. Combined
    // with the stable prefetchKey above, this means re-ranking the same 50
    // prospects issues zero new network requests.
    const toFetch = top50.filter(
      (p) => p.headshot_url && !headshotDataUrlsRef.current[p.id]
    );
    if (toFetch.length === 0) {
      headshotsFetchedRef.current = true;
      return;
    }

    // Cap concurrency so we never saturate the mobile connection pool.
    // Six is the common per-host HTTP/1.1 limit; four keeps headroom for
    // other API calls that may fire while the user is editing.
    const CONCURRENCY = 4;
    let idx = 0;
    const results = {};

    async function worker() {
      while (!cancelled && idx < toFetch.length) {
        const p = toFetch[idx++];
        try {
          // Downsample to ~2× display size (34 px card → 96 px max) so the
          // base64 payload stays tiny. html-to-image on iOS Safari silently
          // drops inlined images when the SVG foreignObject is too large,
          // which made the exported PNG show blank circles for every
          // headshot. 96 px keeps the whole 50-card capture well under the
          // limit while staying visually indistinguishable at 2× pixelRatio.
          const dataUrl = await fetchImageAsDataUrl(
            proxyImageUrl(p.headshot_url),
            96,
            { signal: controller.signal }
          );
          if (cancelled) return;
          if (dataUrl) results[p.id] = dataUrl;
        } catch {
          // AbortError on unmount, or network failure — skip this headshot.
        }
      }
    }

    Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, toFetch.length) }, worker)
    ).then(() => {
      if (cancelled) return;
      if (Object.keys(results).length > 0) {
        setHeadshotDataUrls((prev) => ({ ...prev, ...results }));
      }
      headshotsFetchedRef.current = true;
    });

    return () => {
      cancelled = true;
      // Aborting the controller cancels in-flight proxy fetches so they
      // don't keep holding connections open after the user navigates away.
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefetchKey]);

  const isMobile = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    if (!navigator.share) return false;
    return window.matchMedia?.('(hover: none) and (pointer: coarse)').matches === true;
  }, []);

  async function handleExport() {
    if (!exportRef.current || !top50.length) return;
    setExporting(true);
    try {
      // Wait up to 8 s for the background headshot pre-fetch to complete.
      // If it times out we still proceed — some players will show initials.
      const deadline = Date.now() + 8000;
      while (!headshotsFetchedRef.current && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      // Wait for all <img> elements inside the card to finish loading.
      // This covers both the pre-fetched base64 src AND the proxy-URL
      // fallback imgs that html-to-image will fetch at capture time.
      const imgs = exportRef.current.querySelectorAll('img');
      await Promise.all(
        Array.from(imgs).map((img) =>
          img.complete && img.naturalHeight > 0
            ? Promise.resolve()
            : new Promise((resolve) => {
                img.addEventListener('load', resolve, { once: true });
                img.addEventListener('error', resolve, { once: true });
                // Safety timeout — don't block forever if one image hangs
                setTimeout(resolve, 5000);
              })
        )
      );
      const toPng = await loadToPng();
      // cacheBust:false — images are base64 data URLs; appending ?_cb=... to
      // them corrupts the data: URI and silently drops images.
      // No explicit width — the element is in normal flow so html-to-image
      // reads its natural offsetWidth (900 px) without any fixed-position
      // or viewport-clipping ambiguity.
      const dataUrl = await toPng(exportRef.current, { pixelRatio: 2, cacheBust: false });
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const fileName = `bigboard-top50-${new Date().toISOString().slice(0, 10)}.png`;

      if (isMobile && navigator.share) {
        const file = new File([blob], fileName, { type: 'image/png' });
        await navigator.share({ files: [file], title: `${boardTitle} — Top 50` });
      } else if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast.success('Top 50 copied to clipboard!');
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('Top 50 downloaded!');
      }
    } catch (e) {
      toast.error('Export failed — try again');
      console.error(e);
    } finally {
      setExporting(false);
    }
  }

  return { exportRef, exporting, handleExport, theme, headshotDataUrls };
}

// ─── Sortable board item ──────────────────────────────────────────────────────
function SortableBoardItem({ player, rank, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `board-${player.id}`,
  });
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border-subtle bg-bg-surface/40 group select-none md:cursor-grab md:touch-none"
    >
      {/* Drag handle — on mobile this is the sole drag initiator: touch-none
          scoped to the handle so the row body stays scrollable (without it
          the browser fires pointercancel on scroll gestures and cancels the
          drag before it starts).
          On desktop the whole li is draggable (listeners + touch-none on li
          above); the handle remains a visual affordance. dnd-kit deduplicates
          via its internal `active` guard when both fire on a desktop click. */}
      <span
        {...listeners}
        className="shrink-0 text-text-muted cursor-grab active:cursor-grabbing touch-none p-2 -mx-1 -my-2"
        aria-label="Drag to reorder"
        role="button"
        tabIndex={-1}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
          <rect x="2" y="2" width="3" height="3" rx="1" />
          <rect x="9" y="2" width="3" height="3" rx="1" />
          <rect x="2" y="6" width="3" height="3" rx="1" />
          <rect x="9" y="6" width="3" height="3" rx="1" />
          <rect x="2" y="10" width="3" height="3" rx="1" />
          <rect x="9" y="10" width="3" height="3" rx="1" />
        </svg>
      </span>
      <span className="font-mono text-[10px] text-text-muted w-5 shrink-0 text-right">{rank}</span>
      <PlayerHeadshot url={player.headshot_url} name={player.name} position={player.position} size="xs" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold truncate text-text-primary">{player.name}</div>
        <div className="text-[10.5px] text-text-muted truncate">{player.school}</div>
      </div>
      <PositionBadge position={player.position} />
      {/* stopPropagation prevents the row's drag listeners from firing when
          the user clicks the remove button */}
      <button
        onClick={() => onRemove(player.id)}
        onPointerDown={(e) => e.stopPropagation()}
        className="shrink-0 ml-1 text-text-muted hover:text-red-400 transition opacity-60 md:opacity-0 md:group-hover:opacity-100 cursor-pointer"
        aria-label={`Remove ${player.name}`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </li>
  );
}

// ─── Available player row ─────────────────────────────────────────────────────
function AvailablePlayerRow({ player, onAdd }) {
  return (
    <li
      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border-subtle bg-bg-surface/30 hover:border-accent hover:bg-accent/[0.04] cursor-pointer transition-all duration-100 group"
      onClick={() => onAdd(player)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAdd(player); } }}
    >
      <span className="font-mono text-[10px] text-text-muted w-6 shrink-0 text-right">
        {player.consensus_rank ?? ''}
      </span>
      <PlayerHeadshot url={player.headshot_url} name={player.name} position={player.position} size="xs" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold truncate text-text-primary">{player.name}</div>
        <div className="text-[10.5px] text-text-muted truncate">{player.school}</div>
      </div>
      <PositionBadge position={player.position} />
      <span
        className="shrink-0 ml-1 text-text-muted group-hover:text-accent transition opacity-0 group-hover:opacity-100"
        aria-hidden="true"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </span>
    </li>
  );
}

// ─── Board Editor ─────────────────────────────────────────────────────────────
function BoardEditor({ board, allPlayers, user, onSaved, onBack }) {
  const [title, setTitle] = useState(board?.title || 'My Board');
  const [boardPlayers, setBoardPlayers] = useState(() => {
    if (!board?.rankings) return [];
    return [...board.rankings].sort((a, b) => a.rank - b.rank);
  });
  const [search, setSearch] = useState('');
  const [posFilter, setPosFilter] = useState('ALL');
  const [saving, setSaving] = useState(false);
  const [activeId, setActiveId] = useState(null);

  const boardIds = useMemo(() => new Set(boardPlayers.map((p) => p.id)), [boardPlayers]);

  const available = useMemo(() => {
    let list = (allPlayers || []).filter((p) => !boardIds.has(p.id));
    if (posFilter !== 'ALL') list = list.filter((p) => p.position === posFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || p.school?.toLowerCase().includes(q));
    }
    return list;
  }, [allPlayers, boardIds, posFilter, search]);

  // The handle has touch-action:none so the browser won't intercept its touch
  // events for scroll. PointerSensor with distance:2 works cleanly for both
  // mouse and touch — no delay needed because the handle is the only initiator.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 2 } }));
  const [mobileTab, setMobileTab] = useState('available');
  const sortableIds = useMemo(() => boardPlayers.map((p) => `board-${p.id}`), [boardPlayers]);

  function handleAddPlayer(player) {
    setBoardPlayers((prev) => [...prev, player]);
  }

  function handleRemovePlayer(playerId) {
    setBoardPlayers((prev) => prev.filter((p) => p.id !== playerId));
  }

  function handleDragStart({ active }) {
    setActiveId(active.id);
  }

  function handleDragEnd({ active, over }) {
    setActiveId(null);
    if (!over || active.id === over.id) return;
    const oldIdx = boardPlayers.findIndex((p) => `board-${p.id}` === active.id);
    const newIdx = boardPlayers.findIndex((p) => `board-${p.id}` === over.id);
    if (oldIdx !== -1 && newIdx !== -1) {
      setBoardPlayers((prev) => arrayMove(prev, oldIdx, newIdx));
    }
  }

  const activePlayer = activeId
    ? boardPlayers.find((p) => `board-${p.id}` === activeId)
    : null;

  async function handleSave() {
    if (!user) {
      toast.error('Sign in to save your board');
      return;
    }
    if (!title.trim()) { toast.error('Please enter a board name'); return; }
    setSaving(true);
    try {
      const rankings = boardPlayers.map((p, i) => ({ player_id: p.id, rank: i + 1 }));
      if (board?.id) {
        await api.updateBoard(board.id, { title: title.trim(), rankings });
        toast.success('Board saved!');
      } else {
        await api.createBoard(title.trim(), rankings);
        toast.success('Board created!');
      }
      onSaved();
    } catch (e) {
      toast.error(e?.message || 'Failed to save board');
    } finally {
      setSaving(false);
    }
  }

  // Export hook — uses current boardPlayers as the top 50 source
  const { exportRef, exporting, handleExport, theme, headshotDataUrls } =
    useTop50Export({
      players: boardPlayers,
      boardTitle: title,
    });

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar — full width (matches TeamMock header pattern). Inner content
          is centered via max-w-6xl on an inner child, not on the toolbar itself,
          so the toolbar's shrink-0 height behavior stays clean. */}
      <div className="border-b border-border-subtle bg-bg-surface/30 shrink-0"><div className="flex items-center gap-3 px-4 py-3 max-w-6xl w-full mx-auto flex-wrap">
        <button onClick={onBack} className="text-text-muted hover:text-text-primary transition shrink-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={60}
          placeholder="Board name…"
          className="flex-1 min-w-0 bg-transparent border-b border-border-subtle focus:border-accent outline-none text-text-primary font-display font-semibold text-sm uppercase tracking-[0.1em] py-0.5"
        />
        <div className="flex items-center gap-2 shrink-0">
          {boardPlayers.length >= 1 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting ? 'Exporting…' : 'Export Top 50'}
            </Button>
          )}
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {!user ? 'Sign in to save' : saving ? 'Saving…' : 'Save Board'}
          </Button>
        </div>
        </div>
      </div>

      {/* Mobile tab switcher — hidden on md+ where both panels show side-by-side */}
      <div className="md:hidden border-b border-border-subtle shrink-0"><div className="flex max-w-6xl w-full mx-auto">
        <button
          onClick={() => setMobileTab('available')}
          className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
            mobileTab === 'available'
              ? 'text-accent border-b-2 border-accent -mb-px'
              : 'text-text-muted'
          }`}
        >
          Prospects
          <span className="ml-1.5 text-[11px] font-mono opacity-70">({available.length})</span>
        </button>
        <button
          onClick={() => setMobileTab('board')}
          className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
            mobileTab === 'board'
              ? 'text-accent border-b-2 border-accent -mb-px'
              : 'text-text-muted'
          }`}
        >
          My Board
          <span className="ml-1.5 text-[11px] font-mono opacity-70">({boardPlayers.length})</span>
        </button>
        </div>
      </div>

      {/* Two-panel body — matches TeamMock.jsx's exact working pattern.
          Just `flex-1 overflow-hidden` — no max-w, no min-h, no mx-auto.
          The panels stretch edge-to-edge on wide screens (same as TeamMock)
          so the flex-1 height grow has nothing to fight with. Any max-width
          centering needed for readability happens inside each panel's content. */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left — Available prospects */}
        <div className={`flex-col md:border-r border-border-subtle min-h-0 w-full md:w-1/2 ${
          mobileTab === 'available' ? 'flex' : 'hidden md:flex'
        }`}>
          <div className="px-3 pt-3 pb-2 space-y-2 shrink-0">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search prospects…"
                  autoComplete="off"
                  className="w-full bg-bg-deep/70 border border-border-subtle rounded-lg pl-9 pr-3 py-2 text-text-primary text-[13px] focus:border-accent outline-none transition"
                />
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
                </svg>
              </div>
              <select
                value={posFilter}
                onChange={(e) => setPosFilter(e.target.value)}
                className="bg-bg-deep/70 border border-border-subtle rounded-lg px-2 py-2 text-text-primary text-[12px]"
              >
                {['ALL', ...POSITIONS].map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div className="text-[10px] text-text-muted px-1">
              {available.length} available · {boardIds.size} ranked
            </div>
          </div>
          <ul className="overflow-y-auto flex-1 space-y-1 px-3 pb-3" style={{ overscrollBehavior: 'contain' }}>
            {!allPlayers
              ? Array.from({ length: 12 }, (_, i) => <Skeleton key={i} className="h-[46px] w-full rounded-lg" />)
              : available.length === 0
              ? (
                <li className="text-center py-8 text-text-muted text-sm">
                  {search || posFilter !== 'ALL' ? 'No matches — try clearing filters' : 'All players are on your board!'}
                </li>
              )
              : available.map((p) => (
                <AvailablePlayerRow
                  key={p.id}
                  player={p}
                  onAdd={(player) => {
                    handleAddPlayer(player);
                    // On mobile, switch to board tab after adding so the user
                    // can see the player was added.
                    setMobileTab('board');
                  }}
                />
              ))
            }
          </ul>
        </div>

        {/* Right — My Board */}
        <div className={`flex-col min-h-0 w-full md:w-1/2 ${
          mobileTab === 'board' ? 'flex' : 'hidden md:flex'
        }`}>
          <div className="px-3 pt-3 pb-2 shrink-0">
            <div className="text-[10px] text-text-muted px-1">
              {boardPlayers.length > 0
                ? `${boardPlayers.length} ranked — hold & drag to reorder`
                : 'Tap + on any prospect to add them to your board'}
            </div>
          </div>
          <DndContext
            sensors={sensors}
            modifiers={[snapCenterToCursor]}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
              <ul className="overflow-y-auto flex-1 space-y-1 px-3 pb-3" style={{ overscrollBehavior: 'contain' }}>
                {boardPlayers.length === 0 ? (
                  <li className="border-2 border-dashed border-border-subtle rounded-xl flex items-center justify-center text-text-muted text-sm h-32 mt-2">
                    Your board is empty
                  </li>
                ) : (
                  boardPlayers.map((p, i) => (
                    <SortableBoardItem
                      key={p.id}
                      player={p}
                      rank={i + 1}
                      onRemove={handleRemovePlayer}
                    />
                  ))
                )}
              </ul>
            </SortableContext>
            {/* dropAnimation={null} removes the snap-back on release so the
                list feels instant. The item simply settles in its new slot. */}
            <DragOverlay dropAnimation={null}>
              {activePlayer && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-accent bg-bg-surface shadow-glow opacity-95">
                  <PlayerHeadshot url={activePlayer.headshot_url} name={activePlayer.name} position={activePlayer.position} size="xs" />
                  <span className="text-[13px] font-semibold text-text-primary">{activePlayer.name}</span>
                  <PositionBadge position={activePlayer.position} />
                </div>
              )}
            </DragOverlay>
          </DndContext>
        </div>
      </div>

      {/* Hidden export card.
          opacity:0 hides the card without inheriting to children (visibility
          would propagate and make the canvas capture blank). position:fixed
          removes it from document flow so the 900px card never causes a
          horizontal overflow that displaces draggable items on the page.
          top:0 left:0 keeps the element in-viewport so browsers fully decode
          images — same pattern as TeamMock's working export card. */}
      <div style={{ position: 'fixed', top: 0, left: 0, opacity: 0, zIndex: -1, pointerEvents: 'none' }} aria-hidden>
        <Top50ExportCard
          ref={exportRef}
          players={boardPlayers}
          boardTitle={title}
          theme={theme}
          headshotDataUrls={headshotDataUrls}
          exporting={exporting}
        />
      </div>
    </div>
  );
}

// ─── Board List View ──────────────────────────────────────────────────────────
function BoardListView({ boards, loading, user, onNew, onOpen, onDelete }) {
  const [deleting, setDeleting] = useState(null);

  async function confirmDelete(board) {
    if (!window.confirm(`Delete "${board.title}"? This cannot be undone.`)) return;
    setDeleting(board.id);
    try {
      await api.deleteBoard(board.id);
      toast.success('Board deleted');
      onDelete(board.id);
    } catch (e) {
      toast.error(e?.message || 'Failed to delete board');
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold uppercase tracking-[0.12em] text-text-primary">
            My Big Boards
          </h1>
          <p className="text-text-secondary text-sm mt-1">
            Rank prospects and use your board in any mock draft.
          </p>
        </div>
        <Button onClick={onNew} size="sm">+ New Board</Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
        </div>
      ) : boards.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-border-subtle rounded-2xl">
          {!user ? (
            <>
              <div className="text-text-muted text-sm mb-1">Build your own prospect rankings.</div>
              <div className="text-text-muted text-[12px] mb-4 opacity-70">Sign in to save boards between sessions.</div>
            </>
          ) : (
            <div className="text-text-muted text-sm mb-4">You haven't created any boards yet.</div>
          )}
          <Button onClick={onNew}>Create Your First Board</Button>
        </div>
      ) : (
        <ul className="space-y-3">
          {boards.map((b) => (
            <li
              key={b.id}
              className="flex items-center gap-4 px-4 py-4 rounded-xl border border-border-subtle bg-bg-surface/40 hover:border-accent/50 transition group"
            >
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onOpen(b)}>
                <div className="font-display font-semibold text-text-primary uppercase tracking-[0.1em] truncate">
                  {b.title}
                </div>
                <div className="text-[11px] text-text-muted mt-0.5">
                  {b.rank_count} player{b.rank_count !== 1 ? 's' : ''} ranked ·{' '}
                  {new Date(b.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button variant="outline" size="sm" onClick={() => onOpen(b)}>
                  Edit
                </Button>
                <button
                  onClick={() => confirmDelete(b)}
                  disabled={deleting === b.id}
                  className="text-text-muted hover:text-red-400 transition opacity-0 group-hover:opacity-100 disabled:opacity-30"
                  aria-label={`Delete ${b.title}`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                  </svg>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Page Shell ───────────────────────────────────────────────────────────────
export default function BigBoard() {
  usePageMeta({
    title: 'My Big Board',
    description: 'Build your personal NFL draft prospect rankings and use them in any mock draft.',
  });

  const { user } = useAuth();

  // Editor state is mirrored to ?b=<id> (or ?b=new) so a refresh restores
  // whichever board the user had open.
  const [searchParams, setSearchParams] = useSearchParams();
  const editParam = searchParams.get('b');

  const [boards, setBoards] = useState([]);
  const [loadingBoards, setLoadingBoards] = useState(true);
  const [allPlayers, setAllPlayers] = useState(null);
  // editing: null = list view, object = editor (new board or existing)
  const [editing, setEditing] = useState(null);
  // Loading state for the initial restore-from-URL fetch
  const [restoringFromUrl, setRestoringFromUrl] = useState(!!editParam);

  // Load players for everyone (public endpoint); load saved boards only for
  // logged-in users. Guests can still build boards — they just can't save them.
  useEffect(() => {
    api.getPlayers()
      .then((list) => setAllPlayers(Array.isArray(list) ? list : []))
      .catch(() => setAllPlayers([]));
    if (!user) {
      setLoadingBoards(false);
      return;
    }
    api.listBoards()
      .then((list) => setBoards(Array.isArray(list) ? list : []))
      .catch(() => setBoards([]))
      .finally(() => setLoadingBoards(false));
  }, [user]);

  // Sync editor state with the ?b=… URL param. Runs on mount (restore after
  // refresh) and whenever the param changes (e.g. browser back button).
  useEffect(() => {
    // Wait for auth to settle — user is undefined while loading
    if (user === undefined) return;
    if (editParam === null) {
      setEditing(null);
      setRestoringFromUrl(false);
      return;
    }
    if (editParam === 'new') {
      setEditing({ id: null, title: 'My Board', rankings: [] });
      setRestoringFromUrl(false);
      return;
    }
    // Existing-board IDs are only valid for logged-in users
    if (!user) {
      setSearchParams({}, { replace: true });
      setRestoringFromUrl(false);
      return;
    }
    // Existing-board case: fetch rankings if we don't already have them
    const boardId = Number(editParam);
    if (!Number.isFinite(boardId)) {
      // Invalid param — drop it
      setSearchParams({}, { replace: true });
      return;
    }
    if (editing?.id === boardId) { setRestoringFromUrl(false); return; }
    let cancelled = false;
    // Show a toast only for in-app navigations (when we're NOT gating render).
    // On initial hard-refresh restore, `restoringFromUrl` already gates the
    // UI to a blank screen, so a toast would be redundant and noisy.
    const loadToast = restoringFromUrl ? null : toast.loading('Loading board…');
    api.getBoardById(boardId)
      .then((data) => {
        if (cancelled) return;
        // API returns { board: { id, title }, players: [...all merged...] }
        // where explicitly-ranked players carry a `user_rank` field and
        // auto-completed fill-ins don't. The user's actual picks are
        // exactly those with a user_rank, preserved in order.
        const explicitlyRanked = (data.players || []).filter((p) => p.user_rank != null);
        setEditing({
          id: boardId,
          title: data.board?.title || 'My Board',
          rankings: explicitlyRanked,
        });
        if (loadToast) toast.dismiss(loadToast);
      })
      .catch((e) => {
        if (cancelled) return;
        if (loadToast) toast.dismiss(loadToast);
        toast.error(e?.message || 'Board not found');
        setSearchParams({}, { replace: true });
      })
      .finally(() => { if (!cancelled) setRestoringFromUrl(false); });
    return () => { cancelled = true; if (loadToast) toast.dismiss(loadToast); };
    // editing?.id / restoringFromUrl intentionally omitted — we only re-run
    // when the URL param or user changes, not when we populate `editing`
    // ourselves or flip the restore flag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editParam, user]);

  function handleOpenBoard(boardMeta) {
    // Navigate via URL — the effect above fetches + populates `editing`
    setSearchParams({ b: String(boardMeta.id) });
  }

  function handleNewBoard() {
    setSearchParams({ b: 'new' });
  }

  function handleBack() {
    setSearchParams({});
  }

  function handleSaved() {
    setSearchParams({});
    setLoadingBoards(true);
    api.listBoards()
      .then((list) => setBoards(Array.isArray(list) ? list : []))
      .catch(() => setBoards([]))
      .finally(() => setLoadingBoards(false));
  }

  function handleDeletedBoard(id) {
    setBoards((prev) => prev.filter((b) => b.id !== id));
  }

  // Still loading auth — don't flash list view with wrong state
  if (user === undefined) return null;

  // If restoring from ?b=<id> on a hard refresh, render nothing until the
  // board data arrives — avoids a flash of the list view.
  if (restoringFromUrl) return null;

  if (editing !== null) {
    return (
      <div className="h-full flex flex-col" style={{ overflow: 'hidden' }}>
        <BoardEditor
          board={editing}
          allPlayers={allPlayers}
          user={user}
          onSaved={handleSaved}
          onBack={handleBack}
        />
      </div>
    );
  }

  return (
    <BoardListView
      boards={boards}
      loading={loadingBoards}
      user={user}
      onNew={handleNewBoard}
      onOpen={handleOpenBoard}
      onDelete={handleDeletedBoard}
    />
  );
}
