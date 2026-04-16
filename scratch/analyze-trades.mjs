// Parses 2023, 2024, 2025 NFL draft trade data and produces distribution
// analysis used to calibrate the bot trade proposer.
//
// Usage: node scratch/analyze-trades.mjs
//
// Each trade is tagged with its source draft year so we can slice both
// cross-year and per-year. The chart is the same Rich Hill trade values
// table we use in-app — pick #1 is always worth chartValue(1), independent
// of which year the draft happened.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const chart = JSON.parse(
  readFileSync(join(ROOT, 'client', 'src', 'lib', 'tradeValues2026.json'), 'utf8')
);
const chartMap = new Map(chart.map((r) => [r.pick, r.value]));
const chartGet = (n) => chartMap.get(n) ?? 0;

// Future pick fallback values (one-round discount). Used when a trade
// references a pick in a year beyond the current draft — exact pick number
// is unknown so we value by round only.
const FUTURE_VAL = { 1: 128, 2: 65, 3: 32, 4: 16, 5: 8, 6: 4, 7: 2 };

const YEARS = [2023, 2024, 2025];

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

// Pick chart value. Current-year picks with known number use chart; future
// picks use the round-based fallback.
function valueOf(p, currentYear) {
  if (p.year === currentYear && p.pick) return chartGet(p.pick);
  if (p.year > currentYear) return FUTURE_VAL[p.round] ?? 0;
  return 0;
}

function sumValue(picks, currentYear) {
  return picks.reduce((s, p) => s + valueOf(p, currentYear), 0);
}

// Canonicalize + dedupe trades for a single year. Each real trade appears
// twice in the source (once per team perspective); we collapse by sorted
// pick tuples + date.
function parseYear(year) {
  const csv = readFileSync(join(ROOT, `trade_data_${year}.csv`), 'utf8');
  const tradeLines = csv.split(/\r?\n/).filter((l) => l.includes('Traded '));

  const parsed = [];
  for (const line of tradeLines) {
    const t = parseTrade(line);
    if (t) parsed.push({ ...t, sourceYear: year });
  }

  const seen = new Set();
  const trades = [];
  for (const t of parsed) {
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
  return { raw: parsed.length, unique: trades };
}

// Decide who moved up in a trade, compute package/distance/surplus metrics.
function analyzeTrade(t) {
  const { sourceYear } = t;
  const sentCurrent = t.sent.filter((p) => p.year === sourceYear && p.pick);
  const recvCurrent = t.received.filter((p) => p.year === sourceYear && p.pick);
  if (sentCurrent.length === 0 || recvCurrent.length === 0) return null;

  const topSent = Math.min(...sentCurrent.map((p) => p.pick));
  const topRecv = Math.min(...recvCurrent.map((p) => p.pick));
  const sendingTeamMovedUp = topRecv < topSent;
  const distance = Math.abs(topRecv - topSent);

  const moverPicksSent = sendingTeamMovedUp ? t.sent : t.received;
  const moverPicksRecv = sendingTeamMovedUp ? t.received : t.sent;
  const moverOwnPick = sendingTeamMovedUp ? topSent : topRecv;
  const moverGotPick = sendingTeamMovedUp ? topRecv : topSent;

  const moverGotRound = recvCurrent.find((p) => p.pick === moverGotPick)?.round
    ?? sentCurrent.find((p) => p.pick === moverGotPick)?.round
    ?? 99;

  const yourSide = sumValue(moverPicksSent, sourceYear);
  const theirSide = sumValue(moverPicksRecv, sourceYear);
  const moverDownSurplus = yourSide - theirSide;
  const moverDownSurplusPct = theirSide > 0 ? (moverDownSurplus / theirSide) * 100 : 0;

  const futuresInPackage = moverPicksSent.filter((p) => p.year > sourceYear);

  return {
    year: sourceYear,
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
  };
}

// Run the pipeline.
const perYearCounts = [];
const analyzed = [];
for (const year of YEARS) {
  const { raw, unique } = parseYear(year);
  const yearAnalyzed = unique.map(analyzeTrade).filter(Boolean);
  perYearCounts.push({ year, raw, unique: unique.length, analyzed: yearAnalyzed.length });
  analyzed.push(...yearAnalyzed);
}

console.log('── Source sizes ──');
for (const r of perYearCounts) {
  console.log(`  ${r.year}: ${r.raw} trade lines → ${r.unique} unique trades → ${r.analyzed} analyzable`);
}
console.log(`  TOTAL: ${analyzed.length} analyzable trades across ${YEARS.length} drafts\n`);

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

summarize('All analyzed trades (2023-2025)', () => true);
for (const y of YEARS) summarize(`${y} only`, (t) => t.year === y);
summarize('R1 → R1 (mover got R1 pick)', (t) => t.moverGotRound === 1);
summarize('R2 → R2 (mover got R2 pick)', (t) => t.moverGotRound === 2);
summarize('R3 (mover got R3 pick)', (t) => t.moverGotRound === 3);
summarize('Round 4+', (t) => t.moverGotRound >= 4);
summarize('Small moves (distance ≤ 5)', (t) => t.distance <= 5);
summarize('Medium moves (distance 6-15)', (t) => t.distance > 5 && t.distance <= 15);
summarize('Big moves (distance > 15)', (t) => t.distance > 15);

console.log('── Sample of R1 trades (chronological) ──');
for (const t of analyzed.filter((x) => x.moverGotRound === 1).slice(0, 20)) {
  console.log(
    `  [${t.year}] #${t.moverOwnPick} → #${t.moverGotPick} (+${t.distance} spots)  pkg=${t.packageSize}  futures=${t.futuresDetail || 'none'}  surplus=${t.moverDownSurplusPct.toFixed(1)}%`
  );
}

console.log('\n── Sample of R2 trades (chronological) ──');
for (const t of analyzed.filter((x) => x.moverGotRound === 2).slice(0, 15)) {
  console.log(
    `  [${t.year}] #${t.moverOwnPick} → #${t.moverGotPick} (+${t.distance} spots)  pkg=${t.packageSize}  futures=${t.futuresDetail || 'none'}  surplus=${t.moverDownSurplusPct.toFixed(1)}%`
  );
}
