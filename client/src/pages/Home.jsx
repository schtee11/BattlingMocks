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
      <div className="font-mono font-bold text-3xl md:text-4xl tabular text-text-primary">{n}</div>
      <div className="caption mt-1.5">{label}</div>
    </div>
  );
}

export default function Home() {
  const [stats, setStats] = useState(null);
  useEffect(() => { api.getStats().then(setStats).catch(() => {}); }, []);

  return (
    <div className="route-fade">
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="max-w-5xl mx-auto px-4 pt-20 md:pt-28 pb-14 text-center">
          <div className="caption text-accent mb-4">April 23 · Pittsburgh, PA</div>
          <h1 className="font-display display-xl text-hero text-text-primary">
            Can You Call<br />
            <span style={{ backgroundImage: 'var(--gradient-accent)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>
              The 2026 Draft?
            </span>
          </h1>
          <p className="mt-6 text-[15px] md:text-[16px] text-text-secondary max-w-xl mx-auto">
            Build your 32-pick mock. Score against the real results. Prove you're the best scout.
          </p>
          <div className="mt-8 flex justify-center gap-3 flex-wrap">
            <Link to="/join"><Button size="xl" className="animate-pulse-glow">Build Your Mock →</Button></Link>
            <Link to="/leaderboard">
              <span className="inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary text-[13px] font-display uppercase tracking-[0.14em] py-4 transition">
                View Leaderboard →
              </span>
            </Link>
          </div>
        </div>

        {/* Field-line accent at bottom of hero */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-24" style={{
          backgroundImage: 'linear-gradient(to top, rgba(0,229,255,0.06), transparent)',
          maskImage: 'linear-gradient(to top, black, transparent)',
        }}/>
      </div>

      {/* Stats bar */}
      <div className="max-w-4xl mx-auto px-4 -mt-4 mb-16">
        <Card glass className="px-6 py-6 grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          <Stat label="Mocks Submitted" value={stats?.total_mocks} />
          <Stat label="Scouts Competing" value={stats?.total_users} />
          <Stat label="Average Score" value={stats?.avg_score} />
          <Stat label="Top Score" value={stats?.highest_score} />
        </Card>
        {stats?.is_locked && (
          <div className="mt-3 text-center caption text-amber-300">
            Submissions locked · Draft in progress
          </div>
        )}
      </div>

      {/* How it works */}
      <div className="max-w-4xl mx-auto px-4 pb-24">
        <div className="text-center mb-8">
          <div className="caption text-accent">Three steps</div>
          <h2 className="font-display display-xl text-display text-text-primary mt-1">How It Works</h2>
        </div>
        <div className="grid md:grid-cols-3 gap-4 stagger">
          {[
            { n: 1, t: 'Make your picks', d: 'Drag prospects into all 32 first-round slots.' },
            { n: 2, t: 'Lock it in', d: 'Submit before the real draft begins.' },
            { n: 3, t: 'See how you scored', d: 'Pick-by-pick breakdown and public leaderboard.' },
          ].map((s) => (
            <Card key={s.n} className="p-6">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center font-display font-bold text-bg-deep text-lg"
                style={{ background: 'var(--gradient-accent)' }}
              >
                {s.n}
              </div>
              <div className="mt-4 text-text-primary font-display font-semibold text-[17px] uppercase tracking-wide">{s.t}</div>
              <div className="text-text-secondary text-[13px] mt-1.5">{s.d}</div>
            </Card>
          ))}
        </div>
      </div>

      <footer className="max-w-5xl mx-auto px-4 pb-10 text-center caption">
        MockDraft Showdown · {stats?.draft_year ?? 2026} NFL Draft
      </footer>
    </div>
  );
}
