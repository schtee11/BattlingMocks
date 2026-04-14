import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { api, proxyImageUrl } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { POSITIONS, posHex } from '../lib/positions.js';
import { PlayerHeadshot } from '../components/ui/PlayerHeadshot.jsx';
import { PositionBadge } from '../components/ui/Badge.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { usePageMeta } from '../hooks/usePageMeta.js';

// Lazy-load html-to-image to keep initial bundle small
const loadToPng = () => import('html-to-image').then((m) => m.toPng);

// Inline modifier: restrict dragging to the vertical axis only.
// @dnd-kit/modifiers is not installed, so we provide the same logic here.
function restrictToVerticalAxis({ transform }) {
  return { ...transform, x: 0 };
}

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
const Top50ExportCard = forwardRef(function Top50ExportCard(
  { players, boardTitle, theme, headshotDataUrls = {} },
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
      <div style={{ marginBottom: 28, borderBottom: `1px solid ${C.subtle}`, paddingBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase', color: C.accent, marginBottom: 6 }}>
          MockDraft Showdown
        </div>
        <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: 1, color: C.text }}>
          {boardTitle || 'My Big Board'} — Top 50
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{dateStr}</div>
      </div>

      {/* 5-column grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
        {top50.map((p, i) => {
          const color = posHex(p.position);
          const headshot = headshotDataUrls[p.id];
          const initial = (p.name || '?')[0]?.toUpperCase() || '?';
          return (
            <div
              key={p.id}
              style={{
                background: C.surface,
                borderRadius: 10,
                padding: '10px 10px 8px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                border: `1px solid ${C.subtle}`,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, width: 20, textAlign: 'right', flexShrink: 0 }}>
                {i + 1}
              </div>
              {/* Prefer the pre-fetched base64 data URL (no CORS needed at
                  capture time). Fall back to the proxy URL with
                  crossOrigin="anonymous" so html-to-image can still read
                  the pixels — the proxy sets Access-Control-Allow-Origin:* */}
              {(headshot || p.headshot_url) ? (
                <img
                  src={headshot || proxyImageUrl(p.headshot_url)}
                  crossOrigin="anonymous"
                  alt=""
                  style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, background: `${color}22` }}
                />
              ) : (
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: `${color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 900, color, flexShrink: 0 }}>
                  {initial}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {p.name}
                </div>
                <div style={{ fontSize: 10, color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {p.position}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ marginTop: 24, textAlign: 'center', fontSize: 10, color: C.muted, letterSpacing: 1 }}>
        BATTLINGMOCKS.COM
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

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(getCurrentTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const top50 = useMemo(() => (players || []).slice(0, 50), [players]);

  useEffect(() => {
    if (!top50.length) return;
    headshotsFetchedRef.current = false;
    let cancelled = false;
    const toFetch = top50.filter((p) => p.headshot_url);
    Promise.all(
      toFetch.map((p) =>
        fetch(proxyImageUrl(p.headshot_url))
          .then((r) => (r.ok ? r.blob() : null))
          .then(
            (blob) =>
              new Promise((resolve) => {
                if (!blob) return resolve([p.id, null]);
                const reader = new FileReader();
                reader.onloadend = () => resolve([p.id, reader.result]);
                reader.readAsDataURL(blob);
              })
          )
          .catch(() => [p.id, null])
      )
    ).then((pairs) => {
      if (cancelled) return;
      const map = {};
      for (const [id, url] of pairs) if (url) map[id] = url;
      setHeadshotDataUrls(map);
      headshotsFetchedRef.current = true;
    });
    return () => { cancelled = true; };
  }, [top50]);

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
      // width:900 — explicit capture width so the PNG is never narrower than
      // the card even if the element is in an off-screen fixed container.
      const dataUrl = await toPng(exportRef.current, { pixelRatio: 2, cacheBust: false, width: 900 });
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
      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border-subtle bg-bg-surface/40 group"
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="shrink-0 text-text-muted hover:text-text-secondary cursor-grab active:cursor-grabbing touch-none"
        aria-label="Drag to reorder"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
          <rect x="2" y="2" width="3" height="3" rx="1" />
          <rect x="9" y="2" width="3" height="3" rx="1" />
          <rect x="2" y="6" width="3" height="3" rx="1" />
          <rect x="9" y="6" width="3" height="3" rx="1" />
          <rect x="2" y="10" width="3" height="3" rx="1" />
          <rect x="9" y="10" width="3" height="3" rx="1" />
        </svg>
      </button>
      <span className="font-mono text-[10px] text-text-muted w-5 shrink-0 text-right">{rank}</span>
      <PlayerHeadshot url={player.headshot_url} name={player.name} position={player.position} size="xs" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold truncate text-text-primary">{player.name}</div>
        <div className="text-[10.5px] text-text-muted truncate">{player.school}</div>
      </div>
      <PositionBadge position={player.position} />
      <button
        onClick={() => onRemove(player.id)}
        className="shrink-0 ml-1 text-text-muted hover:text-red-400 transition opacity-0 group-hover:opacity-100"
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
function BoardEditor({ board, allPlayers, onSaved, onBack }) {
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

  // distance:2 gives an instant feel — 2px of movement confirms intent
  // without any perceptible lag before the drag begins.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 2 } }));
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
  const { exportRef, exporting, handleExport, theme, headshotDataUrls } = useTop50Export({
    players: boardPlayers,
    boardTitle: title,
  });

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle bg-bg-surface/30 shrink-0 flex-wrap">
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
            {saving ? 'Saving…' : 'Save Board'}
          </Button>
        </div>
      </div>

      {/* Two-panel body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left — Available */}
        <div className="w-1/2 flex flex-col border-r border-border-subtle min-h-0">
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
                <AvailablePlayerRow key={p.id} player={p} onAdd={handleAddPlayer} />
              ))
            }
          </ul>
        </div>

        {/* Right — Board */}
        <div className="w-1/2 flex flex-col min-h-0">
          <div className="px-3 pt-3 pb-2 shrink-0">
            <div className="text-[10px] text-text-muted px-1">
              {boardPlayers.length > 0
                ? `${boardPlayers.length} ranked — drag to reorder, click × to remove`
                : 'Click + on any player to add them to your board'}
            </div>
          </div>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
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

      {/* Hidden export card — positioned off-screen so it doesn't affect
          page layout. We pass explicit width:900 to toPng so the capture is
          never viewport-constrained (fixed+top/left would clip on narrow
          screens and cut off the rightmost column). */}
      <div style={{ position: 'fixed', left: -9999, top: -9999, pointerEvents: 'none' }} aria-hidden>
        <Top50ExportCard
          ref={exportRef}
          players={boardPlayers}
          boardTitle={title}
          theme={theme}
          headshotDataUrls={headshotDataUrls}
        />
      </div>
    </div>
  );
}

// ─── Board List View ──────────────────────────────────────────────────────────
function BoardListView({ boards, loading, onNew, onOpen, onDelete }) {
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
          <div className="text-text-muted text-sm mb-4">You haven't created any boards yet.</div>
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
  const nav = useNavigate();

  // Redirect guests
  useEffect(() => {
    if (user === null) nav('/join', { replace: true });
  }, [user, nav]);

  const [boards, setBoards] = useState([]);
  const [loadingBoards, setLoadingBoards] = useState(true);
  const [allPlayers, setAllPlayers] = useState(null);
  // editing: null = list view, {} = new board, board object = edit existing
  const [editing, setEditing] = useState(null);

  // Load boards + all players
  useEffect(() => {
    if (!user) return;
    api.listBoards()
      .then((list) => setBoards(Array.isArray(list) ? list : []))
      .catch(() => setBoards([]))
      .finally(() => setLoadingBoards(false));
    api.getPlayers()
      .then((list) => setAllPlayers(Array.isArray(list) ? list : []))
      .catch(() => setAllPlayers([]));
  }, [user]);

  // When opening a board for editing, fetch its full rankings
  async function handleOpenBoard(boardMeta) {
    const loadToast = toast.loading('Loading board…');
    try {
      const data = await api.getBoardById(boardMeta.id);
      // data.players has the full ordered list; we only want the user-ranked ones
      // (the API returns all players merged, but we want just the explicit rankings
      //  so the editor starts with the user's ranked slice, not all 713 players)
      const explicitlyRanked = (data.players || []).filter(
        (_, i) => i < (boardMeta.rank_count || 0)
      );
      toast.dismiss(loadToast);
      setEditing({ id: boardMeta.id, title: boardMeta.title, rankings: explicitlyRanked });
    } catch (e) {
      toast.dismiss(loadToast);
      toast.error(e?.message || 'Failed to load board');
    }
  }

  function handleNewBoard() {
    setEditing({ id: null, title: 'My Board', rankings: [] });
  }

  function handleSaved() {
    setEditing(null);
    setLoadingBoards(true);
    api.listBoards()
      .then((list) => setBoards(Array.isArray(list) ? list : []))
      .catch(() => setBoards([]))
      .finally(() => setLoadingBoards(false));
  }

  function handleDeletedBoard(id) {
    setBoards((prev) => prev.filter((b) => b.id !== id));
  }

  // Still loading auth or guest (redirect handled by useEffect above)
  if (!user) return null;

  if (editing !== null) {
    return (
      <div className="h-screen flex flex-col overflow-hidden">
        <BoardEditor
          board={editing}
          allPlayers={allPlayers}
          onSaved={handleSaved}
          onBack={() => setEditing(null)}
        />
      </div>
    );
  }

  return (
    <BoardListView
      boards={boards}
      loading={loadingBoards}
      onNew={handleNewBoard}
      onOpen={handleOpenBoard}
      onDelete={handleDeletedBoard}
    />
  );
}
