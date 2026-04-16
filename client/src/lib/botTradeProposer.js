// Bot trade proposer.
//
// When the user is on the clock in team_mock, real-world GMs would receive
// trade-up offers from teams picking shortly after. This module assesses
// each near-future bot team and returns the trade offers they'd propose.
//
// Design goals:
//   - NEEDS-AWARE: a bot only proposes a trade-up if there's a player it
//     genuinely wants who's at risk of being gone before its real pick.
//   - TIER-AWARE: a "tier drop" between the user's slot and the bot's slot
//     amplifies urgency (e.g. five elite WRs left, all five are gone after
//     the user picks → bot panics and offers more).
//   - FAIR-ZONE: every accepted offer falls within 5–7% of chart fair value
//     (slightly favouring the user as a gentle inducement), never a steal
//     for the user and never a lowball from the bot. This matches the
//     tradeBasePremium / tradeTop5Bonus already used in TradeModal.
//   - DETERMINISTIC SHAPE: the offer's pick package is computed from the
//     value gap and the bot's own future capital — no random chip-tossing.
//
// We deliberately do NOT roll acceptance probability here — these are
// offers TO the user. The user accepts/rejects them through the UI; the
// "fair-zone" framing means they're already pre-vetted to be reasonable.

import tradeValuesChart from './tradeValues2026.json';
import { getAlgoConfig } from './algoConfig.js';
import { pickForTeam, normalizePos } from './botPicker.js';
import { futurePicksForTeam } from './futurePicks.js';

// How far ahead to look for trade-up candidates. Calibrated against the
// 2025 NFL draft trades dataset (see scratch/analyze-trades.mjs). Real R1
// trade-ups ranged 1-20 spots with a median of 3; R2-to-R1 jumps (HOU #34
// → #25, ATL #46 → #26) were both inside 24 spots. Going wider than 24
// starts capturing trade shapes a bot couldn't realistically finance.
const MAX_LOOKAHEAD_PICKS = 24;

// Maximum number of distinct offers to surface at one time. Two-or-three
// gives the user a real choice without overwhelming the on-clock UI.
const MAX_OFFERS = 3;

// "Tier drop" detection — if among the top-K candidates at the bot's needed
// position, M of them get picked between the user's slot and the bot's
// real slot, the bot perceives a cliff and is willing to deal.
const TIER_LOOKAHEAD_K = 5;
const TIER_DROP_THRESHOLD = 2;

// Minimum urgency to make an offer. Lowered slightly so middle-of-round
// teams can still propose when they have a clear positional target —
// previously the 0.35 floor required either tier-drop OR top-need match
// to fire, which made offers very rare in practice.
const URGENCY_FLOOR = 0.25;

// Diagnostic logging — flip on in the browser console with
//   window.__btDebug = true
// then re-enter the on-clock state. Logs every step of the decision tree
// for each candidate bot team so we can see exactly why offers do/don't
// fire.
function dbg(...args) {
  if (typeof window !== 'undefined' && window.__btDebug) {
    // eslint-disable-next-line no-console
    console.log('[botTradeProposer]', ...args);
  }
}

// Build a chart lookup once per call.
function buildValueLookup() {
  const m = new Map();
  for (const r of tradeValuesChart) m.set(r.pick, r.value);
  return (pick) => m.get(pick) ?? 0;
}

// Sum a list of pick ids. Numeric → chart value. String → ownership row.
function sumValue(ids, chartGet, futureOwnership) {
  let total = 0;
  for (const id of ids) {
    if (typeof id === 'number') total += chartGet(id);
    else if (futureOwnership && futureOwnership.has(id)) {
      total += futureOwnership.get(id).value || 0;
    }
  }
  return total;
}

// Build the "best package" the bot can offer to reach a target value, using
// its own remaining current-year picks (other than the one it's trading up
// FROM) plus its 2027 capital.
//
// Shape preference is ROUND-AWARE — the 2023-2025 dataset (see
// scratch/analyze-trades.mjs) shows the canonical trade-up shape varies
// dramatically by the round of the pick the bot is moving up INTO:
//
//   Round 1: median 3-piece package, 44% include a future pick
//   Round 2: median 2-piece package, only  7% include a future pick
//   Round 3: median 2-piece package, 24% include a future pick
//   Round 4+: median 2-piece package, 11% include a future pick
//
// So we prefer the (current + future) pair ONLY when the bot is trading
// up for an R1 slot. R2+ gets single-piece-first, because padding those
// with a future pick creates shapes that essentially never happen IRL.
//
// Returns { picks, total } or null if no realistic package fits.
function buildOfferPackage({
  botTeam,
  botPick,           // the bot's "real" upcoming pick (the lowest-numbered
                     //   future slot they own — that's their best leverage)
  botRound,          // round of botPick (1..7). Gates the pair-vs-single bias.
  targetValue,       // value the bot needs to send to the user
  liveOrder,
  picksMadeCount,
  futureOwnership,
  chartGet,
}) {
  // Split candidates by source so we can intentionally pair current + future.
  const currentCandidates = [];
  const futureCandidates = [];
  for (const row of liveOrder) {
    if (row.pick_number <= picksMadeCount) continue;
    if (row.team !== botTeam) continue;
    if (row.pick_number === botPick) continue;       // we're sending the user this
    currentCandidates.push({ id: row.pick_number, value: chartGet(row.pick_number) });
  }
  if (futureOwnership) {
    for (const fp of futurePicksForTeam(futureOwnership, botTeam)) {
      futureCandidates.push({ id: fp.id, value: fp.value || 0 });
    }
  }
  // Descending sort — smallest number of pieces wins ties.
  currentCandidates.sort((a, b) => b.value - a.value);
  futureCandidates.sort((a, b) => b.value - a.value);

  const LOW = targetValue * 0.93;
  const HIGH = targetValue * 1.12;
  const closer = (a, b) => Math.abs(a - targetValue) < Math.abs(b - targetValue);

  // Canonical R1 shape: current-year sweetener + future pick. Search the
  // pair whose combined value sits closest to targetValue within the band.
  let bestPair = null;
  for (const c of currentCandidates) {
    for (const f of futureCandidates) {
      const total = c.value + f.value;
      if (total < LOW || total > HIGH) continue;
      if (!bestPair || closer(total, bestPair.total)) {
        bestPair = { picks: [c.id, f.id], total };
      }
    }
  }

  // Canonical R2+ shape: single current-year or future pick in-band.
  let bestSingle = null;
  for (const c of [...currentCandidates, ...futureCandidates]) {
    if (c.value < LOW || c.value > HIGH) continue;
    if (!bestSingle || closer(c.value, bestSingle.value)) {
      bestSingle = c;
    }
  }

  // Shape selection — R1 prefers pair, everything else prefers single.
  // Fall through to the other shape if the preferred one doesn't fit.
  const preferPair = botRound === 1;
  if (preferPair) {
    if (bestPair) return bestPair;
    if (bestSingle) return { picks: [bestSingle.id], total: bestSingle.value };
  } else {
    if (bestSingle) return { picks: [bestSingle.id], total: bestSingle.value };
    if (bestPair) return bestPair;
  }

  // Fallback — greedy fill with a HARD overshoot guard. Never push total
  // above 1.12× target, ever. The previous version allowed an initial
  // oversized dump whenever total was below 85% of target, which let bots
  // throw R1s into 3-spot-move trades (40-50% surplus, way outside the
  // 5-7% fair band).
  const allCandidates = [...currentCandidates, ...futureCandidates].sort(
    (a, b) => b.value - a.value
  );
  const picks = [];
  let total = 0;
  for (const c of allCandidates) {
    if (total >= targetValue * 0.97) break;
    if (total + c.value > HIGH) continue;
    picks.push(c.id);
    total += c.value;
  }

  // Reject offers that fall too short — better to send no offer than a
  // known lopsided lowball. Keeps surplus in the advertised 5-7% band.
  if (total < LOW) return null;
  return { picks, total };
}

// ── Tier-drop / scarcity assessment for a bot at a future slot ──────────────
//
// Returns a numeric "urgency" score 0..1 representing how badly the bot
// wants to move up — used both to gate offer generation (>0 → offer) and
// to decide HOW MUCH the bot is willing to pay (higher urgency = closer
// to the user's side of the 5–7% fair band).
function assessUrgency({
  botSlot,
  userSlot,            // user's on-clock pick (what we're assessing vs)
  available,
  picksBetween,        // bot teams picking BETWEEN the user and this bot
  draftContext,
  randomness,
}) {
  const needs = (botSlot.team_needs || []).slice(0, 3);
  if (needs.length === 0) {
    dbg('urgency=0 reason: no team_needs for', botSlot.team, 'raw=', botSlot.team_needs);
    return 0;
  }

  // Simulate what the bot would pick AT its real slot if nothing changed.
  // This is the player it most wants to lock in — and the one it's afraid
  // of losing to one of the teams picking in between.
  const wantedNow = pickForTeam({
    available,
    teamNeeds: botSlot.team_needs || [],
    randomness,
    pickNumber: botSlot.pick_number,
    draftContext,
  });
  if (!wantedNow) {
    dbg('urgency=0 reason: pickForTeam null for', botSlot.team, 'available=', available.length);
    return 0;
  }

  // What's the bot's wanted POSITION? Use the picked player's position as
  // the canonical signal — needs-priority alone is too noisy.
  const wantedPos = normalizePos(wantedNow.position || '');
  if (!wantedPos) {
    dbg('urgency=0 reason: empty wantedPos for', botSlot.team, 'player=', wantedNow?.name, 'pos=', wantedNow?.position);
    return 0;
  }

  // Tier-drop check: among the top-K available players at the wanted
  // position, how many are likely to be gone by the bot's real pick?
  // We approximate "likely to be gone" by counting how many picks in
  // between are made by teams that share the same need.
  const topAtPos = available
    .filter((p) => normalizePos(p.position) === wantedPos)
    .slice(0, TIER_LOOKAHEAD_K);
  if (topAtPos.length === 0) {
    dbg('urgency=0 reason: topAtPos empty for', botSlot.team, 'wantedPos=', wantedPos);
    return 0;
  }

  let competingPicks = 0;
  for (const slot of picksBetween) {
    const slotNeeds = (slot.team_needs || []).map((n) => normalizePos(n));
    if (slotNeeds.includes(wantedPos)) competingPicks++;
  }

  // ── Amplifiers ──────────────────────────────────────────────────────────
  //
  // 1. Scarcity — top of position is running thin.
  // 2. Competition — multiple teams in-between share the need.
  // 3. Wantedness — wanted position matches the bot's #1 need.
  // 4. BPA cliff — the player available at the USER's slot is dramatically
  //    better than what the bot expects at their own slot. This models the
  //    "player is falling, go grab him" dynamic from real draft trades (the
  //    ATL #46 → LAR #26 trade-up for Pearce Jr. was driven by this cliff).
  const scarcity = topAtPos.length <= 2 ? 0.7 : topAtPos.length <= 3 ? 0.5 : 0.3;
  const competition =
    competingPicks >= TIER_DROP_THRESHOLD ? 0.4 : competingPicks * 0.15;
  const isTopNeed = normalizePos(needs[0] || '') === wantedPos;
  const wantedness = isTopNeed ? 0.2 : 0.05;

  // BPA cliff — approximate by comparing the wantedNow rank vs the best
  // player at the same position available RIGHT NOW (user's slot).
  let bpaCliff = 0;
  if (userSlot) {
    const bestAtUserSlot = available.find((p) => normalizePos(p.position) === wantedPos);
    const nowRank = Number.isFinite(wantedNow.rank) ? wantedNow.rank : 999;
    const bestRank = Number.isFinite(bestAtUserSlot?.rank) ? bestAtUserSlot.rank : 999;
    const rankDelta = nowRank - bestRank;
    // Significant cliffs only — 15+ ranks of upgrade is "star falling to you".
    if (rankDelta >= 30) bpaCliff = 0.35;
    else if (rankDelta >= 15) bpaCliff = 0.2;
    else if (rankDelta >= 8) bpaCliff = 0.1;
  }

  return Math.min(1, scarcity + competition + wantedness + bpaCliff);
}

// ── Main entry point ────────────────────────────────────────────────────────
//
// Returns an array of trade offer objects:
//   [{
//     id,                  // stable id (botTeam-userPick) so dismissal sticks
//     botTeam,             // proposing team abbr
//     botPick,             // the pick the bot sends to the user (their slot)
//     userPick,            // the user's on-clock pick the bot wants
//     theirPicks: number[],// (legacy alias) "their" = bot, sent to user
//     yourPicks: number[], // (legacy alias) "your"  = user, sent to bot
//     summary: { yourValue, theirValue, surplusPct, urgency },
//   }, ...]
//
// `theirPicks` includes botPick; `yourPicks` is just [userPick] — that's
// the asymmetric trade-up shape the user will see ("you send your pick,
// they send theirs plus a sweetener").
export function generateBotTradeOffers({
  userTeam,
  liveOrder,
  picks,                      // already-made picks
  effectivePlayers,
  futureOwnership,
  randomness = 0.25,
  byId,
}) {
  if (!liveOrder || liveOrder.length === 0) {
    dbg('bail: no liveOrder');
    return [];
  }
  const picksMadeCount = picks.length;
  const userSlot = liveOrder[picksMadeCount];
  if (!userSlot || userSlot.team !== userTeam) {
    dbg('bail: not user on the clock', { picksMadeCount, slot: userSlot, userTeam });
    return [];
  }

  const chartGet = buildValueLookup();
  const userPickValue = chartGet(userSlot.pick_number);
  if (userPickValue <= 0) {
    dbg('bail: user pick has no chart value', userSlot.pick_number);
    return [];
  }

  dbg('on the clock', {
    userTeam,
    userPick: userSlot.pick_number,
    userPickValue,
    lookahead: MAX_LOOKAHEAD_PICKS,
    poolSize: effectivePlayers.length,
  });

  const cfg = getAlgoConfig();

  // Available player pool, identical to what the bot would see at its slot.
  const taken = new Set(picks.map((p) => p.player_id));
  const available = effectivePlayers.filter((p) => !taken.has(p.id));
  const allPlayers = effectivePlayers;

  // Look at the next N slots after the user's. Each non-user slot is a
  // candidate trader-upper. We only consider the FIRST upcoming pick per
  // bot team (their next chance to draft), since that's the leverage they'd
  // be giving up to move up.
  const seenTeams = new Set([userTeam]);
  const offers = [];

  for (
    let i = picksMadeCount + 1;
    i < Math.min(liveOrder.length, picksMadeCount + 1 + MAX_LOOKAHEAD_PICKS);
    i++
  ) {
    const botSlot = liveOrder[i];
    if (!botSlot || botSlot.team === userTeam) continue;
    if (seenTeams.has(botSlot.team)) continue;
    seenTeams.add(botSlot.team);

    const botPickValue = chartGet(botSlot.pick_number);
    if (botPickValue <= 0) {
      dbg('skip', botSlot.team, 'bot pick no chart value', botSlot.pick_number);
      continue;
    }

    // Required value the bot must send the user under chart conventions:
    //   user sends their pick → bot sends bot pick + premium-padded difference.
    // Premium matches the TradeModal's evaluator so accepted offers will
    // also pass evaluation if the user re-opens the modal to inspect.
    let premium = cfg.tradeBasePremium ?? 0.05;
    if (userSlot.pick_number <= 5) premium += cfg.tradeTop5Bonus ?? 0.03;
    const requiredFromBot = userPickValue * (1 + premium);
    const sweetenerValue = requiredFromBot - botPickValue;
    if (sweetenerValue <= 0) {
      dbg('skip', botSlot.team, 'bot pick already covers (no sweetener needed)');
      continue;
    }

    const picksBetween = liveOrder.slice(picksMadeCount + 1, i);

    const botContext = {
      allPlayers,
      teamDraftedPos: picks
        .filter((pk) => pk.team === botSlot.team)
        .map((pk) => normalizePos(byId.get(pk.player_id)?.position || '')),
      recentPicks: picks
        .slice(-(cfg.runWindowSize || 8))
        .map((pk) => ({ position: normalizePos(byId.get(pk.player_id)?.position || '') })),
    };

    const urgency = assessUrgency({
      botSlot,
      userSlot,
      available,
      picksBetween,
      draftContext: botContext,
      randomness,
    });
    dbg('urgency', botSlot.team, '@', botSlot.pick_number, '=', urgency.toFixed(2));
    if (urgency < URGENCY_FLOOR) continue;             // not worth the asset cost

    // Target sweetener value — slide between 1.0× and 1.05× of the strict
    // requirement based on urgency. High urgency = bot pays the full top
    // of the fair zone; lower urgency = bot pays the bare minimum. Both
    // are within the 5–7% fair band by construction.
    const targetValue = sweetenerValue * (1 + 0.02 + urgency * 0.04);

    const pkg = buildOfferPackage({
      botTeam: botSlot.team,
      botPick: botSlot.pick_number,
      botRound: botSlot.round,
      targetValue,
      liveOrder,
      picksMadeCount,
      futureOwnership,
      chartGet,
    });
    if (!pkg) {
      dbg('skip', botSlot.team, 'no package fits', { targetValue: Math.round(targetValue) });
      continue;
    }

    const theirPicks = [botSlot.pick_number, ...pkg.picks];
    const yourPicks = [userSlot.pick_number];

    const yourValue = userPickValue;
    const theirValue = sumValue(theirPicks, chartGet, futureOwnership);
    const surplusPct = (theirValue - requiredFromBot) / Math.max(requiredFromBot, 1);

    offers.push({
      id: `${botSlot.team}-${userSlot.pick_number}-${botSlot.pick_number}`,
      botTeam: botSlot.team,
      botPick: botSlot.pick_number,
      userPick: userSlot.pick_number,
      theirPicks,
      yourPicks,
      summary: {
        yourValue: Math.round(yourValue),
        theirValue: Math.round(theirValue),
        surplusPct: Math.round(surplusPct * 1000) / 10,  // %, 1 decimal
        urgency: Math.round(urgency * 100) / 100,
      },
    });
    // NOTE: do NOT break when offers.length >= MAX_OFFERS here. We want to
    // evaluate every bot in the lookahead window so the geographic-spread
    // selection below has real choice. Breaking early meant the three
    // closest teams always got the three slots.
  }

  // Geographic spread selection. Without this step, all three offers
  // would typically come from the teams picking immediately after the
  // user (they're evaluated first). Real-world trade-up offers come from
  // teams across the near/mid/far range, so we bucket by distance and
  // take the most urgent offer per bucket before filling any remaining
  // slots with the next most urgent offers regardless of distance.
  offers.sort((a, b) => b.summary.urgency - a.summary.urgency);
  dbg(
    'candidates (pre-spread)',
    offers.map((o) => `${o.botTeam}@${o.botPick}(u=${o.summary.urgency})`)
  );

  const bucketOf = (offer) => {
    const d = offer.botPick - offer.userPick;
    if (d <= 5) return 'near';
    if (d <= 12) return 'mid';
    return 'far';
  };

  // Pick the most urgent offer per bucket first.
  const chosen = [];
  const usedBuckets = new Set();
  for (const offer of offers) {
    if (chosen.length >= MAX_OFFERS) break;
    const bucket = bucketOf(offer);
    if (usedBuckets.has(bucket)) continue;
    usedBuckets.add(bucket);
    chosen.push(offer);
  }
  // Fill remaining slots with next most urgent, ignoring bucket.
  for (const offer of offers) {
    if (chosen.length >= MAX_OFFERS) break;
    if (chosen.includes(offer)) continue;
    chosen.push(offer);
  }

  // Within the final set, sort by urgency again so the top UI slot is
  // always the most "real" offer.
  chosen.sort((a, b) => b.summary.urgency - a.summary.urgency);
  dbg('result', chosen.length, 'offers', chosen.map((o) => `${o.botTeam}@${o.botPick}`));
  return chosen;
}
