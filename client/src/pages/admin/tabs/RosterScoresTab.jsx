import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../../lib/api.js';
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const rows = await api.adminGetPositionScores(adminKey);
      const next = {};
      for (const [, , teamId] of TEAMS) next[teamId] = {};
      for (const r of rows) {
        if (!next[r.team_id]) next[r.team_id] = {};
        next[r.team_id][r.position] = r.score;
      }
      setScores(next);
      setOriginal(JSON.parse(JSON.stringify(next)));
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

  async function save() {
    if (dirtyCount === 0) return;
    setSaving(true);
    const id = toast.loading(`Saving scores for ${dirtyCount} team(s)…`);
    try {
      const r = await api.adminSavePositionScores(adminKey, dirty);
      toast.dismiss(id);
      toast.success(`Saved: ${r.upserts} updated, ${r.deletes} cleared`);
      await load();
    } catch (e) {
      toast.dismiss(id);
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
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
              Score each team 1–10 at every position. The bot uses these to
              boost picks where a team is deficient (low score → more boost).
              Weights per position are set in Algo Tuning (QB 1.00, CB 0.90,
              Nickel/S 0.60, etc.). Leave blank for "unknown".
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={load} disabled={loading || saving}>
              Reload
            </Button>
            <Button size="sm" onClick={save} disabled={dirtyCount === 0 || saving}>
              {saving ? 'Saving…' : dirtyCount === 0 ? 'No changes' : `Save ${dirtyCount} team${dirtyCount === 1 ? '' : 's'}`}
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
