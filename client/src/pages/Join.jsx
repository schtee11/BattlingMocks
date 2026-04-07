import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, DISCORD_AUTH_URL } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { Card } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';

function DiscordIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M20.317 4.369A19.79 19.79 0 0 0 16.558 3c-.197.35-.42.82-.573 1.197a18.28 18.28 0 0 0-5.972 0A14.36 14.36 0 0 0 9.425 3a19.74 19.74 0 0 0-3.76 1.369C2.104 9.66 1.15 14.813 1.583 19.88a19.9 19.9 0 0 0 5.99 3.04c.48-.65.91-1.34 1.28-2.06-.7-.26-1.37-.59-2-.97.17-.12.34-.24.5-.37 3.86 1.78 8.04 1.78 11.87 0 .17.13.33.25.5.37-.64.38-1.31.71-2 .97.37.72.8 1.41 1.28 2.06a19.9 19.9 0 0 0 5.99-3.04c.5-5.85-.89-10.96-3.7-15.51zM8.02 16.15c-1.18 0-2.15-1.1-2.15-2.44 0-1.35.95-2.45 2.15-2.45 1.2 0 2.17 1.1 2.15 2.45 0 1.34-.95 2.44-2.15 2.44zm7.96 0c-1.18 0-2.15-1.1-2.15-2.44 0-1.35.95-2.45 2.15-2.45s2.17 1.1 2.15 2.45c0 1.34-.95 2.44-2.15 2.44z"/>
    </svg>
  );
}

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
            ? "Link your Discord, or pick a unique display name. This is how you'll appear on the leaderboard."
            : 'Enter the display name you used before.'}
        </p>

        {/* Discord sign-in */}
        <a
          href={DISCORD_AUTH_URL}
          className="w-full inline-flex items-center justify-center gap-2.5 rounded-lg px-6 py-3 text-sm font-display font-semibold uppercase tracking-[0.14em] text-white transition hover:brightness-110"
          style={{ backgroundColor: '#5865F2', boxShadow: '0 0 24px -8px rgba(88,101,242,0.6)' }}
        >
          <DiscordIcon className="w-[18px] h-[18px]" />
          Continue with Discord
        </a>

        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px bg-border-subtle" />
          <div className="caption text-[9px]">Or</div>
          <div className="flex-1 h-px bg-border-subtle" />
        </div>

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
