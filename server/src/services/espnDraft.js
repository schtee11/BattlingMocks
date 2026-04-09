// Fetches draft data from ESPN's undocumented APIs. Phase 1: Round 1 only,
// read-only. Nothing here writes to the DB — the route layer handles that.
//
// ESPN exposes several endpoints that can return draft data and their shapes
// shift without notice. We try multiple endpoints in order, fall back to the
// next on any failure, and log the first raw response so we can diagnose
// shape changes.

const UA = 'MockDraftShowdown/1.0 (+https://mockdraftshowdown.netlify.app)';

let loggedRaw = false;

async function fetchJson(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${url}`);
  return r.json();
}

function logRawOnce(label, data) {
  if (loggedRaw) return;
  loggedRaw = true;
  try {
    console.log(`[espn ${label}] sample`, JSON.stringify(data).slice(0, 3000));
  } catch {}
}

// Normalized pick record:
// { pick, round, team_abbr, team_name, player_name, player_position, player_school }

// Strategy A: ESPN core API — items with $ref pointers. Most reliable for
// completed drafts, slowest (N+1 fetches) but works once we follow refs.
async function fromCore(year, round = 1) {
  const base = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${year}/draft/rounds/${round}/picks?limit=40`;
  const data = await fetchJson(base);
  logRawOnce(`core list year=${year} rd=${round}`, data);

  const items = data?.items || [];
  const picks = [];
  for (const item of items) {
    try {
      // Each item is either a full pick object or a {$ref} that must be fetched
      const pickData = item.$ref ? await fetchJson(item.$ref) : item;

      const teamRef = pickData.team?.$ref;
      const athleteRef = pickData.athlete?.$ref;
      const team = teamRef ? await fetchJson(teamRef).catch(() => null) : pickData.team;
      const athlete = athleteRef
        ? await fetchJson(athleteRef).catch(() => null)
        : pickData.athlete;

      const overall = pickData.overall ?? pickData.pick ?? pickData.overallPick;
      const roundNum = pickData.round?.number ?? pickData.round ?? round;

      picks.push({
        pick: Number(overall),
        round: Number(roundNum),
        team_abbr: team?.abbreviation || null,
        team_name: team?.displayName || team?.name || null,
        player_name: athlete?.displayName || athlete?.fullName || null,
        player_position:
          athlete?.position?.abbreviation || athlete?.position?.displayName || null,
        player_school: athlete?.college?.name || athlete?.birthPlace?.city || null,
      });
    } catch (e) {
      console.warn('[espn core] pick parse error', e.message);
    }
  }
  return picks;
}

// Strategy B: site web API with embedded data. Typically faster (single
// request) and sometimes has richer data. Shape varies by year.
async function fromSiteWeb(year, round = 1) {
  const url = `https://site.web.api.espn.com/apis/v2/scoreboard/header?draft_year=${year}&draft_round=${round}`;
  const data = await fetchJson(url);
  logRawOnce(`siteweb year=${year} rd=${round}`, data);

  // Walk the response for anything that looks like a pick list
  const candidates = [
    data?.picks,
    data?.sports?.[0]?.leagues?.[0]?.events,
    data?.events,
    data?.rounds?.flatMap?.((r) => r.picks || []),
    data?.items,
  ].filter(Array.isArray);

  for (const list of candidates) {
    const picks = list
      .map(normalizeEmbeddedPick)
      .filter((p) => p && Number.isInteger(p.pick));
    if (picks.length > 0) return picks;
  }
  return [];
}

function normalizeEmbeddedPick(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const overall =
    raw.overall ?? raw.pick ?? raw.overallPick ?? raw.number ?? raw.pickNumber;
  if (overall == null) return null;

  const team =
    raw.team || raw.franchise || raw.competitors?.[0]?.team || null;
  const athlete = raw.athlete || raw.player || raw.competitors?.[0]?.athlete || null;

  return {
    pick: Number(overall),
    round: Number(raw.round?.number ?? raw.round ?? raw.roundNumber ?? 0),
    team_abbr: team?.abbreviation || team?.abbrev || null,
    team_name: team?.displayName || team?.name || null,
    player_name: athlete?.displayName || athlete?.fullName || athlete?.name || null,
    player_position:
      athlete?.position?.abbreviation || athlete?.position?.displayName || null,
    player_school: athlete?.college?.name || athlete?.school || null,
  };
}

// Public: fetch round 1 picks, trying each strategy until one works.
export async function fetchRoundOne(year) {
  const strategies = [
    () => fromCore(year, 1),
    () => fromSiteWeb(year, 1),
  ];

  for (const fn of strategies) {
    try {
      const picks = await fn();
      if (picks && picks.length > 0) {
        // Sort and dedupe by pick number
        const byPick = new Map();
        for (const p of picks) if (p && p.pick) byPick.set(p.pick, p);
        return Array.from(byPick.values()).sort((a, b) => a.pick - b.pick);
      }
    } catch (e) {
      console.warn('[espn draft] strategy failed:', e.message);
    }
  }
  return [];
}

// For diagnostics from the route layer
export function resetLogFlag() {
  loggedRaw = false;
}
