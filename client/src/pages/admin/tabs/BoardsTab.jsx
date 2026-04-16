import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../../lib/api.js';
import { Card } from '../../../components/ui/Card.jsx';
import { Button } from '../../../components/ui/Button.jsx';
import { Avatar } from '../../../components/ui/Avatar.jsx';
import { Skeleton } from '../../../components/ui/Skeleton.jsx';

export default function BoardsTab({ adminKey }) {
  const [boardStats, setBoardStats] = useState(null);
  const [boardsLoading, setBoardsLoading] = useState(false);

  function loadBoardStats() {
    setBoardsLoading(true);
    api.adminBoardStats(adminKey)
      .then(setBoardStats)
      .catch((e) => toast.error(e.message))
      .finally(() => setBoardsLoading(false));
  }

  useEffect(() => {
    if (boardStats) return;
    loadBoardStats();
    // eslint-disable-next-line
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display font-semibold text-text-primary text-sm uppercase tracking-[0.12em]">
            User Boards Activity
          </h3>
          <p className="text-text-muted text-xs mt-0.5">
            Big Board usage · who is ranking prospects and how actively
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => { setBoardStats(null); loadBoardStats(); }} disabled={boardsLoading}>
          {boardsLoading ? 'Loading…' : 'Refresh'}
        </Button>
      </div>

      {boardsLoading && !boardStats && (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-40" />
        </div>
      )}

      {boardStats && (
        <>
          {/* Overview cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ['Total Boards', boardStats.overview.total_boards],
              ['Unique Users', boardStats.overview.unique_users],
              ['Total Rankings', boardStats.overview.total_rankings],
              ['Avg Rankings/Board', boardStats.overview.avg_rankings_per_board ?? '—'],
            ].map(([label, value]) => (
              <Card key={label} className="p-3 text-center">
                <div className="text-2xl font-bold font-display text-text-primary">{value}</div>
                <div className="text-[10px] text-text-muted mt-0.5 uppercase tracking-wide">{label}</div>
              </Card>
            ))}
          </div>

          {/* Top users */}
          {boardStats.topUsers.length > 0 && (
            <Card className="p-5">
              <h4 className="font-display font-semibold text-text-primary text-xs uppercase tracking-[0.12em] mb-3">
                Top Users by Board Count
              </h4>
              <div className="space-y-1.5">
                {boardStats.topUsers.map((u, i) => (
                  <div key={u.display_name} className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-text-muted w-5 text-right shrink-0">{i + 1}.</span>
                    <Avatar url={u.avatar_url} name={u.display_name} size="sm" />
                    <span className="text-xs font-medium text-text-primary flex-1 truncate">{u.display_name}</span>
                    <span className="text-[11px] text-text-muted shrink-0">
                      {u.board_count} {u.board_count === 1 ? 'board' : 'boards'} · {u.total_rankings ?? 0} rankings
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Daily creation trend */}
          {boardStats.daily.length > 0 && (
            <Card className="p-5">
              <h4 className="font-display font-semibold text-text-primary text-xs uppercase tracking-[0.12em] mb-3">
                Boards Created — Last 30 Days
              </h4>
              <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
                {(() => {
                  const maxDay = Math.max(...boardStats.daily.map((d) => d.boards_created));
                  return boardStats.daily.map((row) => {
                    const barW = maxDay > 0 ? Math.max((row.boards_created / maxDay) * 100, 3) : 0;
                    return (
                      <div key={row.day} className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-text-muted w-20 shrink-0">
                          {new Date(row.day + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </span>
                        <div className="flex-1 h-4 bg-bg-surface rounded-sm overflow-hidden">
                          <div
                            className="h-full bg-accent/70 rounded-sm transition-all"
                            style={{ width: `${barW}%` }}
                          />
                        </div>
                        <span className="font-mono text-[10px] text-text-muted w-6 text-right shrink-0">
                          {row.boards_created}
                        </span>
                      </div>
                    );
                  });
                })()}
              </div>
            </Card>
          )}

          {/* Recent boards */}
          {boardStats.recentBoards.length > 0 && (
            <Card className="p-5">
              <h4 className="font-display font-semibold text-text-primary text-xs uppercase tracking-[0.12em] mb-3">
                Recent Boards
              </h4>
              <div className="space-y-1">
                {boardStats.recentBoards.map((b) => {
                  const created = new Date(b.created_at);
                  const updated = new Date(b.updated_at);
                  const wasEdited = Math.abs(updated - created) > 5000;
                  return (
                    <div key={b.id} className="flex items-center gap-2 py-1.5 border-b border-border-subtle/50 last:border-0">
                      <Avatar url={b.avatar_url} name={b.display_name} size="sm" />
                      <span className="text-xs font-medium text-text-primary shrink-0 w-28 truncate">{b.display_name}</span>
                      <span className="text-xs text-text-secondary flex-1 truncate">{b.title || 'Untitled Board'}</span>
                      <span className="text-[10px] text-text-muted shrink-0">{b.ranking_count} ranked</span>
                      <span className="text-[10px] text-text-muted shrink-0 ml-2">
                        {wasEdited ? 'updated ' : 'created '}
                        {(wasEdited ? updated : created).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {boardStats.overview.total_boards === 0 && (
            <p className="text-text-muted text-sm text-center py-8">No boards created yet.</p>
          )}
        </>
      )}
    </div>
  );
}
