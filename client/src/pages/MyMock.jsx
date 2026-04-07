import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { Card } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { PositionBadge } from '../components/ui/Badge.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { useCountUp } from '../hooks/useCountUp.js';

function scoreFor(actualSlot, pickSlot) {
  if (actualSlot == null) return { pts: 0, label: 'Miss', tone: 'border-red-700/50 bg-red-900/20' };
  if (actualSlot === pickSlot) return { pts: 15, label: 'Exact', tone: 'border-emerald-600/60 bg-emerald-900/25' };
  if (Math.abs(actualSlot - pickSlot) <= 5) return { pts: 8, label: 'Close', tone: 'border-yellow-600/60 bg-yellow-900/20' };
  return { pts: 5, label: 'Correct', tone: 'border-sky-600/60 bg-sky-900/20' };
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
  const totalScore = useCountUp(mock?.total_score ?? 0);

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
    return { exact, close, correct, miss, picksCorrect: exact + close + correct, biggestMisses, r1Missed };
  }, [mock, scored, actualByPlayer, actuals]);

  if (!user) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center route-fade">
        <Card className="p-6">
          <p className="text-slate-300 mb-4">Join first to see your mock.</p>
          <Link to="/join"><Button>Claim a name</Button></Link>
        </Card>
      </div>
    );
  }
  if (err === 'no_mock') {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center route-fade">
        <Card className="p-6">
          <p className="text-slate-300 mb-4">You haven't submitted a mock yet.</p>
          <Link to="/draft"><Button>Build Your Mock</Button></Link>
        </Card>
      </div>
    );
  }
  if (err) return <div className="max-w-md mx-auto px-4 py-16 text-red-300">{err}</div>;
  if (!mock) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-3">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-24 w-full" />
        {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-14 w-full" />)}
      </div>
    );
  }

  function share() {
    const lines = [`My 2026 Mock Draft — Score: ${mock.total_score}`];
    if (summary) lines.push(`Exact: ${summary.exact} · Close: ${summary.close} · Correct: ${summary.correct}`);
    lines.push('https://mockdraftshowdown.app');
    navigator.clipboard.writeText(lines.join('\n'));
    toast.success('Copied to clipboard');
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 route-fade">
      {/* Summary header */}
      <Card className="p-5 mb-5">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">My Mock</h1>
            <div className="text-slate-500 text-xs mt-1">
              Submitted {new Date(mock.submitted_at).toLocaleString()}
            </div>
          </div>
          <div className="text-right">
            <div className="text-slate-400 text-xs uppercase tracking-wide">Total Score</div>
            <div className="text-4xl font-bold text-accent tabular-nums">{totalScore}</div>
            <div className="text-slate-500 text-xs">of 480 possible</div>
          </div>
        </div>
        {summary && (
          <div className="grid grid-cols-4 gap-3 mt-5 text-center">
            <div>
              <div className="text-2xl font-bold text-emerald-400">{summary.exact}</div>
              <div className="text-xs text-slate-500 uppercase">Exact</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-yellow-400">{summary.close}</div>
              <div className="text-xs text-slate-500 uppercase">Close</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-sky-400">{summary.correct}</div>
              <div className="text-xs text-slate-500 uppercase">Correct</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-red-400">{summary.miss}</div>
              <div className="text-xs text-slate-500 uppercase">Miss</div>
            </div>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          {!scored && (
            <Link to="/draft"><Button variant="secondary" size="sm">Edit</Button></Link>
          )}
          <Button size="sm" variant="ghost" onClick={share}>Share</Button>
        </div>
      </Card>

      {!scored && (
        <Card className="p-3 text-sm text-slate-300 mb-4 border-amber-700/40 bg-amber-900/10">
          Scoring will appear after the admin enters the real draft results.
        </Card>
      )}

      {/* Picks */}
      <ul className="space-y-1.5">
        {mock.picks.map((p) => {
          const a = actualByPlayer.get(p.player_id);
          const { pts, label, tone } = scoreFor(a?.pick_number, p.pick_number);
          const actualAtThisSlot = actualBySlot.get(p.pick_number);
          return (
            <li
              key={p.pick_number}
              className={`flex items-center gap-3 p-3 rounded-lg border ${scored ? tone : 'border-slate-700 bg-panel'}`}
            >
              <div className="w-9 h-9 rounded-full bg-slate-800 flex items-center justify-center font-bold text-accent text-sm ring-1 ring-slate-700 shrink-0">
                {p.pick_number}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="text-white font-medium truncate">{p.name}</div>
                  <PositionBadge position={p.position} />
                </div>
                <div className="text-xs text-slate-500 truncate">{p.school}</div>
                {scored && actualAtThisSlot && actualAtThisSlot.player_id !== p.player_id && (
                  <div className="text-xs text-slate-400 mt-0.5">
                    Actual: <span className="text-white">{actualAtThisSlot.name}</span>
                  </div>
                )}
              </div>
              {scored && (
                <div className="text-right shrink-0">
                  <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
                  <div className="text-lg font-bold text-white tabular-nums">+{pts}</div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Biggest misses */}
      {scored && summary && (summary.biggestMisses.length > 0 || summary.r1Missed.length > 0) && (
        <Card className="p-5 mt-6">
          <h2 className="text-lg font-semibold text-white mb-3">Where you went wrong</h2>
          {summary.biggestMisses.length > 0 && (
            <div className="mb-4">
              <div className="text-xs uppercase text-slate-500 mb-1">Players you picked that went undrafted in R1</div>
              <ul className="text-sm text-slate-300 space-y-1">
                {summary.biggestMisses.map((m) => (
                  <li key={m.player.player_id}>· {m.player.name} ({m.player.position}) — you had at pick {m.player.pick_number}</li>
                ))}
              </ul>
            </div>
          )}
          {summary.r1Missed.length > 0 && (
            <div>
              <div className="text-xs uppercase text-slate-500 mb-1">R1 picks you missed entirely</div>
              <ul className="text-sm text-slate-300 space-y-1">
                {summary.r1Missed.map((a) => (
                  <li key={a.pick_number}>· Pick {a.pick_number}: {a.name} ({a.position})</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
