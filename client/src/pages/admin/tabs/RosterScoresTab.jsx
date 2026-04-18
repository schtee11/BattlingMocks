import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { api, invalidateCache } from '../../../lib/api.js';
import { ALGO_DEFAULTS } from '../../../lib/algoConfig.js';
import { Card } from '../../../components/ui/Card.jsx';
import { Button } from '../../../components/ui/Button.jsx';
import { TeamLogo } from '../../../components/ui/TeamLogo.jsx';

// 12-position grid mirrors the heatmap sheet. NCB = nickel / slot corner,
// tracked as its own bucket for roster-context even though actual prospects
// still map to CB at pick time.
const POSITIONS = [
  ['QB',   'QB',   'Quarterback'],
  ['RB',   'RB',   'Running Back'],
  ['WR',   'WR',   'Wide Receiver'],
  ['TE',   'TE',   'Tight End'],
  ['OT',   'OT',   'Offensive Tackles'],
  ['IOL',  'IOL',  'Interior OL'],
  ['EDGE', 'PR',   'Pass Rusher'],
  ['DT',   'IDL',  'Interior DL'],
  ['LB',   'LB',   'Linebacker'],
  ['NCB',  'Nkl',  'Nickel'],
  ['CB',   'CB',   'Cornerback'],
  ['S',    'S',    'Safety'],
];

const TEAMS = [
  ['AFC', 'East',  'BUF', 'Buffalo Bills'],
  ['AFC', 'East',  'MIA', 'Miami Dolphins'],
  ['AFC', 'East',  'NE',  'New England Patriots'],
  ['AFC', 'East',  'NYJ', 'New York Jets'],
  ['AFC', 'North', 'BAL', 'Baltimore Ravens'],
  ['AFC', 'North', 'CIN', 'Cincinnati Bengals'],
  ['AFC', 'North', 'CLE', 'Cleveland Browns'],
  ['AFC', 'North', 'PIT', 'Pittsburgh Steelers'],
  ['AFC', 'South', 'HOU', 'Houston Texans'],
  ['AFC', 'South', 'IND', 'Indianapolis Colts'],
  ['AFC', 'South', 'JAX', 'Jacksonville Jaguars'],
  ['AFC', 'South', 'TEN', 'Tennessee Titans'],
  ['AFC', 'West',  'DEN', 'Denver Broncos'],
  ['AFC', 'West',  'KC',  'Kansas City Chiefs'],
  ['AFC', 'West',  'LV',  'Las Vegas Raiders'],
  ['AFC', 'West',  'LAC', 'Los Angeles Chargers'],
  ['NFC', 'East',  'DAL', 'Dallas Cowboys'],
  ['NFC', 'East',  'NYG', 'New York Giants'],
  ['NFC', 'East',  'PHI', 'Philadelphia Eagles'],
  ['NFC', 'East',  'WAS', 'Washington Commanders'],
  ['NFC', 'North', 'CHI', 'Chicago Bears'],
  ['NFC', 'North', 'DET', 'Detroit Lions'],
  ['NFC', 'North', 'GB',  'Green Bay Packers'],
  ['NFC', 'North', 'MIN', 'Minnesota Vikings'],
  ['NFC', 'South', 'ATL', 'Atlanta Falcons'],
  ['NFC', 'South', 'CAR', 'Carolina Panthers'],
  ['NFC', 'South', 'NO',  'New Orleans Saints'],
  ['NFC', 'South', 'TB',  'Tampa Bay Buccaneers'],
  ['NFC', 'West',  'ARI', 'Arizona Cardinals'],
  ['NFC', 'West',  'LAR', 'Los Angeles Rams'],
  ['NFC', 'West',  'SF',  'San Francisco 49ers'],
  ['NFC', 'West',  'SEA', 'Seattle Seahawks'],
];

// Heatmap color matching the source spreadsheet: green for high, red for low.
function scoreColor(score) {
  if (score == null || score === '') return 'bg-bg-deep text-text-muted';
  const s = Number(score);
  if (!Number.isFinite(s)) return 'bg-bg-deep text-text-muted';
  if (s >= 9) return 'bg-emerald-500/40 text-emerald-50';
  if (s >= 7) return 'bg-emerald-500/20 text-emerald-100';
  if (s >= 5) return 'bg-yellow-500/20 text-yellow-100';
  if (s >= 3) return 'bg-orange-500/30 text-orange-100';
  return 'bg-red-500/40 text-red-50';
}

export default function RosterScoresTab({ adminKey }) {
  // scores: { [teamId]: { [position]: number|'' } }
  const [scores, setScores] = useState({});
  // originals captured on load so we can diff for save (only send changed cells).
  const [original, setOriginal] = useState({});
  // Weights + max boost live in algo_config so they're tuned alongside the
  // rest of the draft engine. We edit them on this page since they're
  // conceptually paired with the 1–10 scores (weight × deficit = boost).
  const [weights, setWeights] = useState(() => ({ ...ALGO_DEFAULTS.rosterScoreWeights }));
  const [maxBoost, setMaxBoost] = useState(ALGO_DEFAULTS.rosterScoreMaxBoost);
  const [algoOrig, setAlgoOrig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [rows, storedAlgo] = await Promise.all([
        api.adminGetPositionScores(adminKey),
        api.adminGetAlgoConfig(adminKey),
      ]);
      const next = {};
      for (const [, , teamId] of TEAMS) next[teamId] = {};
      for (const r of rows) {
        if (!next[r.team_id]) next[r.team_id] = {};
        next[r.team_id][r.position] = r.score;
      }
      setScores(next);
      setOriginal(JSON.parse(JSON.stringify(next)));

      const merged = { ...ALGO_DEFAULTS, ...storedAlgo };
      const mergedWeights = {
        ...ALGO_DEFAULTS.rosterScoreWeights,
        ...(storedAlgo?.rosterScoreWeights || {}),
      };
      setWeights(mergedWeights);
      setMaxBoost(merged.rosterScoreMaxBoost);
      // Snapshot the full stored config so we can diff and preserve unrelated
      // fields (decayRate, needsBoost*, etc.) when we PUT back.
      setAlgoOrig(storedAlgo || {});
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setCell(teamId, position, raw) {
    const trimmed = String(raw).trim();
    let value = trimmed;
    if (trimmed !== '') {
      const n = parseInt(trimmed, 10);
      if (!Number.isInteger(n) || n < 1 || n > 10) return; // ignore invalid keystrokes
      value = n;
    }
    setScores((prev) => ({
      ...prev,
      [teamId]: { ...(prev[teamId] || {}), [position]: value === '' ? '' : value },
    }));
  }

  // Build the diff payload: only include cells that actually changed. Cleared
  // cells (value === '') are sent as `null` so the server deletes the row.
  const dirty = useMemo(() => {
    const payload = {};
    for (const [, , teamId, teamName] of TEAMS) {
      const curr = scores[teamId] || {};
      const orig = original[teamId] || {};
      const keys = new Set([...Object.keys(curr), ...Object.keys(orig)]);
      const delta = {};
      for (const k of keys) {
        const a = curr[k];
        const b = orig[k];
        const aNorm = a === '' || a == null ? null : a;
        const bNorm = b === '' || b == null ? null : b;
        if (aNorm !== bNorm) delta[k] = aNorm;
      }
      if (Object.keys(delta).length > 0) {
        payload[teamId] = { teamName, scores: delta };
      }
    }
    return payload;
  }, [scores, original]);

  const dirtyCount = Object.keys(dirty).length;

  // Weights/max-boost diff — avoid PUTting the algo_config unless something
  // in this page's slice actually changed.
  const algoDirty = useMemo(() => {
    if (!algoOrig) return false;
    const origWeights = {
      ...ALGO_DEFAULTS.rosterScoreWeights,
      ...(algoOrig.rosterScoreWeights || {}),
    };
    const origMax = algoOrig.rosterScoreMaxBoost ?? ALGO_DEFAULTS.rosterScoreMaxBoost;
    for (const code of Object.keys({ ...origWeights, ...weights })) {
      if (Number(origWeights[code] ?? 0).toFixed(4) !== Number(weights[code] ?? 0).toFixed(4)) return true;
    }
    if (Number(origMax).toFixed(4) !== Number(maxBoost).toFixed(4)) return true;
    return false;
  }, [weights, maxBoost, algoOrig]);

  async function save() {
    if (dirtyCount === 0 && !algoDirty) return;
    setSaving(true);
    const id = toast.loading('Saving roster scoring…');
    try {
      if (dirtyCount > 0) {
        const r = await api.adminSavePositionScores(adminKey, dirty);
        toast.dismiss(id);
        toast.success(`Scores: ${r.upserts} updated, ${r.deletes} cleared`);
      }
      if (algoDirty) {
        // Preserve the rest of algo_config — merge our edits into the stored
        // blob so decayRate, needsBoost*, trade values, etc. are untouched.
        const nextConfig = {
          ...(algoOrig || {}),
          rosterScoreWeights: { ...weights },
          rosterScoreMaxBoost: Number(maxBoost),
        };
        await api.adminSaveAlgoConfig(adminKey, nextConfig);
        invalidateCache('algo-config');
        toast.success('Weights saved — takes effect on next draft start');
      }
      await load();
    } catch (e) {
      toast.dismiss(id);
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  function setWeight(code, raw) {
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) return;
    const clamped = Math.max(0, Math.min(2, v));
    setWeights((w) => ({ ...w, [code]: clamped }));
  }

  function resetWeights() {
    setWeights({ ...ALGO_DEFAULTS.rosterScoreWeights });
    setMaxBoost(ALGO_DEFAULTS.rosterScoreMaxBoost);
  }

  // Per-team offense/defense/overall to mirror the right-side summary in the sheet.
  function summariseTeam(teamId) {
    const row = scores[teamId] || {};
    const OFF = ['QB', 'RB', 'WR', 'TE', 'OT', 'IOL'];
    const DEF = ['EDGE', 'DT', 'LB', 'NCB', 'CB', 'S'];
    const mean = (keys) => {
      const vals = keys.map((k) => Number(row[k])).filter((v) => Number.isFinite(v));
      if (vals.length === 0) return null;
      return vals.reduce((s, v) => s + v, 0) / vals.length;
    };
    const off = mean(OFF);
    const def = mean(DEF);
    const both = [off, def].filter((v) => v != null);
    const overall = both.length ? both.reduce((s, v) => s + v, 0) / both.length : null;
    return { off, def, overall };
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold text-text-primary">Roster Scores</h3>
            <p className="text-text-muted text-xs mt-0.5 max-w-2xl leading-relaxed">
              Score each team 1–10 at every position. The bot boosts picks at
              positions where a team is deficient (low score → more boost).
              Per-position weights below control how much each position
              influences the bot. Leave a cell blank for "unknown".
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={load} disabled={loading || saving}>
              Reload
            </Button>
            <Button
              size="sm"
              onClick={save}
              disabled={(dirtyCount === 0 && !algoDirty) || saving}
            >
              {saving
                ? 'Saving…'
                : dirtyCount === 0 && !algoDirty
                ? 'No changes'
                : `Save${dirtyCount ? ` ${dirtyCount} team${dirtyCount === 1 ? '' : 's'}` : ''}${algoDirty ? ' + weights' : ''}`}
            </Button>
          </div>
        </div>

        {/* Legend */}
        <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-text-muted font-mono">
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-emerald-500/40" /> 9–10 Elite</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-emerald-500/20" /> 7–8 Starter</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-yellow-500/20" /> 5–6 Average</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-orange-500/30" /> 3–4 Replacement</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-red-500/40" /> 1–2 Fringe</span>
        </div>
      </Card>

      {/* Position weights + max boost — tunes the bot's reaction to the scores below */}
      <Card className="p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div>
            <div className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Position weights</div>
            <p className="text-text-muted text-[11px] mt-1 max-w-2xl leading-relaxed">
              0.0–2.0 per position. A deficient position (score 1) at weight 1.0
              applies the full max boost; lower weight = that position matters
              less to draft priority.
            </p>
          </div>
          <label className="flex items-center gap-2 text-[11px] text-text-secondary">
            <span>Max boost ×</span>
            <input
              type="number"
              step={0.01}
              min={1}
              max={3}
              value={maxBoost}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v)) setMaxBoost(Math.max(1, Math.min(3, v)));
              }}
              className="w-20 bg-bg-deep border border-border-focus rounded px-2 py-1 text-text-primary text-xs font-mono text-right"
            />
            <Button size="xs" variant="ghost" onClick={resetWeights}>Reset</Button>
          </label>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
          {POSITIONS.map(([code, label, full]) => (
            <label key={code} className="flex items-center justify-between gap-2 bg-bg-deep/60 rounded px-2 py-1.5" title={full}>
              <span className="text-[11px] text-text-secondary font-mono">{label}</span>
              <input
                type="number"
                step={0.05}
                min={0}
                max={2}
                value={weights[code] ?? 0}
                onChange={(e) => setWeight(code, e.target.value)}
                className="w-14 bg-bg-deep border border-border-focus rounded px-1.5 py-0.5 text-text-primary text-[11px] font-mono text-right"
              />
            </label>
          ))}
        </div>
      </Card>

      <Card className="p-0 overflow-x-auto">
        <table className="w-full text-[12px] border-collapse">
          <thead className="sticky top-0 bg-bg-surface z-10">
            <tr className="text-left caption">
              <th className="px-2 py-2 font-display w-[140px] sticky left-0 bg-bg-surface z-20">Team</th>
              {POSITIONS.map(([code, label, full]) => (
                <th
                  key={code}
                  className="px-1 py-2 font-display text-center text-[10px] tracking-wide"
                  title={full}
                >
                  {label}
                </th>
              ))}
              <th className="px-2 py-2 font-display text-center text-[10px]">Off</th>
              <th className="px-2 py-2 font-display text-center text-[10px]">Def</th>
              <th className="px-2 py-2 font-display text-center text-[10px]">Overall</th>
            </tr>
          </thead>
          <tbody>
            {TEAMS.map(([, , teamId, teamName], idx) => {
              const sum = summariseTeam(teamId);
              const row = scores[teamId] || {};
              return (
                <tr
                  key={teamId}
                  className={`border-t border-border-subtle ${idx % 2 ? 'bg-white/[0.02]' : ''}`}
                >
                  <td className="px-2 py-1 sticky left-0 bg-bg-surface z-10">
                    <div className="flex items-center gap-2">
                      <TeamLogo abbr={teamId} size="xs" />
                      <span className="text-text-secondary text-[11px] truncate">{teamName}</span>
                    </div>
                  </td>
                  {POSITIONS.map(([code]) => {
                    const val = row[code] ?? '';
                    return (
                      <td key={code} className="px-0.5 py-0.5 text-center">
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={val}
                          onChange={(e) => setCell(teamId, code, e.target.value)}
                          className={`w-11 h-7 rounded text-center text-[12px] font-mono border border-transparent focus:border-accent outline-none appearance-none ${scoreColor(val)}`}
                          style={{ MozAppearance: 'textfield' }}
                        />
                      </td>
                    );
                  })}
                  <td className="px-2 py-1 text-center text-text-muted font-mono text-[11px]">
                    {sum.off == null ? '—' : sum.off.toFixed(2)}
                  </td>
                  <td className="px-2 py-1 text-center text-text-muted font-mono text-[11px]">
                    {sum.def == null ? '—' : sum.def.toFixed(2)}
                  </td>
                  <td className="px-2 py-1 text-center text-text-primary font-mono text-[11px] font-semibold">
                    {sum.overall == null ? '—' : sum.overall.toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
