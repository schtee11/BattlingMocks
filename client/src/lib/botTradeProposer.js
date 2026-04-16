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
//   - VARIABLE COUNT: 0–3 offers surfaced per on-clock slot, seeded from
//     the pick number so repeated renders produce the same count. Weights
//     roughly 15 / 35 / 30 / 20 for 0 / 1 / 2 / 3 offers respectively.
//
// We deliberately do NOT roll acceptance probability for user-facing
// offers — they're already pre-vetted to be reasonable by the fair-zone
// construction, so the user makes the call. Bot-vs-bot offers (see
// generateBotToBotOffer) DO roll probability because there's no human in
// the loop to decide.

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

// Hard ceiling on simultaneous offers. The actual count shown for any
// given on-clock pick is sampled via `sampledMaxOffers()` below — this
// just caps the search effort.
const HARD_OFFER_CAP = 3;

// Weighted random in {0, 1, 2, 3} seeded deterministically by pickNumber.
// Real drafts have silent picks — the previous fixed cap of 3 made every
// on-clock moment feel scripted. These weights approximate the observed
// distribution across the 2023–2025 dataset (see scratch/analyze-trades.mjs)
// where roughly half of picks saw no trade-up contact and the rest
// clustered at 1–2 inbound calls.
//
//   0 offers : 15%  (silent pick — no one bites)
//   1 offer  : 35%  (single ring)
//   2 offers : 30%  (two callers)
//   3 offers : 20%  (busy phone — rare but real)
//
// Seeded from pickNumber so a re-render of the on-clock UI won't flip the
// count — important because unrelated state updates (search input, etc.)
// cause the generator effect to rerun.
export function sampledMaxOffers(pickNumber) {
  // Same hash pattern as tradeHash in tradeAcceptance.js — avoids pulling
  // in a PRNG dependency.
  const x = Math.sin((pickNumber || 1) * 12.9898 + 78.233) * 43758.5453;
  const r = x - Math.floor(x);                    // 0..1
  if (r < 0.15) return 0;
  if (r < 0.50) return 1;
  if (r < 0.80) return 2;
  return 3;
}

// "Tier drop" detection — if among the top-K candidates at the bot's needed
// position, M of them get picked between the user's slot and the bot's
// real slot, the bot perceives a cliff and is willing to deal.
const TIER_LOOKAHEAD_K = 5;
const TIER_DROP_THRESHOLD = 2;

// Minimum urgency to make an offer (user-facing offers). Lowered slightly
// so middle-of-round teams can still propose when they have a clear
// positional target — the user gets to accept/reject anyway, so showing
// more options is fine.
const URGENCY_FLOOR = 0.25;

// Higher bar for bot-vs-bot trades: the user isn't in the loop, so only
// genuinely strong motivation — scarcity at a top need, or a clear BPA
// cliff — should produce a swap. Tuned against the observed auto-run
// volume; 0.55 fired on most picks, 0.70 keeps it to a handful per
// round before the per-round cap even kicks in.
const BOT_BOT_URGENCY_FLOOR = 0.70;

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
// Returns { urgency, wantedPlayer }:
//   urgency       — 0..1 score of how badly the bot wants to move up.
//   wantedPlayer  — the specific player the bot is worried about losing;
//                   surfaced in toasts ("X traded up for Y") so the user can
//                   see the realistic motive, not just an abstract score.
function assessUrgency({
  botSlot,
  userSlot,            // user's on-clock pick (what we're assessing vs)
  available,
  picksBetween,        // bot teams picking BETWEEN the user and this bot
  draftContext,
  randomness,
}) {
  const EMPTY = { urgency: 0, wantedPlayer: null };
  const needs = (botSlot.team_needs || []).slice(0, 3);
  if (needs.length === 0) {
    dbg('urgency=0 reason: no team_needs for', botSlot.team, 'raw=', botSlot.team_needs);
    return EMPTY;
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
    return EMPTY;
  }

  // What's the bot's wanted POSITION? Use the picked player's position as
  // the canonical signal — needs-priority alone is too noisy.
  const wantedPos = normalizePos(wantedNow.position || '');
  if (!wantedPos) {
    dbg('urgency=0 reason: empty wantedPos for', botSlot.team, 'player=', wantedNow?.name, 'pos=', wantedNow?.position);
    return EMPTY;
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
    return EMPTY;
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

  return {
    urgency: Math.min(1, scarcity + competition + wantedness + bpaCliff),
    wantedPlayer: wantedNow,
  };
}

// ── Seller reluctance ──────────────────────────────────────────────────────
//
// The mirror of assessUrgency, but from the on-clock (selling) team's POV:
// "how much do I want to STAY and pick here?" Used to gate trade-down
// acceptance so teams with a top-need star available at a premium slot
// don't swap their pick for a value-chart surplus.
//
// Returns a 0..0.95 score. 0.95 is the hard cap — even the most obvious
// hold-the-pick scenarios leave a sliver of room for a completely lopsided
// overpay (preserves the theoretical possibility without making it common).
//
// Signals, all derived from existing data:
//   1. star-at-need   — the player the seller would pick now is top-32 and
//                       matches one of their top-3 needs.
//   2. top-need bonus — that wanted position is specifically need #1.
//   3. premium slot   — top-5, top-10, or top-20 pick slots are rarely moved.
//   4. scarcity       — only 1–2 players at the wanted position left in
//                       top-32, so moving back risks losing them entirely.
//
// LV-at-#1 worked example: 0.5 (rank-1 QB as need) + 0.15 (top need) +
// 0.25 (pick #1 ≤ 5) + 0.15 (scarcity — usually 1 elite QB) = 1.05 → 0.95.
export function assessSellerReluctance({
  sellerSlot,
  available,
  picks = [],
  byId,
  effectivePlayers,
  randomness = 0.25,
}) {
  if (!sellerSlot || !Array.isArray(sellerSlot.team_needs)) return 0;
  const needs = sellerSlot.team_needs.slice(0, 3).map((n) => normalizePos(n));
  if (needs.length === 0) return 0;

  const cfg = getAlgoConfig();
  const sellerContext = {
    allPlayers: effectivePlayers || available,
    teamDraftedPos: picks
      .filter((pk) => pk.team === sellerSlot.team)
      .map((pk) => normalizePos(byId?.get(pk.player_id)?.position || '')),
    recentPicks: picks
      .slice(-(cfg.runWindowSize || 8))
      .map((pk) => ({ position: normalizePos(byId?.get(pk.player_id)?.position || '') })),
  };

  const wantedNow = pickForTeam({
    available,
    teamNeeds: sellerSlot.team_needs,
    randomness,
    pickNumber: sellerSlot.pick_number,
    draftContext: sellerContext,
  });
  if (!wantedNow) return 0;

  const wantedPos = normalizePos(wantedNow.position || '');
  const needIdx = wantedPos ? needs.indexOf(wantedPos) : -1;
  const isAnyNeed = needIdx >= 0;
  const isTopNeed = needIdx === 0;
  const wantedRank = Number.isFinite(wantedNow.rank) ? wantedNow.rank : 999;

  let reluctance = 0;

  // 1. Star-at-need — the cornerstone signal. Only counts if the wanted
  //    player also fills a need; a falling top player at a non-need slot
  //    is a reason to trade DOWN, not up, so doesn't anchor the seller.
  if (isAnyNeed) {
    if (wantedRank <= 10) reluctance += 0.5;
    else if (wantedRank <= 20) reluctance += 0.3;
    else if (wantedRank <= 32) reluctance += 0.15;
  }

  // 2. Top-need bonus — the #1 slot in team_needs array gets extra weight
  //    because it's the most critical hole on the roster.
  if (isTopNeed) reluctance += 0.15;

  // 3. Premium slot — top picks are cultural anchors; franchises almost
  //    never move back from them. Weighted heavily so a clear top-need
  //    star at a premium pick definitely clears the 0.8 block threshold
  //    even when the position pool is deep (scarcity = 0).
  const n = sellerSlot.pick_number;
  if (n <= 3) reluctance += 0.45;
  else if (n <= 5) reluctance += 0.35;
  else if (n <= 10) reluctance += 0.25;
  else if (n <= 20) reluctance += 0.10;

  // 4. Scarcity at wanted position — if only 1–2 top-32 players at this
  //    position remain, moving back likely means losing them entirely.
  if (isAnyNeed && wantedPos) {
    const elitePeers = available.filter((p) =>
      normalizePos(p.position) === wantedPos &&
      Number.isFinite(p.rank) && p.rank <= 32
    ).length;
    if (elitePeers <= 1) reluctance += 0.15;
    else if (elitePeers <= 2) reluctance += 0.08;
  }

  const capped = Math.min(0.95, reluctance);
  dbg(
    'reluctance', sellerSlot.team, '@', sellerSlot.pick_number,
    '=', capped.toFixed(2),
    'wanted=', wantedNow?.name, `(${wantedPos}#${wantedRank})`,
    'needIdx=', needIdx
  );
  return capped;
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

  // Sample today's offer count. Zero = silent pick, no work to do.
  const offerCap = sampledMaxOffers(userSlot.pick_number);
  if (offerCap === 0) {
    dbg('silent pick (sampled 0 offers) for', userSlot.pick_number);
    return [];
  }

  // Seller-reluctance gate — if the user team obviously shouldn't move back
  // (e.g. pick #1 with a franchise QB available and QB as top need), bots
  // wouldn't even call. Threshold is slightly more eager than the bot-vs-bot
  // hard-block (0.9) because the user doesn't benefit from seeing offers
  // they'd dismiss on sight.
  const taken = new Set(picks.map((p) => p.player_id));
  const available = effectivePlayers.filter((p) => !taken.has(p.id));
  const sellerReluctance = assessSellerReluctance({
    sellerSlot: userSlot,
    available,
    picks,
    byId,
    effectivePlayers,
    randomness,
  });
  if (sellerReluctance >= 0.8) {
    dbg('reluctance gate: user team anchored, suppressing offers', sellerReluctance);
    return [];
  }

  dbg('on the clock', {
    userTeam,
    userPick: userSlot.pick_number,
    userPickValue,
    lookahead: MAX_LOOKAHEAD_PICKS,
    offerCap,
    poolSize: effectivePlayers.length,
  });

  const cfg = getAlgoConfig();

  // `taken` and `available` already computed above for the reluctance gate.
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

    const { urgency, wantedPlayer } = assessUrgency({
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
      wantedPlayer: wantedPlayer ? {
        id: wantedPlayer.id,
        name: wantedPlayer.name,
        position: wantedPlayer.position,
      } : null,
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

  // Pick the most urgent offer per bucket first — but never exceed the
  // per-pick sampled cap (0..3). HARD_OFFER_CAP bounds the search just in
  // case sampledMaxOffers ever returns something larger.
  const effectiveCap = Math.min(offerCap, HARD_OFFER_CAP);
  const chosen = [];
  const usedBuckets = new Set();
  for (const offer of offers) {
    if (chosen.length >= effectiveCap) break;
    const bucket = bucketOf(offer);
    if (usedBuckets.has(bucket)) continue;
    usedBuckets.add(bucket);
    chosen.push(offer);
  }
  // Fill remaining slots with next most urgent, ignoring bucket.
  for (const offer of offers) {
    if (chosen.length >= effectiveCap) break;
    if (chosen.includes(offer)) continue;
    chosen.push(offer);
  }

  // Within the final set, sort by urgency again so the top UI slot is
  // always the most "real" offer.
  chosen.sort((a, b) => b.summary.urgency - a.summary.urgency);
  dbg('result', chosen.length, 'offers', chosen.map((o) => `${o.botTeam}@${o.botPick}`));
  return chosen;
}

// ── Bot-vs-bot offer generation ──────────────────────────────────────────────
//
// When a bot is on the clock during auto-run, real-world GMs field calls
// from teams behind them wanting to move up. We reuse the same candidate
// evaluation (assessUrgency + buildOfferPackage) but:
//
//   1. the "seller" (on-clock team) is a bot, not the user,
//   2. we return only ONE offer — the most urgent candidate — because
//      this is a yes/no decision, not a presented menu,
//   3. acceptance is rolled elsewhere (tradeAcceptance.acceptanceProbability
//      + tradeHash) — this function's job is just to build the best
//      available proposal.
//
// Returns `{ offer }` | `null` — the object wraps so we can evolve the
// return shape without callers breaking.
export function generateBotToBotOffer({
  onClockTeam,
  liveOrder,
  picks,
  effectivePlayers,
  futureOwnership,
  randomness = 0.25,
  byId,
  excludeTeams = [],           // buyer must not be one of these (e.g. the user)
}) {
  if (!liveOrder || liveOrder.length === 0) return null;
  const picksMadeCount = picks.length;
  const sellerSlot = liveOrder[picksMadeCount];
  if (!sellerSlot || sellerSlot.team !== onClockTeam) return null;

  const chartGet = buildValueLookup();
  const sellerPickValue = chartGet(sellerSlot.pick_number);
  if (sellerPickValue <= 0) return null;

  const cfg = getAlgoConfig();
  const taken = new Set(picks.map((p) => p.player_id));
  const available = effectivePlayers.filter((p) => !taken.has(p.id));
  const allPlayers = effectivePlayers;

  // Scan the next MAX_LOOKAHEAD_PICKS for buyer candidates (other bots).
  const seenTeams = new Set([onClockTeam, ...excludeTeams]);
  let best = null;

  for (
    let i = picksMadeCount + 1;
    i < Math.min(liveOrder.length, picksMadeCount + 1 + MAX_LOOKAHEAD_PICKS);
    i++
  ) {
    const buyerSlot = liveOrder[i];
    if (!buyerSlot || buyerSlot.team === onClockTeam) continue;
    if (seenTeams.has(buyerSlot.team)) continue;
    seenTeams.add(buyerSlot.team);

    const buyerPickValue = chartGet(buyerSlot.pick_number);
    if (buyerPickValue <= 0) continue;

    let premium = cfg.tradeBasePremium ?? 0.05;
    if (sellerSlot.pick_number <= 5) premium += cfg.tradeTop5Bonus ?? 0.03;
    const requiredFromBuyer = sellerPickValue * (1 + premium);
    const sweetenerValue = requiredFromBuyer - buyerPickValue;
    if (sweetenerValue <= 0) continue;

    const picksBetween = liveOrder.slice(picksMadeCount + 1, i);
    const buyerContext = {
      allPlayers,
      teamDraftedPos: picks
        .filter((pk) => pk.team === buyerSlot.team)
        .map((pk) => normalizePos(byId.get(pk.player_id)?.position || '')),
      recentPicks: picks
        .slice(-(cfg.runWindowSize || 8))
        .map((pk) => ({ position: normalizePos(byId.get(pk.player_id)?.position || '') })),
    };

    const { urgency, wantedPlayer } = assessUrgency({
      botSlot: buyerSlot,
      userSlot: sellerSlot,
      available,
      picksBetween,
      draftContext: buyerContext,
      randomness,
    });
    // Bot-vs-bot trades skip the Math.random gate and instead require a
    // higher urgency bar. This produces a realistic, needs-driven volume
    // (1–3 trades per round) without the randomness making weak-motive
    // trades fire ~12% of the time regardless of fit.
    if (urgency < BOT_BOT_URGENCY_FLOOR) continue;

    const targetValue = sweetenerValue * (1 + 0.02 + urgency * 0.04);
    const pkg = buildOfferPackage({
      botTeam: buyerSlot.team,
      botPick: buyerSlot.pick_number,
      botRound: buyerSlot.round,
      targetValue,
      liveOrder,
      picksMadeCount,
      futureOwnership,
      chartGet,
    });
    if (!pkg) continue;

    const theirPicks = [buyerSlot.pick_number, ...pkg.picks];
    const yourPicks = [sellerSlot.pick_number];
    const theirValue = sumValue(theirPicks, chartGet, futureOwnership);
    const surplusPct = (theirValue - requiredFromBuyer) / Math.max(requiredFromBuyer, 1);

    const candidate = {
      id: `${buyerSlot.team}-${sellerSlot.pick_number}-${buyerSlot.pick_number}`,
      buyerTeam: buyerSlot.team,
      sellerTeam: onClockTeam,
      buyerPick: buyerSlot.pick_number,
      sellerPick: sellerSlot.pick_number,
      theirPicks,                   // buyer → seller (includes buyerPick)
      yourPicks,                    // seller → buyer (just the on-clock slot)
      wantedPlayer: wantedPlayer ? {
        id: wantedPlayer.id,
        name: wantedPlayer.name,
        position: wantedPlayer.position,
      } : null,
      summary: {
        yourValue: Math.round(sellerPickValue),
        theirValue: Math.round(theirValue),
        surplusPct: Math.round(surplusPct * 1000) / 10,
        urgency: Math.round(urgency * 100) / 100,
      },
    };
    if (!best || candidate.summary.urgency > best.summary.urgency) {
      best = candidate;
    }
  }

  return best ? { offer: best } : null;
}
