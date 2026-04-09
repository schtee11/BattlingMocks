// In-process draft poller. Runs a timer that calls syncPicksOnce at a fixed
// interval. Lives in module state — max one active poller per Node process.
// Disabled by default; starts fresh after every deploy/restart.
//
// Safety:
//   - Minimum interval is 10 seconds (don't hammer ESPN)
//   - Maximum interval is 300 seconds (anything longer is a cron job)
//   - start() is idempotent; starting while running stops + restarts
//   - Each tick's errors are swallowed into state.last_error so a single
//     failed fetch doesn't kill the poller

import { syncPicksOnce } from './draftSync.js';

const MIN_INTERVAL_SEC = 10;
const MAX_INTERVAL_SEC = 300;

const state = {
  running: false,
  year: null,
  interval_sec: null,
  handle: null,
  started_at: null,
  last_sync_at: null,
  last_saved: 0,
  total_saved: 0,
  ticks: 0,
  last_error: null,
};

async function tick() {
  state.ticks++;
  try {
    const r = await syncPicksOnce({ year: state.year });
    state.last_sync_at = new Date().toISOString();
    state.last_saved = r.saved || 0;
    state.total_saved += r.saved || 0;
    state.last_error = null;
    if (r.saved > 0) {
      console.log(`[poller] tick ${state.ticks}: saved ${r.saved} picks`);
    }
  } catch (e) {
    state.last_error = e.message;
    console.error(`[poller] tick ${state.ticks} error:`, e.message);
  }
}

export function startPoller({ year, intervalSec }) {
  const yr = parseInt(year, 10) || 2026;
  let interval = parseInt(intervalSec, 10) || 20;
  if (interval < MIN_INTERVAL_SEC) interval = MIN_INTERVAL_SEC;
  if (interval > MAX_INTERVAL_SEC) interval = MAX_INTERVAL_SEC;

  if (state.running) stopPoller();

  state.running = true;
  state.year = yr;
  state.interval_sec = interval;
  state.started_at = new Date().toISOString();
  state.ticks = 0;
  state.total_saved = 0;
  state.last_error = null;
  state.last_sync_at = null;
  state.last_saved = 0;

  // Fire once immediately so the user gets instant feedback, then interval
  tick();
  state.handle = setInterval(tick, interval * 1000);
  console.log(`[poller] started year=${yr} interval=${interval}s`);
  return getStatus();
}

export function stopPoller() {
  if (state.handle) clearInterval(state.handle);
  state.handle = null;
  state.running = false;
  console.log('[poller] stopped');
  return getStatus();
}

export function getStatus() {
  return {
    running: state.running,
    year: state.year,
    interval_sec: state.interval_sec,
    started_at: state.started_at,
    last_sync_at: state.last_sync_at,
    last_saved: state.last_saved,
    total_saved: state.total_saved,
    ticks: state.ticks,
    last_error: state.last_error,
    min_interval: MIN_INTERVAL_SEC,
    max_interval: MAX_INTERVAL_SEC,
  };
}

// Ensure the interval stops if the process shuts down cleanly
process.on('SIGTERM', () => stopPoller());
process.on('SIGINT', () => stopPoller());
