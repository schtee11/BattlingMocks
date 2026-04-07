import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.js';

function scoreFor(actualSlot, pickSlot) {
  if (actualSlot == null) return { pts: 0, color: 'bg-red-900/40 border-red-700' };
  if (actualSlot === pickSlot) return { pts: 15, color: 'bg-green-900/40 border-green-600' };
  if (Math.abs(actualSlot - pickSlot) <= 5) return { pts: 8, color: 'bg-yellow-900/40 border-yellow-600' };
  return { pts: 5, color: 'bg-blue-900/40 border-blue-600' };
}

export default function MyMock() {
  const { user } = useAuth();
  const [mock, setMock] = useState(null);
  const [actualByPlayer, setActualByPlayer] = useState(new Map());
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!user) return;
    api.getMock(user.id).then(setMock).catch((e) => setErr(e.message));
    fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/settings`)
      .then((r) => r.json())
      .catch(() => {});
  }, [user]);

  // Try to fetch public actuals if exposed; otherwise infer scoring from total only.
  useEffect(() => {
    // Lightweight: fetch leaderboard not needed; we just color picks if total > 0 and we know nothing.
    // Without exposing actual_picks publicly, color shows preview only when scoring has run.
  }, []);

  if (!user) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <p className="text-slate-300 mb-4">Join first to see your mock.</p>
        <Link to="/join" className="text-accent">Join →</Link>
      </div>
    );
  }
  if (err) return <div className="max-w-md mx-auto px-4 py-16 text-slate-400">{err}</div>;
  if (!mock) return <div className="max-w-md mx-auto px-4 py-16 text-slate-400">Loading…</div>;

  const scored = mock.total_score > 0;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-end justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-3xl font-bold text-white">My Mock</h1>
        <div className="text-right">
          <div className="text-slate-400 text-sm">Total Score</div>
          <div className="text-3xl font-bold text-accent">{mock.total_score}</div>
        </div>
      </div>
      {!scored && (
        <div className="bg-panel border border-slate-700 rounded p-3 text-slate-300 text-sm mb-4">
          Scoring will appear after the draft is run.
        </div>
      )}
      <ul className="space-y-1">
        {mock.picks.map((p) => {
          const actualSlot = actualByPlayer.get(p.player_id);
          const { pts, color } = scoreFor(actualSlot, p.pick_number);
          return (
            <li key={p.pick_number} className={`flex items-center gap-3 p-2 rounded border ${scored ? color : 'border-slate-700 bg-panel'}`}>
              <div className="w-8 text-center font-mono text-accent">{p.pick_number}</div>
              <div className="flex-1">
                <div className="text-white font-medium">{p.name}</div>
                <div className="text-xs text-slate-400">{p.position} · {p.school}</div>
              </div>
              {scored && <div className="text-sm font-semibold text-slate-200">+{pts}</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
