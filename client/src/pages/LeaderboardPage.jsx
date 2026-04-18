import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { usePolling } from '../hooks/usePolling.js';
import { prettyName } from '../lib/displayName.js';
import { Card } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { Avatar } from '../components/ui/Avatar.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { usePageMeta } from '../hooks/usePageMeta.js';

const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };

function TrophyIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  );
}

export default function LeaderboardPage() {
  usePageMeta({
    title: '2026 NFL Mock Draft Leaderboard — Live Rankings',
    description:
      'Live leaderboard for every 2026 NFL Mock Draft Simulator entry. See top scouts, exact-match rates, and percentile rank updating in real time on draft night.',
    path: '/leaderboard',
  });
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const userRowRef = useRef(null);

  const fetchLeaderboard = useCallback(() => {
    api
      .getLeaderboard(200, 0)
      .then((d) => {
        setData(d);
        setErr('');
      })
      .catch((e) => setErr(e.message));
  }, []);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  // Live updates: refresh every 15s while the tab is visible
  usePolling(fetchLeaderboard, 15_000);

  const allZero = useMemo(
    () => data?.entries?.length > 0 && data.entries.every((e) => e.total_score === 0),
    [data]
  );

  const topThree = data?.entries?.slice(0, 3) || [];
  const rest = data?.entries?.slice(3) || [];

  // Your own rank + percentile chip (shown above the table when signed in).
  const myRow = useMemo(() => {
    if (!user || !data?.entries?.length) return null;
    return data.entries.find((e) => e.user_id === user.id) || null;
  }, [user, data]);

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

  const loading = !data && !err;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 route-fade">
      <PageHeader
        eyebrow="Standings"
        title="Leaderboard"
        description="Live rankings during draft night. Scores update every 15 seconds."
        actions={
          user && data?.entries?.some((e) => e.user_id === user.id) ? (
            <Button variant="secondary" onClick={scrollToMe}>
              Find Me
            </Button>
          ) : null
        }
        className="mb-5"
      />

      {/* Stats */}
      {loading ? (
        <div className="grid grid-cols-3 gap-3 mb-5">
          {Array.from({ length: 3 }, (_, i) => (
            <Card glass key={i} className="p-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-14 mt-2" />
            </Card>
          ))}
        </div>
      ) : (
        stats && (
          <div className="grid grid-cols-3 gap-3 mb-5">
            <Card glass className="p-4">
              <div className="caption">Participants</div>
              <div className="font-mono text-2xl font-bold tabular text-text-primary mt-1">
                {stats.total}
              </div>
            </Card>
            <Card glass className="p-4">
              <div className="caption">Average Score</div>
              <div className="font-mono text-2xl font-bold tabular text-text-primary mt-1">
                {stats.avg}
              </div>
            </Card>
            <Card glass className="p-4">
              <div className="caption">Top Score</div>
              <div className="font-mono text-2xl font-bold tabular text-gold mt-1">
                {stats.max}
              </div>
            </Card>
          </div>
        )
      )}

      {allZero && (
        <Card className="banner-warn p-4 mb-4">
          <span className="caption" style={{ color: 'var(--warn-text)' }}>
            Scores Revealed Draft Night
          </span>
          <div className="text-[13px] mt-1 opacity-80">
            Mocks are shown in submission order until real results are entered.
          </div>
        </Card>
      )}

      {myRow && !allZero && (
        <Card glass className="p-4 mb-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="caption text-accent">Your Standing</div>
            <div className="font-display font-bold uppercase tracking-wide text-text-primary text-[18px] mt-1">
              Rank #{myRow.rank} · {myRow.total_score} pts
            </div>
          </div>
          <div className="text-right">
            <div className="caption text-[10px]">Percentile</div>
            <div className="font-mono font-bold text-3xl tabular text-gold mt-1">
              {myRow.percentile}%
            </div>
            <div className="text-[10.5px] text-text-muted mt-0.5">
              Higher than {myRow.percentile}% of scouts
            </div>
          </div>
        </Card>
      )}

      {err && (
        <Card className="banner-error p-4 mb-4 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div
              className="font-display font-bold uppercase tracking-[0.12em] text-[12px]"
              style={{ color: 'var(--error-text)' }}
            >
              Couldn't load the leaderboard
            </div>
            <div className="text-[12.5px] mt-1 opacity-85">{err}</div>
          </div>
          <Button size="sm" variant="secondary" onClick={fetchLeaderboard}>
            Retry
          </Button>
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
                className={`p-5 text-center relative ${
                  e.rank === 1 ? 'shadow-glow-gold' : ''
                } ${me ? 'ring-1 ring-accent/40' : ''}`}
              >
                <div className="text-3xl mb-2" aria-hidden="true">
                  {MEDALS[e.rank]}
                </div>
                <div className="flex justify-center mb-2">
                  <Avatar url={e.avatar_url} name={e.display_name} size="lg" />
                </div>
                <div className="caption">#{e.rank}</div>
                <div className="font-display font-bold text-text-primary text-[18px] uppercase tracking-wide mt-1 truncate">
                  {prettyName(e.display_name)}
                  {me && <span className="ml-2 text-[10px] text-accent">YOU</span>}
                </div>
                <div className="font-mono font-bold text-4xl tabular text-gold mt-3">
                  {e.total_score}
                </div>
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
            <caption className="sr-only">Full leaderboard of submitted mocks</caption>
            <thead>
              <tr className="text-left caption">
                <th scope="col" className="px-4 py-3 font-display">
                  Rank
                </th>
                <th scope="col" className="px-4 py-3 font-display">
                  Name
                </th>
                <th scope="col" className="px-4 py-3 font-display text-right">
                  Score
                </th>
                <th scope="col" className="px-4 py-3 font-display text-right hidden sm:table-cell">
                  Correct
                </th>
                <th scope="col" className="px-4 py-3 font-display text-right hidden sm:table-cell">
                  Exact
                </th>
                <th scope="col" className="px-4 py-3 font-display text-right hidden md:table-cell">
                  Submitted
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }, (_, i) => (
                  <tr key={i} className="border-t border-border-subtle">
                    <td className="px-4 py-3" colSpan={6}>
                      <Skeleton className="h-5 w-full" />
                    </td>
                  </tr>
                ))
              ) : data && data.entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-0">
                    <EmptyState
                      icon={<TrophyIcon className="w-7 h-7 text-text-muted" />}
                      title="No mocks submitted yet"
                      description="Be the first to claim the top spot. Build your predictive mock and it will land on the leaderboard the moment you submit."
                      action={
                        <Link to="/draft">
                          <Button>Build Your Mock</Button>
                        </Link>
                      }
                    />
                  </td>
                </tr>
              ) : data ? (
                (allZero ? data.entries : rest).map((e, idx) => {
                  const me = user && e.user_id === user.id;
                  const odd = idx % 2 === 1;
                  return (
                    <tr
                      key={e.id}
                      ref={me ? userRowRef : null}
                      className={`border-t border-border-subtle transition-colors ${
                        odd ? 'bg-white/[0.015]' : ''
                      } ${me ? 'bg-accent/[0.07]' : 'hover:bg-white/[0.03]'}`}
                      style={me ? { borderLeft: '3px solid var(--accent)' } : undefined}
                    >
                      <td className="px-4 py-3 font-mono tabular font-bold">
                        <span className={e.rank <= 3 ? 'text-gold' : 'text-text-secondary'}>
                          {e.rank}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Avatar url={e.avatar_url} name={e.display_name} size="xs" />
                          <span className="text-text-primary font-semibold truncate">
                            {prettyName(e.display_name)}
                          </span>
                          {me && (
                            <span className="font-display uppercase tracking-[0.14em] text-[9.5px] text-accent shrink-0">
                              You
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold tabular text-gold">
                        {e.total_score}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular text-text-secondary hidden sm:table-cell">
                        {e.picks_correct}/32
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular text-text-secondary hidden sm:table-cell">
                        {e.exact_picks}
                      </td>
                      <td className="px-4 py-3 text-right text-text-muted text-[11.5px] hidden md:table-cell">
                        {new Date(e.submitted_at).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
