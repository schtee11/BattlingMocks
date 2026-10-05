// Single source of truth for which NFL Draft the site is running. Mirrors
// server/src/config.js — bump both (or set VITE_DRAFT_YEAR / DRAFT_YEAR)
// when the season rolls over.
export const CURRENT_DRAFT_YEAR = Number(import.meta.env.VITE_DRAFT_YEAR) || 2027;

// The draft after the current one — the "future picks" in trade UIs.
export const NEXT_DRAFT_YEAR = CURRENT_DRAFT_YEAR + 1;

// 2027 NFL Draft: April 29 – May 1, 2027 on the National Mall, Washington, D.C.
// Round 1 kicks off 8:00 PM ET Thursday (EDT = UTC-4 in late April).
export const DRAFT_START = new Date('2027-04-29T20:00:00-04:00');
export const DRAFT_DATES_LABEL = 'April 29 – May 1, 2027';
export const DRAFT_KICKOFF_LABEL = 'Thursday, April 29, 2027';
export const DRAFT_LOCATION = 'Washington, D.C.';
