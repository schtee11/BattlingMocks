const BASE = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3001';

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

export const api = {
  // public
  getPlayers: () => request('/api/players'),
  getDraftOrder: () => request('/api/draft-order'),
  getSettings: () => request('/api/settings'),
  getStats: () => request('/api/stats'),
  getActualPicks: () => request('/api/actual-picks'),
  checkName: (name) => request(`/api/users/check?name=${encodeURIComponent(name)}`),
  createUser: (display_name) => request('/api/users', { method: 'POST', body: { display_name } }),
  getUser: (id) => request(`/api/users/${id}`),
  submitMock: (user_id, picks) =>
    request('/api/mocks', { method: 'POST', body: { user_id, picks } }),
  getMock: (userId) => request(`/api/mocks/${userId}`),
  getLeaderboard: (limit = 100, offset = 0) =>
    request(`/api/leaderboard?limit=${limit}&offset=${offset}`),

  // admin
  addPlayer: (key, p) => request('/api/admin/players', { method: 'POST', body: p, adminKey: key }),
  updatePlayer: (key, id, p) =>
    request(`/api/admin/players/${id}`, { method: 'PUT', body: p, adminKey: key }),
  deletePlayer: (key, id) =>
    request(`/api/admin/players/${id}`, { method: 'DELETE', adminKey: key }),
  importProspects: (key) =>
    request('/api/admin/import-prospects', { method: 'POST', adminKey: key }),
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
