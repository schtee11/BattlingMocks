const BASE = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3001';

export const API_BASE = BASE;
export const DISCORD_AUTH_URL = `${BASE}/api/auth/discord`;

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
  getPlayers: () => cached('players', 5 * 60_000, () => request('/api/players')),
  getDraftOrder: () => cached('draft-order', 60 * 60_000, () => request('/api/draft-order')),
  getSettings: () => cached('settings', 30_000, () => request('/api/settings')),
  getStats: () => cached('stats', 30_000, () => request('/api/stats')),
  getActualPicks: ({ fresh = false } = {}) => {
    if (fresh) invalidateCache('actual-picks');
    return cached('actual-picks', 30_000, () => request('/api/actual-picks'));
  },
  checkName: (name) => request(`/api/users/check?name=${encodeURIComponent(name)}`),
  getUserByName: (name) => request(`/api/users/by-name?name=${encodeURIComponent(name)}`),
  createUser: (display_name) => request('/api/users', { method: 'POST', body: { display_name } }),
  getUser: (id) => request(`/api/users/${id}`),
  submitMock: (user_id, picks) => {
    invalidateCache('stats');
    return request('/api/mocks', { method: 'POST', body: { user_id, picks } });
  },
  getMock: (userId) => request(`/api/mocks/${userId}`),
  getLeaderboard: (limit = 100, offset = 0) =>
    request(`/api/leaderboard?limit=${limit}&offset=${offset}`),

  // admin
  adminListUsers: (key) => request('/api/admin/users', { adminKey: key }),
  addPlayer: (key, p) => request('/api/admin/players', { method: 'POST', body: p, adminKey: key }),
  updatePlayer: (key, id, p) =>
    request(`/api/admin/players/${id}`, { method: 'PUT', body: p, adminKey: key }),
  deletePlayer: (key, id) =>
    request(`/api/admin/players/${id}`, { method: 'DELETE', adminKey: key }),
  importProspects: (key) =>
    request('/api/admin/import-prospects', { method: 'POST', adminKey: key }),
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
  adminGetDraftOrder: (key) => request('/api/admin/draft-order', { adminKey: key }),
  adminSetDraftOrder: (key, order) =>
    request('/api/admin/draft-order', { method: 'POST', body: { order }, adminKey: key }),
  adminGetActualPicks: (key) => request('/api/admin/actual-picks', { adminKey: key }),
  setActualPick: (key, body) =>
    request('/api/admin/actual-picks', { method: 'POST', body, adminKey: key }),
  deleteActualPick: (key, pick) =>
    request(`/api/admin/actual-picks/${pick}`, { method: 'DELETE', adminKey: key }),
  runScore: (key) => request('/api/admin/score', { method: 'POST', adminKey: key }),
  toggleLock: (key, is_locked) =>
    request('/api/admin/lock', { method: 'POST', body: { is_locked }, adminKey: key }),
};
