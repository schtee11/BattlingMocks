import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Card } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { useCountUp } from '../hooks/useCountUp.js';

function Stat({ label, value }) {
  const n = useCountUp(value ?? 0);
  return (
    <div>
      <div className="text-3xl md:text-4xl font-bold text-white tabular-nums">{n}</div>
      <div className="text-xs uppercase tracking-wider text-slate-500 mt-1">{label}</div>
    </div>
  );
}

export default function Home() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    api.getStats().then(setStats).catch(() => {});
  }, []);

  return (
    <div className="route-fade">
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 opacity-60"
          style={{
            backgroundImage:
              'radial-gradient(600px 300px at 20% 0%, rgba(34,211,238,0.14), transparent 60%), radial-gradient(600px 300px at 80% 10%, rgba(245,158,11,0.08), transparent 60%)',
          }}
        />
        <div className="max-w-4xl mx-auto px-4 pt-20 pb-14 text-center">
          <div className="inline-block text-xs tracking-[0.2em] text-accent uppercase mb-3">
            2026 NFL Draft · Round 1
          </div>
          <h1 className="text-4xl md:text-6xl font-extrabold text-white leading-tight">
            Can You Predict the <br />
            <span className="bg-gradient-to-r from-accent to-gold bg-clip-text text-transparent">
              2026 NFL Draft?
            </span>
          </h1>
          <p className="mt-4 text-slate-300 text-lg max-w-2xl mx-auto">
            Submit your 32-pick first round, see how close you get on draft night, and climb the leaderboard.
          </p>
          <div className="mt-7 flex justify-center gap-3 flex-wrap">
            <Link to="/join"><Button size="lg">Build Your Mock</Button></Link>
            <Link to="/leaderboard"><Button size="lg" variant="secondary">View Leaderboard</Button></Link>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="max-w-4xl mx-auto px-4 -mt-4 mb-12">
        <Card className="px-6 py-5 grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          <Stat label="Mocks submitted" value={stats?.total_mocks} />
          <Stat label="Players" value={stats?.total_users} />
          <Stat label="Average score" value={stats?.avg_score} />
          <Stat label="Top score" value={stats?.highest_score} />
        </Card>
        {stats?.is_locked && (
          <div className="mt-3 text-center text-amber-300 text-sm">
            Submissions locked — draft in progress
          </div>
        )}
      </div>

      {/* How it works */}
      <div className="max-w-4xl mx-auto px-4 pb-20">
        <h2 className="text-2xl font-bold text-white mb-5 text-center">How It Works</h2>
        <div className="grid md:grid-cols-3 gap-4">
          {[
            { n: 1, t: 'Make your picks', d: 'Drag prospects into all 32 first-round slots.' },
            { n: 2, t: 'Wait for draft night', d: 'Lock in your mock before the real draft begins.' },
            { n: 3, t: 'See how you scored', d: 'Pick-by-pick breakdown and public leaderboard.' },
          ].map((s) => (
            <Card key={s.n} className="p-5">
              <div className="w-9 h-9 rounded-full bg-accent/15 text-accent flex items-center justify-center font-bold">
                {s.n}
              </div>
              <div className="mt-3 text-white font-semibold">{s.t}</div>
              <div className="text-slate-400 text-sm mt-1">{s.d}</div>
            </Card>
          ))}
        </div>
      </div>

      <footer className="max-w-4xl mx-auto px-4 pb-8 text-center text-slate-600 text-xs">
        MockDraft Showdown · Built for the {stats?.draft_year ?? 2026} NFL Draft
      </footer>
    </div>
  );
}
