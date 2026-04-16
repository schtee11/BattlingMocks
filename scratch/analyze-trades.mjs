// Parses 2025 NFL draft trade data and produces distribution analysis used
// to calibrate the bot trade proposer.
//
// Usage: node scratch/analyze-trades.mjs

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const csv = readFileSync(join(__dirname, '..', 'trade_data_2025.csv'), 'utf8');
const chart = JSON.parse(
  readFileSync(join(__dirname, '..', 'client', 'src', 'lib', 'tradeValues2026.json'), 'utf8')
);
const chartMap = new Map(chart.map((r) => [r.pick, r.value]));
const chartGet = (n) => chartMap.get(n) ?? 0;

// Future pick fallback values (one-round discount).
const FUTURE_VAL = { 1: 128, 2: 65, 3: 32, 4: 16, 5: 8, 6: 4, 7: 2 };

// Extract every "Traded X to Y for Z on DATE" line.
const tradeLines = csv.split(/\r?\n/).filter((l) => l.includes('Traded '));

// Parse one trade line: returns { sent, received, toTeam, date } or null.
function parseTrade(line) {
  // Normalize bullets + NBSP — the CSV uses ?, •, and \u00a0 interchangeably.
  const clean = line.replace(/[\u00a0\u2022?]/g, '|').replace(/\|+/g, '|');
  // Shape: "Traded |picks_sent| to TEAM for |picks_received| on YYYY-MM-DD"
  const m = clean.match(/Traded\s*\|(.+?)\s*to\s+(\w[\w ]*?)\s+for\s*\|(.+?)\s*on\s+(\d{4}-\d{2}-\d{2})/);
  if (!m) return null;
  const [, sentStr, toTeam, recvStr, date] = m;
  const sent = parsePicks(sentStr);
  const received = parsePicks(recvStr);
  return { sent, received, toTeam: toTeam.trim(), date };
}

// Parse pick list separated by |. Handles current-year (with pick #) and
// future-year (pick # unknown, just year+round).
function parsePicks(str) {
  const parts = str.split('|').map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    // "2025 first round pick (#5-Mason Graham)" → {year:2025, round:1, pick:5}
    // "2026 first round pick (?-?)" → {year:2026, round:1, pick:null}
    const yrMatch = p.match(/(\d{4})\s+(first|second|third|fourth|fifth|sixth|seventh)\s+round/i);
    if (!yrMatch) continue;
    const ROUND = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7 };
    const year = parseInt(yrMatch[1], 10);
    const round = ROUND[yrMatch[2].toLowerCase()];
    const pickMatch = p.match(/#(\d+)/);
    const pick = pickMatch ? parseInt(pickMatch[1], 10) : null;
    out.push({ year, round, pick });
  }
  return out;
}

// Pick chart value. Future picks use FUTURE_VAL.
function valueOf(p) {
  if (p.year === 2025 && p.pick) return chartGet(p.pick);
  if (p.year > 2025) return FUTURE_VAL[p.round] ?? 0;
  return 0;
}

function sumValue(picks) {
  return picks.reduce((s, p) => s + valueOf(p), 0);
}

// Parse + dedupe. Each real trade appears twice (perspective from each team).
// We canonicalize by sorting pick tuples and keep only unique entries.
const parsed = [];
for (const line of tradeLines) {
  const t = parseTrade(line);
  if (t) parsed.push(t);
}

const seen = new Set();
const trades = [];
for (const t of parsed) {
  // Canonical key: sorted picks from both sides + date.
  const key = [
    ...t.sent.map((p) => `${p.year}-${p.round}-${p.pick ?? 0}`).sort(),
    '::',
    ...t.received.map((p) => `${p.year}-${p.round}-${p.pick ?? 0}`).sort(),
    '::',
    t.date,
  ].join('|');
  const mirrorKey = [
    ...t.received.map((p) => `${p.year}-${p.round}-${p.pick ?? 0}`).sort(),
    '::',
    ...t.sent.map((p) => `${p.year}-${p.round}-${p.pick ?? 0}`).sort(),
    '::',
    t.date,
  ].join('|');
  if (seen.has(key) || seen.has(mirrorKey)) continue;
  seen.add(key);
  trades.push(t);
}

console.log(`Parsed ${parsed.length} trade lines → ${trades.length} unique trades\n`);

// For each trade, figure out who moved up. The mover-up is whoever
// RECEIVED the lower pick number (higher value). "Distance" = how many
// spots they jumped to get there.
const analyzed = [];
for (const t of trades) {
  const sent2025 = t.sent.filter((p) => p.year === 2025 && p.pick);
  const recv2025 = t.received.filter((p) => p.year === 2025 && p.pick);
  if (sent2025.length === 0 || recv2025.length === 0) continue;

  const topSent = Math.min(...sent2025.map((p) => p.pick));
  const topRecv = Math.min(...recv2025.map((p) => p.pick));
  // `t.toTeam` is the OTHER team (the receiver of `sent`).
  // If topRecv < topSent, the SENDING team moved UP (they got a higher pick).
  const sendingTeamMovedUp = topRecv < topSent;
  const distance = Math.abs(topRecv - topSent);

  const moverPicksSent = sendingTeamMovedUp ? t.sent : t.received;
  const moverPicksRecv = sendingTeamMovedUp ? t.received : t.sent;
  const moverOwnPick = sendingTeamMovedUp ? topSent : topRecv;      // what they gave up
  const moverGotPick = sendingTeamMovedUp ? topRecv : topSent;       // what they got

  // Round bucket — only analyze trades where the MAIN pick being moved
  // into is a round-1 or round-2 pick (where most calibration matters).
  const moverGotRound = recv2025.find((p) => p.pick === moverGotPick)?.round ?? 99;

  const sweetenerValue = sumValue(moverPicksSent) - valueOf({ year: 2025, pick: moverOwnPick });
  const recvValue = sumValue(moverPicksRecv);
  const theirSide = recvValue;
  const yourSide = sumValue(moverPicksSent);
  // Surplus to the MOVER-DOWN team (the one receiving the package).
  const moverDownSurplus = yourSide - theirSide;
  const moverDownSurplusPct = theirSide > 0 ? (moverDownSurplus / theirSide) * 100 : 0;

  // Number of future picks included in the mover-up's package.
  const futuresInPackage = moverPicksSent.filter((p) => p.year > 2025);

  analyzed.push({
    date: t.date,
    moverGotPick,
    moverOwnPick,
    distance,
    moverGotRound,
    packageSize: moverPicksSent.length,
    futuresCount: futuresInPackage.length,
    futuresDetail: futuresInPackage.map((p) => `${p.year}-R${p.round}`).join('+'),
    yourSide,
    theirSide,
    moverDownSurplus,
    moverDownSurplusPct,
  });
}

// Helper — percentile of a numeric array.
const pct = (arr, p) => {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((sorted.length - 1) * p);
  return sorted[idx];
};

function summarize(label, filter) {
  const subset = analyzed.filter(filter);
  if (subset.length === 0) {
    console.log(`${label}: 0 trades\n`);
    return;
  }
  const distances = subset.map((t) => t.distance);
  const pkgSizes = subset.map((t) => t.packageSize);
  const futureCount = subset.filter((t) => t.futuresCount > 0).length;
  const surplus = subset.map((t) => t.moverDownSurplusPct);

  console.log(`── ${label} (n=${subset.length}) ──`);
  console.log(`  distance (spots moved up):  p25=${pct(distances, 0.25)}  p50=${pct(distances, 0.5)}  p75=${pct(distances, 0.75)}  max=${Math.max(...distances)}`);
  console.log(`  package size (# picks):     p25=${pct(pkgSizes, 0.25)}  p50=${pct(pkgSizes, 0.5)}  p75=${pct(pkgSizes, 0.75)}  max=${Math.max(...pkgSizes)}`);
  console.log(`  trades with future pick:    ${futureCount}/${subset.length} (${Math.round((futureCount / subset.length) * 100)}%)`);
  console.log(`  surplus % (mover-down):     p25=${pct(surplus, 0.25).toFixed(1)}  p50=${pct(surplus, 0.5).toFixed(1)}  p75=${pct(surplus, 0.75).toFixed(1)}`);
  console.log('');
}

summarize('All analyzed 2025 trades', () => true);
summarize('R1 → R1 (mover got R1 pick)', (t) => t.moverGotRound === 1);
summarize('R2 → R2 (mover got R2 pick)', (t) => t.moverGotRound === 2);
summarize('Round 3+', (t) => t.moverGotRound >= 3);
summarize('Small moves (distance ≤ 5)', (t) => t.distance <= 5);
summarize('Medium moves (distance 6-15)', (t) => t.distance > 5 && t.distance <= 15);
summarize('Big moves (distance > 15)', (t) => t.distance > 15);

console.log('── Sample of R1 trades (chronological) ──');
for (const t of analyzed.filter((x) => x.moverGotRound === 1).slice(0, 12)) {
  console.log(
    `  #${t.moverOwnPick} → #${t.moverGotPick} (+${t.distance} spots)  pkg=${t.packageSize}  futures=${t.futuresDetail || 'none'}  surplus=${t.moverDownSurplusPct.toFixed(1)}%`
  );
}
