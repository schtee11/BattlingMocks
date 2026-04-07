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
    api.getLeaderboard(200, 0)
      .then(setData)
      .catch((e) => setErr(e.message));
  }, []);

  const allZero = useMemo(
    () => data?.entries?.length > 0 && data.entries.every((e) => e.total_score === 0),
    [data]
  );

  function scrollToMe() {
    userRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 route-fade">
      <div className="flex items-end justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-3xl font-bold text-white">Leaderboard</h1>
          <div className="text-slate-500 text-sm mt-1">
            {data?.total ?? 0} mocks submitted · top {data?.entries?.length ?? 0} shown
          </div>
        </div>
        {user && data?.entries?.some((e) => e.user_id === user.id) && (
          <Button variant="secondary" onClick={scrollToMe}>My Rank</Button>
        )}
      </div>

      {allZero && (
        <Card className="p-4 mb-4 text-slate-300 border-amber-700/40 bg-amber-900/10">
          Scores will be revealed after the draft! Mocks are currently shown in submission order.
        </Card>
      )}

      {err && (
        <Card className="p-4 mb-4 text-red-300 bg-red-900/20 border-red-700/40">
          {err}
          <Button size="sm" variant="ghost" className="ml-3" onClick={() => location.reload()}>Retry</Button>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-ink text-slate-400 text-left text-xs uppercase tracking-wide">
              <tr>
                <th className="px-3 py-3">Rank</th>
                <th className="px-3 py-3">Name</th>
                <th className="px-3 py-3 text-right">Score</th>
                <th className="px-3 py-3 text-right hidden sm:table-cell">Correct</th>
                <th className="px-3 py-3 text-right hidden sm:table-cell">Exact</th>
                <th className="px-3 py-3 text-right hidden md:table-cell">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {!data ? (
                Array.from({ length: 6 }, (_, i) => (
                  <tr key={i} className="border-t border-slate-800">
                    <td className="px-3 py-3" colSpan={6}><Skeleton className="h-5 w-full" /></td>
                  </tr>
                ))
              ) : data.entries.length === 0 ? (
                <tr><td colSpan={6} className="p-6 text-center text-slate-500">No mocks yet.</td></tr>
              ) : (
                data.entries.map((e) => {
                  const me = user && e.user_id === user.id;
                  return (
                    <tr
                      key={e.id}
                      ref={me ? userRowRef : null}
                      className={`border-t border-slate-800 transition ${me ? 'bg-accent/10 ring-1 ring-accent/30' : 'hover:bg-white/[0.02]'}`}
                    >
                      <td className="px-3 py-3 font-mono">
                        <span className="text-accent">{e.rank}</span>
                        {MEDALS[e.rank] && <span className="ml-1">{MEDALS[e.rank]}</span>}
                      </td>
                      <td className="px-3 py-3 text-white font-medium">
                        {e.display_name}
                        {me && <span className="ml-2 text-xs text-accent">you</span>}
                      </td>
                      <td className="px-3 py-3 text-right font-bold text-white tabular-nums">{e.total_score}</td>
                      <td className="px-3 py-3 text-right text-slate-300 tabular-nums hidden sm:table-cell">
                        {e.picks_correct ?? 0}/32
                      </td>
                      <td className="px-3 py-3 text-right text-slate-300 tabular-nums hidden sm:table-cell">
                        {e.exact_picks ?? 0}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-500 hidden md:table-cell">
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
