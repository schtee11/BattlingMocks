import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { posHex } from '../lib/positions.js';
import { Card } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { PositionBadge } from '../components/ui/Badge.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { useCountUp } from '../hooks/useCountUp.js';

function scoreFor(actualSlot, pickSlot) {
  if (actualSlot == null) return { pts: 0, label: 'Miss', color: '#ef4444' };
  if (actualSlot === pickSlot) return { pts: 15, label: 'Exact', color: '#34d399' };
  if (Math.abs(actualSlot - pickSlot) <= 5) return { pts: 8, label: 'Close', color: '#fbbf24' };
  return { pts: 5, label: 'In R1', color: '#3b82f6' };
}

export default function MyMock() {
  const { user } = useAuth();
  const [mock, setMock] = useState(null);
  const [actuals, setActuals] = useState([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const [m, a] = await Promise.all([api.getMock(user.id), api.getActualPicks()]);
        setMock(m);
        setActuals(a);
      } catch (e) {
        if (String(e.message).includes('no mock')) setErr('no_mock');
        else setErr(e.message);
      }
    })();
  }, [user]);

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

  const scored = actuals.length > 0;
  const totalScore = useCountUp(mock?.total_score ?? 0, 1500);

  const summary = useMemo(() => {
    if (!mock || !scored) return null;
    let exact = 0, close = 0, correct = 0, miss = 0;
    const biggestMisses = [];
    mock.picks.forEach((p) => {
      const a = actualByPlayer.get(p.player_id);
      if (!a) { miss++; biggestMisses.push({ type: 'undrafted', player: p }); return; }
      if (a.pick_number === p.pick_number) exact++;
      else if (Math.abs(a.pick_number - p.pick_number) <= 5) close++;
      else correct++;
    });
    const myIds = new Set(mock.picks.map((p) => p.player_id));
    const r1Missed = actuals.filter((a) => !myIds.has(a.player_id));
    return { exact, close, correct, miss, biggestMisses, r1Missed };
  }, [mock, scored, actualByPlayer, actuals]);

  if (!user) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center route-fade">
        <Card glass className="p-7">
          <p className="text-text-secondary text-sm mb-4">Join first to see your mock.</p>
          <Link to="/join"><Button>Claim a name</Button></Link>
        </Card>
      </div>
    );
  }
  if (err === 'no_mock') {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center route-fade">
        <Card glass className="p-7">
          <p className="text-text-secondary text-sm mb-4">You haven't submitted a mock yet.</p>
          <Link to="/draft"><Button>Build Your Mock</Button></Link>
        </Card>
      </div>
    );
  }
  if (err) return <div className="max-w-md mx-auto px-4 py-16 text-red-300">{err}</div>;
  if (!mock) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-3">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-32 w-full" />
        {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-14 w-full" />)}
      </div>
    );
  }

  function share() {
    const lines = [`My 2026 Mock Draft — Score: ${mock.total_score}`];
    if (summary) lines.push(`Exact: ${summary.exact} · Close: ${summary.close} · Correct: ${summary.correct}`);
    navigator.clipboard.writeText(lines.join('\n'));
    toast.success('Copied to clipboard');
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 route-fade">
      {/* Summary */}
      <Card glass className="p-6 mb-5">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="caption text-accent">Your Board</div>
            <h1 className="font-display display-xl text-display text-white mt-1">My Mock</h1>
            <div className="text-text-muted text-[11px] mt-1 font-display uppercase tracking-[0.12em]">
              Submitted {new Date(mock.submitted_at).toLocaleDateString()}
            </div>
          </div>
          <div className="text-right">
            <div className="caption">Total</div>
            <div className="font-mono font-bold text-6xl tabular text-gold leading-none mt-1">{totalScore}</div>
            <div className="text-text-muted text-[10.5px] font-display uppercase tracking-[0.14em] mt-1">
              of 480 possible
            </div>
          </div>
        </div>
        {summary && (
          <div className="grid grid-cols-4 gap-3 mt-6">
            {[
              { label: 'Exact',   val: summary.exact,   color: '#34d399' },
              { label: 'Close',   val: summary.close,   color: '#fbbf24' },
              { label: 'In R1',   val: summary.correct, color: '#3b82f6' },
              { label: 'Missed',  val: summary.miss,    color: '#ef4444' },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-lg p-3 text-center border"
                style={{ background: `${s.color}0f`, borderColor: `${s.color}33` }}
              >
                <div className="font-mono font-bold text-2xl tabular" style={{ color: s.color }}>{s.val}</div>
                <div className="caption mt-1 text-[9.5px]">{s.label}</div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          {!scored && (
            <Link to="/draft"><Button variant="secondary" size="sm">Edit</Button></Link>
          )}
          <Button size="sm" variant="ghost" onClick={share}>Share</Button>
        </div>
      </Card>

      {!scored && (
        <Card className="p-3 text-[13px] mb-4 border-amber-700/40" style={{ background: 'rgba(146,64,14,0.1)', color: '#fcd34d' }}>
          <span className="caption text-amber-300">Awaiting Results</span>
          <div className="mt-0.5 text-amber-200/80">Scoring will appear after the admin enters the real draft picks.</div>
        </Card>
      )}

      {/* Picks */}
      <ul className="space-y-1.5 stagger">
        {mock.picks.map((p) => {
          const a = actualByPlayer.get(p.player_id);
          const { pts, label, color } = scoreFor(a?.pick_number, p.pick_number);
          const actualAtThisSlot = actualBySlot.get(p.pick_number);
          const posColor = posHex(p.position);
          return (
            <li
              key={p.pick_number}
              className="flex items-center gap-3 p-3 rounded-lg border"
              style={
                scored
                  ? { background: `${color}0d`, borderColor: `${color}44`, borderLeft: `4px solid ${color}` }
                  : { background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', borderLeft: `3px solid ${posColor}` }
              }
            >
              <div
                className="w-11 h-11 rounded-full flex items-center justify-center font-mono font-bold text-[13px] shrink-0"
                style={{ backgroundColor: posColor, color: '#04080f', boxShadow: `0 0 18px -6px ${posColor}` }}
              >
                {p.pick_number}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="text-white font-semibold truncate">{p.name}</div>
                  <PositionBadge position={p.position} />
                </div>
                <div className="text-[11px] text-text-muted truncate">{p.school}</div>
                {scored && actualAtThisSlot && actualAtThisSlot.player_id !== p.player_id && (
                  <div className="text-[11px] text-text-muted mt-0.5">
                    Actual: <span className="text-white">{actualAtThisSlot.name}</span>
                  </div>
                )}
              </div>
              {scored && (
                <div className="text-right shrink-0">
                  <div className="caption text-[9px]" style={{ color }}>{label}</div>
                  <div className="font-mono font-bold text-2xl tabular" style={{ color }}>+{pts}</div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {scored && summary && (summary.biggestMisses.length > 0 || summary.r1Missed.length > 0) && (
        <Card glass className="p-6 mt-6">
          <div className="caption text-accent">Post-mortem</div>
          <h2 className="font-display display-xl text-[22px] text-white mt-1 mb-4">Where you went wrong</h2>
          {summary.biggestMisses.length > 0 && (
            <div className="mb-5">
              <div className="caption mb-2">Your picks that went undrafted in R1</div>
              <ul className="text-[13px] text-text-secondary space-y-1">
                {summary.biggestMisses.map((m) => (
                  <li key={m.player.player_id}>
                    · <span className="text-white">{m.player.name}</span> ({m.player.position}) — pick {m.player.pick_number}
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
                    · Pick {a.pick_number}: <span className="text-white">{a.name}</span> ({a.position})
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
