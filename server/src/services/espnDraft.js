// ESPN draft fetcher — Phase 1, Round 1 only, read-only.
// Writes nothing to the DB; the route layer handles persistence.
//
// Works off ESPN's site.web.api scoreboard/header endpoint. The endpoint
// requires a sport/league filter otherwise it defaults to basketball.
// Response shape (verified against NBA 2025 data):
//   sports[0].leagues[0].draft.rounds[N].picks[N]
// Each pick has: { pick, overall, round, team: "Chiefs",
//                  displayName, position, college, link: "/name/kc/..." }

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
    console.log(`[espn ${label}] sample`, JSON.stringify(data).slice(0, 3500));
  } catch {}
}

// Parse the `link` field (e.g. "/nfl/draft/teams/_/name/kc/kansas-city-chiefs")
// and pull the abbr + full name slug.
function parseTeamLink(link) {
  if (!link || typeof link !== 'string') return { abbr: null, name: null };
  const m = link.match(/\/name\/([a-z0-9]+)(?:\/([a-z0-9-]+))?/i);
  if (!m) return { abbr: null, name: null };
  const abbr = m[1].toUpperCase();
  const name = m[2]
    ? m[2]
        .split('-')
        .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
        .join(' ')
    : null;
  return { abbr, name };
}

// Walk ESPN's response looking for an NFL league with a draft section.
function extractNflDraft(data) {
  const sports = Array.isArray(data?.sports) ? data.sports : [];
  for (const sport of sports) {
    const leagues = Array.isArray(sport.leagues) ? sport.leagues : [];
    for (const league of leagues) {
      const looksLikeNfl =
        league.slug === 'nfl' ||
        league.abbreviation === 'NFL' ||
        /national football/i.test(league.name || '');
      if (looksLikeNfl && league.draft) return league.draft;
    }
  }
  return null;
}

function normalizePick(raw, fallbackRound) {
  if (!raw || typeof raw !== 'object') return null;
  const overall = raw.overall ?? raw.pick ?? raw.pickNumber;
  if (!Number.isInteger(Number(overall))) return null;

  // Team: can be a string ("Chiefs"), an object, or parsed from link
  const { abbr: linkAbbr, name: linkName } = parseTeamLink(raw.link);
  let teamAbbr = linkAbbr;
  let teamName = null;
  if (typeof raw.team === 'string') {
    teamName = linkName || raw.team;
  } else if (raw.team && typeof raw.team === 'object') {
    teamAbbr = teamAbbr || raw.team.abbreviation || null;
    teamName = raw.team.displayName || raw.team.name || linkName;
  } else {
    teamName = linkName;
  }

  return {
    pick: Number(overall),
    round: Number(raw.round ?? fallbackRound ?? 1),
    team_abbr: teamAbbr,
    team_name: teamName,
    player_name: raw.displayName || raw.fullName || raw.name || null,
    player_position:
      (raw.position && (raw.position.abbreviation || raw.position.displayName)) ||
      (typeof raw.position === 'string' ? raw.position : null),
    player_school:
      raw.college ||
      raw.school ||
      (raw.athlete && (raw.athlete.college?.name || raw.athlete.school)) ||
      null,
    traded: !!raw.traded,
  };
}

// Try a list of candidate URLs until one returns an NFL draft with picks.
async function fetchFromSiteWeb(year, round) {
  const urls = [
    // Primary: scoreboard header with sport + league filters (prevents NBA default)
    `https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=football&league=nfl&draft_year=${year}&draft_round=${round}`,
    // Secondary: classic site API draft endpoint
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/draft?year=${year}`,
    // Tertiary: common v3 draft
    `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/draft?year=${year}`,
  ];

  for (const url of urls) {
    try {
      const data = await fetchJson(url);
      logRawOnce(`siteweb ${year} r${round} @ ${url.replace(/^.*espn\.com/, '')}`, data);
      const draft = extractNflDraft(data);
      if (!draft) continue;

      const rounds = Array.isArray(draft.rounds) ? draft.rounds : [];
      const target =
        rounds.find((r) => Number(r.number) === Number(round)) || rounds[0];
      const rawPicks = Array.isArray(target?.picks) ? target.picks : [];
      if (rawPicks.length === 0) continue;

      const picks = rawPicks
        .map((p) => normalizePick(p, round))
        .filter((p) => p && p.pick);
      if (picks.length > 0) return picks;
    } catch (e) {
      console.warn(`[espn draft] strategy failed:`, e.message);
    }
  }
  return [];
}

// Public: fetch round N (default 1), deduped and sorted by pick number.
export async function fetchRound(year, round = 1) {
  const picks = await fetchFromSiteWeb(year, round);
  const byPick = new Map();
  for (const p of picks) if (p && p.pick) byPick.set(p.pick, p);
  return Array.from(byPick.values()).sort((a, b) => a.pick - b.pick);
}

// Back-compat alias used by Phase 1/2 callers
export async function fetchRoundOne(year) {
  return fetchRound(year, 1);
}

// Fetch all 7 rounds sequentially. Rounds that return 0 picks are skipped
// (happens for unannounced comp picks in future drafts). Result is a flat,
// sorted list of picks across all rounds.
export async function fetchAllRounds(year) {
  const all = [];
  for (let r = 1; r <= 7; r++) {
    try {
      const picks = await fetchRound(year, r);
      for (const p of picks) {
        // Ensure round field is set — the parser defaults to the requested round
        if (!p.round) p.round = r;
        all.push(p);
      }
    } catch (e) {
      console.warn(`[espn fetchAllRounds] round ${r} failed:`, e.message);
    }
  }
  // Dedupe in case a pick shows up in multiple rounds' responses
  const byPick = new Map();
  for (const p of all) if (p && p.pick) byPick.set(p.pick, p);
  return Array.from(byPick.values()).sort((a, b) => a.pick - b.pick);
}

// -------- Draft prospects fetch --------
// Tries several ESPN endpoint patterns that are known to return prospect
// data. Response shapes vary wildly; we normalize everything we find into
// { name, position, school, headshot_url, rank }.

function normalizeProspect(raw, fallbackRank) {
  if (!raw || typeof raw !== 'object') return null;

  // Name
  const name =
    raw.displayName ||
    raw.fullName ||
    raw.name ||
    (raw.firstName && raw.lastName ? `${raw.firstName} ${raw.lastName}` : null);
  if (!name) return null;

  // Position — can be a string or an object
  let position = null;
  if (typeof raw.position === 'string') position = raw.position;
  else if (raw.position && typeof raw.position === 'object')
    position = raw.position.abbreviation || raw.position.displayName || raw.position.name || null;
  if (!position && raw.pos) position = raw.pos;
  if (!position) return null;

  // School — ESPN calls it college/school/team in different places
  let school = null;
  if (typeof raw.college === 'string') school = raw.college;
  else if (raw.college && typeof raw.college === 'object')
    school = raw.college.name || raw.college.displayName || null;
  if (!school) school = raw.school || raw.team || null;

  // Headshot
  let headshot_url = null;
  if (typeof raw.headshot === 'string') headshot_url = raw.headshot;
  else if (raw.headshot && typeof raw.headshot === 'object')
    headshot_url = raw.headshot.href || raw.headshot.default || null;
  if (!headshot_url && raw.image)
    headshot_url = typeof raw.image === 'string' ? raw.image : raw.image.default || raw.image.href || null;

  // Rank
  const rank = Number(raw.rank ?? raw.ranking ?? raw.grade ?? fallbackRank) || null;

  return { name, position, school, headshot_url, rank };
}

async function fetchProspectsFromEspnAttempts(year, limit) {
  const urls = [
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/draft/prospects?year=${year}&limit=${limit}`,
    `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/draft/prospects?year=${year}&limit=${limit}`,
    `https://site.web.api.espn.com/apis/v3/sports/football/nfl/draft/prospects?year=${year}&limit=${limit}`,
    `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${year}/draft/prospects?limit=${limit}`,
    `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/draft/prospects?limit=${limit}`,
  ];

  for (const url of urls) {
    try {
      const data = await fetchJson(url);
      logRawOnce(`prospects ${year} @ ${url.replace(/^.*espn\.com/, '')}`, data);

      // Find an array of prospects anywhere in the response
      const candidates = [
        data?.prospects,
        data?.items,
        data?.athletes,
        data?.results,
        data?.rankings,
        data?.data,
      ].filter(Array.isArray);

      for (const arr of candidates) {
        // If items are $refs, we'd need to follow them, but core API is slow
        // so we only use direct data and skip ref-only responses.
        const flat = arr.filter((x) => x && typeof x === 'object' && !x.$ref);
        if (flat.length === 0) continue;

        const prospects = flat
          .map((raw, i) => normalizeProspect(raw, i + 1))
          .filter(Boolean);

        if (prospects.length > 0) {
          console.log(`[espn prospects] got ${prospects.length} from ${url.replace(/^.*espn\.com/, '')}`);
          return prospects;
        }
      }
    } catch (e) {
      console.warn('[espn prospects] strategy failed:', e.message);
    }
  }
  return [];
}

export async function fetchProspects(year, limit = 400) {
  return fetchProspectsFromEspnAttempts(year, limit);
}

export function resetLogFlag() {
  loggedRaw = false;
}
