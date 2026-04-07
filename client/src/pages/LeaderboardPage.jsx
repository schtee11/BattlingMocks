import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { Card } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';

const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };

export default function LeaderboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const userRowRef = useRef(null);

  useEffect(() => {
    api.getLeaderboard(200, 0).then(setData).catch((e) => setErr(e.message));
  }, []);

  const allZero = useMemo(
    () => data?.entries?.length > 0 && data.entries.every((e) => e.total_score === 0),
    [data]
  );

  const topThree = data?.entries?.slice(0, 3) || [];
  const rest = data?.entries?.slice(3) || [];

  function scrollToMe() {
    userRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  const stats = useMemo(() => {
    if (!data?.entries?.length) return null;
    const scores = data.entries.map((e) => e.total_score);
    const scored = scores.filter((s) => s > 0);
    return {
      total: data.total,
      avg: scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : 0,
      max: Math.max(...scores, 0),
    };
  }, [data]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 route-fade">
      <div className="flex items-end justify-between flex-wrap gap-3 mb-5">
        <div>
          <div className="caption text-accent">Standings</div>
          <h1 className="font-display display-xl text-display text-white mt-1">Leaderboard</h1>
        </div>
        {user && data?.entries?.some((e) => e.user_id === user.id) && (
          <Button variant="secondary" onClick={scrollToMe}>Find Me</Button>
        )}
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-3 mb-5">
          <Card glass className="p-4">
            <div className="caption">Participants</div>
            <div className="font-mono text-2xl font-bold tabular text-white mt-1">{stats.total}</div>
          </Card>
          <Card glass className="p-4">
            <div className="caption">Average Score</div>
            <div className="font-mono text-2xl font-bold tabular text-white mt-1">{stats.avg}</div>
          </Card>
          <Card glass className="p-4">
            <div className="caption">Top Score</div>
            <div className="font-mono text-2xl font-bold tabular text-gold mt-1">{stats.max}</div>
          </Card>
        </div>
      )}

      {allZero && (
        <Card className="p-4 mb-4 text-amber-200 border-amber-700/40" style={{ background: 'rgba(146,64,14,0.1)' }}>
          <span className="caption text-amber-300">Scores Revealed Draft Night</span>
          <div className="text-[13px] mt-1 text-amber-200/80">Mocks are shown in submission order until real results are entered.</div>
        </Card>
      )}

      {err && (
        <Card className="p-4 mb-4 text-red-300 border-red-700/40" style={{ background: 'rgba(127,29,29,0.15)' }}>
          {err}
          <Button size="sm" variant="ghost" className="ml-3" onClick={() => location.reload()}>Retry</Button>
        </Card>
      )}

      {/* Top 3 */}
      {!allZero && topThree.length >= 3 && (
        <div className="grid md:grid-cols-3 gap-3 mb-4">
          {topThree.map((e) => {
            const me = user && e.user_id === user.id;
            return (
              <Card
                key={e.id}
                glass
                className={`p-5 text-center relative ${e.rank === 1 ? 'shadow-glow-gold' : ''} ${me ? 'ring-1 ring-accent/40' : ''}`}
              >
                <div className="text-3xl mb-1">{MEDALS[e.rank]}</div>
                <div className="caption">#{e.rank}</div>
                <div className="font-display font-bold text-white text-[18px] uppercase tracking-wide mt-1 truncate">
                  {e.display_name}{me && <span className="ml-2 text-[10px] text-accent">YOU</span>}
                </div>
                <div className="font-mono font-bold text-4xl tabular text-gold mt-3">{e.total_score}</div>
                <div className="text-[11px] text-text-muted mt-1">
                  {e.picks_correct}/32 correct · {e.exact_picks} exact
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Full table */}
      <Card glass className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left caption">
                <th className="px-4 py-3 font-display">Rank</th>
                <th className="px-4 py-3 font-display">Name</th>
                <th className="px-4 py-3 font-display text-right">Score</th>
                <th className="px-4 py-3 font-display text-right hidden sm:table-cell">Correct</th>
                <th className="px-4 py-3 font-display text-right hidden sm:table-cell">Exact</th>
                <th className="px-4 py-3 font-display text-right hidden md:table-cell">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {!data ? (
                Array.from({ length: 6 }, (_, i) => (
                  <tr key={i} className="border-t border-border-subtle">
                    <td className="px-4 py-3" colSpan={6}><Skeleton className="h-5 w-full" /></td>
                  </tr>
                ))
              ) : data.entries.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-text-muted">No mocks yet.</td></tr>
              ) : (
                (allZero ? data.entries : rest).map((e, idx) => {
                  const me = user && e.user_id === user.id;
                  const odd = idx % 2 === 1;
                  return (
                    <tr
                      key={e.id}
                      ref={me ? userRowRef : null}
                      className={`border-t border-border-subtle transition-colors ${odd ? 'bg-white/[0.015]' : ''} ${me ? 'bg-accent/[0.07]' : 'hover:bg-white/[0.03]'}`}
                      style={me ? { borderLeft: '3px solid var(--accent)' } : undefined}
                    >
                      <td className="px-4 py-3 font-mono tabular font-bold">
                        <span className={e.rank <= 3 ? 'text-gold' : 'text-text-secondary'}>{e.rank}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-white font-semibold">{e.display_name}</span>
                        {me && <span className="ml-2 font-display uppercase tracking-[0.14em] text-[9.5px] text-accent">You</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold tabular text-gold">{e.total_score}</td>
                      <td className="px-4 py-3 text-right font-mono tabular text-text-secondary hidden sm:table-cell">{e.picks_correct}/32</td>
                      <td className="px-4 py-3 text-right font-mono tabular text-text-secondary hidden sm:table-cell">{e.exact_picks}</td>
                      <td className="px-4 py-3 text-right text-text-muted text-[11.5px] hidden md:table-cell">
                        {new Date(e.submitted_at).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
