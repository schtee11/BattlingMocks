import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../../lib/api.js';
import { Card } from '../../../components/ui/Card.jsx';
import { Button } from '../../../components/ui/Button.jsx';
import { TeamLogo } from '../../../components/ui/TeamLogo.jsx';
import { Skeleton } from '../../../components/ui/Skeleton.jsx';

export default function VolumeStatsTab({ adminKey, syncYear }) {
  const [volumeStats, setVolumeStats] = useState(null);
  const [volumeLoading, setVolumeLoading] = useState(false);
  // Prediction mocks analytics (rendered inside the Volume Stats tab)
  const [predMockStats, setPredMockStats] = useState(null);
  const [predMockLoading, setPredMockLoading] = useState(false);

  function loadVolumeStats() {
    setVolumeLoading(true);
    api.volumeStats(adminKey, syncYear)
      .then(setVolumeStats)
      .catch((e) => toast.error(e.message))
      .finally(() => setVolumeLoading(false));
  }

  function loadPredMockStats() {
    setPredMockLoading(true);
    api.predictionMockStats(adminKey)
      .then(setPredMockStats)
      .catch((e) => toast.error(e.message))
      .finally(() => setPredMockLoading(false));
  }

  useEffect(() => {
    if (volumeStats) return;
    loadVolumeStats();
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    if (predMockStats) return;
    loadPredMockStats();
    // eslint-disable-next-line
  }, []);

  return (
    <div className="space-y-5">

      {/* Header + refresh */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display font-semibold text-text-primary text-sm uppercase tracking-[0.12em]">
            Volume Stats — {syncYear}
          </h3>
          <p className="text-text-muted text-[11px] mt-0.5">
            Draft session telemetry · how much data we have and where the gaps are
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => { setVolumeStats(null); loadVolumeStats(); }} disabled={volumeLoading}>
          {volumeLoading ? 'Loading…' : 'Refresh'}
        </Button>
      </div>

      {volumeLoading && !volumeStats && (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      )}

      {volumeStats && (
        <>
          {/* ── Overview cards ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ['Total Sessions', volumeStats.overview.total_sessions],
              ['Completed', volumeStats.overview.completed],
              ['Abandoned', volumeStats.overview.abandoned],
              ['Completion Rate', volumeStats.overview.total_sessions > 0
                ? `${Math.round((volumeStats.overview.completed / volumeStats.overview.total_sessions) * 100)}%`
                : '—'],
              ['Unique Users', volumeStats.overview.unique_users],
              ['Anonymous', volumeStats.overview.anonymous_sessions],
              ['Avg Duration', volumeStats.overview.avg_duration_sec != null
                ? `${Math.floor(volumeStats.overview.avg_duration_sec / 60)}m ${volumeStats.overview.avg_duration_sec % 60}s`
                : '—'],
              ['Data Range', volumeStats.overview.earliest_session
                ? `${new Date(volumeStats.overview.earliest_session).toLocaleDateString()} → ${new Date(volumeStats.overview.latest_session).toLocaleDateString()}`
                : '—'],
            ].map(([label, value]) => (
              <Card key={label} className="p-3 text-center">
                <div className="text-text-muted text-[10px] uppercase tracking-widest font-display">{label}</div>
                <div className="text-text-primary font-display font-bold text-lg mt-1">{value}</div>
              </Card>
            ))}
          </div>

          {/* ── Team mock breakdown (the money table) ── */}
          <Card className="p-5">
            <h4 className="font-display font-semibold text-text-primary text-xs uppercase tracking-[0.12em] mb-1">
              Completed Team Mocks by Team
            </h4>
            <p className="text-text-muted text-[10px] mb-3">
              This is the data set that powers consensus analytics. More completed mocks = better data.
            </p>
            {volumeStats.byTeam.length === 0 ? (
              <p className="text-text-muted text-xs">No team mock sessions yet.</p>
            ) : (
              <>
                {/* Summary bar */}
                {(() => {
                  const totalCompleted = volumeStats.byTeam.reduce((s, r) => s + r.completed, 0);
                  const teamCount = volumeStats.byTeam.filter((r) => r.completed > 0).length;
                  return (
                    <div className="flex gap-4 mb-4 text-[11px]">
                      <span className="text-text-muted">
                        Total completed team mocks: <span className="text-text-primary font-bold">{totalCompleted}</span>
                      </span>
                      <span className="text-text-muted">
                        Teams with data: <span className="text-text-primary font-bold">{teamCount}/32</span>
                      </span>
                    </div>
                  );
                })()}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 max-h-[420px] overflow-y-auto">
                  {volumeStats.byTeam.map((row) => {
                    const maxCompleted = volumeStats.byTeam[0]?.completed || 1;
                    const barW = Math.max((row.completed / maxCompleted) * 100, 2);
                    return (
                      <div key={row.user_team} className="flex items-center gap-2 p-1.5 rounded border border-border-subtle bg-bg-surface/40">
                        <TeamLogo abbr={row.user_team} size="xs" />
                        <span className="font-display font-bold text-[11px] uppercase tracking-wide text-text-primary w-10 shrink-0">
                          {row.user_team}
                        </span>
                        <div className="flex-1 h-4 rounded bg-bg-deep overflow-hidden">
                          <div
                            className="h-full rounded transition-all"
                            style={{
                              width: `${barW}%`,
                              backgroundColor: row.completed >= 10 ? '#22c55e' : row.completed >= 5 ? '#eab308' : '#ef4444',
                            }}
                          />
                        </div>
                        <span className="font-mono text-[10px] text-text-muted tabular-nums w-24 text-right shrink-0">
                          {row.completed} done · {row.total} total
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-4 mt-3 text-[10px] text-text-muted">
                  <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#22c55e' }} /> 10+ (good)</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#eab308' }} /> 5-9 (building)</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#ef4444' }} /> &lt;5 (needs more)</span>
                </div>
              </>
            )}
          </Card>

          {/* ── Daily trend (last 30 days) ── */}
          <Card className="p-5">
            <h4 className="font-display font-semibold text-text-primary text-xs uppercase tracking-[0.12em] mb-3">
              Daily Volume — Last 30 Days
            </h4>
            {volumeStats.daily.length === 0 ? (
              <p className="text-text-muted text-xs">No sessions in the last 30 days.</p>
            ) : (
              <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
                {(() => {
                  const maxDay = Math.max(...volumeStats.daily.map((d) => d.total));
                  return volumeStats.daily.map((row) => {
                    const totalBarW = maxDay > 0 ? Math.max((row.total / maxDay) * 100, 3) : 0;
                    const completedBarW = maxDay > 0 ? Math.max((row.completed / maxDay) * 100, 1) : 0;
                    const dayDate = new Date(row.day + 'T12:00:00');
                    return (
                      <div key={row.day} className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-text-muted w-20 shrink-0">
                          {dayDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', weekday: 'short' })}
                        </span>
                        <div className="flex-1 h-5 rounded bg-bg-deep overflow-hidden relative">
                          <div
                            className="h-full absolute left-0 top-0 rounded"
                            style={{ width: `${totalBarW}%`, backgroundColor: '#3b82f6', opacity: 0.15 }}
                          />
                          <div
                            className="h-full absolute left-0 top-0 rounded"
                            style={{ width: `${completedBarW}%`, backgroundColor: '#3b82f6' }}
                          />
                        </div>
                        <span className="font-mono text-[10px] text-text-muted tabular-nums w-32 text-right shrink-0">
                          {row.completed}/{row.total} done · {row.distinct_teams} teams
                        </span>
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </Card>

          {/* ── Top contributors ── */}
          {volumeStats.topUsers.length > 0 && (
            <Card className="p-5">
              <h4 className="font-display font-semibold text-text-primary text-xs uppercase tracking-[0.12em] mb-3">
                Top Contributors — Completed Team Mocks
              </h4>
              <div className="space-y-1.5">
                {volumeStats.topUsers.map((u, i) => (
                  <div key={u.user_id} className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-text-muted w-5 text-right shrink-0">{i + 1}.</span>
                    <span className={`text-xs font-medium truncate flex-1 ${u.user_id === 'guest' ? 'text-text-muted italic' : 'text-text-primary'}`}>
                      {u.display_name}
                    </span>
                    <span className="font-mono text-[11px] text-accent tabular-nums font-bold">
                      {u.completed_team_mocks}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* ── Recent sessions ── */}
          {volumeStats.recent?.length > 0 && (
            <Card className="p-5">
              <h4 className="font-display font-semibold text-text-primary text-xs uppercase tracking-[0.12em] mb-3">
                Latest 20 Sessions
              </h4>
              <div className="space-y-1">
                {volumeStats.recent.map((s) => {
                  const time = new Date(s.started_at);
                  return (
                    <div key={s.id} className="flex items-center gap-2 py-1 border-b border-border-subtle/50 last:border-0">
                      <TeamLogo abbr={s.user_team} size="xs" />
                      <span className="font-display font-bold text-[11px] uppercase tracking-wide text-text-primary w-10 shrink-0">
                        {s.user_team}
                      </span>
                      <span className={`text-[11px] w-20 shrink-0 font-medium ${s.completed_at ? 'text-green-500' : 'text-text-muted'}`}>
                        {s.completed_at ? 'Completed' : 'Abandoned'}
                      </span>
                      <span className={`text-[11px] w-14 shrink-0 ${s.is_guest ? 'text-text-muted italic' : 'text-text-primary'}`}>
                        {s.is_guest ? 'Guest' : s.display_name}
                      </span>
                      <span className="font-mono text-[10px] text-text-muted ml-auto shrink-0">
                        {time.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{' '}
                        {time.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </>
      )}

      {/* ── Prediction Mocks usage panel ─────────────────────────────
          Sits inside Volume Stats so all "how is the tool being used"
          metrics live in one place. Driven by the prediction_mock_events
          log — CRUD on saved slots + export/download/share actions. */}
      <div className="pt-2">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-display font-semibold text-text-primary text-sm uppercase tracking-[0.12em]">
              Prediction Mocks
            </h3>
            <p className="text-text-muted text-[11px] mt-0.5">
              Saved-slot counts plus load / export / download telemetry · tracks usage of the predictive-draft tool
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => { setPredMockStats(null); loadPredMockStats(); }}
            disabled={predMockLoading}
          >
            {predMockLoading ? 'Loading…' : 'Refresh'}
          </Button>
        </div>

        {predMockLoading && !predMockStats && (
          <div className="space-y-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-40" />
          </div>
        )}

        {predMockStats && (
          <div className="space-y-5">
            {/* Saved-slot overview cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                ['Saved Mocks', predMockStats.slotOverview?.total_mocks ?? 0],
                ['Unique Users', predMockStats.slotOverview?.unique_users ?? 0],
                ['Avg per User', predMockStats.slotOverview?.avg_mocks_per_user ?? '—'],
                ['Last Updated', predMockStats.slotOverview?.latest_mock_update
                  ? new Date(predMockStats.slotOverview.latest_mock_update).toLocaleDateString()
                  : '—'],
              ].map(([label, value]) => (
                <Card key={label} className="p-3 text-center">
                  <div className="text-text-muted text-[10px] uppercase tracking-widest font-display">{label}</div>
                  <div className="text-text-primary font-display font-bold text-lg mt-1">{value}</div>
                </Card>
              ))}
            </div>

            {/* Events by type — the headline "what are people doing" table */}
            <Card className="p-5">
              <h4 className="font-display font-semibold text-text-primary text-xs uppercase tracking-[0.12em] mb-3">
                Events by Type
              </h4>
              {(predMockStats.eventsByType?.length ?? 0) === 0 ? (
                <p className="text-text-muted text-xs">
                  No events logged yet. Save, load, export or download a prediction mock and it'll show up here.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {predMockStats.eventsByType.map((row) => (
                    <div
                      key={row.event_type}
                      className="p-3 rounded border border-border-subtle bg-bg-surface/40 flex flex-col gap-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-display text-[11px] font-bold uppercase tracking-wide text-text-primary">
                          {row.event_type}
                        </span>
                        <span className="font-mono text-[14px] text-accent tabular-nums font-bold">
                          {row.total}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-text-muted font-mono tabular-nums">
                        <span>7d: {row.last_7d}</span>
                        <span>30d: {row.last_30d}</span>
                        <span>{row.unique_users} users</span>
                      </div>
                      {row.guest_events > 0 && (
                        <div className="text-[9px] text-text-muted italic">
                          {row.guest_events} from guests
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Mode breakdown — prediction vs. competition exports */}
            {(predMockStats.byMode?.length ?? 0) > 0 && (
              <Card className="p-5">
                <h4 className="font-display font-semibold text-text-primary text-xs uppercase tracking-[0.12em] mb-1">
                  Exports by Draft Mode
                </h4>
                <p className="text-text-muted text-[10px] mb-3">
                  Where export and download volume is coming from. Prediction = sandbox boards; Competition = scored mocks.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {predMockStats.byMode.map((row) => (
                    <div
                      key={`${row.mode}-${row.event_type}`}
                      className="flex items-center justify-between p-2 rounded border border-border-subtle bg-bg-surface/40"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-display text-[11px] font-bold uppercase tracking-wide text-text-primary">
                          {row.mode}
                        </span>
                        <span className="text-[10px] text-text-muted uppercase tracking-wider">
                          {row.event_type}
                        </span>
                      </div>
                      <span className="font-mono text-[12px] text-accent tabular-nums font-bold">
                        {row.count}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Daily trend — 30-day activity chart */}
            {(predMockStats.daily?.length ?? 0) > 0 && (
              <Card className="p-5">
                <h4 className="font-display font-semibold text-text-primary text-xs uppercase tracking-[0.12em] mb-3">
                  Prediction-Mock Activity — Last 30 Days
                </h4>
                <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
                  {(() => {
                    const maxDay = Math.max(...predMockStats.daily.map((d) => d.total), 1);
                    return predMockStats.daily.map((row) => {
                      const barW = Math.max((row.total / maxDay) * 100, 3);
                      const dayDate = new Date(row.day + 'T12:00:00');
                      return (
                        <div key={row.day} className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-text-muted w-20 shrink-0">
                            {dayDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', weekday: 'short' })}
                          </span>
                          <div className="flex-1 h-5 rounded bg-bg-deep overflow-hidden relative">
                            <div
                              className="h-full absolute left-0 top-0 rounded"
                              style={{ width: `${barW}%`, backgroundColor: '#a855f7' }}
                            />
                          </div>
                          <span className="font-mono text-[10px] text-text-muted tabular-nums text-right shrink-0 w-52">
                            {row.total} total · {row.created}c {row.updated}u {row.loaded}l {row.exported + row.downloaded}dl
                          </span>
                        </div>
                      );
                    });
                  })()}
                </div>
                <div className="flex gap-3 mt-3 text-[10px] text-text-muted flex-wrap">
                  <span>c = created</span>
                  <span>u = updated</span>
                  <span>l = loaded</span>
                  <span>dl = export+download</span>
                </div>
              </Card>
            )}

            {/* Top users */}
            {(predMockStats.topUsers?.length ?? 0) > 0 && (
              <Card className="p-5">
                <h4 className="font-display font-semibold text-text-primary text-xs uppercase tracking-[0.12em] mb-3">
                  Top Users — Ranked by Exports
                </h4>
                <div className="space-y-1.5">
                  {predMockStats.topUsers.map((u, i) => (
                    <div key={u.user_id} className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-text-muted w-5 text-right shrink-0">{i + 1}.</span>
                      <span className={`text-xs font-medium truncate flex-1 ${u.user_id === 'guest' ? 'text-text-muted italic' : 'text-text-primary'}`}>
                        {u.display_name}
                      </span>
                      <span className="font-mono text-[10px] text-text-muted tabular-nums shrink-0 w-14 text-right">
                        {u.mocks_created} saved
                      </span>
                      <span className="font-mono text-[10px] text-text-muted tabular-nums shrink-0 w-12 text-right">
                        {u.loads} loads
                      </span>
                      <span className="font-mono text-[11px] text-accent tabular-nums font-bold shrink-0 w-14 text-right">
                        {u.exports} exp
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Top mocks (most exported/loaded specific slots) */}
            {(predMockStats.topMocks?.length ?? 0) > 0 && (
              <Card className="p-5">
                <h4 className="font-display font-semibold text-text-primary text-xs uppercase tracking-[0.12em] mb-3">
                  Most-Shared Saved Mocks
                </h4>
                <div className="space-y-1.5">
                  {predMockStats.topMocks.map((m, i) => (
                    <div key={m.id} className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-text-muted w-5 text-right shrink-0">{i + 1}.</span>
                      <span className="text-xs font-medium text-text-primary truncate flex-1">
                        {m.name}
                      </span>
                      <span className="text-[10px] text-text-muted truncate shrink-0 w-24 text-right">
                        {m.display_name || '—'}
                      </span>
                      <span className="font-mono text-[10px] text-text-muted tabular-nums shrink-0 w-14 text-right">
                        {m.load_count} loads
                      </span>
                      <span className="font-mono text-[11px] text-accent tabular-nums font-bold shrink-0 w-14 text-right">
                        {m.export_count} exp
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Recent event stream */}
            {(predMockStats.recent?.length ?? 0) > 0 && (
              <Card className="p-5">
                <h4 className="font-display font-semibold text-text-primary text-xs uppercase tracking-[0.12em] mb-3">
                  Latest 20 Events
                </h4>
                <div className="space-y-1">
                  {predMockStats.recent.map((e) => {
                    const time = new Date(e.created_at);
                    const mode = e.metadata?.mode ? ` · ${e.metadata.mode}` : '';
                    return (
                      <div key={e.id} className="flex items-center gap-2 py-1 border-b border-border-subtle/50 last:border-0">
                        <span className="font-display font-bold text-[10px] uppercase tracking-wide text-accent w-16 shrink-0">
                          {e.event_type}
                        </span>
                        <span className={`text-[11px] w-20 shrink-0 ${e.is_guest ? 'text-text-muted italic' : 'text-text-primary'}`}>
                          {e.is_guest ? 'Guest' : e.display_name}
                        </span>
                        <span className="text-[11px] text-text-muted flex-1 truncate">
                          {e.mock_name || '—'}{mode}
                        </span>
                        <span className="font-mono text-[10px] text-text-muted ml-auto shrink-0">
                          {time.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{' '}
                          {time.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
