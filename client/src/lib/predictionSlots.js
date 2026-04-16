// Persistence layer for prediction-mode mocks.
// Logged-in users → server DB via /api/prediction-mocks.
// Guests → localStorage fallback (same key as before).

import { api } from './api.js';

const LS_KEY = 'mds_prediction_slots';
const MAX_SLOTS = 10;

export { MAX_SLOTS };

// ── localStorage helpers (guest fallback) ─────────────────────────────

function lsLoad() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function lsSave(slots) {
  localStorage.setItem(LS_KEY, JSON.stringify(slots));
}

// ── Public async API ──────────────────────────────────────────────────

export async function loadSlots(userId) {
  if (userId) {
    try {
      return await api.listPredictionMocks();
    } catch (e) {
      console.warn('[predictionSlots] API load failed, falling back to localStorage', e);
    }
  }
  return lsLoad();
}

export async function saveSlot({ name, picks, draftOrder }, userId) {
  if (userId) {
    return api.savePredictionMock(name, picks, draftOrder);
  }
  // Guest: localStorage
  const slots = lsLoad();
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    name: name || `Mock ${slots.length + 1}`,
    picks,
    draftOrder,
    savedAt: new Date().toISOString(),
  };
  const next = [entry, ...slots].slice(0, MAX_SLOTS);
  lsSave(next);
  return entry;
}

export async function updateSlot(id, { picks, draftOrder }, userId) {
  if (userId) {
    return api.updatePredictionMock(id, picks, draftOrder);
  }
  // Guest: localStorage
  const slots = lsLoad().map((s) =>
    s.id === id
      ? { ...s, picks, draftOrder, savedAt: new Date().toISOString() }
      : s,
  );
  lsSave(slots);
}

export async function deleteSlot(id, userId) {
  if (userId) {
    return api.deletePredictionMock(id);
  }
  // Guest: localStorage
  const slots = lsLoad().filter((s) => s.id !== id);
  lsSave(slots);
}
