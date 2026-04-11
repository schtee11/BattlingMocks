import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { usePolling } from '../hooks/usePolling.js';
import { Card } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { TeamLogo } from '../components/ui/TeamLogo.jsx';
import { PlayerHeadshot } from '../components/ui/PlayerHeadshot.jsx';
import { PositionBadge } from '../components/ui/Badge.jsx';
import { CountdownTimer, DRAFT_START_2026 } from '../components/ui/CountdownTimer.jsx';
import { usePageMeta } from '../hooks/usePageMeta.js';

// Live draft night page. Polls the /api/predictive/live bundle every ~12s
// and renders two panels:
//   1. The current actual R1 picks (lit up as they come in)
//   2. Your picks side-by-side with actuals, color-coded by match state
//   3. The top leaderboard, updating live
//
// Designed to stay watchable for an hour+ on draft night. The polling is
// paused automatically when the tab isn't visible (usePolling handles that).

function computeMatchState(actualPick, yourPicks) {
  // Given an actual pick and a user's predicted picks, return the state for
  // their prediction at that slot and their prediction of that player.
  if (!actualPick) return { slotState: 'pending', playerState: 'pending' };
  const yourPickAtSlot = yourPicks.find((p) => p.pick_number === actualPick.pick_number);
  const yourPickForPlayer = yourPicks.find((p) => p.player_id === actualPick.player_id);
  let slotState = 'miss';
  if (yourPickAtSlot && yourPickAtSlot.player_id === actualPick.player_id) slotState = 'exact';
  else if (yourPickForPlayer) slotState = 'close';
  return { slotState, yourPickAtSlot, yourPickForPlayer };
}

export default function Live() {
  usePageMeta({
    title: 'Live Draft Night',
    description:
      'Watch the 2026 NFL Draft unfold live with your predictions lighting up in real time. Your picks score as each team goes on the clock.',
  });
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [players, setPlayers] = useState([]);
  const [err, setErr] = useState('');

  async function refresh(opts = {}) {
    try {
      const [live, p] = await Promise.all([
        api.getPredictiveLive({ fresh: !!opts.fresh }),
        players.length ? Promise.resolve(players) : api.getPlayers(),
      ]);
      setData(live);
      if (!players.length) setPlayers(p);
    } catch (e) {
      setErr(e.message);
    }
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);
  usePolling(() => refresh({ fresh: true }), 12_000);

  const playerById = useMemo(() => {
    const m = new Map();
    players.forEach((p) => m.set(p.id, p));
    return m;
  }, [players]);

  const myMock = useMemo(() => {
    if (!user || !data) return null;
    return data.mocks.find((m) => m.user_id === user.id) || null;
  }, [user, data]);

  const actualsBySlot = useMemo(() => {
    const m = new Map();
    (data?.actuals || []).forEach((a) => m.set(a.pick_number, a));
    return m;
  }, [data]);

  if (err) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center">
        <Card glass className="p-7">
          <p className="text-red-300 text-[13px] mb-4">Live mode unavailable: {err}</p>
          <Link to="/"><Button variant="secondary">Home</Button></Link>
        </Card>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-3">
        <Skeleton className="h-14 w-72" />
        <Skeleton className="h-24 w-full" />
        {Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-14 w-full" />)}
      </div>
    );
  }

  const totalActual = data.actuals.length;
  const isLive = totalActual > 0;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 route-fade">
      {/* Header */}
      <div className="mb-5">
        <div className="caption text-accent">Live Draft Night</div>
        <div className="flex items-end justify-between gap-4 flex-wrap mt-1">
          <h1 className="font-display display-xl text-display text-text-primary">
            {isLive ? `${totalActual} / 32 Picks In` : 'Waiting For Round 1'}
          </h1>
          {!isLive && (
            <div className="text-right">
              <div className="caption text-[10px]">Kickoff in</div>
              <div className="mt-1"><CountdownTimer target={DRAFT_START_2026} compact /></div>
            </div>
          )}
        </div>
        <p className="text-text-secondary text-[13px] mt-2">
          {isLive
            ? 'Picks are updating live. Your predictions light up green for exact matches and yellow when the right player lands on a different team.'
            : 'This page goes live when Round 1 kicks off. Your predictions will score in real time as each pick comes in.'}
        </p>
      </div>

      {/* Your results strip */}
      {user && myMock && (
        <Card glass className="px-5 py-4 mb-5">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="caption text-[10px]">Your Mock</div>
              <div className="font-display font-bold uppercase tracking-wide text-text-primary text-[16px]">
                {myMock.display_name}
              </div>
            </div>
            <YourLiveSummary mock={myMock} actuals={data.actuals} />
          </div>
        </Card>
      )}

      {/* Live board */}
      <Card glass className="p-4 mb-5">
        <div className="flex items-center justify-between mb-3">
          <div className="caption">Round 1 Live Board</div>
          <div className="text-text-muted text-[11px] font-mono tabular">updates every 12s</div>
        </div>
        <ul className="space-y-1.5">
          {Array.from({ length: 32 }, (_, i) => i + 1).map((slot) => {
            const actual = actualsBySlot.get(slot);
            const yourPicks = myMock?.picks || [];
            const match = actual
              ? computeMatchState(actual, yourPicks)
              : { slotState: 'pending' };
            const color =
              match.slotState === 'exact' ? '#34d399'
              : match.slotState === 'close' ? '#fbbf24'
              : match.slotState === 'miss' ? '#ef4444'
              : null;
            const yourPick = yourPicks.find((p) => p.pick_number === slot);
            const yourPlayer = yourPick ? playerById.get(yourPick.player_id) : null;
            return (
              <li
                key={slot}
                className="flex items-center gap-3 p-2.5 rounded-lg border transition-all"
                style={{
                  background: actual
                    ? `${color}0d`
                    : 'var(--bg-surface)',
                  borderColor: actual ? `${color}44` : 'var(--border-subtle)',
                  borderLeft: actual ? `4px solid ${color}` : `3px solid var(--border-subtle)`,
                }}
              >
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center font-mono font-bold text-[12px] shrink-0"
                  style={{
                    backgroundColor: actual ? color : 'transparent',
                    color: actual ? '#04080f' : 'var(--text-secondary)',
                    boxShadow: actual
                      ? `0 0 14px -4px ${color}`
                      : 'inset 0 0 0 1.5px rgba(255,255,255,0.08)',
                  }}
                >
                  {slot}
                </div>
                <TeamLogo abbr={actual?.team} size="sm" />
                {actual ? (
                  <div className="flex-1 min-w-0 flex items-center gap-3">
                    <PlayerHeadshot
                      url={actual.headshot_url}
                      name={actual.name}
                      position={actual.position}
                      size="xs"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-text-primary font-semibold text-[13px] truncate">
                          {actual.name}
                        </div>
                        <PositionBadge position={actual.position} />
                      </div>
                      <div className="text-[11px] text-text-muted truncate">
                        {yourPlayer
                          ? yourPlayer.id === actual.player_id
                            ? 'You called it ✓'
                            : `You had: ${yourPlayer.name}`
                          : user
                          ? 'You had no prediction here'
                          : null}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 text-[12px] text-text-muted">
                    {yourPlayer ? `Your call: ${yourPlayer.name} · ${yourPlayer.position}` : 'On deck…'}
                  </div>
                )}
                {actual && match.slotState !== 'pending' && (
                  <div className="shrink-0 text-right">
                    <div
                      className="caption text-[9px]"
                      style={{ color }}
                    >
                      {match.slotState === 'exact' ? 'Exact' : match.slotState === 'close' ? 'Close' : 'Miss'}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      {/* Live leaderboard */}
      <Card glass className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="caption">Live Leaderboard</div>
          <Link to="/leaderboard" className="caption text-accent hover:underline">View full →</Link>
        </div>
        {data.leaderboard.length === 0 ? (
          <div className="text-text-muted text-[12px] text-center py-4">No mocks submitted yet.</div>
        ) : (
          <ol className="space-y-1">
            {data.leaderboard.slice(0, 10).map((row) => (
              <li
                key={row.id}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg ${
                  user && row.user_id === user.id ? 'bg-accent/5 border border-accent/25' : ''
                }`}
              >
                <div className="font-mono font-bold text-[13px] tabular w-8 text-text-muted">
                  #{row.rank}
                </div>
                <div className="flex-1 text-text-primary text-[13px] truncate">{row.display_name}</div>
                <div className="font-mono font-bold text-[16px] tabular text-gold">
                  {row.total_score}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {!user && (
        <div className="mt-6 text-center">
          <Link to="/join">
            <Button>Claim Your Name To Compete</Button>
          </Link>
        </div>
      )}
    </div>
  );
}

// Compute and display the user's running score for the live page. Uses the
// same tiers as the server-side scoring service. Doesn't need to persist —
// the server recomputes total_score on each actual-pick insert.
function YourLiveSummary({ mock, actuals }) {
  const picks = mock.picks || [];
  const actualById = new Map();
  actuals.forEach((a) => actualById.set(a.player_id, a));
  const actualBySlot = new Map();
  actuals.forEach((a) => actualBySlot.set(a.pick_number, a));

  let exact = 0;
  let close = 0;
  let miss = 0;
  let running = 0;
  for (const p of picks) {
    const a = actualById.get(p.player_id);
    const slotMatch = actualBySlot.get(p.pick_number);
    if (a && a.pick_number === p.pick_number) {
      exact++;
      running += p.is_confident ? 15 : 10;
    } else if (a) {
      close++;
      running += 3;
      if (Math.abs(a.pick_number - p.pick_number) <= 3) running += 1;
    } else if (slotMatch) {
      // Slot filled but not with your player — counted as a miss from the
      // user's perspective (the player might land later in R1).
      miss++;
    }
  }

  return (
    <div className="flex items-center gap-4">
      <div className="text-right">
        <div className="caption text-[9px]">Exact</div>
        <div className="font-mono font-bold text-[18px] tabular text-green-400">{exact}</div>
      </div>
      <div className="text-right">
        <div className="caption text-[9px]">Close</div>
        <div className="font-mono font-bold text-[18px] tabular text-gold">{close}</div>
      </div>
      <div className="text-right">
        <div className="caption text-[9px]">Running</div>
        <div className="font-mono font-bold text-[22px] tabular text-accent">{running}</div>
      </div>
    </div>
  );
}
