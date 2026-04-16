import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { api, invalidateCache } from '../../../lib/api.js';
import { Card } from '../../../components/ui/Card.jsx';
import { Button } from '../../../components/ui/Button.jsx';
import { TeamLogo } from '../../../components/ui/TeamLogo.jsx';

export default function DraftOrderTab({ adminKey, syncYear, setSyncYear, refresh }) {
  // Scope selector that drives which sync handler runs.
  // 'r1' → Round 1 overwrite (hand-curated teams). 'r2r7' → rounds 2-7 only.
  const [orderSyncScope, setOrderSyncScope] = useState('r1');
  const [syncing, setSyncing] = useState(false);

  async function syncDraftOrderFromEspn(dry) {
    if (syncing) return;
    setSyncing(true);
    const id = toast.loading(dry ? 'Previewing from ESPN…' : 'Syncing draft order from ESPN…');
    try {
      const r = await api.syncDraftOrderFromEspn(adminKey, { year: syncYear, dry });
      toast.dismiss(id);
      // eslint-disable-next-line no-console
      console.log('[sync draft-order] result', r);
      if (dry) {
        toast(`Preview: ${r.round1} R1 picks fetched (${r.fetched} total)`, { duration: 8000 });
        if (r.samples?.[0]) {
          toast(`Sample: Pick ${r.samples[0].pick} → ${r.samples[0].team_abbr}`, { duration: 8000 });
        }
      } else {
        toast.success(`Updated ${r.updated}/${r.round1} picks`);
        invalidateCache('draft-order');
        refresh?.();
      }
    } catch (e) {
      toast.dismiss(id);
      toast.error(e.message);
    } finally {
      setSyncing(false);
    }
  }

  async function syncAllRoundsFromEspn(dry) {
    if (syncing) return;
    setSyncing(true);
    const id = toast.loading(dry ? 'Previewing all 7 rounds…' : 'Syncing all 7 rounds from ESPN…');
    try {
      const r = await api.syncAllRoundsFromEspn(adminKey, { year: syncYear, dry, includeR1: false });
      toast.dismiss(id);
      // eslint-disable-next-line no-console
      console.log('[sync all-rounds] result', r);
      const byRound = r.by_round ? Object.entries(r.by_round).map(([k, v]) => `R${k}:${v}`).join(' ') : '';
      if (dry) {
        toast(`Preview: ${r.would_update} picks across rounds · ${byRound}`, { duration: 10000 });
      } else {
        toast.success(`Inserted ${r.inserted}, updated ${r.updated} · ${byRound}`);
        invalidateCache('draft-order');
        refresh?.();
      }
    } catch (e) {
      toast.dismiss(id);
      toast.error(e.message);
    } finally {
      setSyncing(false);
    }
  }

  // Dispatcher used by the unified Draft Order tab form. Delegates to the
  // existing R1 / R2-R7 handlers based on the selected scope.
  function runOrderSync(dry) {
    if (orderSyncScope === 'r2r7') return syncAllRoundsFromEspn(dry);
    return syncDraftOrderFromEspn(dry);
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="mb-3">
          <h3 className="font-semibold text-text-primary">Sync draft order from ESPN</h3>
          <p className="text-text-muted text-xs mt-0.5">
            R1 overwrites team abbr + name (team needs preserved). R2–R7 pulls
            rounds 2-7 and leaves R1 untouched. Preview fetches without writing.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-text-muted font-display uppercase tracking-wide">Year</label>
            <input
              type="number"
              value={syncYear}
              onChange={(e) => setSyncYear(parseInt(e.target.value, 10) || 2026)}
              className="w-20 bg-bg-deep border border-border-focus rounded px-2 py-1.5 text-text-primary text-sm font-mono"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-text-muted font-display uppercase tracking-wide">Scope</label>
            <div className="flex rounded-md border border-border-focus overflow-hidden">
              {[
                { id: 'r1', label: 'R1 only' },
                { id: 'r2r7', label: 'R2–R7' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setOrderSyncScope(opt.id)}
                  disabled={syncing}
                  className={`px-3 py-1.5 text-xs font-display transition ${
                    orderSyncScope === opt.id
                      ? 'bg-accent/[0.1] text-accent'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <Button size="sm" variant="secondary" onClick={() => runOrderSync(true)} disabled={syncing}>
              {syncing ? '…' : 'Preview'}
            </Button>
            <Button size="sm" onClick={() => runOrderSync(false)} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync'}
            </Button>
          </div>
        </div>
      </Card>
      <TeamNeedsCard adminKey={adminKey} />
    </div>
  );
}

// Per-team needs editor. Loads all draft_order rows (all rounds), groups by
// team (keeping the first non-empty needs we see since needs are logically
// per-team, not per-pick), and posts a bulk update via /admin/team-needs.
function TeamNeedsCard({ adminKey }) {
  const [rows, setRows] = useState(null);
  const [needsMap, setNeedsMap] = useState({}); // team → comma-separated string
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    if (!adminKey) return;
    try {
      const data = await api.adminGetDraftOrder(adminKey, { round: 'all' });
      setRows(data);
      // Build initial needsMap from the first row seen per team with non-empty needs
      const map = {};
      const seen = new Set();
      for (const r of data) {
        if (seen.has(r.team)) continue;
        seen.add(r.team);
        const needs = Array.isArray(r.team_needs) ? r.team_needs.join(', ') : '';
        map[r.team] = needs;
      }
      // Also include teams that have only empty needs (ensure every team has an entry)
      for (const r of data) if (!(r.team in map)) map[r.team] = '';
      setNeedsMap(map);
      setDirty(false);
    } catch (e) {
      console.error('[team-needs load]', e);
      toast.error('Failed to load draft order');
    }
  }, [adminKey]);

  useEffect(() => { load(); }, [load]);

  // Unique team list sorted by their earliest pick number — matches the order
  // teams will actually pick in, so the editor reads like a draft order.
  const teamsInOrder = useMemo(() => {
    if (!rows) return [];
    const firstPick = new Map();
    for (const r of rows) {
      if (!firstPick.has(r.team) || r.pick_number < firstPick.get(r.team)) {
        firstPick.set(r.team, r.pick_number);
      }
    }
    return [...firstPick.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([team, pick]) => ({ team, firstPick: pick }));
  }, [rows]);

  function updateNeeds(team, value) {
    setNeedsMap((prev) => ({ ...prev, [team]: value }));
    setDirty(true);
  }

  async function saveAll() {
    if (!adminKey) return;
    setBusy(true);
    try {
      const payload = {};
      for (const [team, str] of Object.entries(needsMap)) {
        payload[team] = str
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean);
      }
      const res = await api.adminSetTeamNeeds(adminKey, payload);
      toast.success(`Updated ${res.rows_updated} draft_order rows`);
      setDirty(false);
      // Also bust any cached draft order so the team-mock page picks up the
      // new needs on next visit.
      invalidateCache('draft-order');
    } catch (e) {
      console.error('[team-needs save]', e);
      toast.error(e.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  if (!rows) {
    return (
      <Card className="p-5">
        <div className="text-text-muted text-sm">Loading draft order…</div>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h3 className="font-semibold text-text-primary">Team Needs</h3>
          <p className="text-text-muted text-xs mt-0.5">
            Propagates to every draft_order row for that team across all 7 rounds.
            The team-mock bot uses these to weight BPA picks toward positions of need.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={load} disabled={busy}>
            Reload
          </Button>
          <Button size="sm" onClick={saveAll} disabled={busy || !dirty}>
            {busy ? 'Saving…' : dirty ? 'Save Needs' : 'Saved'}
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {teamsInOrder.map(({ team, firstPick }) => (
          <div key={team} className="flex items-center gap-2 p-2 rounded-md border border-border-subtle bg-bg-surface/40">
            <span className="font-mono text-[10px] text-text-muted w-6 text-right shrink-0">
              #{firstPick}
            </span>
            <TeamLogo abbr={team} size="xs" />
            <span className="font-display font-bold text-[11px] uppercase tracking-wide text-text-primary w-10 shrink-0">
              {team}
            </span>
            <input
              value={needsMap[team] || ''}
              onChange={(e) => updateNeeds(team, e.target.value)}
              placeholder="QB, WR, OT, EDGE"
              className="flex-1 bg-bg-deep border border-border-focus rounded px-2 py-1 text-text-primary text-xs uppercase min-w-0"
            />
          </div>
        ))}
      </div>
    </Card>
  );
}
