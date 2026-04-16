// Helpers for future-year draft picks (currently 2027). These picks are
// tradable assets in both team_mock and round1 prediction modes but live in
// a parallel data structure from the current-year draft_order: each team
// owns one pick per round, keyed by a stable string id (e.g. "2027-LV-R1").
//
// Pick id format
//   `${year}-${team}-R${round}`         e.g. "2027-NYJ-R3"
//
// Selection-set storage
//   2026 picks  — kept as numbers (existing behaviour, unchanged)
//   2027 picks  — kept as strings
//   The TradeModal's selected sets, valueMap, and trade-history JSON all
//   accept the union type. We never coerce one to the other so saved mocks
//   round-trip losslessly.

// Stable across the app — keep in sync with server/src/data/future-pick-values.json
// year_offset_1 (only consumed when the server endpoint can't be reached).
const FALLBACK_VALUE_BY_ROUND = { 1: 128, 2: 65, 3: 32, 4: 16, 5: 8, 6: 4, 7: 2 };

export function isFuturePickId(id) {
  return typeof id === 'string' && /^\d{4}-[A-Z]{2,4}-R[1-7]$/.test(id);
}

export function parseFuturePickId(id) {
  if (!isFuturePickId(id)) return null;
  const [year, team, roundTag] = id.split('-');
  return { year: Number(year), team, round: Number(roundTag.slice(1)) };
}

export function makeFuturePickId({ year, team, round }) {
  return `${year}-${team}-R${round}`;
}

// Display label used everywhere a pick id appears in the UI (cards, history).
// Numbers fall back to "#25" so existing 2026 rendering is unchanged.
export function formatPickLabel(id) {
  if (typeof id === 'number') return `#${id}`;
  const parsed = parseFuturePickId(id);
  if (parsed) return `${parsed.year} R${parsed.round}`;
  return String(id);
}

// Compact label for tight spaces — keeps the year for clarity.
export function formatPickLabelCompact(id) {
  if (typeof id === 'number') return `#${id}`;
  const parsed = parseFuturePickId(id);
  if (parsed) return `'${String(parsed.year).slice(2)} R${parsed.round}`;
  return String(id);
}

// Build an in-memory ownership map from a list of future picks. Keyed by id
// for O(1) trade swaps. Each entry is the pick object with a mutable `team`.
export function buildFutureOwnership(futurePicks) {
  const map = new Map();
  for (const p of futurePicks || []) map.set(p.id, { ...p });
  return map;
}

// Apply a swap: change ownership of `ids` to `newTeam`. Returns a NEW Map so
// React state updates remain immutable.
export function swapFutureOwnership(prevMap, ids, newTeam) {
  const next = new Map(prevMap);
  for (const id of ids || []) {
    const cur = next.get(id);
    if (cur) next.set(id, { ...cur, team: newTeam });
  }
  return next;
}

// Used by the trade UI to show "Team X's 2027 picks" — sorted R1 → R7.
export function futurePicksForTeam(ownershipMap, team) {
  const out = [];
  for (const p of ownershipMap.values()) if (p.team === team) out.push(p);
  out.sort((a, b) => a.round - b.round);
  return out;
}

// Fallback value lookup when the server-provided value is missing (e.g. an
// old saved mock loaded its trades JSON before the server endpoint existed).
export function fallbackFutureValue(idOrRound) {
  if (typeof idOrRound === 'number') return FALLBACK_VALUE_BY_ROUND[idOrRound] ?? 1;
  const parsed = parseFuturePickId(idOrRound);
  if (parsed) return FALLBACK_VALUE_BY_ROUND[parsed.round] ?? 1;
  return 0;
}
