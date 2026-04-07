import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { Card } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';

export default function Join() {
  const { user, setUser } = useAuth();
  const [mode, setMode] = useState('create'); // 'create' | 'signin'
  const [name, setName] = useState('');
  const [avail, setAvail] = useState(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef();
  const nav = useNavigate();

  useEffect(() => { if (user) nav('/draft'); }, [user, nav]);

  // Availability check only matters in create mode
  useEffect(() => {
    clearTimeout(timer.current);
    if (mode !== 'create' || name.trim().length < 2) { setAvail(null); return; }
    setChecking(true);
    timer.current = setTimeout(async () => {
      try {
        const r = await api.checkName(name.trim());
        setAvail(r.available);
      } catch { setAvail(null); }
      finally { setChecking(false); }
    }, 350);
    return () => clearTimeout(timer.current);
  }, [name, mode]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      let u;
      if (mode === 'create') {
        u = await api.createUser(name.trim());
        toast.success(`Welcome, ${u.display_name}`);
      } else {
        u = await api.getUserByName(name.trim());
        toast.success(`Welcome back, ${u.display_name}`);
      }
      setUser(u);
      nav('/draft');
    } catch (e) {
      toast.error(mode === 'signin' && /not found/i.test(e.message) ? 'No account with that name' : e.message);
    } finally {
      setBusy(false);
    }
  }

  if (user) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 route-fade">
        <Card glass className="p-7 text-center">
          <div className="caption text-accent">Welcome back</div>
          <div className="text-white font-display text-2xl mt-1 mb-4 uppercase">{user.display_name}</div>
          <Link to="/draft"><Button size="lg">Enter The War Room →</Button></Link>
        </Card>
      </div>
    );
  }

  const isCreate = mode === 'create';
  const submitDisabled =
    busy ||
    name.trim().length < 2 ||
    (isCreate && avail === false);

  return (
    <div className="max-w-md mx-auto px-4 py-20 route-fade">
      <Card glass className="p-8">
        <div className="caption text-accent">2026 NFL Draft</div>
        <h1 className="font-display display-xl text-[32px] text-white mt-1">
          {isCreate ? 'Claim Your Spot' : 'Sign Back In'}
        </h1>
        <p className="text-text-secondary text-[13px] mt-2 mb-5">
          {isCreate
            ? "Pick a unique display name. This is how you'll appear on the leaderboard."
            : 'Enter the display name you used before.'}
        </p>

        {/* Mode toggle */}
        <div className="inline-flex rounded-lg bg-bg-deep/60 border border-border-subtle p-0.5 mb-4">
          <button
            type="button"
            onClick={() => { setMode('create'); setAvail(null); }}
            className={`px-3 py-1.5 rounded-md font-display text-[10px] uppercase tracking-[0.14em] transition ${
              isCreate ? 'bg-accent text-bg-deep' : 'text-text-secondary hover:text-white'
            }`}
          >
            New Player
          </button>
          <button
            type="button"
            onClick={() => { setMode('signin'); setAvail(null); }}
            className={`px-3 py-1.5 rounded-md font-display text-[10px] uppercase tracking-[0.14em] transition ${
              !isCreate ? 'bg-accent text-bg-deep' : 'text-text-secondary hover:text-white'
            }`}
          >
            Sign In
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              minLength={2}
              maxLength={60}
              required
              placeholder="Display name"
              className="w-full bg-bg-deep/70 border border-border-subtle rounded-lg px-4 py-3.5 text-white text-[15px] focus:border-accent outline-none transition"
              autoFocus
            />
            <div className="h-5 mt-1.5 text-[11px] font-display uppercase tracking-[0.12em]">
              {isCreate && checking && <span className="text-text-muted">Checking…</span>}
              {isCreate && !checking && avail === true && <span className="text-emerald-400">✓ Available</span>}
              {isCreate && !checking && avail === false && <span className="text-red-400">Already taken</span>}
            </div>
          </div>
          <Button type="submit" className="w-full" size="lg" disabled={submitDisabled}>
            {busy
              ? (isCreate ? 'Creating…' : 'Signing in…')
              : (isCreate ? 'Enter The War Room' : 'Sign In')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
