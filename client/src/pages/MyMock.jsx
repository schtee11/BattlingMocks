import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { usePolling } from '../hooks/usePolling.js';
import { posHex } from '../lib/positions.js';
import { Card } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { PositionBadge } from '../components/ui/Badge.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { EmptyState } from '../components/ui/EmptyState.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { TeamLogo } from '../components/ui/TeamLogo.jsx';
import { PlayerHeadshot } from '../components/ui/PlayerHeadshot.jsx';
import { useCountUp } from '../hooks/useCountUp.js';
import { usePageMeta } from '../hooks/usePageMeta.js';

// Client-side score preview — mirrors the server scoring tiers defined in
// server/src/services/scoring.js. Used for live coloring on MyMock; the
// authoritative total_score comes from the server after each scoring run.
//
//   Exact (right player at right slot)     : 10  (×1.5 = 15 on confidence picks)
//   Team (right player, right team, wrong slot) : 7
//   R1   (right player, wrong team)         : 3   (+1 bonus if within 3 slots)
//   Miss (player not drafted in R1)         : 0
function scoreFor({ actualForPlayer, predictedSlot, predictedTeam, isConfident }) {
  if (!actualForPlayer) return { pts: 0, label: 'Miss', color: '#ef4444' };
  const delta = Math.abs(actualForPlayer.pick_number - predictedSlot);
  if (actualForPlayer.pick_number === predictedSlot) {
    return { pts: isConfident ? 15 : 10, label: isConfident ? 'Exact ★' : 'Exact', color: '#34d399' };
  }
  if (predictedTeam && actualForPlayer.team === predictedTeam) {
    return { pts: 7, label: 'Team', color: '#fbbf24' };
  }
  const bonus = delta <= 3 ? 1 : 0;
  return { pts: 3 + bonus, label: bonus ? 'In R1 +1' : 'In R1', color: '#3b82f6' };
}

function ClipboardIcon(props) {
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
      <rect x="9" y="2" width="6" height="4" rx="1" />
      <path d="M9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3" />
    </svg>
  );
}

export default function MyMock() {
  usePageMeta({
    title: 'My 2026 NFL Mock Draft — Pick-by-Pick Scoring',
    description:
      'Your submitted 2026 NFL mock draft with pick-by-pick scoring, total points, and live refresh during draft night. Share your card and track your rank.',
    path: '/my-mock',
  });
  const { user } = useAuth();
  const [mock, setMock] = useState(null);
  const [actuals, setActuals] = useState([]);
  const [draftOrder, setDraftOrder] = useState([]);
  const [err, setErr] = useState('');

  const refresh = useCallback(
    async (opts = {}) => {
      if (!user) return;
      try {
        const [m, a, o] = await Promise.all([
          api.getMock(user.id),
          api.getActualPicks({ fresh: !!opts.fresh }),
          api.getDraftOrder(),
        ]);
        setMock(m);
        setActuals(a);
        setDraftOrder(o);
        setErr('');
      } catch (e) {
        if (String(e.message).includes('no mock')) setErr('no_mock');
        else setErr(e.message);
      }
    },
    [user]
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Live updates while the draft is unfolding — refresh actuals every 15s
  usePolling(() => refresh({ fresh: true }), 15_000);

  const actualByPlayer = useMemo(() => {
    const m = new Map();
    actuals.forEach((a) => m.set(a.player_id, a));
    return m;
  }, [actuals]);

  const actualBySlot = useMemo(() => {
    const m = new Map();
    actuals.forEach((a) => m.set(a.pick_number, a));
    return m;
  }, [actuals]);

  const teamBySlot = useMemo(() => {
    const m = new Map();
    draftOrder.forEach((o) => m.set(o.pick_number, o.team));
    return m;
  }, [draftOrder]);

  const scored = actuals.length > 0;
  const totalScore = useCountUp(mock?.total_score ?? 0, 1500);

  const summary = useMemo(() => {
    if (!mock || !scored) return null;
    let exact = 0;
    let team = 0;
    let correct = 0;
    let miss = 0;
    const biggestMisses = [];
    mock.picks.forEach((p) => {
      const a = actualByPlayer.get(p.player_id);
      if (!a) {
        miss++;
        biggestMisses.push({ type: 'undrafted', player: p });
        return;
      }
      if (a.pick_number === p.pick_number) exact++;
      else if (teamBySlot.get(p.pick_number) === a.team) team++;
      else correct++;
    });
    const myIds = new Set(mock.picks.map((p) => p.player_id));
    const r1Missed = actuals.filter((a) => !myIds.has(a.player_id));
    return { exact, team, correct, miss, biggestMisses, r1Missed };
  }, [mock, scored, actualByPlayer, actuals, teamBySlot]);

  if (!user) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 route-fade">
        <Card glass>
          <EmptyState
            title="Sign in to view your mock"
            description="We need to know who you are before we can show your picks. Signing in only takes a second."
            action={
              <Link to="/join">
                <Button>Sign in with Discord</Button>
              </Link>
            }
          />
        </Card>
      </div>
    );
  }
  if (err === 'no_mock') {
    return (
      <div className="max-w-md mx-auto px-4 py-20 route-fade">
        <Card glass>
          <EmptyState
            title="You haven't submitted a mock yet"
            description="Build your 32-pick predictive mock to land on the leaderboard. You can edit it as many times as you want until the draft starts."
            action={
              <Link to="/draft">
                <Button>Build Your Mock</Button>
              </Link>
            }
          />
        </Card>
      </div>
    );
  }
  if (err) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 route-fade">
        <Card className="banner-error p-5">
          <div
            className="font-display font-bold uppercase tracking-[0.12em] text-[12px]"
            style={{ color: 'var(--error-text)' }}
          >
            Couldn't load your mock
          </div>
          <p className="text-[13px] mt-2 opacity-85">{err}</p>
          <div className="mt-3">
            <Button size="sm" variant="secondary" onClick={() => refresh()}>
              Retry
            </Button>
          </div>
        </Card>
      </div>
    );
  }
  if (!mock) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-3">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-32 w-full" />
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  function share() {
    const lines = [`My 2026 Mock Draft — Score: ${mock.total_score}`];
    if (summary) {
      lines.push(
        `Exact: ${summary.exact} · Team: ${summary.team} · In R1: ${summary.correct} · Miss: ${summary.miss}`
      );
    }
    try {
      navigator.clipboard.writeText(lines.join('\n'));
      toast.success('Mock summary copied to clipboard');
    } catch {
      toast.error('Couldn\'t copy — please copy manually');
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 route-fade">
      {/* Summary */}
      <Card glass className="p-6 mb-5">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="min-w-0">
            <PageHeader
              eyebrow="Your Board"
              title="My Mock"
              description={`Submitted ${new Date(mock.submitted_at).toLocaleDateString()}`}
            />
          </div>
          <div className="text-right">
            <div className="caption">Total</div>
            <div className="font-mono font-bold text-6xl tabular text-gold leading-none mt-1">
              {totalScore}
            </div>
            <div className="text-text-muted text-[10.5px] font-display uppercase tracking-[0.14em] mt-1">
              of 352 possible
            </div>
          </div>
        </div>
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
            {[
              { label: 'Exact', val: summary.exact, color: '#34d399' },
              { label: 'Team', val: summary.team, color: '#fbbf24' },
              { label: 'In R1', val: summary.correct, color: '#3b82f6' },
              { label: 'Missed', val: summary.miss, color: '#ef4444' },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-lg p-3 text-center border"
                style={{ background: `${s.color}0f`, borderColor: `${s.color}33` }}
              >
                <div className="font-mono font-bold text-2xl tabular" style={{ color: s.color }}>
                  {s.val}
                </div>
                <div className="caption mt-1 text-[9.5px]">{s.label}</div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2 flex-wrap">
          {!scored && (
            <Link to="/draft">
              <Button variant="secondary" size="sm">
                Edit Mock
              </Button>
            </Link>
          )}
          <Button size="sm" variant="ghost" onClick={share}>
            <ClipboardIcon className="w-4 h-4" />
            Copy Summary
          </Button>
        </div>
      </Card>

      {!scored && (
        <Card className="banner-warn p-3 text-[13px] mb-4">
          <span className="caption" style={{ color: 'var(--warn-text)' }}>
            Awaiting Results
          </span>
          <div className="mt-0.5 opacity-80">
            Scoring will appear after the admin enters the real draft picks.
          </div>
        </Card>
      )}

      {/* Picks */}
      <h2 className="sr-only">Your picks</h2>
      <ul className="space-y-1.5 stagger">
        {mock.picks.map((p) => {
          const a = actualByPlayer.get(p.player_id);
          const teamAbbr = teamBySlot.get(p.pick_number);
          const { pts, label, color } = scoreFor({
            actualForPlayer: a,
            predictedSlot: p.pick_number,
            predictedTeam: teamAbbr,
            isConfident: p.is_confident,
          });
          const actualAtThisSlot = actualBySlot.get(p.pick_number);
          const posColor = posHex(p.position);
          return (
            <li
              key={p.pick_number}
              className="flex items-center gap-3 p-3 rounded-lg border"
              style={
                scored
                  ? {
                      background: `${color}0d`,
                      borderColor: `${color}44`,
                      borderLeft: `4px solid ${color}`,
                    }
                  : {
                      background: 'var(--bg-surface)',
                      borderColor: 'var(--border-subtle)',
                      borderLeft: `3px solid ${posColor}`,
                    }
              }
            >
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center font-mono font-bold text-[13px] shrink-0"
                style={{
                  backgroundColor: posColor,
                  color: '#04080f',
                  boxShadow: `0 0 18px -6px ${posColor}`,
                }}
                aria-label={`Pick ${p.pick_number}`}
              >
                {p.pick_number}
              </div>
              <TeamLogo abbr={teamAbbr} size="sm" />
              <PlayerHeadshot
                url={p.headshot_url}
                name={p.name}
                position={p.position}
                size="sm"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="text-text-primary font-semibold truncate">{p.name}</div>
                  <PositionBadge position={p.position} />
                  {p.is_confident && (
                    <span
                      className="text-gold text-[13px] leading-none"
                      title="Confidence pick (1.5× on exact match)"
                      aria-label="Confidence pick"
                    >
                      ★
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-text-muted truncate">{p.school}</div>
                {scored && actualAtThisSlot && actualAtThisSlot.player_id !== p.player_id && (
                  <div className="text-[11px] text-text-muted mt-0.5">
                    Actual: <span className="text-text-primary">{actualAtThisSlot.name}</span>
                  </div>
                )}
              </div>
              {scored && (
                <div className="text-right shrink-0">
                  <div className="caption text-[9px]" style={{ color }}>
                    {label}
                  </div>
                  <div className="font-mono font-bold text-2xl tabular" style={{ color }}>
                    +{pts}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {scored &&
        summary &&
        (summary.biggestMisses.length > 0 || summary.r1Missed.length > 0) && (
          <Card glass className="p-6 mt-6">
            <div className="caption text-accent">Post-mortem</div>
            <h2 className="font-display display-xl text-[22px] text-text-primary mt-1 mb-4">
              Where you went wrong
            </h2>
            {summary.biggestMisses.length > 0 && (
              <div className="mb-5">
                <div className="caption mb-2">Your picks that went undrafted in R1</div>
                <ul className="text-[13px] text-text-secondary space-y-1">
                  {summary.biggestMisses.map((m) => (
                    <li key={m.player.player_id}>
                      · <span className="text-text-primary">{m.player.name}</span> (
                      {m.player.position}) — pick {m.player.pick_number}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {summary.r1Missed.length > 0 && (
              <div>
                <div className="caption mb-2">R1 picks you missed entirely</div>
                <ul className="text-[13px] text-text-secondary space-y-1">
                  {summary.r1Missed.map((a) => (
                    <li key={a.pick_number}>
                      · Pick {a.pick_number}:{' '}
                      <span className="text-text-primary">{a.name}</span> ({a.position})
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        )}
    </div>
  );
}
