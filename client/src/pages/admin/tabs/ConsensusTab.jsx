import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../../lib/api.js';
import { Card } from '../../../components/ui/Card.jsx';
import { PositionBadge } from '../../../components/ui/Badge.jsx';
import { TeamLogo } from '../../../components/ui/TeamLogo.jsx';
import { PlayerHeadshot } from '../../../components/ui/PlayerHeadshot.jsx';
import { Skeleton } from '../../../components/ui/Skeleton.jsx';
import { posHex } from '../../../lib/positions.js';

export default function ConsensusTab({ order }) {
  const [consensusR1, setConsensusR1] = useState(null);
  const [consensusPos, setConsensusPos] = useState(null);
  const [consensusLoading, setConsensusLoading] = useState(false);
  const [consensusTeam, setConsensusTeam] = useState('');
  const [consensusTeamData, setConsensusTeamData] = useState(null);
  const [consensusTeamLoading, setConsensusTeamLoading] = useState(false);
  const [consensusPosFilter, setConsensusPosFilter] = useState('ALL');
  const [expandedRounds, setExpandedRounds] = useState(new Set());

  useEffect(() => {
    if (consensusR1) return;
    setConsensusLoading(true);
    Promise.all([api.getR1Consensus(), api.getPositionConsensus()])
      .then(([r1, pos]) => { setConsensusR1(r1); setConsensusPos(pos); })
      .catch((e) => toast.error(e.message))
      .finally(() => setConsensusLoading(false));
    // eslint-disable-next-line
  }, []);

  function selectConsensusTeam(abbr) {
    if (consensusTeam === abbr) return;
    setConsensusTeam(abbr);
    setConsensusTeamData(null);
    setExpandedRounds(new Set());
    setConsensusTeamLoading(true);
    api.getTeamPickBreakdown(abbr)
      .then(setConsensusTeamData)
      .catch((e) => toast.error(e.message))
      .finally(() => setConsensusTeamLoading(false));
  }

  // Group team pick breakdown by round for rendering
  const playersByRound = consensusTeamData?.picks
    ? (() => {
        const byRound = {};
        for (const pick of consensusTeamData.picks) {
          const r = pick.round;
          if (!byRound[r]) byRound[r] = new Map();
          for (const opt of pick.options) {
            const existing = byRound[r].get(opt.player_id);
            if (existing) {
              existing.pick_count += opt.pick_count;
            } else {
              byRound[r].set(opt.player_id, { ...opt });
            }
          }
        }
        const result = {};
        for (const [r, map] of Object.entries(byRound)) {
          result[r] = [...map.values()].sort((a, b) => b.pick_count - a.pick_count);
        }
        return result;
      })()
    : {};

  const consensusPositions = consensusR1?.players
    ? [...new Set(consensusR1.players.map((p) => p.position))].sort()
    : [];

  const filteredConsensusPlayers = consensusR1?.players
    ? (consensusPosFilter === 'ALL'
        ? consensusR1.players
        : consensusR1.players.filter((p) => p.position === consensusPosFilter))
    : [];

  return (
    <div className="space-y-5">

      {/* ── MAIN: Team Pick Breakdown ── */}
      <Card className="p-5">
        <div className="mb-4">
          <h3 className="font-display font-semibold text-text-primary text-sm uppercase tracking-[0.12em]">
            Team Pick Breakdown
          </h3>
          <p className="text-text-muted text-[11px] mt-0.5">
            Select a team to see top player choices at every pick slot across all 7-round team mocks
          </p>
        </div>

        {/* Team selector */}
        {order.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 mb-5">
            {[...new Map(order.map((o) => [o.team, o])).values()]
              .filter((o) => o.team)
              .sort((a, b) => a.team.localeCompare(b.team))
              .map((o) => (
                <button
                  key={o.team}
                  onClick={() => selectConsensusTeam(o.team)}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[11px] font-display font-semibold uppercase transition-all ${
                    consensusTeam === o.team
                      ? 'border-accent/60 bg-accent/[0.08] text-text-primary'
                      : 'border-border-subtle text-text-secondary hover:text-text-primary hover:border-border-focus'
                  }`}
                >
                  <TeamLogo abbr={o.team} size="xs" />
                  {o.team}
                </button>
              ))}
          </div>
        ) : (
          <p className="text-text-muted text-[11px] mb-4">Load the Draft Order tab first to populate teams.</p>
        )}

        {/* No team selected */}
        {!consensusTeam && (
          <p className="text-text-muted text-sm text-center py-6">Select a team above to view their picks.</p>
        )}

        {/* Loading */}
        {consensusTeam && consensusTeamLoading && (
          <div className="space-y-2">
            {Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
        )}

        {/* No data for team */}
        {consensusTeam && !consensusTeamLoading && consensusTeamData?.picks?.length === 0 && (
          <p className="text-text-muted text-sm text-center py-6">
            No team mocks saved for {consensusTeam} yet.
          </p>
        )}

        {/* Pick breakdown grouped by round */}
        {consensusTeam && !consensusTeamLoading && consensusTeamData?.picks?.length > 0 && (
          <div className="space-y-5">
            <p className="text-text-muted text-[11px]">
              <span className="text-text-primary font-semibold">{consensusTeamData.total_team_mocks}</span>{' '}
              GM{consensusTeamData.total_team_mocks !== 1 ? 's' : ''} drafted {consensusTeam}
            </p>
            {Object.entries(playersByRound)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([round, players]) => {
                const topCount = players[0]?.pick_count ?? 1;
                return (
                  <div key={round}>
                    {/* Round header */}
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-display font-bold text-[10px] uppercase tracking-[0.18em] text-text-muted px-2 py-0.5 rounded border border-border-subtle">
                        Round {round}
                      </span>
                      <div className="flex-1 h-px bg-border-subtle" />
                    </div>
                    {/* Player list */}
                    {(() => {
                      const LIMIT = 5;
                      const isExpanded = expandedRounds.has(round);
                      const visible = isExpanded ? players : players.slice(0, LIMIT);
                      const hasMore = players.length > LIMIT;
                      return (
                        <>
                          <div className="divide-y divide-border-subtle">
                            {visible.map((p) => {
                              const hex = posHex(p.position);
                              const pct = consensusTeamData.total_team_mocks > 0
                                ? Math.round((p.pick_count / consensusTeamData.total_team_mocks) * 100)
                                : 0;
                              const barW = Math.round((p.pick_count / topCount) * 100);
                              return (
                                <div key={p.player_id} className="flex items-center gap-3 py-2 px-1 hover:bg-white/[0.02] rounded">
                                  <PositionBadge position={p.position} />
                                  <div className="min-w-0 flex-1">
                                    <div className="text-[12px] font-semibold text-text-primary truncate">{p.name}</div>
                                    <div className="text-[10px] text-text-muted truncate">{p.school}</div>
                                  </div>
                                  <div className="w-24 shrink-0">
                                    <div className="h-1 w-full rounded-full bg-white/[0.06]">
                                      <div
                                        className="h-full rounded-full transition-all duration-500"
                                        style={{ width: `${barW}%`, backgroundColor: hex, boxShadow: `0 0 6px -1px ${hex}66` }}
                                      />
                                    </div>
                                  </div>
                                  <span
                                    className="font-mono font-semibold text-[13px] tabular-nums w-10 text-right shrink-0"
                                    style={{ color: hex }}
                                  >
                                    {pct}%
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                          {hasMore && (
                            <button
                              onClick={() => setExpandedRounds((prev) => {
                                const next = new Set(prev);
                                if (isExpanded) next.delete(round);
                                else next.add(round);
                                return next;
                              })}
                              className="flex items-center gap-1 mt-1 px-1 text-[10.5px] text-text-muted hover:text-text-primary transition-colors"
                            >
                              <svg
                                className={`w-3 h-3 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                                viewBox="0 0 12 12"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <polyline points="2 4 6 8 10 4" />
                              </svg>
                              {isExpanded
                                ? 'Show less'
                                : `${players.length - LIMIT} more player${players.length - LIMIT !== 1 ? 's' : ''}`}
                            </button>
                          )}
                        </>
                      );
                    })()}
                  </div>
                );
              })}
          </div>
        )}
      </Card>

      {/* ── Most Picked Players (all team mocks) ── */}
      <Card className="p-5">
        <div className="mb-4">
          <h3 className="font-display font-semibold text-text-primary text-sm uppercase tracking-[0.12em]">
            Most Picked Players
          </h3>
          <p className="text-text-muted text-[11px] mt-0.5">
            {consensusR1
              ? `Players drafted most often across ${consensusR1.total_mocks} team mock${consensusR1.total_mocks !== 1 ? 's' : ''} · all rounds`
              : 'Most-drafted players across all saved team mocks'}
          </p>
        </div>

        {/* Position filter pills */}
        {!consensusLoading && consensusPositions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            <button
              onClick={() => setConsensusPosFilter('ALL')}
              className={`px-2.5 py-0.5 rounded-full text-[10.5px] font-display font-semibold uppercase tracking-[0.1em] border transition-all ${
                consensusPosFilter === 'ALL'
                  ? 'bg-accent/[0.15] border-accent/50 text-accent'
                  : 'border-border-subtle text-text-muted hover:text-text-primary hover:border-border-focus'
              }`}
            >
              All
            </button>
            {consensusPositions.map((pos) => {
              const hex = posHex(pos);
              const isActive = consensusPosFilter === pos;
              return (
                <button
                  key={pos}
                  onClick={() => setConsensusPosFilter(pos)}
                  className="px-2.5 py-0.5 rounded-full text-[10.5px] font-display font-semibold uppercase tracking-[0.1em] border transition-all"
                  style={isActive
                    ? { backgroundColor: `${hex}22`, borderColor: `${hex}88`, color: hex }
                    : { borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }
                  }
                >
                  {pos}
                </button>
              );
            })}
          </div>
        )}

        {consensusLoading && (
          <div className="space-y-2">
            {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        )}

        {!consensusLoading && consensusR1?.total_mocks === 0 && (
          <p className="text-text-muted text-sm text-center py-6">No team mocks saved yet.</p>
        )}

        {!consensusLoading && filteredConsensusPlayers.length === 0 && consensusR1?.players?.length > 0 && (
          <p className="text-text-muted text-sm text-center py-6">No players at that position yet.</p>
        )}

        {!consensusLoading && filteredConsensusPlayers.length > 0 && (
          <div className="divide-y divide-border-subtle">
            {filteredConsensusPlayers.map((p, i) => {
              const pct = consensusR1.total_mocks > 0
                ? Math.round((p.pick_count / consensusR1.total_mocks) * 100)
                : 0;
              const hex = posHex(p.position);
              const delta = p.consensus_rank ? Math.round(p.avg_pick) - p.consensus_rank : null;
              const rankChip = delta !== null && Math.abs(delta) >= 3
                ? delta >= 3
                  ? { label: `Value — expert rank #${p.consensus_rank}`, color: '#22d3ee' }
                  : { label: `Reaches early — expert rank #${p.consensus_rank}`, color: '#f59e0b' }
                : null;
              return (
                <div key={p.id} className="py-3 hover:bg-white/[0.02] rounded px-1">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[11px] text-text-muted w-5 text-right shrink-0">{i + 1}</span>
                    <PlayerHeadshot url={p.headshot_url} name={p.name} position={p.position} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[12px] font-semibold text-text-primary">{p.name}</span>
                        <PositionBadge position={p.position} />
                        <span className="text-text-muted text-[10px]">{p.school}</span>
                        {rankChip && (
                          <span
                            className="text-[10px] font-mono px-1.5 py-px rounded"
                            style={{ backgroundColor: `${rankChip.color}18`, color: rankChip.color, border: `1px solid ${rankChip.color}44` }}
                          >
                            {rankChip.label}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <div className="flex-1 h-1.5 rounded-full bg-white/[0.06]">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${pct}%`, backgroundColor: hex, boxShadow: `0 0 6px -1px ${hex}66` }}
                          />
                        </div>
                        <span className="font-mono text-[11px] font-semibold tabular-nums shrink-0" style={{ color: hex }}>
                          {pct}%
                        </span>
                      </div>
                      <div className="mt-1 font-mono text-[10px] text-text-muted tabular-nums">
                        Drafted in {p.pick_count} of {consensusR1.total_mocks} mocks
                        {' · '}Avg pick: #{p.avg_pick}
                        {p.earliest_pick != null && p.latest_pick != null && (
                          <> · Range: #{p.earliest_pick}–#{p.latest_pick}</>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ── Position Distribution ── */}
      <Card className="p-5">
        <div className="mb-4">
          <h3 className="font-display font-semibold text-text-primary text-sm uppercase tracking-[0.12em]">
            Position Distribution
          </h3>
          <p className="text-text-muted text-[11px] mt-0.5">
            All user picks across completed team mocks
            {consensusPos?.total_r1_picks > 0 && ` · ${consensusPos.total_r1_picks.toLocaleString()} total picks`}
          </p>
        </div>

        {consensusLoading && (
          <div className="space-y-2">
            {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        )}

        {!consensusLoading && consensusPos?.total_r1_picks === 0 && (
          <p className="text-text-muted text-sm text-center py-6">No team mock picks to analyze yet.</p>
        )}

        {!consensusLoading && consensusPos?.positions?.length > 0 && (
          <div className="space-y-2">
            {consensusPos.positions.map((pos) => {
              const pct = consensusPos.total_r1_picks > 0
                ? (pos.pick_count / consensusPos.total_r1_picks) * 100
                : 0;
              const hex = posHex(pos.position);
              return (
                <div key={pos.position} className="flex items-center gap-3">
                  <PositionBadge position={pos.position} />
                  <div className="flex-1 h-2 rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: hex,
                        boxShadow: `0 0 8px -2px ${hex}88`,
                      }}
                    />
                  </div>
                  <span className="font-mono text-[11px] text-text-muted tabular-nums w-24 text-right shrink-0">
                    {Math.round(pct)}% · {pos.pick_count} picks
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

    </div>
  );
}
