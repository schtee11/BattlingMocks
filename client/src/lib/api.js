const BASE = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3001';

export const API_BASE = BASE;
export const DISCORD_AUTH_URL = `${BASE}/api/auth/discord`;
export const GOOGLE_AUTH_URL = `${BASE}/api/auth/google`;

// Build a link-intent OAuth URL for an already-authenticated user. The
// server reads `link=1&user=<uuid>` to know this is a link flow, not a new
// sign-in, and attaches the resulting identity to the given user instead
// of creating a new account.
export function linkProviderUrl(provider, userId) {
  const qs = new URLSearchParams({ link: '1', user: userId });
  return `${BASE}/api/auth/${provider}?${qs.toString()}`;
}

// Routes an ESPN CDN image URL through our server-side proxy so html-to-image
// can read it into a canvas. Without this, cross-origin images taint the
// canvas and the capture silently loses them.
export function proxyImageUrl(url) {
  if (!url) return null;
  return `${BASE}/api/proxy/image?url=${encodeURIComponent(url)}`;
}

async function request(path, { method = 'GET', body, adminKey } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (adminKey) headers['X-Admin-Key'] = adminKey;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let err;
    try { err = await res.json(); } catch { err = { error: res.statusText }; }
    throw new Error(err.error || 'request failed');
  }
  if (res.status === 204) return null;
  return res.json();
}

// Simple in-memory TTL cache for idempotent GETs.
// Lives for the lifetime of the tab; cleared on full page reload.
const memCache = new Map();
function cached(key, ttlMs, fetcher) {
  const hit = memCache.get(key);
  const now = Date.now();
  if (hit && now - hit.time < ttlMs) return Promise.resolve(hit.data);
  if (hit?.inflight) return hit.inflight;
  const inflight = fetcher().then(
    (data) => { memCache.set(key, { data, time: Date.now() }); return data; },
    (err) => { memCache.delete(key); throw err; }
  );
  memCache.set(key, { ...(hit || {}), inflight });
  return inflight;
}
export function invalidateCache(prefix) {
  if (!prefix) { memCache.clear(); return; }
  for (const key of memCache.keys()) {
    if (key.startsWith(prefix)) memCache.delete(key);
  }
}

export const api = {
  // public — cached where safe
  getPlayers: ({ fresh = false } = {}) => {
    if (fresh) invalidateCache('players');
    // When fresh, add a cache-bust query param so the browser HTTP cache
    // (Cache-Control max-age=300) gets bypassed too — invalidating the
    // in-memory cache alone isn't enough.
    return cached(
      'players',
      5 * 60_000,
      () => request(fresh ? `/api/players?_=${Date.now()}` : '/api/players')
    );
  },
  getDraftOrder: () => cached('draft-order', 60 * 60_000, () => request('/api/draft-order')),
  // Short-TTL + cache-bust support so admin syncs of R2-R7 show up immediately.
  getDraftOrderAll: ({ fresh = false } = {}) => {
    if (fresh) invalidateCache('draft-order-all');
    return cached(
      'draft-order-all',
      30_000,
      () => request(fresh ? `/api/draft-order?round=all&_=${Date.now()}` : '/api/draft-order?round=all')
    );
  },
  getSettings: () => cached('settings', 30_000, () => request('/api/settings')),
  getAlgoConfig: () => cached('algo-config', 60_000, () => request('/api/algo-config')),
  getStats: () => cached('stats', 30_000, () => request('/api/stats')),
  getActualPicks: ({ fresh = false } = {}) => {
    if (fresh) invalidateCache('actual-picks');
    return cached('actual-picks', 30_000, () => request('/api/actual-picks'));
  },
  // Phase 6: enterprise upgrade endpoints
  getTeams: () => cached('teams', 5 * 60_000, () => request('/api/teams')),
  getPlayerById: (id) => cached(`player-${id}`, 5 * 60_000, () => request(`/api/players/${id}`)),
  getUserProfile: (userId) => request(`/api/users/${userId}/profile`),
  getPredictiveLive: ({ fresh = false } = {}) => {
    if (fresh) invalidateCache('predictive-live');
    return cached('predictive-live', 8_000, () => request('/api/predictive/live'));
  },
  checkName: (name) => request(`/api/users/check?name=${encodeURIComponent(name)}`),
  getUserByName: (name) => request(`/api/users/by-name?name=${encodeURIComponent(name)}`),
  createUser: (display_name) => request('/api/users', { method: 'POST', body: { display_name } }),
  getUser: (id) => request(`/api/users/${id}`),
  // Linked-provider management (Account Settings page)
  getUserIdentities: (userId) => request(`/api/auth/users/${userId}/identities`),
  unlinkProvider: (userId, provider) =>
    request(`/api/auth/users/${userId}/identities/${provider}`, { method: 'DELETE' }),
  submitMock: (user_id, picks) => {
    invalidateCache('stats');
    // picks may include { pick_number, player_id, is_confident? }
    return request('/api/mocks', { method: 'POST', body: { user_id, picks } });
  },
  getMock: (userId) => request(`/api/mocks/${userId}`),
  getLeaderboard: (limit = 100, offset = 0) =>
    request(`/api/leaderboard?limit=${limit}&offset=${offset}`),

  // team-specific mock (Phase 4) — unlimited per user
  listTeamMocks: (userId) => request(`/api/team-mocks/user/${userId}`),
  getTeamMockById: (id) => request(`/api/team-mocks/${id}`),
  submitTeamMock: (user_id, team_abbr, picks, title, trades) =>
    request('/api/team-mocks', {
      method: 'POST',
      body: { user_id, team_abbr, picks, title, trades },
    }),
  deleteTeamMock: (id) => request(`/api/team-mocks/${id}`, { method: 'DELETE' }),

  // Draft-session telemetry (Phase 5). Fire-and-forget from the caller —
  // all telemetry failures are swallowed by the DraftSimulator wrapper so
  // they never block the live draft flow.
  createDraftSession: (payload) =>
    request('/api/draft-sessions', { method: 'POST', body: payload }),
  logDraftSessionPicks: (sessionId, picks) =>
    request(`/api/draft-sessions/${sessionId}/picks`, {
      method: 'POST',
      body: { picks },
    }),
  completeDraftSession: (sessionId) =>
    request(`/api/draft-sessions/${sessionId}`, { method: 'PATCH' }),

  // admin
  adminGetAlgoConfig: (key) => request('/api/admin/algo-config', { adminKey: key }),
  adminSaveAlgoConfig: (key, config) =>
    request('/api/admin/algo-config', { method: 'PUT', body: config, adminKey: key }),
  adminResetAlgoConfig: (key) =>
    request('/api/admin/algo-config', { method: 'DELETE', adminKey: key }),
  adminListUsers: (key) => request('/api/admin/users', { adminKey: key }),
  addPlayer: (key, p) => request('/api/admin/players', { method: 'POST', body: p, adminKey: key }),
  updatePlayer: (key, id, p) =>
    request(`/api/admin/players/${id}`, { method: 'PUT', body: p, adminKey: key }),
  deletePlayer: (key, id) =>
    request(`/api/admin/players/${id}`, { method: 'DELETE', adminKey: key }),
  importProspects: (key) =>
    request('/api/admin/import-prospects', { method: 'POST', adminKey: key }),
  bulkImportProspects: (key, prospects) =>
    request('/api/admin/prospects/bulk-import', {
      method: 'POST',
      body: { prospects },
      adminKey: key,
    }),
  syncProspectsFromEspn: (key, { year = 2026, limit = 400, dry = false } = {}) =>
    request(
      `/api/admin/prospects/sync-from-espn?year=${year}&limit=${limit}${dry ? '&dry=1' : ''}`,
      { method: 'POST', adminKey: key }
    ),
  fetchHeadshots: (key, { overwrite = false } = {}) =>
    request(`/api/admin/fetch-headshots${overwrite ? '?overwrite=1' : ''}`, {
      method: 'POST',
      adminKey: key,
    }),
  // ESPN draft sync — all Round 1 for Phase 1
  previewEspnDraft: (key, year = 2026) =>
    request(`/api/admin/sync/preview?year=${year}`, { adminKey: key }),
  syncDraftOrderFromEspn: (key, { year = 2026, dry = false } = {}) =>
    request(`/api/admin/sync/draft-order?year=${year}${dry ? '&dry=1' : ''}`, {
      method: 'POST',
      adminKey: key,
    }),
  // Full 7-round draft order sync from ESPN. Preserves R1 by default.
  syncAllRoundsFromEspn: (key, { year = 2026, dry = false, includeR1 = false } = {}) =>
    request(
      `/api/admin/sync/draft-order-all?year=${year}${dry ? '&dry=1' : ''}${includeR1 ? '&include_r1=1' : ''}`,
      { method: 'POST', adminKey: key }
    ),
  syncPicksFromEspn: (key, { year = 2026, dry = false } = {}) =>
    request(`/api/admin/sync/picks?year=${year}${dry ? '&dry=1' : ''}`, {
      method: 'POST',
      adminKey: key,
    }),
  // Draft-night auto-poller
  pollStatus: (key) => request('/api/admin/sync/poll-status', { adminKey: key }),
  pollStart: (key, { year = 2026, intervalSec = 20 } = {}) =>
    request(`/api/admin/sync/poll-start?year=${year}&interval=${intervalSec}`, {
      method: 'POST',
      adminKey: key,
    }),
  pollStop: (key) =>
    request('/api/admin/sync/poll-stop', { method: 'POST', adminKey: key }),
  // Trade calculator (admin only for Phase 3a)
  tradeValues: (key) => request('/api/admin/trades/values', { adminKey: key }),
  tradeCalculate: (key, body) =>
    request('/api/admin/trades/calculate', { method: 'POST', body, adminKey: key }),
  tradeApply: (key, body) =>
    request('/api/admin/trades/apply', { method: 'POST', body, adminKey: key }),
  adminGetDraftOrder: (key, { round = 'all' } = {}) =>
    request(`/api/admin/draft-order?round=${round}`, { adminKey: key }),
  adminSetDraftOrder: (key, order) =>
    request('/api/admin/draft-order', { method: 'POST', body: { order }, adminKey: key }),
  adminSetTeamNeeds: (key, needs) =>
    request('/api/admin/team-needs', { method: 'POST', body: { needs }, adminKey: key }),
  adminGetActualPicks: (key) => request('/api/admin/actual-picks', { adminKey: key }),
  setActualPick: (key, body) =>
    request('/api/admin/actual-picks', { method: 'POST', body, adminKey: key }),
  deleteActualPick: (key, pick) =>
    request(`/api/admin/actual-picks/${pick}`, { method: 'DELETE', adminKey: key }),
  runScore: (key) => request('/api/admin/score', { method: 'POST', adminKey: key }),
  toggleLock: (key, is_locked) =>
    request('/api/admin/lock', { method: 'POST', body: { is_locked }, adminKey: key }),
};
