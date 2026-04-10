import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
// Lazy-loaded on first export to keep the initial chunk small
const loadToPng = () => import('html-to-image').then((m) => m.toPng);
import { api, proxyImageUrl } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { pickForTeam } from '../lib/botPicker.js';
import { POSITIONS, posHex } from '../lib/positions.js';
import { TeamLogo } from '../components/ui/TeamLogo.jsx';
import { PlayerHeadshot } from '../components/ui/PlayerHeadshot.jsx';
import { PositionBadge } from '../components/ui/Badge.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { TradeModal } from '../components/TradeModal.jsx';

// ─── NFL Teams ────────────────────────────────────────────────────────────────
const NFL_TEAMS = [
  // AFC East
  { abbr: 'BUF', name: 'Bills' }, { abbr: 'MIA', name: 'Dolphins' },
  { abbr: 'NE', name: 'Patriots' }, { abbr: 'NYJ', name: 'Jets' },
  // AFC North
  { abbr: 'BAL', name: 'Ravens' }, { abbr: 'CIN', name: 'Bengals' },
  { abbr: 'CLE', name: 'Browns' }, { abbr: 'PIT', name: 'Steelers' },
  // AFC South
  { abbr: 'HOU', name: 'Texans' }, { abbr: 'IND', name: 'Colts' },
  { abbr: 'JAX', name: 'Jaguars' }, { abbr: 'TEN', name: 'Titans' },
  // AFC West
  { abbr: 'DEN', name: 'Broncos' }, { abbr: 'KC', name: 'Chiefs' },
  { abbr: 'LV', name: 'Raiders' }, { abbr: 'LAC', name: 'Chargers' },
  // NFC East
  { abbr: 'DAL', name: 'Cowboys' }, { abbr: 'NYG', name: 'Giants' },
  { abbr: 'PHI', name: 'Eagles' }, { abbr: 'WAS', name: 'Commanders' },
  // NFC North
  { abbr: 'CHI', name: 'Bears' }, { abbr: 'DET', name: 'Lions' },
  { abbr: 'GB', name: 'Packers' }, { abbr: 'MIN', name: 'Vikings' },
  // NFC South
  { abbr: 'ATL', name: 'Falcons' }, { abbr: 'CAR', name: 'Panthers' },
  { abbr: 'NO', name: 'Saints' }, { abbr: 'TB', name: 'Buccaneers' },
  // NFC West
  { abbr: 'ARI', name: 'Cardinals' }, { abbr: 'LAR', name: 'Rams' },
  { abbr: 'SF', name: '49ers' }, { abbr: 'SEA', name: 'Seahawks' },
];

const ROUND_LABELS = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th'];

// ─── Team Picker ──────────────────────────────────────────────────────────────
function TeamPicker({ onSelect, draftOrder, onRefresh }) {
  // Count how many rounds actually loaded — helps diagnose stale caches.
  const roundsLoaded = useMemo(() => {
    const s = new Set();
    for (const row of draftOrder || []) s.add(row.round);
    return [...s].sort((a, b) => a - b);
  }, [draftOrder]);
  const totalPicks = draftOrder?.length || 0;
  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="text-center mb-8">
        <h1 className="font-display text-3xl font-bold uppercase tracking-[0.12em] text-text-primary mb-2">
          Team Mock Draft
        </h1>
        <p className="text-text-secondary text-sm max-w-md mx-auto leading-relaxed">
          Pick your team. You'll draft all their picks across all 7 rounds.
          Bots fill every other team using BPA + team needs.
        </p>
        <div className="mt-3 flex items-center justify-center gap-2 text-[10px] font-mono text-text-muted">
          <span>
            {totalPicks} picks loaded · rounds [{roundsLoaded.join(', ') || '—'}]
          </span>
          <button
            onClick={onRefresh}
            className="font-display font-semibold uppercase tracking-[0.12em] text-[9.5px] text-accent hover:brightness-125 transition"
          >
            Refresh
          </button>
        </div>
      </div>
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
        {NFL_TEAMS.map((t) => (
          <button
            key={t.abbr}
            onClick={() => onSelect(t.abbr)}
            className="flex flex-col items-center gap-1.5 p-2 rounded-xl border border-border-subtle bg-bg-surface/40 hover:border-accent/60 hover:bg-accent/[0.05] hover:-translate-y-[2px] transition-all duration-150 group"
          >
            <TeamLogo abbr={t.abbr} size="lg" />
            <span className="font-display font-semibold text-[9.5px] uppercase tracking-[0.1em] text-text-muted group-hover:text-text-primary transition-colors">
              {t.abbr}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Saved View ───────────────────────────────────────────────────────────────
function SavedView({ savedMock, players, onRestart }) {
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const userTeam = savedMock.team_abbr;
  // Only show the user's own picks — the full 262-pick board is noise when
  // reviewing a saved team mock. The actual user_team picks are stored along
  // with bot picks in savedMock.picks; filter by team.
  const myPicks = useMemo(
    () =>
      savedMock.picks
        .filter((p) => p.team === userTeam)
        .sort((a, b) => a.pick_number - b.pick_number),
    [savedMock.picks, userTeam]
  );
  const myPicksByRound = useMemo(() => {
    const map = {};
    for (const p of myPicks) {
      if (!map[p.round]) map[p.round] = [];
      map[p.round].push(p);
    }
    return map;
  }, [myPicks]);
  const rounds = Object.keys(myPicksByRound).map(Number).sort((a, b) => a - b);

  // Export: renders the hidden ExportCard to a PNG blob, then either copies
  // to clipboard (desktop) or opens the native share sheet (mobile). One
  // button, two behaviors based on platform — Windows share-to-Discord is
  // broken (Discord pops its own server/channel picker instead of pasting
  // into the current chat), so clipboard+Ctrl-V is the reliable path.
  const exportRef = useRef(null);
  const [exporting, setExporting] = useState(false);
  const cachedBlobRef = useRef(null);

  // Mobile detection: touch-primary device with no hover. Desktops with
  // trackpads report hover:hover; phones/tablets report hover:none. This is
  // more reliable than user-agent sniffing.
  const isMobile = useMemo(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    if (!navigator.share) return false;
    return window.matchMedia?.('(hover: none) and (pointer: coarse)').matches === true;
  }, []);

  // Theme mirror. The hidden card mounts with the current theme so the
  // captured PNG matches whatever the user is looking at.
  const [theme, setTheme] = useState(getCurrentTheme);
  useEffect(() => {
    // React to live theme changes (user toggles mid-view)
    const observer = new MutationObserver(() => setTheme(getCurrentTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const themeBg = theme === 'light' ? '#f0f2f7' : '#04080f';

  // Count how many headshots we expect to fetch. On slow mobile networks the
  // fetches can take several seconds, so the Share/Copy handlers wait for
  // this count to be matched before generating the blob.
  const expectedHeadshotCount = useMemo(
    () => myPicks.filter((p) => byId.get(p.player_id)?.headshot_url).length,
    [myPicks, byId]
  );

  // Pre-fetch the team logo and all prospect headshots as base64 data URLs.
  // This way the ExportCard's <img> tags reference inlined data URLs that
  // html-to-image captures without any network fetching — eliminates CORS,
  // stale cache, and theme-timing issues in one shot.
  const [teamLogoDataUrl, setTeamLogoDataUrl] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const url = proxyImageUrl(teamLogoEspnUrl(userTeam));
    fetch(url)
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (!blob || cancelled) return;
        const reader = new FileReader();
        reader.onloadend = () => { if (!cancelled) setTeamLogoDataUrl(reader.result); };
        reader.readAsDataURL(blob);
      })
      .catch(() => { /* fall back to empty = badge fallback */ });
    return () => { cancelled = true; };
  }, [userTeam]);

  const [headshotDataUrls, setHeadshotDataUrls] = useState({});
  useEffect(() => {
    let cancelled = false;
    const toFetch = myPicks
      .map((p) => {
        const player = byId.get(p.player_id);
        return player?.headshot_url ? { id: p.player_id, url: player.headshot_url } : null;
      })
      .filter(Boolean);
    Promise.all(
      toFetch.map(({ id, url }) =>
        fetch(proxyImageUrl(url))
          .then((r) => (r.ok ? r.blob() : null))
          .then(
            (blob) =>
              new Promise((resolve) => {
                if (!blob) return resolve([id, null]);
                const reader = new FileReader();
                reader.onloadend = () => resolve([id, reader.result]);
                reader.readAsDataURL(blob);
              })
          )
          .catch(() => [id, null])
      )
    ).then((pairs) => {
      if (cancelled) return;
      const map = {};
      for (const [id, dataUrl] of pairs) if (dataUrl) map[id] = dataUrl;
      setHeadshotDataUrls(map);
    });
    return () => { cancelled = true; };
  }, [myPicks, byId]);

  // Refs mirror state so async handlers can poll for readiness without
  // capturing stale closure values.
  const logoReadyRef = useRef(!!teamLogoDataUrl);
  const headshotCountRef = useRef(Object.keys(headshotDataUrls).length);
  useEffect(() => { logoReadyRef.current = !!teamLogoDataUrl; }, [teamLogoDataUrl]);
  useEffect(() => { headshotCountRef.current = Object.keys(headshotDataUrls).length; }, [headshotDataUrls]);

  async function waitForImages(timeoutMs = 6000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const logoReady = logoReadyRef.current;
      const headshotsReady = headshotCountRef.current >= expectedHeadshotCount;
      if (logoReady && headshotsReady) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false; // Timed out — proceed anyway with whatever loaded
  }

  async function generateBlob() {
    if (!exportRef.current) return null;
    // Wait for all <img> inside the card to finish loading before capture,
    // so the first click doesn't grab a half-loaded screenshot.
    const imgs = exportRef.current.querySelectorAll('img');
    await Promise.all(
      Array.from(imgs).map((img) =>
        img.complete && img.naturalHeight > 0
          ? Promise.resolve()
          : new Promise((resolve) => {
              img.addEventListener('load', resolve, { once: true });
              img.addEventListener('error', resolve, { once: true });
            })
      )
    );
    const toPng = await loadToPng();
    const dataUrl = await toPng(exportRef.current, {
      // cacheBust forces html-to-image to append a unique query param to
      // every image URL, defeating any stale browser cache. Necessary
      // because switching themes was producing wrong-theme captures.
      cacheBust: true,
      pixelRatio: 2,
      backgroundColor: themeBg,
    });
    const res = await fetch(dataUrl);
    return res.blob();
  }

  // Pre-render the blob as soon as the card has data + the DOM is ready so
  // Share has something to hand off instantly. Re-render whenever the theme,
  // the underlying mock, or the inlined image data URLs change (images load
  // asynchronously after mount, so the first render is usually text-only).
  const headshotsLoadedCount = Object.keys(headshotDataUrls).length;
  useEffect(() => {
    let cancelled = false;
    cachedBlobRef.current = null;
    // Give the DOM a tick to mount the ExportCard with the latest data URLs,
    // then render. Slightly longer delay gives React time to commit.
    const t = setTimeout(() => {
      generateBlob()
        .then((blob) => { if (!cancelled) cachedBlobRef.current = blob; })
        .catch((e) => { console.warn('[pre-render]', e); });
    }, 500);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedMock.id, theme, teamLogoDataUrl, headshotsLoadedCount]);

  const fileName = `${userTeam.toLowerCase()}-mock-${new Date(savedMock.submitted_at).toISOString().slice(0, 10)}.png`;

  function handleCopy() {
    // CRITICAL: navigator.clipboard.write MUST be called synchronously from
    // within the user gesture. Pass a Promise<Blob> so the gesture stays
    // alive while html-to-image finishes rendering.
    if (!navigator.clipboard || !window.ClipboardItem) {
      toast.error('Clipboard unsupported — use Share instead');
      return;
    }
    setExporting(true);
    // Always re-generate fresh so we pick up any data URLs that finished
    // loading after the pre-render. Cached blobs were producing stale
    // captures on slow networks where images hadn't loaded yet when the
    // pre-render ran.
    const blobPromise = (async () => {
      await waitForImages();
      cachedBlobRef.current = null;
      const blob = await generateBlob();
      if (!blob) throw new Error('render failed');
      cachedBlobRef.current = blob;
      return blob;
    })();
    navigator.clipboard
      .write([new ClipboardItem({ 'image/png': blobPromise })])
      .then(() => {
        toast.success('Copied — paste into Discord with Ctrl+V');
      })
      .catch((e) => {
        console.error('[copy]', e);
        if (e.name === 'NotAllowedError' || e.message?.includes('focused')) {
          toast.error('Click the page first, then tap Copy');
        } else {
          toast.error('Copy failed — try Share instead');
        }
      })
      .finally(() => setExporting(false));
  }

  function triggerDownload(blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = fileName;
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Smart share: on mobile (touch, no hover) use the native share sheet; on
  // desktop use clipboard copy (Windows' share-to-Discord flow is broken —
  // Discord pops its own server/channel picker instead of pasting into the
  // current chat, so Ctrl+V is the only reliable path).
  function handleShare() {
    if (isMobile) {
      handleMobileShare();
    } else {
      handleCopy();
    }
  }

  async function handleMobileShare() {
    setExporting(true);
    try {
      // Wait for all data URLs to finish loading before capturing. On slow
      // mobile networks the pre-render can run before images arrive, and
      // the cached blob ends up missing all the photos.
      await waitForImages();
      cachedBlobRef.current = null;
      const blob = await generateBlob();
      if (blob) cachedBlobRef.current = blob;
      if (!blob) throw new Error('render failed');

      const file = new File([blob], fileName, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: savedMock.title || `${userTeam} Team Mock`,
            text: `My ${userTeam} mock draft — MockDraft Showdown`,
          });
          return;
        } catch (e) {
          if (e.name === 'AbortError') return;
          console.warn('[share] share failed, downloading instead:', e);
        }
      }
      triggerDownload(blob);
      toast.success('Downloaded — share it with the squad');
    } catch (e) {
      console.error('[share]', e);
      toast.error('Could not generate image');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      {/* Off-screen export card — positioned far offscreen so it renders but
          stays invisible; html-to-image captures it into a PNG on demand. */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: -10000,
          zIndex: -1,
          pointerEvents: 'none',
        }}
        aria-hidden
      >
        <ExportCard
          ref={exportRef}
          savedMock={savedMock}
          myPicks={myPicks}
          byId={byId}
          userTeam={userTeam}
          theme={theme}
          teamLogoDataUrl={teamLogoDataUrl}
          headshotDataUrls={headshotDataUrls}
        />
      </div>

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-4 mb-8 sm:mb-10">
        <div className="flex items-center gap-4 sm:gap-5">
          <TeamLogo abbr={userTeam} size="xl" className="hidden sm:block" />
          <TeamLogo abbr={userTeam} size="lg" className="sm:hidden" />
          <div>
            <div className="font-display text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
              Team Mock · {userTeam}
            </div>
            <h2 className="font-display text-2xl sm:text-4xl font-bold uppercase tracking-[0.08em] text-text-primary leading-tight">
              {savedMock.title || `${userTeam} Team Mock`}
            </h2>
            <p className="text-text-secondary text-xs sm:text-sm mt-1">
              Saved · {new Date(savedMock.submitted_at).toLocaleString(undefined, {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
              })}
              <span className="mx-2 text-text-muted">·</span>
              {myPicks.length} pick{myPicks.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleShare}
            disabled={exporting}
            title={isMobile ? 'Share via your phone\'s share sheet' : 'Copy image — paste into Discord with Ctrl+V'}
            className="font-display font-bold text-[11px] uppercase tracking-[0.12em] px-4 py-2 rounded-lg text-bg-deep transition hover:brightness-110 disabled:opacity-50"
            style={{ background: 'var(--gradient-accent)', boxShadow: '0 0 18px -6px rgba(0,229,255,0.55)' }}
          >
            {exporting ? 'Rendering…' : 'Share'}
          </button>
          <button
            onClick={onRestart}
            className="font-display font-semibold text-[11px] uppercase tracking-[0.12em] px-4 py-2 rounded-lg border border-border-subtle text-text-secondary hover:border-border-focus hover:text-text-primary transition"
          >
            ← Back
          </button>
        </div>
      </div>

      {/* ── Picks by round ── */}
      <div className="space-y-8">
        {rounds.map((r) => (
          <div key={r}>
            <div className="flex items-center gap-3 mb-3">
              <div className="font-display text-[11px] sm:text-[12px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                {ROUND_LABELS[r] || `Round ${r}`} Round
              </div>
              <div className="flex-1 h-px bg-border-subtle" />
              <div className="font-mono text-[10px] text-text-muted">
                {myPicksByRound[r].length} pick{myPicksByRound[r].length === 1 ? '' : 's'}
              </div>
            </div>
            {/* Grid: 1 col mobile, 2 cols tablet, 3 cols desktop */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {myPicksByRound[r].map((pick) => {
                const player = byId.get(pick.player_id) || pick;
                const color = posHex(player.position);
                return (
                  <div
                    key={pick.pick_number}
                    className="relative flex items-center gap-4 p-4 rounded-xl border border-border-subtle bg-bg-surface/40 hover:border-accent/40 transition-colors overflow-hidden"
                    style={{ borderLeft: `4px solid ${color}` }}
                  >
                    {/* Pick number overlay */}
                    <div
                      className="absolute top-2 right-3 font-mono text-[10px] font-semibold"
                      style={{ color }}
                    >
                      #{pick.pick_number}
                    </div>
                    {/* Big player photo */}
                    <PlayerHeadshot
                      url={player.headshot_url}
                      name={player.name}
                      position={player.position}
                      size="lg"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-[15px] sm:text-[16px] font-bold truncate text-text-primary leading-tight">
                        {player.name}
                      </div>
                      {player.school && (
                        <div className="text-[11px] text-text-muted truncate mt-0.5">
                          {player.school}
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 mt-2">
                        <PositionBadge position={player.position} />
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
  );
}

// ─── Shareable Export Card ────────────────────────────────────────────────────
// Self-contained card optimized for PNG capture via html-to-image. Uses inline
// styles (not Tailwind utilities) so the captured image doesn't depend on the
// full stylesheet being inlined. Fixed 900px width gives a clean aspect ratio
// for Twitter/Discord shares. Headshots are routed through the server proxy so
// html-to-image can read them into a canvas (ESPN CDN lacks CORS headers).

// Theme-aware color sets. The ExportCard mirrors whichever theme the user is
// currently using so the shared screenshot feels consistent with what they see.
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
    footerTitle: '#f0f4fc',
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
    footerTitle: '#0f172a',
  },
};

function getCurrentTheme() {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

// Initials-in-circle fallback used whenever a headshot is missing or fails
// to load. Matches the fallback style elsewhere in the app.
function InitialCircle({ name, color, size = 56 }) {
  const initial = (name || '?').trim()[0]?.toUpperCase() || '?';
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: `${color}22`,
        boxShadow: `inset 0 0 0 2px ${color}66`,
        color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.42,
        fontWeight: 900,
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );
}

function teamLogoEspnUrl(abbr) {
  if (!abbr) return null;
  const key = abbr === 'WAS' ? 'wsh' : abbr.toLowerCase();
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${key}.png`;
}

// Primary brand colors for each NFL team. Used for the fallback team badge
// when the ESPN logo fetch fails or returns wrong content — every team gets
// a distinctive on-brand look instead of a generic accent-colored box.
const TEAM_BRAND = {
  BUF: '#00338D', MIA: '#008E97', NE: '#002244', NYJ: '#125740',
  BAL: '#241773', CIN: '#FB4F14', CLE: '#311D00', PIT: '#FFB612',
  HOU: '#03202F', IND: '#002C5F', JAX: '#006778', TEN: '#0C2340',
  DEN: '#FB4F14', KC: '#E31837', LV: '#000000', LAC: '#0080C6',
  DAL: '#003594', NYG: '#0B2265', PHI: '#004C54', WAS: '#5A1414',
  CHI: '#0B162A', DET: '#0076B6', GB: '#203731', MIN: '#4F2683',
  ATL: '#A71930', CAR: '#0085CA', NO: '#D3BC8D', TB: '#D50A0A',
  ARI: '#97233F', LAR: '#003594', SF: '#AA0000', SEA: '#002244',
};

const ExportCard = forwardRef(function ExportCard(
  { savedMock, myPicks, byId, userTeam, theme, teamLogoDataUrl, headshotDataUrls = {} },
  ref
) {
  const title = savedMock.title || `${userTeam} Team Mock`;
  const dateStr = new Date(savedMock.submitted_at).toLocaleDateString(undefined, {
    month: 'long', day: 'numeric', year: 'numeric',
  });

  const picksByRound = {};
  for (const p of myPicks) {
    if (!picksByRound[p.round]) picksByRound[p.round] = [];
    picksByRound[p.round].push(p);
  }
  const rounds = Object.keys(picksByRound).map(Number).sort((a, b) => a - b);

  const C = EXPORT_THEMES[theme] || EXPORT_THEMES.dark;

  return (
    <div
      ref={ref}
      style={{
        width: 900,
        padding: 48,
        background: `linear-gradient(180deg, ${C.bg} 0%, ${C.bgGradientEnd} 100%)`,
        color: C.text,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif',
        boxSizing: 'border-box',
      }}
    >
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 32 }}>
        {/* Real ESPN team logo, inlined as a base64 data URL so html-to-image
            captures the actual bytes already in the DOM — no network fetch
            during capture, no CORS headaches, no theme-timing weirdness.
            Falls back to a team-branded color badge if the pre-fetch hasn't
            completed yet or the upstream fetch failed entirely. */}
        {teamLogoDataUrl ? (
          <img
            src={teamLogoDataUrl}
            alt=""
            style={{
              width: 96,
              height: 96,
              objectFit: 'contain',
              flexShrink: 0,
            }}
          />
        ) : (
          <div
            style={{
              width: 96,
              height: 96,
              borderRadius: 18,
              background: TEAM_BRAND[userTeam] || C.accent,
              boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.18)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <div
              style={{
                fontSize: userTeam.length >= 4 ? 22 : 30,
                fontWeight: 900,
                letterSpacing: 1.5,
                color: '#ffffff',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif',
              }}
            >
              {userTeam}
            </div>
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 3,
              color: C.accent,
              marginBottom: 4,
            }}
          >
            Team Mock · {userTeam}
          </div>
          <div
            style={{
              fontSize: 40,
              fontWeight: 900,
              textTransform: 'uppercase',
              letterSpacing: 1.5,
              lineHeight: 1.05,
              color: C.text,
            }}
          >
            {title}
          </div>
          <div style={{ fontSize: 15, color: C.muted, marginTop: 6 }}>
            {myPicks.length} picks · {dateStr}
          </div>
        </div>
      </div>

      {/* Accent divider */}
      <div
        style={{
          height: 2,
          background: `linear-gradient(90deg, ${C.accent} 0%, transparent 100%)`,
          marginBottom: 28,
        }}
      />

      {/* ── Picks by round ── */}
      {rounds.map((r) => (
        <div key={r} style={{ marginBottom: 28 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 3,
              color: C.muted,
              marginBottom: 10,
            }}
          >
            {(ROUND_LABELS[r] || `Round ${r}`) + ' Round'}
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
            }}
          >
            {picksByRound[r].map((pick) => {
              const player = byId.get(pick.player_id) || pick;
              const color = posHex(player.position);
              // Prefer inlined data URL (pre-fetched in SavedView's useEffect)
              // so html-to-image captures a purely-local image. Falls back to
              // the initials circle if the pre-fetch hasn't completed or the
              // player has no headshot_url.
              const headshotDataUrl = headshotDataUrls[pick.player_id];
              return (
                <div
                  key={pick.pick_number}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    padding: 14,
                    borderRadius: 12,
                    background: C.surface,
                    borderLeft: `4px solid ${color}`,
                    border: `1px solid ${C.subtle}`,
                  }}
                >
                  {headshotDataUrl ? (
                    <img
                      src={headshotDataUrl}
                      alt=""
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: '50%',
                        objectFit: 'cover',
                        background: `${color}22`,
                        boxShadow: `inset 0 0 0 2px ${color}66`,
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <InitialCircle name={player.name} color={color} size={56} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 17,
                        fontWeight: 800,
                        color: C.text,
                        lineHeight: 1.2,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {player.name}
                    </div>
                    {player.school && (
                      <div
                        style={{
                          fontSize: 12,
                          color: C.muted,
                          marginTop: 2,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {player.school}
                      </div>
                    )}
                    <div
                      style={{
                        display: 'inline-block',
                        marginTop: 6,
                        padding: '3px 10px',
                        borderRadius: 999,
                        fontSize: 10,
                        fontWeight: 800,
                        letterSpacing: 1.2,
                        textTransform: 'uppercase',
                        background: `${color}22`,
                        color,
                        border: `1px solid ${color}55`,
                      }}
                    >
                      {player.position}
                    </div>
                  </div>
                  <div
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 13,
                      fontWeight: 700,
                      color,
                      flexShrink: 0,
                    }}
                  >
                    #{pick.pick_number}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* ── Branding footer ── */}
      <div
        style={{
          marginTop: 36,
          paddingTop: 20,
          borderTop: `1px solid ${C.subtle}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div
          style={{
            fontSize: 16,
            fontWeight: 900,
            letterSpacing: 2,
            textTransform: 'uppercase',
          }}
        >
          <span style={{ color: C.text }}>MOCKDRAFT</span>{' '}
          <span style={{ color: C.accent }}>SHOWDOWN</span>
        </div>
        <div style={{ fontSize: 12, color: C.muted }}>
          mockdraftshowdown.netlify.app
        </div>
      </div>
    </div>
  );
});

// ─── Post-draft Results View ──────────────────────────────────────────────────
// Shown right after the draft finishes. Shows only the user's picks (not the
// full 262-pick board), any trades made during the mock, and save/share CTAs.
// Share produces the same PNG image as SavedView via ExportCard.
function ResultsView({
  team,
  picks,
  byId,
  userPicksMade,
  userSlotCount,
  saving,
  trades = [],
  onSave,
  onRestart,
  onChangeTeam,
}) {
  const [title, setTitle] = useState(
    `${team} · ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
  );

  const myPicksOnly = useMemo(() => picks.filter((p) => p.is_user), [picks]);

  const myPicksByRound = useMemo(() => {
    const map = {};
    for (const p of myPicksOnly) {
      if (!map[p.round]) map[p.round] = [];
      map[p.round].push(p);
    }
    return map;
  }, [myPicksOnly]);
  const rounds = Object.keys(myPicksByRound).map(Number).sort((a, b) => a - b);

  // ── PNG Export infrastructure (mirrors SavedView) ──────────────────────────
  const exportRef = useRef(null);
  const [exporting, setExporting] = useState(false);
  const cachedBlobRef = useRef(null);

  const isMobile = useMemo(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    if (!navigator.share) return false;
    return window.matchMedia?.('(hover: none) and (pointer: coarse)').matches === true;
  }, []);

  const [theme, setTheme] = useState(getCurrentTheme);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(getCurrentTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  const themeBg = theme === 'light' ? '#f0f2f7' : '#04080f';

  // Construct a mock-like object for ExportCard
  const mockForExport = useMemo(() => ({
    title: title || `${team} Team Mock`,
    submitted_at: new Date().toISOString(),
    team_abbr: team,
  }), [title, team]);

  // Pre-fetch team logo + headshots as data URLs for ExportCard
  const expectedHeadshotCount = useMemo(
    () => myPicksOnly.filter((p) => byId.get(p.player_id)?.headshot_url).length,
    [myPicksOnly, byId]
  );

  const [teamLogoDataUrl, setTeamLogoDataUrl] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const url = proxyImageUrl(teamLogoEspnUrl(team));
    fetch(url)
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (!blob || cancelled) return;
        const reader = new FileReader();
        reader.onloadend = () => { if (!cancelled) setTeamLogoDataUrl(reader.result); };
        reader.readAsDataURL(blob);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [team]);

  const [headshotDataUrls, setHeadshotDataUrls] = useState({});
  useEffect(() => {
    let cancelled = false;
    const toFetch = myPicksOnly
      .map((p) => {
        const player = byId.get(p.player_id);
        return player?.headshot_url ? { id: p.player_id, url: player.headshot_url } : null;
      })
      .filter(Boolean);
    Promise.all(
      toFetch.map(({ id, url }) =>
        fetch(proxyImageUrl(url))
          .then((r) => (r.ok ? r.blob() : null))
          .then(
            (blob) =>
              new Promise((resolve) => {
                if (!blob) return resolve([id, null]);
                const reader = new FileReader();
                reader.onloadend = () => resolve([id, reader.result]);
                reader.readAsDataURL(blob);
              })
          )
          .catch(() => [id, null])
      )
    ).then((pairs) => {
      if (cancelled) return;
      const map = {};
      for (const [id, dataUrl] of pairs) if (dataUrl) map[id] = dataUrl;
      setHeadshotDataUrls(map);
    });
    return () => { cancelled = true; };
  }, [myPicksOnly, byId]);

  const logoReadyRef = useRef(!!teamLogoDataUrl);
  const headshotCountRef = useRef(Object.keys(headshotDataUrls).length);
  useEffect(() => { logoReadyRef.current = !!teamLogoDataUrl; }, [teamLogoDataUrl]);
  useEffect(() => { headshotCountRef.current = Object.keys(headshotDataUrls).length; }, [headshotDataUrls]);

  async function waitForImages(timeoutMs = 6000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (logoReadyRef.current && headshotCountRef.current >= expectedHeadshotCount) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  async function generateBlob() {
    if (!exportRef.current) return null;
    const imgs = exportRef.current.querySelectorAll('img');
    await Promise.all(
      Array.from(imgs).map((img) =>
        img.complete && img.naturalHeight > 0
          ? Promise.resolve()
          : new Promise((resolve) => {
              img.addEventListener('load', resolve, { once: true });
              img.addEventListener('error', resolve, { once: true });
            })
      )
    );
    const toPng = await loadToPng();
    const dataUrl = await toPng(exportRef.current, {
      cacheBust: true,
      pixelRatio: 2,
      backgroundColor: themeBg,
    });
    const res = await fetch(dataUrl);
    return res.blob();
  }

  // Pre-render the blob once images have loaded so Share has something
  // ready immediately instead of generating on-click (which can miss images
  // that haven't inlined yet on slow mobile networks).
  const headshotsLoadedCount = Object.keys(headshotDataUrls).length;
  useEffect(() => {
    let cancelled = false;
    cachedBlobRef.current = null;
    const t = setTimeout(() => {
      generateBlob()
        .then((blob) => { if (!cancelled) cachedBlobRef.current = blob; })
        .catch(() => {});
    }, 500);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, teamLogoDataUrl, headshotsLoadedCount]);

  const fileName = `${team.toLowerCase()}-mock-${new Date().toISOString().slice(0, 10)}.png`;

  function handleCopy() {
    if (!navigator.clipboard || !window.ClipboardItem) {
      toast.error('Clipboard unsupported — use Share instead');
      return;
    }
    setExporting(true);
    const blobPromise = (async () => {
      await waitForImages();
      cachedBlobRef.current = null;
      const blob = await generateBlob();
      if (!blob) throw new Error('render failed');
      cachedBlobRef.current = blob;
      return blob;
    })();
    navigator.clipboard
      .write([new ClipboardItem({ 'image/png': blobPromise })])
      .then(() => { toast.success('Copied — paste into Discord with Ctrl+V'); })
      .catch((e) => {
        console.error('[copy]', e);
        if (e.name === 'NotAllowedError' || e.message?.includes('focused')) {
          toast.error('Click the page first, then tap Copy');
        } else {
          toast.error('Copy failed — try Share instead');
        }
      })
      .finally(() => setExporting(false));
  }

  function triggerDownload(blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = fileName;
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function handleShare() {
    if (isMobile) handleMobileShare();
    else handleCopy();
  }

  async function handleMobileShare() {
    setExporting(true);
    try {
      await waitForImages();
      cachedBlobRef.current = null;
      const blob = await generateBlob();
      if (!blob) throw new Error('render failed');
      cachedBlobRef.current = blob;
      const file = new File([blob], fileName, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: title || `${team} Team Mock`,
            text: `My ${team} mock draft — MockDraft Showdown`,
          });
          return;
        } catch (e) {
          if (e.name === 'AbortError') return;
        }
      }
      triggerDownload(blob);
      toast.success('Downloaded — share it with the squad');
    } catch (e) {
      console.error('[share]', e);
      toast.error('Could not generate image');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col">
      {/* Off-screen export card for PNG generation */}
      <div
        style={{ position: 'fixed', top: 0, left: -10000, zIndex: -1, pointerEvents: 'none' }}
        aria-hidden
      >
        <ExportCard
          ref={exportRef}
          savedMock={mockForExport}
          myPicks={myPicksOnly}
          byId={byId}
          userTeam={team}
          theme={theme}
          teamLogoDataUrl={teamLogoDataUrl}
          headshotDataUrls={headshotDataUrls}
        />
      </div>

      <div className="max-w-3xl mx-auto w-full px-4 py-6">
        {/* ── Header ── */}
        <div className="flex items-center gap-3 mb-1">
          <TeamLogo abbr={team} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">
              Mock Complete
            </div>
            <h2 className="font-display text-xl sm:text-2xl font-bold uppercase tracking-[0.1em] text-text-primary">
              {team} Team Mock
            </h2>
            <p className="text-text-secondary text-[11px]">
              {userPicksMade} picks made · {picks.length} total in draft
            </p>
          </div>
        </div>

        {/* ── Save / Share card ── */}
        <div className="mt-4 p-3 rounded-xl border border-accent/40 bg-accent/[0.05]">
          <label className="font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted block mb-1">
            Mock Title
          </label>
          <div className="flex gap-2 items-center">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 80))}
              placeholder="Name this mock…"
              className="flex-1 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-2 text-[13px] text-text-primary placeholder-text-muted focus:border-accent/60 outline-none transition"
            />
            <button
              onClick={() => onSave(title.trim() || `${team} · ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`)}
              disabled={saving}
              className="shrink-0 font-display font-bold text-[11px] uppercase tracking-[0.14em] text-bg-deep rounded-lg px-4 py-2 transition hover:brightness-110 disabled:opacity-50"
              style={{ background: 'var(--gradient-accent)', boxShadow: '0 0 18px -6px rgba(0,229,255,0.55)' }}
            >
              {saving ? 'Saving…' : 'Save Mock'}
            </button>
          </div>
          <div className="flex gap-3 mt-3">
            <button
              onClick={onRestart}
              className="font-display text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted hover:text-text-primary transition"
            >
              ← Redraft
            </button>
            <button
              onClick={onChangeTeam}
              className="font-display text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted hover:text-text-primary transition"
            >
              Change Team
            </button>
            <button
              onClick={handleShare}
              disabled={exporting}
              className="font-display font-bold text-[10px] uppercase tracking-[0.12em] text-bg-deep rounded-lg px-3 py-1.5 transition hover:brightness-110 disabled:opacity-50 ml-auto"
              style={{ background: 'var(--gradient-accent)' }}
            >
              {exporting ? 'Rendering…' : 'Share'}
            </button>
          </div>
        </div>

        {/* ── User Picks by round ── */}
        <div className="mt-6 space-y-6">
          <div className="flex items-center gap-2">
            <TeamLogo abbr={team} size="xs" />
            <span className="font-display text-[11px] font-bold uppercase tracking-[0.14em] text-text-primary">
              Your {team} Picks
            </span>
            <span className="font-mono text-[10px] text-text-muted ml-auto">
              {userPicksMade} / {userSlotCount}
            </span>
          </div>
          {rounds.map((r) => (
            <div key={r}>
              <div className="flex items-center gap-3 mb-2">
                <div className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                  {ROUND_LABELS[r] || `Round ${r}`} Round
                </div>
                <div className="flex-1 h-px bg-border-subtle" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {myPicksByRound[r].map((pick) => {
                  const player = byId.get(pick.player_id);
                  if (!player) return null;
                  const color = posHex(player.position);
                  return (
                    <div
                      key={pick.pick_number}
                      className="flex items-center gap-2.5 p-2.5 rounded-lg border border-accent/30 bg-accent/[0.06]"
                      style={{ borderLeft: `3px solid ${color}` }}
                    >
                      <div className="shrink-0 w-12 text-right">
                        <div className="font-mono text-[10px] font-semibold text-text-muted">R{pick.round}</div>
                        <div className="font-mono text-[12px] font-bold text-text-primary">#{pick.pick_number}</div>
                      </div>
                      <PlayerHeadshot url={player.headshot_url} name={player.name} position={player.position} size="sm" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold truncate text-text-primary">
                          {player.name}
                        </div>
                        <div className="text-[10px] text-text-muted truncate">{player.school}</div>
                      </div>
                      <PositionBadge position={player.position} />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* ── Trades made during the mock ── */}
        {trades.length > 0 && (
          <div className="mt-8">
            <div className="font-display text-[11px] font-bold uppercase tracking-[0.14em] text-text-primary mb-3">
              Trades Made
            </div>
            <div className="space-y-2">
              {trades.map((t, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border-subtle bg-bg-surface/40"
                >
                  <TeamLogo abbr={team} size="xs" />
                  <div className="text-[10px] text-text-muted font-mono">↔</div>
                  <TeamLogo abbr={t.partnerTeam} size="xs" />
                  <div className="flex-1 min-w-0 text-[11px]">
                    <div className="text-text-secondary">
                      <span className="text-text-muted">Gave:</span>{' '}
                      <span className="font-mono font-semibold text-text-primary">
                        {t.gave.map((n) => `#${n}`).join(', ')}
                      </span>
                    </div>
                    <div className="text-text-secondary mt-0.5">
                      <span className="text-text-muted">Got:</span>{' '}
                      <span className="font-mono font-semibold text-accent">
                        {t.got.map((n) => `#${n}`).join(', ')}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Draft Simulator (sequential on-the-clock) ───────────────────────────────
// Flow: user clicks Start. Bot picks forward pick-by-pick, pausing whenever the
// slot on the clock belongs to the user's team. User selects from the remaining
// pool, then the bot resumes until the next user slot. Repeats until all picks
// are in. No value leaks because the simulation doesn't run past the user's
// current slot — they see the true live pool at each of their picks.
const PHASE_READY = 'ready';
const PHASE_RUNNING = 'running';
const PHASE_PAUSED = 'paused';
const PHASE_ON_CLOCK = 'on_clock';
const PHASE_DONE = 'done';

// Speed slider tick → ms per bot pick. Index 0 = instant, higher = slower.
const SPEED_STEPS = [0, 150, 400, 800, 1500, 2500];
const SPEED_LABELS = ['Instant', 'Fast', 'Normal', 'Slow', 'Slower', 'Max 2.5s'];

function DraftSimulator({ team, players, draftOrder, onSaved, onChangeTeam }) {
  const { user } = useAuth();

  // Live draft order — initialized from props but mutable so trades can swap
  // team ownership mid-draft without losing simulation state.
  const [liveOrder, setLiveOrder] = useState(() =>
    [...draftOrder].sort((a, b) => a.pick_number - b.pick_number)
  );
  useEffect(() => {
    // Reset whenever the source draftOrder changes (e.g. team change round-trip)
    setLiveOrder([...draftOrder].sort((a, b) => a.pick_number - b.pick_number));
  }, [draftOrder]);

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const userSlotCount = useMemo(
    () => liveOrder.filter((s) => s.team === team).length,
    [liveOrder, team]
  );

  const [picks, setPicks] = useState([]); // sequential: [{pick_number, team, player_id, round, is_user}]
  const [phase, setPhase] = useState(PHASE_READY);
  const [randomness, setRandomness] = useState(0.25);
  const [speedIdx, setSpeedIdx] = useState(1); // default "Fast"
  const [showUsed, setShowUsed] = useState(false);
  const [tradeOpen, setTradeOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim().toLowerCase()), 150);
    return () => clearTimeout(t);
  }, [search]);
  const [posFilter, setPosFilter] = useState('ALL');
  const [saving, setSaving] = useState(false);
  const [trades, setTrades] = useState([]); // record trades for the results view

  // Lock page scroll while the in-draft layout is active. On iOS/Chrome
  // mobile, overflow:hidden on body alone isn't enough — momentum scroll
  // bleeds through inner containers and snaps the page. Setting both html
  // and body to fixed+overflow:hidden is the only reliable cross-browser
  // scroll lock. We save/restore scrollY so the page doesn't jump when
  // returning to the team mock list.
  useEffect(() => {
    if (phase === PHASE_DONE) {
      // Release lock — ResultsView uses a fixed overlay with its own scroll
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      return;
    }
    const scrollY = window.scrollY;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      document.body.style.overflow = '';
      window.scrollTo(0, scrollY);
    };
  }, [phase]);

  // Mobile: tab-based layout replaces the old resizable panels
  const [mobileTab, setMobileTab] = useState('board'); // 'board' | 'picks' | 'prospects'
  const [settingsOpen, setSettingsOpen] = useState(false);

  const currentIdx = picks.length; // next slot to fill
  const currentSlot = currentIdx < liveOrder.length ? liveOrder[currentIdx] : null;
  const usedIds = useMemo(() => new Set(picks.map((p) => p.player_id)), [picks]);

  const userPicksMade = picks.filter((p) => p.is_user).length;

  // Main engine: drive bot picks forward while phase is running. When the slot
  // on the clock belongs to the user's team, flip phase to ON_CLOCK and halt.
  useEffect(() => {
    if (phase !== PHASE_RUNNING) return;
    if (!currentSlot) { setPhase(PHASE_DONE); return; }
    if (currentSlot.team === team) { setPhase(PHASE_ON_CLOCK); return; }

    const delay = SPEED_STEPS[speedIdx] ?? 150;
    const timer = setTimeout(() => {
      // Compute the live pool right now, pick, then advance.
      const taken = new Set(picks.map((p) => p.player_id));
      const available = players.filter((p) => !taken.has(p.id));
      const picked = pickForTeam({
        available,
        teamNeeds: currentSlot.team_needs || [],
        randomness,
      });
      if (!picked) { setPhase(PHASE_DONE); return; }
      setPicks((prev) => [
        ...prev,
        {
          pick_number: currentSlot.pick_number,
          team: currentSlot.team,
          player_id: picked.id,
          round: currentSlot.round,
          is_user: false,
        },
      ]);
    }, delay);
    return () => clearTimeout(timer);
  }, [phase, currentSlot, picks, players, team, randomness, speedIdx]);

  // Auto-switch mobile to Prospects tab when it's the user's turn to pick
  useEffect(() => {
    if (phase === PHASE_ON_CLOCK) setMobileTab('prospects');
  }, [phase]);

  // ── Actions ────────────────────────────────────────────────────────────────
  function start() { setPhase(PHASE_RUNNING); }
  function pause() { if (phase === PHASE_RUNNING) setPhase(PHASE_PAUSED); }
  function resume() { if (phase === PHASE_PAUSED) setPhase(PHASE_RUNNING); }

  function handleUserPick(player) {
    if (phase !== PHASE_ON_CLOCK || !currentSlot) return;
    if (usedIds.has(player.id)) { toast.error('Player already drafted'); return; }
    setPicks((prev) => [
      ...prev,
      {
        pick_number: currentSlot.pick_number,
        team: currentSlot.team,
        player_id: player.id,
        round: currentSlot.round,
        is_user: true,
      },
    ]);
    setPhase(PHASE_RUNNING);
  }

  function restart() {
    setPicks([]);
    setTrades([]);
    setPhase(PHASE_READY);
    setLiveOrder([...draftOrder].sort((a, b) => a.pick_number - b.pick_number));
  }

  // Apply a trade: swap team ownership on the affected pick_numbers.
  // Only upcoming (not-yet-made) picks can change hands — past picks are locked.
  function applyTradeLocal({ partnerTeam, yourPicks, theirPicks }) {
    const yourSet = new Set(yourPicks);
    const theirSet = new Set(theirPicks);
    setLiveOrder((prev) =>
      prev.map((row) => {
        // Don't touch picks already made
        if (row.pick_number <= picks.length) return row;
        if (yourSet.has(row.pick_number)) return { ...row, team: partnerTeam };
        if (theirSet.has(row.pick_number)) return { ...row, team };
        return row;
      })
    );
    // Record trade for the results view
    setTrades((prev) => [
      ...prev,
      { partnerTeam, gave: [...yourPicks].sort((a, b) => a - b), got: [...theirPicks].sort((a, b) => a - b) },
    ]);
  }

  async function handleSave(customTitle) {
    if (!user) { toast.error('Sign in to save'); return; }
    if (phase !== PHASE_DONE) return;
    const defaultTitle = `${team} · ${new Date().toLocaleDateString(undefined, {
      month: 'short', day: 'numeric',
    })}`;
    const title = (typeof customTitle === 'string' && customTitle.trim()) || defaultTitle;
    setSaving(true);
    try {
      const payload = picks.map((p) => ({
        pick_number: p.pick_number,
        player_id: p.player_id,
        round: p.round,
        team: p.team,
      }));
      await api.submitTeamMock(user.id, team, payload, title);
      toast.success('Team mock saved!');
      onSaved();
    } catch (e) {
      toast.error(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  // ── Derived data ───────────────────────────────────────────────────────────
  // Prospect list: by default hide already-drafted players; toggle to show.
  const pickOrder = useMemo(() => {
    // Map player_id → the pick row that took them, so we can show "who took who"
    const m = new Map();
    for (const p of picks) m.set(p.player_id, p);
    return m;
  }, [picks]);

  const filteredProspects = useMemo(() => {
    let list = players;
    if (!showUsed) list = list.filter((p) => !usedIds.has(p.id));
    if (posFilter !== 'ALL') list = list.filter((p) => p.position === posFilter);
    if (debouncedSearch) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(debouncedSearch) ||
          p.school?.toLowerCase().includes(debouncedSearch)
      );
    }
    return list;
  }, [players, showUsed, usedIds, posFilter, debouncedSearch]);

  // Draft history — most recent first so users see the latest pick at top
  const recentPicks = useMemo(() => [...picks].reverse(), [picks]);
  // Only the user's picks, in draft order (not reversed — small list, easier to
  // read chronologically so users can see their roster build out top to bottom)
  const myPicks = useMemo(() => picks.filter((p) => p.is_user), [picks]);

  const FILTERS = ['ALL', ...POSITIONS];

  // ── Status banner (on the clock) ───────────────────────────────────────────
  function StatusBanner({ compact = false }) {
    if (phase === PHASE_READY) {
      return (
        <div className={`${compact ? 'px-3 py-2' : 'px-4 py-3'} flex items-center gap-3`}>
          <TeamLogo abbr={team} size={compact ? 'sm' : 'md'} />
          <div className="flex-1 min-w-0">
            <div className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
              Drafting for
            </div>
            <div className={`font-display font-bold ${compact ? 'text-[13px]' : 'text-[16px]'} text-text-primary truncate`}>
              {team} · {userSlotCount} picks
            </div>
          </div>
          <button
            onClick={start}
            className="shrink-0 font-display font-bold uppercase tracking-[0.14em] text-[11px] text-bg-deep rounded-lg px-4 py-2 transition hover:brightness-110 active:scale-[0.98]"
            style={{ background: 'var(--gradient-accent)', boxShadow: '0 0 18px -6px rgba(0,229,255,0.55)' }}
          >
            Start Mock Draft
          </button>
        </div>
      );
    }
    if (phase === PHASE_DONE) {
      return (
        <div className={`${compact ? 'px-3 py-2' : 'px-4 py-3'} flex items-center gap-3`}>
          <TeamLogo abbr={team} size={compact ? 'sm' : 'md'} />
          <div className="flex-1 min-w-0">
            <div className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
              Mock complete
            </div>
            <div className="text-[11px] text-text-muted">
              {userPicksMade} picks for {team} · {picks.length} total
            </div>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="shrink-0 font-display font-bold uppercase tracking-[0.14em] text-[11px] text-bg-deep rounded-lg px-4 py-2 transition hover:brightness-110 disabled:opacity-50"
            style={{ background: 'var(--gradient-accent)' }}
          >
            {saving ? 'Saving…' : 'Save Mock'}
          </button>
        </div>
      );
    }
    // RUNNING or ON_CLOCK
    const isYou = phase === PHASE_ON_CLOCK;
    const slot = currentSlot;
    return (
      <div
        className={`${compact ? 'px-3 py-2' : 'px-4 py-3'} flex items-center gap-3 border-l-[3px] transition-colors`}
        style={{
          borderLeftColor: isYou ? 'var(--accent)' : 'transparent',
          background: isYou ? 'rgba(0,229,255,0.06)' : undefined,
        }}
      >
        <TeamLogo abbr={slot?.team} size={compact ? 'sm' : 'md'} />
        <div className="flex-1 min-w-0">
          <div className={`font-display text-[10px] font-semibold uppercase tracking-[0.14em] ${isYou ? 'text-accent' : 'text-text-muted'}`}>
            {isYou ? 'You are on the clock' : 'On the clock'}
          </div>
          <div className={`font-display font-bold ${compact ? 'text-[12.5px]' : 'text-[15px]'} text-text-primary truncate`}>
            {slot?.team} · Pick #{slot?.pick_number}
            <span className="ml-2 text-text-muted font-mono text-[11px]">
              {ROUND_LABELS[slot?.round] || `R${slot?.round}`}
            </span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] font-mono text-text-muted">
            {picks.length}/{liveOrder.length}
          </div>
          <div className="text-[10px] font-mono text-accent">
            You: {userPicksMade}/{userSlotCount}
          </div>
        </div>
      </div>
    );
  }

  // ── Prospect list item ─────────────────────────────────────────────────────
  function renderProspect(p) {
    const taken = usedIds.has(p.id);
    const takenBy = taken ? pickOrder.get(p.id) : null;
    const locked = taken || phase !== PHASE_ON_CLOCK;
    return (
      <li
        key={p.id}
        onClick={() => !locked && handleUserPick(p)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all duration-150 ${
          taken
            ? 'border-transparent bg-bg-surface/20 opacity-50 cursor-not-allowed'
            : phase === PHASE_ON_CLOCK
            ? 'border-border-subtle bg-bg-surface/40 hover:border-accent hover:bg-accent/[0.05] cursor-pointer'
            : 'border-border-subtle bg-bg-surface/30 cursor-default'
        }`}
      >
        <span className="font-mono text-[10px] text-text-muted w-5 shrink-0 text-right">
          {p.rank ?? ''}
        </span>
        <PlayerHeadshot url={p.headshot_url} name={p.name} position={p.position} size="xs" />
        <div className="flex-1 min-w-0">
          <div className={`text-[13px] font-semibold truncate ${taken ? 'line-through text-text-muted' : 'text-text-primary'}`}>
            {p.name}
          </div>
          <div className="text-[10.5px] text-text-muted truncate">
            {taken && takenBy
              ? `${takenBy.team} · #${takenBy.pick_number}`
              : p.school}
          </div>
        </div>
        <PositionBadge position={p.position} muted={taken} />
      </li>
    );
  }

  // ── Draft history row ──────────────────────────────────────────────────────
  function renderHistoryPick(pick) {
    const player = byId.get(pick.player_id);
    if (!player) return null;
    const color = posHex(player.position);
    return (
      <div
        key={pick.pick_number}
        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border ${
          pick.is_user ? 'border-accent/40 bg-accent/[0.06]' : 'border-border-subtle bg-bg-surface/30'
        }`}
        style={pick.is_user ? { borderLeft: `3px solid ${color}` } : undefined}
      >
        <span className="font-mono text-[9.5px] text-text-muted w-7 text-right shrink-0">
          #{pick.pick_number}
        </span>
        <TeamLogo abbr={pick.team} size="xs" />
        <PlayerHeadshot url={player.headshot_url} name={player.name} position={player.position} size="xs" />
        <div className="flex-1 min-w-0">
          <div className={`text-[12px] font-semibold truncate ${pick.is_user ? 'text-text-primary' : 'text-text-secondary'}`}>
            {player.name}
          </div>
          <div className="text-[10px] text-text-muted truncate">{player.school}</div>
        </div>
        <PositionBadge position={player.position} muted={!pick.is_user} />
      </div>
    );
  }

  // Compact "My Picks" row — denser than the history row since the panel is
  // height-constrained and this list only ever has ~6-10 entries.
  function renderMyPick(pick) {
    const player = byId.get(pick.player_id);
    if (!player) return null;
    const color = posHex(player.position);
    return (
      <div
        key={pick.pick_number}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-accent/[0.05] border border-accent/20"
        style={{ borderLeft: `3px solid ${color}` }}
      >
        <span className="font-mono text-[9px] text-text-muted w-8 text-right shrink-0">
          {ROUND_LABELS[pick.round] || `R${pick.round}`} · {pick.pick_number}
        </span>
        <PlayerHeadshot url={player.headshot_url} name={player.name} position={player.position} size="xs" />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold truncate text-text-primary leading-tight">
            {player.name}
          </div>
          <div className="text-[9px] text-text-muted truncate leading-tight">
            {player.school}
          </div>
        </div>
        <PositionBadge position={player.position} />
      </div>
    );
  }

  // ── Layout ─────────────────────────────────────────────────────────────────
  // Dedicated results screen once the draft is complete — swaps the in-draft
  // two-panel layout for a "Mock complete" summary with save controls.
  // ResultsView needs to scroll freely — break out of the parent's
  // viewport-locked overflow:hidden wrapper with fixed positioning.
  if (phase === PHASE_DONE) {
    return (
      <div className="fixed inset-0 top-[40px] sm:top-[56px] z-20 bg-bg-deep overflow-y-auto overscroll-contain">
      <ResultsView
        team={team}
        picks={picks}
        byId={byId}
        userPicksMade={userPicksMade}
        userSlotCount={userSlotCount}
        saving={saving}
        trades={trades}
        onSave={handleSave}
        onRestart={restart}
        onChangeTeam={onChangeTeam}
      />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Desktop ── */}
      <div className="hidden md:flex flex-1 overflow-hidden gap-0">
        {/* Left: My picks + Draft history */}
        <div className="w-80 shrink-0 flex flex-col border-r border-border-subtle overflow-hidden">
          {/* My Picks — compact, fixed height */}
          <div className="shrink-0 border-b border-border-subtle">
            <div className="px-4 py-2 flex items-center gap-2">
              <TeamLogo abbr={team} size="xs" />
              <span className="font-display text-[11px] font-bold uppercase tracking-[0.14em] text-text-primary flex-1">
                My Picks
              </span>
              <span className="font-mono text-[10px] text-text-muted">
                {myPicks.length}/{userSlotCount}
              </span>
              <button
                onClick={onChangeTeam}
                className="text-[10px] font-display uppercase tracking-wider text-text-muted hover:text-text-primary transition"
              >
                Change
              </button>
            </div>
            <div className="px-2 pb-2 max-h-52 overflow-y-auto space-y-1">
              {myPicks.length === 0 ? (
                <div className="text-center text-text-muted text-[10.5px] py-3">
                  No picks yet
                </div>
              ) : (
                myPicks.map(renderMyPick)
              )}
            </div>
          </div>
          {/* Draft Board — all picks, most recent first */}
          <div className="px-4 py-2 border-b border-border-subtle flex items-center gap-2">
            <div className="font-display text-[11px] font-bold uppercase tracking-[0.14em] text-text-primary flex-1">
              Draft Board
            </div>
            <span className="font-mono text-[10px] text-text-muted">
              {picks.length}/{liveOrder.length}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {recentPicks.length === 0 ? (
              <div className="text-center text-text-muted text-xs py-8">
                Click Start Mock Draft to begin
              </div>
            ) : (
              recentPicks.map(renderHistoryPick)
            )}
          </div>
          {/* Controls */}
          <div className="px-4 py-3 border-t border-border-subtle space-y-3">
            {/* Speed slider */}
            <div>
              <div className="flex justify-between text-[10px] text-text-muted mb-1">
                <span>Speed</span>
                <span>{SPEED_LABELS[speedIdx]}</span>
              </div>
              <input
                type="range" min="0" max={SPEED_STEPS.length - 1} step="1"
                value={speedIdx}
                onChange={(e) => setSpeedIdx(Number(e.target.value))}
                className="w-full h-1 accent-accent cursor-pointer"
              />
            </div>
            {/* Bot chaos slider */}
            <div>
              <div className="flex justify-between text-[10px] text-text-muted mb-1">
                <span>Bot Chaos</span>
                <span>{Math.round(randomness * 100)}%</span>
              </div>
              <input
                type="range" min="0" max="1" step="0.05"
                value={randomness}
                onChange={(e) => setRandomness(Number(e.target.value))}
                className="w-full h-1 accent-accent cursor-pointer"
              />
            </div>
            {/* Pause / Resume / Trade */}
            <div className="grid grid-cols-2 gap-2">
              {phase === PHASE_RUNNING && (
                <button
                  onClick={pause}
                  className="font-display font-semibold text-[10px] uppercase tracking-[0.12em] text-text-primary rounded-lg px-3 py-1.5 border border-border-subtle hover:border-border-focus transition"
                >
                  Pause
                </button>
              )}
              {phase === PHASE_PAUSED && (
                <button
                  onClick={resume}
                  className="font-display font-semibold text-[10px] uppercase tracking-[0.12em] text-bg-deep rounded-lg px-3 py-1.5 transition hover:brightness-110"
                  style={{ background: 'var(--gradient-accent)' }}
                >
                  Resume
                </button>
              )}
              {(phase === PHASE_RUNNING || phase === PHASE_PAUSED || phase === PHASE_ON_CLOCK) && (
                <button
                  onClick={() => { if (phase === PHASE_RUNNING) setPhase(PHASE_PAUSED); setTradeOpen(true); }}
                  className="font-display font-semibold text-[10px] uppercase tracking-[0.12em] text-text-primary rounded-lg px-3 py-1.5 border border-accent/40 hover:bg-accent/[0.08] transition"
                >
                  Propose Trade
                </button>
              )}
            </div>
            {phase !== PHASE_READY && (
              <button
                onClick={restart}
                className="w-full font-display font-semibold text-[10px] uppercase tracking-[0.12em] text-text-muted hover:text-text-primary rounded-lg px-3 py-1.5 border border-border-subtle hover:border-border-focus transition"
              >
                Restart
              </button>
            )}
          </div>
        </div>

        {/* Right: Status + prospect pool */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="border-b border-border-subtle">
            <StatusBanner />
          </div>
          <div className="px-4 py-2 flex items-center gap-2 border-b border-border-subtle">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={phase === PHASE_ON_CLOCK ? 'Search prospects…' : 'Prospects'}
              disabled={phase === PHASE_READY}
              className="flex-1 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[12px] text-text-primary placeholder-text-muted focus:border-accent/60 outline-none transition disabled:opacity-50"
            />
            <label className="flex items-center gap-1.5 shrink-0 text-[10px] font-display uppercase tracking-[0.1em] text-text-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showUsed}
                onChange={(e) => setShowUsed(e.target.checked)}
                className="w-3.5 h-3.5 accent-accent cursor-pointer"
              />
              Show drafted
            </label>
          </div>
          <div className="flex gap-1 px-4 py-2 overflow-x-auto scrollbar-none border-b border-border-subtle">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setPosFilter(f)}
                className={`shrink-0 px-2 py-0.5 rounded-md font-display text-[10px] font-semibold uppercase tracking-[0.1em] transition ${
                  posFilter === f ? 'bg-accent text-bg-deep' : 'text-text-muted hover:text-text-primary'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <ul className="flex-1 overflow-y-auto p-3 space-y-1">
            {filteredProspects.map(renderProspect)}
            {filteredProspects.length === 0 && (
              <li className="text-center text-text-muted text-sm py-12">
                {showUsed ? 'No prospects match' : 'No available prospects match'}
              </li>
            )}
          </ul>
        </div>
      </div>

      {/* ── Mobile ── */}
      {/* ── Mobile: tab-based layout ── */}
      <div className="flex flex-col md:hidden" style={{ flex: 1, overflow: 'hidden' }}>
        {/* Fixed top: status banner + action bar */}
        <div className="shrink-0 border-b border-border-subtle">
          <StatusBanner compact />
          {/* Pre-draft settings — always visible so user can adjust before starting */}
          {phase === PHASE_READY && (
            <div className="px-3 pb-3 pt-1 space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-display text-[10px] font-semibold uppercase tracking-wider text-text-muted w-12 shrink-0">Speed</span>
                <input type="range" min="0" max={SPEED_STEPS.length - 1} step="1" value={speedIdx}
                  onChange={(e) => setSpeedIdx(Number(e.target.value))}
                  className="flex-1 h-1 accent-accent cursor-pointer" />
                <span className="font-mono text-[10px] text-text-muted w-14 text-right shrink-0">{SPEED_LABELS[speedIdx]}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-display text-[10px] font-semibold uppercase tracking-wider text-text-muted w-12 shrink-0">Chaos</span>
                <input type="range" min="0" max="1" step="0.05" value={randomness}
                  onChange={(e) => setRandomness(Number(e.target.value))}
                  className="flex-1 h-1 accent-accent cursor-pointer" />
                <span className="font-mono text-[10px] text-text-muted w-14 text-right shrink-0">{Math.round(randomness * 100)}%</span>
              </div>
            </div>
          )}
          {/* During-draft action bar: Pause/Resume + Trade + gear icon */}
          {phase !== PHASE_READY && phase !== PHASE_DONE && (
            <div className="px-3 pb-2 flex items-center gap-2">
              {phase === PHASE_RUNNING && (
                <button onClick={pause}
                  className="font-display text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-md border border-border-subtle text-text-primary">
                  Pause
                </button>
              )}
              {phase === PHASE_PAUSED && (
                <button onClick={resume}
                  className="font-display text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-md text-bg-deep"
                  style={{ background: 'var(--gradient-accent)' }}>
                  Resume
                </button>
              )}
              <button
                onClick={() => { if (phase === PHASE_RUNNING) setPhase(PHASE_PAUSED); setTradeOpen(true); }}
                className="font-display text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-md border border-accent/40 text-text-primary">
                Trade
              </button>
              <div className="flex-1" />
              <button
                onClick={() => setSettingsOpen((v) => !v)}
                className="w-8 h-8 flex items-center justify-center rounded-md border border-border-subtle text-text-muted hover:text-text-primary transition"
                title="Settings"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path fillRule="evenodd" d="M8.34 1.804A1 1 0 019.32 1h1.36a1 1 0 01.98.804l.295 1.473c.497.144.971.342 1.416.587l1.25-.834a1 1 0 011.262.125l.962.962a1 1 0 01.125 1.262l-.834 1.25c.245.445.443.919.587 1.416l1.473.294a1 1 0 01.804.98v1.362a1 1 0 01-.804.98l-1.473.295a6.95 6.95 0 01-.587 1.416l.834 1.25a1 1 0 01-.125 1.262l-.962.962a1 1 0 01-1.262.125l-1.25-.834a6.953 6.953 0 01-1.416.587l-.294 1.473a1 1 0 01-.98.804H9.32a1 1 0 01-.98-.804l-.295-1.473a6.957 6.957 0 01-1.416-.587l-1.25.834a1 1 0 01-1.262-.125l-.962-.962a1 1 0 01-.125-1.262l.834-1.25a6.957 6.957 0 01-.587-1.416l-1.473-.294A1 1 0 011 11.18V9.82a1 1 0 01.804-.98l1.473-.295c.144-.497.342-.971.587-1.416l-.834-1.25a1 1 0 01.125-1.262l.962-.962A1 1 0 015.38 3.53l1.25.834a6.957 6.957 0 011.416-.587l.294-1.473zM13 10a3 3 0 11-6 0 3 3 0 016 0z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          )}
          {/* Collapsible settings drawer (during draft only) */}
          {settingsOpen && phase !== PHASE_READY && phase !== PHASE_DONE && (
            <div className="px-3 pb-3 pt-2 space-y-2 border-t border-border-subtle bg-bg-surface/30">
              <div className="flex items-center gap-2">
                <span className="font-display text-[10px] font-semibold uppercase tracking-wider text-text-muted w-12 shrink-0">Speed</span>
                <input type="range" min="0" max={SPEED_STEPS.length - 1} step="1" value={speedIdx}
                  onChange={(e) => setSpeedIdx(Number(e.target.value))}
                  className="flex-1 h-1 accent-accent cursor-pointer" />
                <span className="font-mono text-[10px] text-text-muted w-14 text-right shrink-0">{SPEED_LABELS[speedIdx]}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-display text-[10px] font-semibold uppercase tracking-wider text-text-muted w-12 shrink-0">Chaos</span>
                <input type="range" min="0" max="1" step="0.05" value={randomness}
                  onChange={(e) => setRandomness(Number(e.target.value))}
                  className="flex-1 h-1 accent-accent cursor-pointer" />
                <span className="font-mono text-[10px] text-text-muted w-14 text-right shrink-0">{Math.round(randomness * 100)}%</span>
              </div>
              <button onClick={restart}
                className="w-full font-display font-semibold text-[10px] uppercase tracking-[0.12em] text-text-muted hover:text-text-primary rounded-lg px-3 py-1.5 border border-border-subtle hover:border-border-focus transition">
                Restart Draft
              </button>
            </div>
          )}
        </div>

        {/* Tab content — single scroll area per tab */}
        <div className="flex-1 overflow-hidden">
          {mobileTab === 'board' && (
            <div className="h-full overflow-y-auto overscroll-contain p-2 space-y-1">
              {recentPicks.length === 0 ? (
                <div className="text-center text-text-muted text-xs py-8">
                  {phase === PHASE_READY ? 'Tap Start Mock Draft above to begin' : 'Draft in progress…'}
                </div>
              ) : (
                recentPicks.map(renderHistoryPick)
              )}
            </div>
          )}

          {mobileTab === 'picks' && (
            <div className="h-full overflow-y-auto overscroll-contain p-2 space-y-1">
              <div className="flex items-center gap-2 px-1 py-2">
                <TeamLogo abbr={team} size="xs" />
                <span className="font-display text-[11px] font-bold uppercase tracking-wider text-text-primary flex-1">
                  My Picks
                </span>
                <span className="font-mono text-[10px] text-text-muted">
                  {myPicks.length}/{userSlotCount}
                </span>
              </div>
              {myPicks.length === 0 ? (
                <div className="text-center text-text-muted text-xs py-8">No picks yet</div>
              ) : (
                myPicks.map(renderMyPick)
              )}
            </div>
          )}

          {mobileTab === 'prospects' && (
            <div className="h-full flex flex-col overflow-hidden">
              <div className="px-3 py-2 flex gap-2 border-b border-border-subtle shrink-0">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={phase === PHASE_ON_CLOCK ? 'Search prospects…' : 'Prospects'}
                  disabled={phase === PHASE_READY}
                  className="flex-1 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[12px] text-text-primary placeholder-text-muted focus:border-accent/60 outline-none transition disabled:opacity-50"
                />
                <label className="flex items-center gap-1 shrink-0 text-[10px] font-display uppercase tracking-[0.1em] text-text-muted cursor-pointer select-none">
                  <input type="checkbox" checked={showUsed} onChange={(e) => setShowUsed(e.target.checked)}
                    className="w-3.5 h-3.5 accent-accent cursor-pointer" />
                  Drafted
                </label>
              </div>
              <div className="flex gap-1 px-3 py-1.5 overflow-x-auto scrollbar-none border-b border-border-subtle shrink-0">
                {FILTERS.map((f) => (
                  <button key={f} onClick={() => setPosFilter(f)}
                    className={`shrink-0 px-2 py-0.5 rounded-md font-display text-[10px] font-semibold uppercase tracking-[0.1em] transition ${
                      posFilter === f ? 'bg-accent text-bg-deep' : 'text-text-muted hover:text-text-primary'
                    }`}>
                    {f}
                  </button>
                ))}
              </div>
              <ul className="flex-1 overflow-y-auto overscroll-contain p-2 space-y-1">
                {filteredProspects.map(renderProspect)}
              </ul>
            </div>
          )}
        </div>

        {/* Bottom tab bar */}
        <div className="shrink-0 border-t border-border-subtle bg-bg-deep/95 flex" style={{ backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          {[
            { key: 'board', label: 'Board', badge: `${picks.length}` },
            { key: 'picks', label: 'My Picks', badge: `${myPicks.length}` },
            { key: 'prospects', label: 'Prospects', badge: phase === PHASE_ON_CLOCK ? '!' : null },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setMobileTab(t.key)}
              className={`flex-1 py-3 flex flex-col items-center gap-0.5 transition ${
                mobileTab === t.key ? 'text-accent' : 'text-text-muted'
              }`}
            >
              <span className="font-display text-[11px] font-bold uppercase tracking-[0.12em]">
                {t.label}
              </span>
              {t.badge && (
                <span className={`font-mono text-[9px] ${
                  t.key === 'prospects' && phase === PHASE_ON_CLOCK
                    ? 'text-accent animate-pulse'
                    : 'text-text-muted'
                }`}>
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Trade modal ── */}
      {tradeOpen && (
        <TradeModal
          userTeam={team}
          liveOrder={liveOrder}
          picksMadeCount={picks.length}
          onClockTeam={currentSlot?.team}
          onClose={() => setTradeOpen(false)}
          onAccepted={(swap) => {
            applyTradeLocal(swap);
            setTradeOpen(false);
            toast.success('Trade accepted!');
            // Always resume after a trade. The engine effect will detect
            // whether the current slot still belongs to the user (stays on
            // clock) or to someone else (bot picks next). Without this,
            // trading during PHASE_ON_CLOCK leaves the draft stuck.
            setPhase(PHASE_RUNNING);
          }}
        />
      )}
    </div>
  );
}

// ─── Saved Mocks List ─────────────────────────────────────────────────────────
function SavedMocksList({ mocks, onOpen, onDelete, onNew }) {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold uppercase tracking-[0.12em] text-text-primary">
            Team Mocks
          </h1>
          <p className="text-text-secondary text-[11px] mt-1">
            {mocks.length} saved · unlimited
          </p>
        </div>
        <button
          onClick={onNew}
          className="font-display font-bold uppercase tracking-[0.14em] text-[11px] text-bg-deep rounded-lg px-4 py-2 transition hover:brightness-110 active:scale-[0.98]"
          style={{ background: 'var(--gradient-accent)', boxShadow: '0 0 18px -6px rgba(0,229,255,0.55)' }}
        >
          + New Team Mock
        </button>
      </div>

      {mocks.length === 0 ? (
        <div className="text-center py-16 text-text-muted">
          <p className="text-sm mb-2">No team mocks yet.</p>
          <p className="text-[11px]">Start one to build your first sandbox draft.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {mocks.map((m) => (
            <div
              key={m.id}
              className="group relative flex items-center gap-3 p-3 rounded-xl border border-border-subtle bg-bg-surface/40 hover:border-accent/50 hover:bg-white/[0.02] transition-all cursor-pointer"
              onClick={() => onOpen(m)}
            >
              <TeamLogo abbr={m.team_abbr} size="lg" />
              <div className="flex-1 min-w-0">
                <div className="font-display font-bold text-[13px] uppercase tracking-[0.08em] text-text-primary truncate">
                  {m.title || `${m.team_abbr} Mock`}
                </div>
                <div className="text-[10.5px] text-text-muted">
                  {new Date(m.submitted_at).toLocaleString(undefined, {
                    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                  })}
                </div>
                <div className="text-[10px] text-text-muted mt-0.5">
                  {m.pick_count} picks
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(m); }}
                className="opacity-0 group-hover:opacity-100 font-display text-[9px] uppercase tracking-wider text-text-muted hover:text-[color:var(--color-danger,#ef4444)] transition px-2 py-1"
                title="Delete mock"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page Shell ───────────────────────────────────────────────────────────────
export default function TeamMock() {
  const { user } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [players, setPlayers] = useState(null);
  const [draftOrder, setDraftOrder] = useState(null);
  // undefined = loading, [] = none yet
  const [savedMocks, setSavedMocks] = useState(undefined);
  const [activeMock, setActiveMock] = useState(null); // currently-viewed saved mock
  const [team, setTeam] = useState(null); // currently drafting for

  // Load players + full draft order (all 7 rounds) on mount. Always pull the
  // draft order fresh so admin syncs of R2-R7 show up without a hard refresh.
  function loadData() {
    setPlayers(null);
    setDraftOrder(null);
    Promise.all([api.getPlayers(), api.getDraftOrderAll({ fresh: true })])
      .then(([pl, order]) => {
        setPlayers(pl);
        setDraftOrder(order);
      })
      .catch(() => {
        setPlayers([]);
        setDraftOrder([]);
      });
  }
  useEffect(() => { loadData(); }, []);

  // Load the user's saved team mocks list
  function loadSavedMocks() {
    if (!user) { setSavedMocks([]); return; }
    api.listTeamMocks(user.id)
      .then((list) => setSavedMocks(Array.isArray(list) ? list : []))
      .catch(() => setSavedMocks([]));
  }
  useEffect(() => { loadSavedMocks(); }, [user]);

  function handleTeamSelect(abbr) {
    if (!user) { nav('/join'); return; }
    setTeam(abbr);
  }

  function handleSaved() {
    // Refresh list, drop out of draft mode
    setTeam(null);
    loadSavedMocks();
  }

  async function handleOpen(mockSummary) {
    // Fetch full picks for the clicked mock
    try {
      const full = await api.getTeamMockById(mockSummary.id);
      setActiveMock(full);
    } catch (e) {
      console.error('[open team mock]', e);
    }
  }

  async function handleDelete(mockSummary) {
    const ok = window.confirm(`Delete "${mockSummary.title || mockSummary.team_abbr + ' Mock'}"?`);
    if (!ok) return;
    try {
      await api.deleteTeamMock(mockSummary.id);
      loadSavedMocks();
      if (activeMock?.id === mockSummary.id) setActiveMock(null);
    } catch (e) {
      console.error('[delete team mock]', e);
    }
  }

  // When the user clicks the "Team Mock" nav link while already on /team-mock,
  // the Navbar navigates with { state: { reset } }. Reset all drill-in state
  // so the user lands back on the mocks list / team picker.
  useEffect(() => {
    if (location.state?.reset) {
      setTeam(null);
      setActiveMock(null);
      setShowPickerExplicit(false);
    }
  }, [location.state?.reset]);

  const [showPickerExplicit, setShowPickerExplicit] = useState(false);
  function startNew() {
    setActiveMock(null);
    setTeam(null);
    setShowPickerExplicit(true);
  }

  const loading = players === null || draftOrder === null || savedMocks === undefined;

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-3">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 mt-6">
          {Array.from({ length: 32 }, (_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
        </div>
      </div>
    );
  }

  // 1) Actively drafting — needs the viewport-locked two-panel layout.
  // Use dvh (dynamic viewport height) so mobile browser chrome doesn't
  // throw off the math. The draft simulator is the only view that needs
  // to be clamped to the viewport.
  if (team) {
    return (
      <div className="flex flex-col h-[calc(100dvh-40px)] sm:h-[calc(100dvh-56px)]" style={{ overflow: 'hidden' }}>
        <DraftSimulator
          team={team}
          players={players}
          draftOrder={draftOrder}
          onSaved={handleSaved}
          onChangeTeam={() => { setTeam(null); setShowPickerExplicit(true); }}
        />
      </div>
    );
  }

  // 2) Viewing a saved mock — let the body scroll naturally. The previous
  // fixed-height wrapper (calc(100vh - 56px) + overflow-y:auto) created
  // double-scroll on mobile because the navbar wraps past 56px and both
  // the wrapper AND the body tried to scroll.
  if (activeMock) {
    return (
      <SavedView
        savedMock={activeMock}
        players={players}
        onRestart={() => setActiveMock(null)}
      />
    );
  }

  // 3) Explicit "new mock" picker
  if (showPickerExplicit || savedMocks.length === 0) {
    return (
      <div>
        {savedMocks.length > 0 && (
          <div className="max-w-3xl mx-auto px-4 pt-4">
            <button
              onClick={() => setShowPickerExplicit(false)}
              className="font-display text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted hover:text-text-primary transition"
            >
              ← Back to My Mocks
            </button>
          </div>
        )}
        <TeamPicker onSelect={handleTeamSelect} draftOrder={draftOrder} onRefresh={loadData} />
      </div>
    );
  }

  // 4) Default: saved-mocks list
  return (
    <SavedMocksList
      mocks={savedMocks}
      onOpen={handleOpen}
      onDelete={handleDelete}
      onNew={startNew}
    />
  );
}
