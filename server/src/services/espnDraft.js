// ESPN draft fetcher — Phase 1, Round 1 only, read-only.
// Writes nothing to the DB; the route layer handles persistence.
//
// Works off ESPN's site.web.api scoreboard/header endpoint. The endpoint
// requires a sport/league filter otherwise it defaults to basketball.
// Response shape (verified against NBA 2025 data):
//   sports[0].leagues[0].draft.rounds[N].picks[N]
// Each pick has: { pick, overall, round, team: "Chiefs",
//                  displayName, position, college, link: "/name/kc/..." }

const UA = 'MockDraftShowdown/1.0 (+https://mockdraftshowdown.com)';

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

// Deep-walk any object/array looking for collections of prospect-like records.
function findProspectArrays(node, depth = 0, out = []) {
  if (depth > 8 || !node) return out;
  if (Array.isArray(node)) {
    // Consider this array if most entries look like prospect objects
    const sample = node.slice(0, 5);
    const looksLikeProspects =
      sample.length > 0 &&
      sample.every(
        (x) =>
          x &&
          typeof x === 'object' &&
          !x.$ref &&
          (x.displayName || x.fullName || x.name || x.athlete) &&
          (x.position || x.pos || x.athlete?.position)
      );
    if (looksLikeProspects && node.length >= 10) out.push(node);
    // Also recurse so we don't miss nested arrays
    for (const item of node) findProspectArrays(item, depth + 1, out);
  } else if (typeof node === 'object') {
    for (const key of Object.keys(node)) findProspectArrays(node[key], depth + 1, out);
  }
  return out;
}

// Follow a single $ref URL and return the resolved object (or null on fail).
async function followRef(ref) {
  if (!ref || typeof ref !== 'string') return null;
  try {
    return await fetchJson(ref);
  } catch (e) {
    return null;
  }
}

// Resolve a list of refs in parallel with a concurrency cap to avoid hammering.
async function resolveRefs(items, cap = 10) {
  const refs = items.map((it) => it?.$ref).filter(Boolean);
  const out = [];
  for (let i = 0; i < refs.length; i += cap) {
    const batch = refs.slice(i, i + cap);
    const resolved = await Promise.all(batch.map(followRef));
    out.push(...resolved.filter(Boolean));
  }
  return out;
}

async function fetchProspectsFromEspnAttempts(year, limit) {
  // Strategy A: core API reference-following. These are patterns documented
  // in nntrn's ESPN hidden API gist. College-football athletes is the most
  // reliable of the bunch — returns all CFB players which we then filter
  // heuristically to likely draft prospects (active, ranked, etc.).
  const corePaths = [
    `https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/athletes?limit=${limit}&active=true`,
    `https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/${year}/athletes?limit=${limit}`,
    `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${year}/draft/athletes?limit=${limit}`,
    `https://sports.core.api.espn.com/v3/sports/football/leagues/nfl/seasons/${year}/draft/athletes?limit=${limit}`,
    `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/draft/athletes?limit=${limit}`,
    `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${year}/draft?limit=${limit}`,
  ];

  for (const url of corePaths) {
    try {
      const data = await fetchJson(url);
      logRawOnce(`prospects core @ ${url.replace(/^.*espn\.com/, '')}`, data);

      // Core API typically returns { items: [{ $ref }, ...], pageCount, ... }
      const items = Array.isArray(data?.items) ? data.items : null;
      if (items && items.length > 0) {
        // Items may already be full objects, or they may be $ref pointers
        const refItems = items.filter((x) => x?.$ref);
        const directItems = items.filter((x) => x && !x.$ref && typeof x === 'object');

        let resolved = [...directItems];
        if (refItems.length > 0) {
          console.log(`[espn prospects] following ${Math.min(refItems.length, limit)} refs from ${url.replace(/^.*espn\.com/, '')}`);
          const capped = refItems.slice(0, limit);
          const followed = await resolveRefs(capped, 10);
          resolved = [...resolved, ...followed];
        }

        // Each resolved object may still have nested refs for position/college.
        // Follow those in parallel batches.
        const fullyResolved = [];
        for (let i = 0; i < resolved.length; i += 10) {
          const batch = resolved.slice(i, i + 10);
          const enriched = await Promise.all(
            batch.map(async (obj) => {
              if (!obj || typeof obj !== 'object') return null;
              const out = { ...obj };
              if (out.position?.$ref) out.position = await followRef(out.position.$ref);
              if (out.college?.$ref) out.college = await followRef(out.college.$ref);
              return out;
            })
          );
          fullyResolved.push(...enriched.filter(Boolean));
        }

        const prospects = fullyResolved
          .map((raw, i) => normalizeProspect(raw, i + 1))
          .filter(Boolean);

        if (prospects.length >= 10) {
          console.log(`[espn prospects] core API got ${prospects.length} from ${url.replace(/^.*espn\.com/, '')}`);
          return prospects;
        }
      }
    } catch (e) {
      console.warn('[espn prospects] core strategy failed:', e.message);
    }
  }

  // Strategy B: site API variants — speculative
  const apiUrls = [
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/draft/prospects?year=${year}&limit=${limit}`,
    `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/draft/prospects?year=${year}&limit=${limit}`,
    `https://site.web.api.espn.com/apis/v3/sports/football/nfl/draft/prospects?year=${year}&limit=${limit}`,
    // Reuse the working scoreboard/header endpoint — it might have prospects
    // tucked somewhere we didn't look.
    `https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=football&league=nfl&draft_year=${year}&draft_round=1`,
  ];

  for (const url of apiUrls) {
    try {
      const data = await fetchJson(url);
      logRawOnce(`prospects ${year} @ ${url.replace(/^.*espn\.com/, '')}`, data);

      // Check well-known top-level keys first
      const knownKeys = [
        data?.prospects,
        data?.items,
        data?.athletes,
        data?.results,
        data?.rankings,
        data?.data,
        data?.bestAvailable,
        data?.sports?.[0]?.leagues?.[0]?.draft?.prospects,
        data?.sports?.[0]?.leagues?.[0]?.draft?.bestAvailable,
      ].filter(Array.isArray);

      for (const arr of knownKeys) {
        const flat = arr.filter((x) => x && typeof x === 'object' && !x.$ref);
        if (flat.length >= 10) {
          const prospects = flat.map((raw, i) => normalizeProspect(raw, i + 1)).filter(Boolean);
          if (prospects.length > 0) {
            console.log(`[espn prospects] found ${prospects.length} in known key at ${url.replace(/^.*espn\.com/, '')}`);
            return prospects;
          }
        }
      }

      // Deep-walk fallback
      const found = findProspectArrays(data);
      for (const arr of found) {
        const prospects = arr.map((raw, i) => normalizeProspect(raw, i + 1)).filter(Boolean);
        if (prospects.length >= 10) {
          console.log(`[espn prospects] deep-walk found ${prospects.length} at ${url.replace(/^.*espn\.com/, '')}`);
          return prospects;
        }
      }
    } catch (e) {
      console.warn('[espn prospects] api strategy failed:', e.message);
    }
  }

  // Strategy B: scrape ESPN's public draft prospects HTML page.
  // ESPN's Next.js pages ship full data in <script id="__NEXT_DATA__"> —
  // pulling that and walking it usually works even when no JSON API is public.
  const htmlUrls = [
    `https://www.espn.com/nfl/draft/prospects`,
    `https://www.espn.com/nfl/draft/rankings`,
    `https://www.espn.com/nfl/draft/bestavailable`,
  ];

  for (const url of htmlUrls) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      });
      if (!r.ok) continue;
      const html = await r.text();

      // Common embedded JSON patterns on ESPN pages:
      //   <script id="__NEXT_DATA__" type="application/json">{...}</script>
      //   window.espn.data = {...};
      //   <script>window.__ESPN_DATA__ = {...}</script>
      const patterns = [
        /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
        /window\.espn\.data\s*=\s*(\{[\s\S]*?\});/,
        /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/,
        /window\.__ESPN_DATA__\s*=\s*(\{[\s\S]*?\});/,
      ];

      for (const re of patterns) {
        const m = html.match(re);
        if (!m) continue;
        try {
          const data = JSON.parse(m[1]);
          logRawOnce(`prospects html ${url.replace(/^.*espn\.com/, '')}`, data);
          const found = findProspectArrays(data);
          for (const arr of found) {
            const prospects = arr.map((raw, i) => normalizeProspect(raw, i + 1)).filter(Boolean);
            if (prospects.length >= 10) {
              console.log(`[espn prospects] html scrape got ${prospects.length} from ${url}`);
              return prospects;
            }
          }
        } catch (e) {
          console.warn('[espn prospects] html parse error:', e.message);
        }
      }
    } catch (e) {
      console.warn('[espn prospects] html strategy failed:', e.message);
    }
  }

  return [];
}

// Sleeper has a fully-documented public API. `/v1/players/nfl` returns every
// player in their DB keyed by player_id. We filter down to likely draft-
// eligible college players (no NFL team assigned, rookie years_exp, in an
// Active status) and return the top N.
async function fetchProspectsFromSleeper(limit) {
  try {
    const r = await fetch('https://api.sleeper.app/v1/players/nfl', {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (!data || typeof data !== 'object') return [];

    const candidates = Object.values(data).filter(
      (p) =>
        p &&
        typeof p === 'object' &&
        p.full_name &&
        p.position &&
        p.college &&
        // No NFL team yet (draft-eligible or undrafted rookie)
        !p.team &&
        (p.years_exp === 0 || p.years_exp == null) &&
        p.status !== 'Inactive'
    );

    logRawOnce('prospects sleeper', { count: candidates.length, sample: candidates.slice(0, 3) });

    const prospects = candidates
      .map((p) => ({
        name: p.full_name,
        position: Array.isArray(p.fantasy_positions) ? p.fantasy_positions[0] : p.position,
        school: p.college,
        headshot_url: null,
        rank: p.search_rank || null,
      }))
      .filter((p) => p.name && p.position)
      .sort((a, b) => (a.rank || 99999) - (b.rank || 99999))
      .slice(0, limit);

    console.log(`[sleeper prospects] returned ${prospects.length} candidates`);
    return prospects;
  } catch (e) {
    console.warn('[sleeper prospects] failed:', e.message);
    return [];
  }
}

export async function fetchProspects(year, limit = 400) {
  const fromEspn = await fetchProspectsFromEspnAttempts(year, limit);
  if (fromEspn.length > 0) return fromEspn;
  console.log('[prospects] ESPN strategies returned 0; falling back to Sleeper');
  return fetchProspectsFromSleeper(limit);
}

export function resetLogFlag() {
  loggedRaw = false;
}
