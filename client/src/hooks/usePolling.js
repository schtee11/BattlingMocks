import { useEffect, useRef } from 'react';

// Runs `fn` on an interval. Skips ticks when the tab is hidden so we don't
// hammer the API from a backgrounded page. Calls `fn` once on mount as well.
export function usePolling(fn, intervalMs = 15_000) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let cancelled = false;
    let timer;

    function tick() {
      if (cancelled) return;
      if (document.visibilityState === 'visible') {
        try { fnRef.current(); } catch { /* ignore */ }
      }
      timer = setTimeout(tick, intervalMs);
    }

    timer = setTimeout(tick, intervalMs);

    // Fetch immediately when the tab becomes visible after being hidden.
    function onVisible() {
      if (document.visibilityState === 'visible') {
        try { fnRef.current(); } catch { /* ignore */ }
      }
    }
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs]);
}
