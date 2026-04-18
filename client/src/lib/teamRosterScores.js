// Roster scores cache — 1–10 per-team, per-position scores entered by admins
// in the Roster Scores tab. The bot picker reads these via draftContext to
// boost picks for positions where the owning team is deficient.
//
// Usage: call loadTeamRosterScores() once at draft startup (already done from
// TeamMock.loadData). getTeamRosterScores(abbr) returns a plain object keyed
// by canonical position (QB, RB, …, NCB, CB, S) with integer 1–10 values.
// Teams with no saved scores return an empty object — the picker falls back
// to rosterScoreDefault in that case.

import { api } from './api.js';

let _byTeam = null;

export async function loadTeamRosterScores() {
  try {
    const teams = await api.getTeams();
    const next = {};
    for (const t of teams || []) {
      const abbr = (t.abbr || t.id || '').toUpperCase();
      if (!abbr) continue;
      next[abbr] = t.position_scores || {};
    }
    _byTeam = next;
  } catch {
    if (!_byTeam) _byTeam = {};
  }
  return _byTeam;
}

export function getTeamRosterScores(teamAbbr) {
  if (!_byTeam) return {};
  const abbr = String(teamAbbr || '').toUpperCase();
  return _byTeam[abbr] || {};
}
