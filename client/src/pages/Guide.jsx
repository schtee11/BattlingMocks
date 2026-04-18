import { Link } from 'react-router-dom';
import { Card } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { usePageMeta } from '../hooks/usePageMeta.js';

export default function Guide() {
  usePageMeta({
    title: 'How to Do a 2026 NFL Mock Draft — Complete Guide',
    description:
      'A complete guide to the 2026 NFL Mock Draft: predictive vs. team mock modes, scoring rules, trade strategy, and tips to build a smarter NFL mock draft simulator run.',
    path: '/guide',
  });

  return (
    <article className="max-w-3xl mx-auto px-4 py-10 md:py-16 route-fade">
      <header className="text-center mb-10">
        <div className="caption text-accent mb-3">2026 NFL Draft · Complete Guide</div>
        <h1 className="font-display display-xl text-display text-text-primary">
          How to Do a 2026 NFL Mock Draft
        </h1>
        <p className="text-text-secondary mt-4 text-[14px] md:text-[15px] leading-relaxed max-w-2xl mx-auto">
          Everything you need to build a smarter 2026 NFL mock draft — from picking
          between predictive and team mock modes to confidence picks, trade value, and
          live draft-night scoring.
        </p>
      </header>

      <Card glass className="p-6 md:p-8 mb-8">
        <h2 className="font-display uppercase tracking-wide text-text-primary text-[18px] mb-3">
          What is an NFL mock draft?
        </h2>
        <p className="text-text-secondary text-[14px] leading-relaxed">
          An NFL mock draft is a prediction of which players each team will select in
          the upcoming NFL Draft. Mock drafts come in two main flavors:{' '}
          <strong className="text-text-primary">predictive mocks</strong>, where you try
          to guess what each team will actually do, and{' '}
          <strong className="text-text-primary">team mocks</strong>, where you run a
          single team&apos;s draft yourself while a simulator handles the other 31
          franchises.
        </p>
      </Card>

      <Card glass className="p-6 md:p-8 mb-8">
        <h2 className="font-display uppercase tracking-wide text-text-primary text-[18px] mb-3">
          Predictive vs. Team Mock — which should you pick?
        </h2>
        <div className="grid md:grid-cols-2 gap-4 mt-4">
          <div className="rounded-lg p-5 border border-border-subtle">
            <div className="caption text-accent mb-2">Predictive Mock</div>
            <h3 className="font-display uppercase tracking-wide text-text-primary text-[15px]">
              You predict the real draft
            </h3>
            <p className="text-text-secondary text-[13px] leading-relaxed mt-2">
              Build a 32-pick Round 1 mock before the real draft starts. On draft
              night, every actual pick scores your prediction in real time. Best for
              fans who love following the rumor mill and want to prove they nailed it.
            </p>
            <div className="mt-4">
              <Link to="/draft">
                <Button size="sm">Try the predictive simulator →</Button>
              </Link>
            </div>
          </div>
          <div className="rounded-lg p-5 border border-border-subtle">
            <div className="caption text-accent mb-2">Team Mock</div>
            <h3 className="font-display uppercase tracking-wide text-text-primary text-[15px]">
              You GM a team through all 7 rounds
            </h3>
            <p className="text-text-secondary text-[13px] leading-relaxed mt-2">
              Pick any NFL team and run their draft yourself. CPU teams draft on
              best-player-available plus team needs, and you can propose trades up or
              down with a fairness meter. Best for fantasy-style roster building.
            </p>
            <div className="mt-4">
              <Link to="/team-mock">
                <Button size="sm" variant="secondary">
                  Try the 7-round simulator →
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </Card>

      <Card glass className="p-6 md:p-8 mb-8">
        <h2 className="font-display uppercase tracking-wide text-text-primary text-[18px] mb-3">
          How live draft-night scoring works
        </h2>
        <p className="text-text-secondary text-[14px] leading-relaxed mb-4">
          Predictive mocks on MockDraft Showdown are scored pick by pick the moment
          the real NFL Draft plays out. The tiers:
        </p>
        <ul className="text-[13.5px] text-text-secondary space-y-2 pl-4">
          <li>
            <strong className="text-text-primary">Exact (10 pts)</strong> — right
            player at the right slot. Confidence picks score 15.
          </li>
          <li>
            <strong className="text-text-primary">Team (7 pts)</strong> — right player
            goes to the right team, but at a different slot than you predicted.
          </li>
          <li>
            <strong className="text-text-primary">In Round 1 (3 pts + 1 bonus)</strong>{' '}
            — right player is drafted in Round 1, but to a different team. +1 bonus if
            your predicted slot was within three of the real slot.
          </li>
          <li>
            <strong className="text-text-primary">Miss (0 pts)</strong> — the player
            you predicted was not drafted in Round 1.
          </li>
        </ul>
        <p className="text-text-secondary text-[13.5px] leading-relaxed mt-4">
          You can flag up to <strong className="text-text-primary">three confidence
          picks</strong> per mock for a 1.5× multiplier on exact matches — a classic
          risk/reward lever if you&apos;re chasing the leaderboard.
        </p>
      </Card>

      <Card glass className="p-6 md:p-8 mb-8">
        <h2 className="font-display uppercase tracking-wide text-text-primary text-[18px] mb-3">
          Trade strategy in a 7-round mock draft
        </h2>
        <p className="text-text-secondary text-[14px] leading-relaxed">
          Our team mock draft simulator uses the{' '}
          <strong className="text-text-primary">Rich Hill trade value chart</strong> —
          the modern standard for NFL draft pick valuation — plus a fairness meter
          that accounts for team need and positional scarcity. Tips:
        </p>
        <ul className="text-[13.5px] text-text-secondary space-y-2 pl-4 mt-3">
          <li>
            Trading <strong className="text-text-primary">down</strong> is almost
            always positive expected value — more picks = more hits.
          </li>
          <li>
            Trading <strong className="text-text-primary">up</strong> is only worth
            the premium when you have a clear conviction on a specific player the
            board won&apos;t make it to.
          </li>
          <li>
            Future picks depreciate by roughly a round, so a 2027 Round 1 is close to
            a current Round 2 in value.
          </li>
          <li>
            Target teams that have picks they don&apos;t need — reloading contenders
            love to trade back, rebuilding teams love to stockpile.
          </li>
        </ul>
      </Card>

      <Card glass className="p-6 md:p-8 mb-8">
        <h2 className="font-display uppercase tracking-wide text-text-primary text-[18px] mb-3">
          Tips for a smarter NFL mock draft
        </h2>
        <ul className="text-[13.5px] text-text-secondary space-y-2 pl-4">
          <li>
            Start with team needs, not the big board. A top-ranked QB does not go to
            a team with a franchise QB already locked in.
          </li>
          <li>
            Read beat writers for each team — local reporters leak intent long before
            national media catches up.
          </li>
          <li>
            Respect positional value. Elite QBs, OTs, and EDGEs go earlier than their
            raw grade because the market pays a premium for premium positions.
          </li>
          <li>
            Watch the pro day and combine numbers. A 40-time bump or a clean medical
            re-check can move a prospect five slots in a week.
          </li>
          <li>
            Don&apos;t over-fit to consensus. The leaderboard rewards correct
            contrarian picks — if you think a QB is rising, back it with a confidence
            flag.
          </li>
        </ul>
      </Card>

      <Card glass className="p-6 md:p-8 mb-8">
        <h2 className="font-display uppercase tracking-wide text-text-primary text-[18px] mb-3">
          Frequently asked questions
        </h2>
        <div className="space-y-5 text-[13.5px]">
          <div>
            <div className="font-display uppercase tracking-wide text-text-primary text-[14px]">
              Is the NFL mock draft simulator free?
            </div>
            <p className="text-text-secondary leading-relaxed mt-1">
              Yes. Every mode — predictive, team mock, big board, live scoring — is
              100% free with no paywall and unlimited saves.
            </p>
          </div>
          <div>
            <div className="font-display uppercase tracking-wide text-text-primary text-[14px]">
              Does the simulator cover all 7 rounds?
            </div>
            <p className="text-text-secondary leading-relaxed mt-1">
              Yes. Team mock mode covers all 7 rounds of the 2026 NFL Draft with CPU
              teams drafting for every slot you don&apos;t own.
            </p>
          </div>
          <div>
            <div className="font-display uppercase tracking-wide text-text-primary text-[14px]">
              Can I trade picks?
            </div>
            <p className="text-text-secondary leading-relaxed mt-1">
              Yes. Propose trades up or down with any CPU team. A fairness meter
              scores the deal using the Rich Hill value chart plus team-need
              modifiers.
            </p>
          </div>
          <div>
            <div className="font-display uppercase tracking-wide text-text-primary text-[14px]">
              When is the 2026 NFL Draft?
            </div>
            <p className="text-text-secondary leading-relaxed mt-1">
              The 2026 NFL Draft runs April 23–25, 2026 in Pittsburgh, PA. Round 1
              kicks off Thursday, April 23. Our live leaderboard and scoring engine
              go live with the first pick.
            </p>
          </div>
        </div>
      </Card>

      <div className="text-center mt-10">
        <Link to="/draft">
          <Button size="xl" className="animate-pulse-glow">
            Start Your 2026 Mock Draft →
          </Button>
        </Link>
        <div className="mt-4 text-[12.5px] text-text-muted">
          Or{' '}
          <Link to="/team-mock" className="text-accent hover:underline">
            run a full 7-round team mock
          </Link>
          .
        </div>
      </div>
    </article>
  );
}
