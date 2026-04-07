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
  const [avail, setAvail] = useState(null); // null | true | false
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef();
  const nav = useNavigate();

  useEffect(() => {
    if (user) nav('/draft');
  }, [user, nav]);

  // Debounced availability check
  useEffect(() => {
    clearTimeout(timer.current);
    if (name.trim().length < 2) { setAvail(null); return; }
    setChecking(true);
    timer.current = setTimeout(async () => {
      try {
        const r = await api.checkName(name.trim());
        setAvail(r.available);
      } catch {
        setAvail(null);
      } finally {
        setChecking(false);
      }
    }, 350);
    return () => clearTimeout(timer.current);
  }, [name]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const u = await api.createUser(name.trim());
      setUser(u);
      toast.success(`Welcome, ${u.display_name}!`);
      nav('/draft');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (user) {
    return (
      <div className="max-w-md mx-auto px-4 py-16">
        <Card className="p-6 text-center">
          <div className="text-slate-300 mb-3">Welcome back, <span className="text-white font-semibold">{user.display_name}</span>.</div>
          <Link to="/draft"><Button>Go to Draft Board</Button></Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 py-16">
      <Card className="p-7">
        <h1 className="text-2xl font-bold text-white mb-1">Claim Your Name</h1>
        <p className="text-slate-400 text-sm mb-5">
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
              className="w-full bg-ink border border-slate-700 rounded-lg px-4 py-3 text-white focus:border-accent outline-none"
            />
            <div className="h-5 mt-1 text-xs">
              {checking && <span className="text-slate-500">Checking…</span>}
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
            {busy ? 'Creating…' : 'Claim Your Name'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
