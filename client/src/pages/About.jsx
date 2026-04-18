import { Link } from 'react-router-dom';
import { Card } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { usePageMeta } from '../hooks/usePageMeta.js';

export default function About() {
  usePageMeta({
    title: 'About MockDraft Showdown — Free NFL Mock Draft Simulator',
    description:
      'About MockDraft Showdown: a free NFL mock draft simulator for the 2026 NFL Draft. Our scoring methodology, trade logic, and why the platform will always be free.',
    path: '/about',
  });

  return (
    <article className="max-w-3xl mx-auto px-4 py-10 md:py-16 route-fade">
      <header className="text-center mb-10">
        <div className="caption text-accent mb-3">About · MockDraft Showdown</div>
        <h1 className="font-display display-xl text-display text-text-primary">
          A Free NFL Mock Draft Simulator Built Around a Contest
        </h1>
        <p className="text-text-secondary mt-4 text-[14px] md:text-[15px] leading-relaxed max-w-2xl mx-auto">
          MockDraft Showdown is the only NFL mock draft simulator built around a
          public, live-scored predictive contest. Every mode is free. No paywall.
          No hidden upsell.
        </p>
      </header>

      <Card glass className="p-6 md:p-8 mb-8">
        <h2 className="font-display uppercase tracking-wide text-text-primary text-[18px] mb-3">
          What the simulator does
        </h2>
        <ul className="text-[13.5px] text-text-secondary space-y-3 pl-4">
          <li>
            <strong className="text-text-primary">Predictive Round 1 mock</strong> —
            build a 32-pick mock of the 2026 NFL Draft and score live against the
            real picks on draft night.
          </li>
          <li>
            <strong className="text-text-primary">Full 7-round team mock</strong> —
            GM any NFL team through all 7 rounds, trade up or down, and earn a
            post-draft grade.
          </li>
          <li>
            <strong className="text-text-primary">Personal big board</strong> —
            rank every prospect your way and have the simulator respect your
            rankings.
          </li>
          <li>
            <strong className="text-text-primary">Live draft tracker</strong> —
            watch your predictions score in real time during the real NFL Draft.
          </li>
          <li>
            <strong className="text-text-primary">Public leaderboard</strong> —
            compete against every user for percentile rank and exact-match rate.
          </li>
        </ul>
      </Card>

      <Card glass className="p-6 md:p-8 mb-8">
        <h2 className="font-display uppercase tracking-wide text-text-primary text-[18px] mb-3">
          Scoring methodology
        </h2>
        <p className="text-text-secondary text-[14px] leading-relaxed">
          Predictive mocks are graded against the official NFL Draft results using a
          tiered scoring system:
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-[13px] border-separate border-spacing-0">
            <thead>
              <tr className="text-text-muted uppercase tracking-wider text-[11px]">
                <th className="text-left pb-2 pr-3">Tier</th>
                <th className="text-left pb-2 pr-3">Meaning</th>
                <th className="text-left pb-2">Points</th>
              </tr>
            </thead>
            <tbody className="text-text-secondary">
              <tr>
                <td className="py-1.5 pr-3 text-text-primary font-display">Exact</td>
                <td className="py-1.5 pr-3">Right player, right slot</td>
                <td className="py-1.5">10 (×1.5 on confidence = 15)</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 text-text-primary font-display">Team</td>
                <td className="py-1.5 pr-3">Right player, right team, wrong slot</td>
                <td className="py-1.5">7</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 text-text-primary font-display">In R1</td>
                <td className="py-1.5 pr-3">Right player, wrong team</td>
                <td className="py-1.5">3 (+1 if within 3 slots)</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 text-text-primary font-display">Miss</td>
                <td className="py-1.5 pr-3">Not drafted in Round 1</td>
                <td className="py-1.5">0</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card glass className="p-6 md:p-8 mb-8">
        <h2 className="font-display uppercase tracking-wide text-text-primary text-[18px] mb-3">
          How CPU teams draft
        </h2>
        <p className="text-text-secondary text-[14px] leading-relaxed">
          In team mock mode, CPU teams draft on a best-player-available plus
          team-needs engine. They consider positional value, roster depth, recent
          free-agent moves, and coach tendencies. Trades are proposed when the value
          chart and team needs align — accepted or rejected based on an acceptance
          probability that models reluctance to deal inside division, premium picks,
          or star players.
        </p>
      </Card>

      <Card glass className="p-6 md:p-8 mb-8">
        <h2 className="font-display uppercase tracking-wide text-text-primary text-[18px] mb-3">
          Trade value
        </h2>
        <p className="text-text-secondary text-[14px] leading-relaxed">
          We use the{' '}
          <strong className="text-text-primary">Rich Hill trade value chart</strong>{' '}
          — the modern baseline for NFL pick valuation — as the foundation for all
          trade proposals and fairness meters. Future picks depreciate by
          approximately one round per year, consistent with how actual NFL front
          offices treat them.
        </p>
      </Card>

      <Card glass className="p-6 md:p-8 mb-8">
        <h2 className="font-display uppercase tracking-wide text-text-primary text-[18px] mb-3">
          Why it&apos;s free
        </h2>
        <p className="text-text-secondary text-[14px] leading-relaxed">
          Because the best NFL mock draft simulator shouldn&apos;t cost anything. We
          don&apos;t sell user data, we don&apos;t gate features behind subscriptions,
          and we don&apos;t show pop-up ads. The only thing we ask is that you
          actually submit a mock — that&apos;s how the leaderboard stays fun.
        </p>
      </Card>

      <div className="text-center mt-10">
        <Link to="/draft">
          <Button size="xl" className="animate-pulse-glow">
            Build Your 2026 Mock Draft →
          </Button>
        </Link>
        <div className="mt-4 text-[12.5px] text-text-muted">
          New here?{' '}
          <Link to="/guide" className="text-accent hover:underline">
            Read the complete mock draft guide
          </Link>
          .
        </div>
      </div>
    </article>
  );
}
