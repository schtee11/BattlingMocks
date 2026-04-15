import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { posHex } from '../lib/positions.js';
import { proxyImageUrl, fetchImageAsDataUrl } from '../lib/api.js';
import { teamLogoUrl } from '../lib/teams.js';

// Lazy-loaded on first export — keeps html-to-image out of the main Draft chunk.
const loadToPng = () => import('html-to-image').then((m) => m.toPng);

// Theme-aware color sets. Mirrors the export theme used by TeamMock so screenshots
// across the app feel consistent.
const EXPORT_THEMES = {
  dark: {
    bg: '#04080f',
    bgGradientEnd: '#020408',
    surface: '#0b1120',
    subtle: '#1a2336',
    text: '#f0f4fc',
    muted: '#7a8ba8',
    accent: '#00e5ff',
    gold: '#fbbf24',
  },
  light: {
    bg: '#f0f2f7',
    bgGradientEnd: '#e3e8f1',
    surface: '#ffffff',
    subtle: 'rgba(15,23,42,0.12)',
    text: '#0f172a',
    muted: '#64748b',
    accent: '#0891b2',
    gold: '#ca8a04',
  },
};

function getCurrentTheme() {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

// Initials-in-circle fallback used when a headshot is missing or fails to load.
function InitialCircle({ name, color, size = 36 }) {
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
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif',
      }}
    >
      {initial}
    </div>
  );
}

// ─── Shareable Export Card ────────────────────────────────────────────────────
// Self-contained card optimized for PNG capture via html-to-image. Uses inline
// styles (not Tailwind utilities) so the captured image doesn't depend on the
// full stylesheet being inlined. Laid out as two columns of 16 picks so the
// full 32-pick Round 1 fits comfortably in a shareable aspect ratio.
export const Round1ExportCard = forwardRef(function Round1ExportCard(
  {
    picks,
    playerById,
    teamByPickNumber,
    userLabel,
    theme,
    teamLogoDataUrls = {},
    headshotDataUrls = {},
  },
  ref,
) {
  const C = EXPORT_THEMES[theme] || EXPORT_THEMES.dark;
  const dateStr = new Date().toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  // Split into two columns of 16 for a balanced shareable grid.
  const sorted = (picks || []).slice().sort((a, b) => a.pick_number - b.pick_number);
  const left = sorted.slice(0, 16);
  const right = sorted.slice(16, 32);

  function renderRow(pick) {
    const player = playerById?.get?.(pick.player_id);
    if (!player) return null;
    const color = posHex(player.position);
    const teamAbbr = teamByPickNumber?.get?.(pick.pick_number);
    const logoDataUrl = teamAbbr ? teamLogoDataUrls[teamAbbr] : null;
    const headshotDataUrl = headshotDataUrls[pick.player_id];
    return (
      <div
        key={pick.pick_number}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 12px',
          borderRadius: 10,
          background: C.surface,
          border: `1px solid ${C.subtle}`,
          borderLeft: `4px solid ${color}`,
        }}
      >
        <div
          style={{
            fontFamily: 'monospace',
            fontSize: 13,
            fontWeight: 800,
            color: C.muted,
            width: 22,
            textAlign: 'center',
            flexShrink: 0,
          }}
        >
          {pick.pick_number}
        </div>
        {logoDataUrl ? (
          <img
            src={logoDataUrl}
            alt=""
            style={{ width: 28, height: 28, objectFit: 'contain', flexShrink: 0 }}
          />
        ) : (
          <div
            style={{
              width: 28,
              height: 28,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 9,
              fontWeight: 800,
              color: C.muted,
              flexShrink: 0,
              letterSpacing: 0.5,
            }}
          >
            {teamAbbr || '—'}
          </div>
        )}
        {headshotDataUrl ? (
          <img
            src={headshotDataUrl}
            alt=""
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              objectFit: 'cover',
              background: `${color}22`,
              boxShadow: `inset 0 0 0 2px ${color}66`,
              flexShrink: 0,
            }}
          />
        ) : (
          <InitialCircle name={player.name} color={color} size={36} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 800,
              color: C.text,
              lineHeight: 1.15,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              minWidth: 0,
            }}
          >
            {player.name}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 2,
              minWidth: 0,
            }}
          >
            <span
              style={{
                display: 'inline-block',
                padding: '1px 7px',
                borderRadius: 999,
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: 1.1,
                textTransform: 'uppercase',
                background: `${color}22`,
                color,
                border: `1px solid ${color}55`,
                flexShrink: 0,
              }}
            >
              {player.position}
            </span>
            {player.school && (
              <span
                style={{
                  fontSize: 10,
                  color: C.muted,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  minWidth: 0,
                }}
              >
                {player.school}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      style={{
        width: 1000,
        padding: 44,
        background: `linear-gradient(180deg, ${C.bg} 0%, ${C.bgGradientEnd} 100%)`,
        color: C.text,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif',
        boxSizing: 'border-box',
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
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
          2026 NFL Draft · Round 1
        </div>
        <div
          style={{
            fontSize: 38,
            fontWeight: 900,
            textTransform: 'uppercase',
            letterSpacing: 1.5,
            lineHeight: 1.05,
            color: C.text,
          }}
        >
          Predictive Mock
        </div>
        <div style={{ fontSize: 14, color: C.muted, marginTop: 6 }}>
          {userLabel ? `${userLabel} · ` : ''}
          {sorted.length} pick{sorted.length === 1 ? '' : 's'} · {dateStr}
        </div>
      </div>

      {/* Accent divider */}
      <div
        style={{
          height: 2,
          background: `linear-gradient(90deg, ${C.accent} 0%, transparent 100%)`,
          marginBottom: 24,
        }}
      />

      {/* Two columns of 16 picks each */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          columnGap: 18,
          rowGap: 8,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {left.map(renderRow)}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {right.map(renderRow)}
        </div>
      </div>

      {/* Branding footer */}
      <div
        style={{
          marginTop: 28,
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
        <div style={{ fontSize: 12, color: C.muted }}>mockdraftshowdown.com</div>
      </div>
    </div>
  );
});

// ─── Share Export Hook ──────────────────────────────────────────────────────
// Mirrors the TeamMock useShareExport hook: pre-fetches logos and headshots as
// inlined data URLs (so html-to-image doesn't have to hit the network during
// capture), renders the off-screen Round1ExportCard to PNG, and exposes
// platform-smart share/copy/download handlers.
export function useRound1ShareExport({
  picks,
  playerById,
  teamByPickNumber,
}) {
  const exportRef = useRef(null);
  const [exporting, setExporting] = useState(false);
  const cachedBlobRef = useRef(null);

  // Mobile detection: touch-primary device with Web Share support.
  const isMobile = useMemo(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    if (!navigator.share) return false;
    return window.matchMedia?.('(hover: none) and (pointer: coarse)').matches === true;
  }, []);

  // Mirror the current theme so the captured PNG matches whatever the user sees.
  const [theme, setTheme] = useState(getCurrentTheme);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(getCurrentTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);
  const themeBg = theme === 'light' ? '#f0f2f7' : '#04080f';

  // Deduped list of team abbreviations we need logos for (after any trades,
  // one team may appear on multiple picks — only fetch each logo once).
  const uniqueTeams = useMemo(() => {
    const s = new Set();
    (picks || []).forEach((p) => {
      const t = teamByPickNumber?.get?.(p.pick_number);
      if (t) s.add(t);
    });
    return Array.from(s);
  }, [picks, teamByPickNumber]);

  const [teamLogoDataUrls, setTeamLogoDataUrls] = useState({});
  useEffect(() => {
    let cancelled = false;
    if (uniqueTeams.length === 0) {
      setTeamLogoDataUrls({});
      return;
    }
    Promise.all(
      uniqueTeams.map((t) =>
        fetchImageAsDataUrl(proxyImageUrl(teamLogoUrl(t)), 96)
          .then((u) => [t, u])
          .catch(() => [t, null]),
      ),
    ).then((pairs) => {
      if (cancelled) return;
      const map = {};
      for (const [t, u] of pairs) if (u) map[t] = u;
      setTeamLogoDataUrls(map);
    });
    return () => {
      cancelled = true;
    };
  }, [uniqueTeams]);

  // Pre-fetch each prospect headshot as a downsampled data URL — see the
  // TeamMock useShareExport hook for the full iOS Safari rationale.
  const expectedHeadshotCount = useMemo(
    () =>
      (picks || []).filter((p) => playerById?.get?.(p.player_id)?.headshot_url).length,
    [picks, playerById],
  );
  const [headshotDataUrls, setHeadshotDataUrls] = useState({});
  useEffect(() => {
    let cancelled = false;
    const toFetch = (picks || [])
      .map((p) => {
        const player = playerById?.get?.(p.player_id);
        return player?.headshot_url ? { id: p.player_id, url: player.headshot_url } : null;
      })
      .filter(Boolean);
    if (toFetch.length === 0) {
      setHeadshotDataUrls({});
      return;
    }
    Promise.all(
      toFetch.map(({ id, url }) =>
        fetchImageAsDataUrl(proxyImageUrl(url), 96)
          .then((dataUrl) => [id, dataUrl])
          .catch(() => [id, null]),
      ),
    ).then((pairs) => {
      if (cancelled) return;
      const map = {};
      for (const [id, u] of pairs) if (u) map[id] = u;
      setHeadshotDataUrls(map);
    });
    return () => {
      cancelled = true;
    };
  }, [picks, playerById]);

  // Refs mirror state so async handlers can poll for readiness without
  // capturing stale closure values.
  const logoCount = Object.keys(teamLogoDataUrls).length;
  const headshotCount = Object.keys(headshotDataUrls).length;
  const logoCountRef = useRef(logoCount);
  const headshotCountRef = useRef(headshotCount);
  useEffect(() => {
    logoCountRef.current = logoCount;
  }, [logoCount]);
  useEffect(() => {
    headshotCountRef.current = headshotCount;
  }, [headshotCount]);

  async function waitForImages(timeoutMs = 6000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (
        logoCountRef.current >= uniqueTeams.length &&
        headshotCountRef.current >= expectedHeadshotCount
      ) {
        return true;
      }
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
            }),
      ),
    );
    const toPng = await loadToPng();
    const dataUrl = await toPng(exportRef.current, {
      pixelRatio: 2,
      backgroundColor: themeBg,
    });
    const res = await fetch(dataUrl);
    return res.blob();
  }

  // Pre-render the blob as soon as the card has data + images so Share/Copy
  // has something to hand off instantly. Re-render when inputs change.
  useEffect(() => {
    let cancelled = false;
    cachedBlobRef.current = null;
    const t = setTimeout(() => {
      generateBlob()
        .then((blob) => {
          if (!cancelled) cachedBlobRef.current = blob;
        })
        .catch(() => {});
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, logoCount, headshotCount, picks?.length]);

  const fileName = `round1-mock-${new Date().toISOString().slice(0, 10)}.png`;

  function triggerDownload(blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = fileName;
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function handleCopy() {
    if (!navigator.clipboard || !window.ClipboardItem) {
      handleDownload();
      return;
    }
    // CRITICAL: pass a Promise<Blob> to navigator.clipboard.write so the
    // synchronous user gesture remains valid while rendering completes.
    setExporting(true);
    const blobPromise = (async () => {
      if (cachedBlobRef.current) return cachedBlobRef.current;
      await waitForImages();
      const blob = await generateBlob();
      if (!blob) throw new Error('render failed');
      cachedBlobRef.current = blob;
      return blob;
    })();
    navigator.clipboard
      .write([new ClipboardItem({ 'image/png': blobPromise })])
      .then(() => toast.success('Copied — paste into Discord with Ctrl+V'))
      .catch((e) => {
        if (e.name === 'NotAllowedError' || String(e.message || '').includes('focused')) {
          toast.error('Click the page first, then tap Copy');
        } else {
          toast.error('Copy failed — try Download instead');
        }
      })
      .finally(() => setExporting(false));
  }

  async function handleDownload() {
    setExporting(true);
    try {
      let blob = cachedBlobRef.current;
      if (!blob) {
        await waitForImages();
        blob = await generateBlob();
        if (blob) cachedBlobRef.current = blob;
      }
      if (!blob) throw new Error('render failed');
      triggerDownload(blob);
      toast.success('Downloaded — share your mock!');
    } catch (e) {
      toast.error('Could not generate image');
    } finally {
      setExporting(false);
    }
  }

  async function handleMobileShare() {
    setExporting(true);
    try {
      let blob = cachedBlobRef.current;
      if (!blob) {
        await waitForImages();
        blob = await generateBlob();
        if (blob) cachedBlobRef.current = blob;
      }
      if (!blob) throw new Error('render failed');
      const file = new File([blob], fileName, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: '2026 Round 1 Mock Draft',
          });
          return;
        } catch (e) {
          if (e.name === 'AbortError') return;
        }
      }
      triggerDownload(blob);
      toast.success('Downloaded — share it with the squad');
    } catch (e) {
      toast.error('Could not generate image');
    } finally {
      setExporting(false);
    }
  }

  function handleShare() {
    if (isMobile) handleMobileShare();
    else handleCopy();
  }

  return {
    exportRef,
    exporting,
    theme,
    teamLogoDataUrls,
    headshotDataUrls,
    handleShare,
    handleCopy,
    handleDownload,
    isMobile,
  };
}
