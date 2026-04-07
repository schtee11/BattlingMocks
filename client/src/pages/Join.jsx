import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { Card } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';

export default function Join() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState('');
  const [avail, setAvail] = useState(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef();
  const nav = useNavigate();

  useEffect(() => { if (user) nav('/draft'); }, [user, nav]);

  useEffect(() => {
    clearTimeout(timer.current);
    if (name.trim().length < 2) { setAvail(null); return; }
    setChecking(true);
    timer.current = setTimeout(async () => {
      try {
        const r = await api.checkName(name.trim());
        setAvail(r.available);
      } catch { setAvail(null); }
      finally { setChecking(false); }
    }, 350);
    return () => clearTimeout(timer.current);
  }, [name]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const u = await api.createUser(name.trim());
      setUser(u);
      toast.success(`Welcome, ${u.display_name}`);
      nav('/draft');
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
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

  return (
    <div className="max-w-md mx-auto px-4 py-20 route-fade">
      <Card glass className="p-8">
        <div className="caption text-accent">2026 NFL Draft</div>
        <h1 className="font-display display-xl text-[32px] text-white mt-1">Claim Your Spot</h1>
        <p className="text-text-secondary text-[13px] mt-2 mb-6">
          Pick a unique display name. This is how you'll appear on the leaderboard.
        </p>
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
            />
            <div className="h-5 mt-1.5 text-[11px] font-display uppercase tracking-[0.12em]">
              {checking && <span className="text-text-muted">Checking…</span>}
              {!checking && avail === true && <span className="text-emerald-400">✓ Available</span>}
              {!checking && avail === false && <span className="text-red-400">Already taken</span>}
            </div>
          </div>
          <Button
            type="submit"
            className="w-full"
            size="lg"
            disabled={busy || avail === false || name.trim().length < 2}
          >
            {busy ? 'Creating…' : 'Enter The War Room'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
