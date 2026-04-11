import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Card } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { useCountUp } from '../hooks/useCountUp.js';
import { CountdownTimer, DRAFT_START_2026 } from '../components/ui/CountdownTimer.jsx';
import { usePageMeta } from '../hooks/usePageMeta.js';

// Animated number block — defers rendering the count-up until the value
// lands from the API, so the skeleton → number swap is always honest.
function Stat({ label, value, loading }) {
  const n = useCountUp(value ?? 0);
  return (
    <div>
      {loading ? (
        <Skeleton className="h-9 w-20 mx-auto" />
      ) : (
        <div className="font-mono font-bold text-3xl md:text-4xl tabular text-text-primary">
          {n}
        </div>
      )}
      <div className="caption mt-1.5">{label}</div>
    </div>
  );
}

export default function Home() {
  usePageMeta({
    title: 'MockDraft Showdown · 2026 NFL Draft',
    description:
      "Predict the 2026 NFL Draft and prove you're right. Live draft-night scoring, full 7-round team mocks, and a public leaderboard. 100% free.",
    suffix: false,
  });
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .getStats()
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => {
        // Stats are non-essential — fall through so the page still renders.
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isLive = !!stats?.is_locked;

  return (
    <div className="route-fade">
      {/* Hero */}
      <div className="relative">
        <div className="max-w-5xl mx-auto px-4 pt-14 md:pt-24 pb-10 text-center">
          <div className="caption text-accent mb-4">
            Thursday, April 23, 2026 · Pittsburgh, PA
          </div>
          <h1 className="font-display display-xl text-hero text-text-primary">
            Predict The Draft.<br />
            <span
              style={{
                backgroundImage: 'var(--gradient-accent)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              Prove You're Right.
            </span>
          </h1>
          <p className="mt-6 text-[15px] md:text-[16px] text-text-secondary max-w-xl mx-auto leading-relaxed">
            Build a 32-pick predictive mock and climb the public leaderboard when the real
            draft starts. Or GM your favorite franchise through all 7 rounds in team mock
            mode.
          </p>
          <div className="mt-8 flex justify-center gap-3 flex-wrap">
            {/* Primary CTA rotates based on draft state so "the most important
                thing right now" is always the first button. */}
            {isLive ? (
              <>
                <Link to="/live">
                  <Button size="xl" className="animate-pulse-glow">
                    Watch Live →
                  </Button>
                </Link>
                <Link to="/leaderboard">
                  <Button size="xl" variant="secondary">
                    Leaderboard →
                  </Button>
                </Link>
              </>
            ) : (
              <>
                <Link to="/draft" aria-label="Start a predictive draft">
                  <Button size="xl" className="animate-pulse-glow">
                    Predictive Draft →
                  </Button>
                </Link>
                <Link to="/team-mock" aria-label="Run a team mock draft">
                  <Button size="xl" variant="secondary">
                    Team Mock Draft →
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Countdown */}
      <div className="max-w-4xl mx-auto px-4 mb-14">
        <Card glass className="px-6 py-8">
          <CountdownTimer target={DRAFT_START_2026} label="Round 1 Kickoff" />
          {isLive && (
            <div className="mt-4 text-center caption" style={{ color: 'var(--warn-text)' }}>
              Submissions locked · Draft in progress
            </div>
          )}
        </Card>
      </div>

      {/* Stats bar */}
      <div className="max-w-4xl mx-auto px-4 mb-16">
        <Card glass className="px-6 py-6 grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          <Stat label="Mocks Submitted" value={stats?.total_mocks} loading={statsLoading} />
          <Stat label="Scouts Competing" value={stats?.total_users} loading={statsLoading} />
          <Stat label="Average Score" value={stats?.avg_score} loading={statsLoading} />
          <Stat label="Top Score" value={stats?.highest_score} loading={statsLoading} />
        </Card>
      </div>

      {/* Feature highlights — two modes */}
      <div className="max-w-5xl mx-auto px-4 mb-16">
        <div className="text-center mb-8">
          <div className="caption text-accent">Two Ways To Play</div>
          <h2 className="font-display display-xl text-display text-text-primary mt-1">
            Pick Your Mode
          </h2>
        </div>
        <div className="grid md:grid-cols-2 gap-4 stagger">
          {/* Predictive mode card */}
          <Card className="p-6 md:p-7 flex flex-col">
            <div className="caption text-accent mb-2">Predictive · Free · Ranked</div>
            <h3 className="font-display font-bold uppercase tracking-wide text-[22px] text-text-primary">
              Predictive Draft
            </h3>
            <p className="text-text-secondary text-[13.5px] leading-relaxed mt-2 flex-1">
              Predict who every team <em>actually</em> drafts in Round 1. Lock your picks
              before the real draft starts, then watch them score in real-time on draft
              night. Nail exact matches, earn confidence bonuses, climb the public
              leaderboard. Nobody else runs this contest.
            </p>
            <ul className="mt-4 space-y-1.5 text-[12.5px] text-text-secondary">
              <li className="flex items-start gap-2">
                <span className="text-accent">•</span> 32 first-round picks, scored against reality
              </li>
              <li className="flex items-start gap-2">
                <span className="text-accent">•</span> Mark up to 3 confidence picks for a 1.5× multiplier
              </li>
              <li className="flex items-start gap-2">
                <span className="text-accent">•</span> Live draft-night leaderboard + percentile rank
              </li>
            </ul>
            <div className="mt-5">
              <Link to="/draft">
                <Button size="lg">Start Predicting →</Button>
              </Link>
            </div>
          </Card>

          {/* Team mock mode card */}
          <Card className="p-6 md:p-7 flex flex-col">
            <div className="caption text-accent mb-2">Team Mock · Free · Unlimited</div>
            <h3 className="font-display font-bold uppercase tracking-wide text-[22px] text-text-primary">
              Team Mock Draft
            </h3>
            <p className="text-text-secondary text-[13.5px] leading-relaxed mt-2 flex-1">
              Pick a team and GM them through all 7 rounds. CPU teams draft on a BPA +
              team-needs engine with trade logic. Propose trades up or down, get a fairness
              read, and collect a full draft grade when you're done.
            </p>
            <ul className="mt-4 space-y-1.5 text-[12.5px] text-text-secondary">
              <li className="flex items-start gap-2">
                <span className="text-accent">•</span> All 32 teams, all 7 rounds, unlimited saves
              </li>
              <li className="flex items-start gap-2">
                <span className="text-accent">•</span> Rich Hill trade value chart + fairness meter
              </li>
              <li className="flex items-start gap-2">
                <span className="text-accent">•</span> Post-draft grade on value and need fit
              </li>
            </ul>
            <div className="mt-5">
              <Link to="/team-mock">
                <Button size="lg" variant="secondary">
                  Run A Sim →
                </Button>
              </Link>
            </div>
          </Card>
        </div>
      </div>

      {/* How it works */}
      <div className="max-w-4xl mx-auto px-4 pb-16">
        <div className="text-center mb-8">
          <div className="caption text-accent">Three steps</div>
          <h2 className="font-display display-xl text-display text-text-primary mt-1">
            How It Works
          </h2>
        </div>
        <div className="grid md:grid-cols-3 gap-4 stagger">
          {[
            { n: 1, t: 'Make your picks', d: 'Drag prospects into all 32 first-round slots.' },
            { n: 2, t: 'Draft night scores it', d: 'We grade every pick the moment it happens.' },
            { n: 3, t: 'Climb the leaderboard', d: 'See your rank, share your card, come back next year.' },
          ].map((s) => (
            <Card key={s.n} className="p-6">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center font-display font-bold text-bg-deep text-lg"
                style={{ background: 'var(--gradient-accent)' }}
                aria-hidden="true"
              >
                {s.n}
              </div>
              <div className="mt-4 text-text-primary font-display font-semibold text-[17px] uppercase tracking-wide">
                {s.t}
              </div>
              <div className="text-text-secondary text-[13.5px] leading-relaxed mt-1.5">
                {s.d}
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-border-subtle mt-10">
        <div className="max-w-5xl mx-auto px-4 py-10 grid gap-8 md:grid-cols-3 text-[13px]">
          <div>
            <div className="font-display font-bold uppercase tracking-[0.14em] text-text-primary">
              MockDraft Showdown
            </div>
            <p className="text-text-secondary mt-2 text-[12.5px] leading-relaxed">
              The only mock draft platform built around a predictive contest. 100% free, no
              paywall. Live draft-night scoring and an unlimited team mock sandbox — all in
              one place.
            </p>
          </div>
          <div>
            <div className="caption mb-3">Play</div>
            <ul className="space-y-1.5">
              <li>
                <Link className="text-text-secondary hover:text-accent transition" to="/draft">
                  Predictive Draft
                </Link>
              </li>
              <li>
                <Link className="text-text-secondary hover:text-accent transition" to="/team-mock">
                  Team Mock Draft
                </Link>
              </li>
              <li>
                <Link className="text-text-secondary hover:text-accent transition" to="/leaderboard">
                  Leaderboard
                </Link>
              </li>
              <li>
                <Link className="text-text-secondary hover:text-accent transition" to="/live">
                  Live Draft Night
                </Link>
              </li>
              <li>
                <Link className="text-text-secondary hover:text-accent transition" to="/my-mock">
                  My Mock
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <div className="caption mb-3">About</div>
            <ul className="space-y-1.5 text-text-secondary">
              <li>2026 NFL Draft coverage</li>
              <li>Free forever · No paywall</li>
              <li>Built for draft obsessives</li>
            </ul>
          </div>
        </div>
        <div className="border-t border-border-subtle">
          <div className="max-w-5xl mx-auto px-4 py-4 text-center caption">
            MockDraft Showdown · {stats?.draft_year ?? 2026} NFL Draft
          </div>
        </div>
      </footer>
    </div>
  );
}
