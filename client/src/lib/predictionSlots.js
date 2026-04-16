// Lightweight localStorage persistence for Prediction-mode mocks.
// Users can save up to MAX_SLOTS named drafts while exploring
// trades/picks outside of the scored competition.

const KEY = 'mds_prediction_slots';
const MAX_SLOTS = 10;

export { MAX_SLOTS };

export function loadSlots() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveSlot({ name, picks, confidentSlots, draftOrder }) {
  const slots = loadSlots();
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    name: name || `Mock ${slots.length + 1}`,
    picks,
    confidentSlots: [...confidentSlots],
    draftOrder,
    savedAt: new Date().toISOString(),
  };
  const next = [entry, ...slots].slice(0, MAX_SLOTS);
  localStorage.setItem(KEY, JSON.stringify(next));
  return entry;
}

export function updateSlot(id, { picks, confidentSlots, draftOrder }) {
  const slots = loadSlots().map((s) =>
    s.id === id
      ? { ...s, picks, confidentSlots: [...confidentSlots], draftOrder, savedAt: new Date().toISOString() }
      : s,
  );
  localStorage.setItem(KEY, JSON.stringify(slots));
}

export function deleteSlot(id) {
  const slots = loadSlots().filter((s) => s.id !== id);
  localStorage.setItem(KEY, JSON.stringify(slots));
}
