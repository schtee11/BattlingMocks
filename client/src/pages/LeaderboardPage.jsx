import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.js';

export default function LeaderboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState({ entries: [], total: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getLeaderboard(100, 0)
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  const allZero = data.entries.length > 0 && data.entries.every((e) => e.total_score === 0);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-white mb-4">Leaderboard</h1>
      {loading ? (
        <div className="text-slate-400">Loading…</div>
      ) : allZero ? (
        <div className="bg-panel border border-slate-700 rounded p-4 text-slate-300">
          Scores will be calculated once the draft begins.
        </div>
      ) : null}
      <div className="bg-panel rounded-lg overflow-hidden mt-4">
        <table className="w-full text-sm">
          <thead className="bg-ink text-slate-400 text-left">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2 text-right">Score</th>
              <th className="px-3 py-2 text-right hidden sm:table-cell">Submitted</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((e) => {
              const me = user && e.user_id === user.id;
              return (
                <tr key={e.id} className={`border-t border-slate-800 ${me ? 'bg-accent/10' : ''}`}>
                  <td className="px-3 py-2 font-mono text-accent">{e.rank}</td>
                  <td className="px-3 py-2 text-white">{e.display_name}{me && ' (you)'}</td>
                  <td className="px-3 py-2 text-right font-semibold">{e.total_score}</td>
                  <td className="px-3 py-2 text-right text-slate-500 hidden sm:table-cell">
                    {new Date(e.submitted_at).toLocaleDateString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data.entries.length === 0 && !loading && (
          <div className="p-4 text-slate-500 text-center">No mocks yet.</div>
        )}
      </div>
    </div>
  );
}
