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

// Wrap ESPN CDN images so the browser loads them via our server proxy.
// ESPN's CDN serves placeholder silhouettes (or no image at all) to clients
// it considers bot-like — which on iOS / mobile Safari with a no-referrer
// policy is almost everyone. The proxy sends a real Chrome UA + ESPN
// referer, so images come back correctly on every platform. Non-ESPN URLs
// (local assets, gravatars, etc.) fall through unchanged.
export function playerImageUrl(url) {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    if (/(^|\.)espncdn\.com$/i.test(host)) return proxyImageUrl(url);
  } catch {
    // Not a parseable URL — treat as already-final (e.g. a data: URL).
  }
  return url;
}

// Fetches an image and returns a base64 PNG data URL, downsampled so the
// longest edge is at most `maxSize` px. Used by the share/export flows that
// inline images into an html-to-image capture.
//
// Why downsample: ESPN serves full-size assets (team logos at 500 px, many
// headshots > 1000 px). html-to-image rasterizes via an SVG <foreignObject>
// with every image inlined as base64. iOS Safari silently drops images when
// the SVG payload exceeds its internal rasterization budget — the layout
// captures fine, but all headshots come out blank. Scaling each image down
// to roughly its display size keeps the whole capture well under that
// budget while staying visually indistinguishable at the final resolution.
//
// Returns null on fetch/decode failure; throws on AbortError so callers can
// cancel pending work.
export async function fetchImageAsDataUrl(url, maxSize = 128, { signal } = {}) {
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('image decode failed'));
      i.src = objectUrl;
    });
    const w0 = img.naturalWidth;
    const h0 = img.naturalHeight;
    if (!w0 || !h0) return null;
    const scale = Math.min(1, maxSize / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// Fallback access token for mobile browsers where cross-origin cookies are
// blocked (Safari ITP, private browsing). Stored in localStorage and sent
// as an Authorization: Bearer header. Desktop browsers still use cookies.
const TOKEN_KEY = 'mds_token';

export function setAccessToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

export function getAccessToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

async function request(path, { method = 'GET', body, adminKey } = {}) {
  const headers = {};
  // Only set Content-Type when there's a body to send. Sending it on GET
  // requests triggers a CORS preflight (application/json is not a "simple"
  // content type), which can interfere with cookie handling on mobile
  // browsers that have strict third-party cookie policies.
  if (body) headers['Content-Type'] = 'application/json';
  if (adminKey) headers['X-Admin-Key'] = adminKey;
  // Send the stored access token as a Bearer header so authenticated
  // requests work even when cross-origin cookies are blocked.
  const token = getAccessToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let err;
    try { err = await res.json(); } catch { err = { error: res.statusText }; }
    const error = new Error(err.error || 'request failed');
    error.status = res.status;
    throw error;
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
  // Auth — cookie-based JWT session
  getMe: () => request('/api/auth/me'),
  signOut: () => request('/api/auth/sign-out', { method: 'POST' }),

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
  // Future-year picks (e.g. 2027). Short TTL so admin sync of R2-R7 (which
  // determines which teams qualify for the canonical list) shows up promptly.
  getFuturePicks: (year = 2027) =>
    cached(`future-picks-${year}`, 30_000, () => request(`/api/draft-order/future?year=${year}&_=${Date.now()}`)),
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
  getR1Consensus: () => cached('analytics-r1', 2 * 60_000, () => request('/api/analytics/r1-consensus')),
  getTeamConsensus: (team) =>
    cached(`analytics-team-${team}`, 2 * 60_000, () =>
      request(`/api/analytics/team-consensus/${encodeURIComponent(team)}`)
    ),
  getTeamPickBreakdown: (team) =>
    cached(`analytics-breakdown-${team}`, 2 * 60_000, () =>
      request(`/api/analytics/team-pick-breakdown/${encodeURIComponent(team)}`)
    ),
  getPositionConsensus: () =>
    cached('analytics-positions', 2 * 60_000, () => request('/api/analytics/positions')),
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
    // user_id is now derived from the JWT cookie on the server; we still
    // accept the parameter for API shape compatibility but don't send it.
    return request('/api/mocks', { method: 'POST', body: { picks } });
  },
  getMock: (userId) => request(`/api/mocks/${userId}`),
  getLeaderboard: (limit = 100, offset = 0) =>
    request(`/api/leaderboard?limit=${limit}&offset=${offset}`),

  // team-specific mock (Phase 4) — unlimited per user
  listTeamMocks: (userId) => request(`/api/team-mocks/user/${userId}`),
  getTeamMockById: (id) => request(`/api/team-mocks/${id}`),
  submitTeamMock: (user_id, team_abbr, picks, title, trades) =>
    // user_id is now derived from the JWT cookie on the server.
    request('/api/team-mocks', {
      method: 'POST',
      body: { team_abbr, picks, title, trades },
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

  // Big Boards (Phase 8)
  listBoards: () => request('/api/boards'),
  createBoard: (title, rankings) =>
    request('/api/boards', { method: 'POST', body: { title, rankings } }),
  getBoardById: (id) => request(`/api/boards/${id}`),
  updateBoard: (id, { title, rankings } = {}) =>
    request(`/api/boards/${id}`, { method: 'PUT', body: { title, rankings } }),
  deleteBoard: (id) => request(`/api/boards/${id}`, { method: 'DELETE' }),
  getBoardTop50: (id) => request(`/api/boards/${id}/top50`),

  // Prediction mocks (Phase 9) — DB-backed sandbox R1 mocks, up to 10 per user
  listPredictionMocks: () => request('/api/prediction-mocks'),
  savePredictionMock: (name, picks, draftOrder) =>
    request('/api/prediction-mocks', {
      method: 'POST',
      body: { name, picks, draftOrder },
    }),
  updatePredictionMock: (id, picks, draftOrder) =>
    request(`/api/prediction-mocks/${id}`, {
      method: 'PUT',
      body: { picks, draftOrder },
    }),
  deletePredictionMock: (id) =>
    request(`/api/prediction-mocks/${id}`, { method: 'DELETE' }),
  // Usage telemetry — fire-and-forget. Server accepts optional auth so guest
  // exports still get counted. Callers should .catch() silently; analytics
  // failures must never break the user-facing action (download, share, etc.).
  logPredictionMockEvent: ({ event_type, mock_id = null, metadata = {} } = {}) =>
    request('/api/prediction-mocks/events', {
      method: 'POST',
      body: { event_type, mock_id, metadata },
    }),

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
  bulkImportPlayerRanks: (key, ranks, { draft_year } = {}) =>
    request('/api/admin/player-ranks/bulk-import', {
      method: 'POST',
      body: { ranks, draft_year },
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
  adminGetPositionScores: (key, { year = 2026 } = {}) =>
    request(`/api/admin/position-scores?year=${year}`, { adminKey: key }),
  adminSavePositionScores: (key, scores, { year = 2026 } = {}) =>
    request('/api/admin/position-scores', {
      method: 'POST',
      body: { scores, year },
      adminKey: key,
    }),
  adminGetActualPicks: (key) => request('/api/admin/actual-picks', { adminKey: key }),
  setActualPick: (key, body) =>
    request('/api/admin/actual-picks', { method: 'POST', body, adminKey: key }),
  deleteActualPick: (key, pick) =>
    request(`/api/admin/actual-picks/${pick}`, { method: 'DELETE', adminKey: key }),
  runScore: (key) => request('/api/admin/score', { method: 'POST', adminKey: key }),
  toggleLock: (key, is_locked) =>
    request('/api/admin/lock', { method: 'POST', body: { is_locked }, adminKey: key }),
  volumeStats: (key, year = 2026) =>
    request(`/api/admin/volume-stats?year=${year}`, { adminKey: key }),
  adminBoardStats: (key) =>
    request('/api/admin/boards', { adminKey: key }),
  predictionMockStats: (key) =>
    request('/api/admin/prediction-mock-stats', { adminKey: key }),
};
