import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.js';

export default function Join() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    if (user) nav('/draft');
  }, [user, nav]);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const u = await api.createUser(name.trim());
      setUser(u);
      nav('/draft');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md mx-auto px-4 py-16">
      <h1 className="text-3xl font-bold text-white mb-6">Claim your name</h1>
      <p className="text-slate-400 mb-6">
        Pick a unique display name. This is how you'll appear on the leaderboard.
      </p>
      <form onSubmit={submit} className="space-y-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          minLength={2}
          maxLength={60}
          required
          placeholder="Display name"
          className="w-full bg-panel border border-slate-700 rounded px-4 py-3 text-white"
        />
        {err && <div className="text-red-400 text-sm">{err}</div>}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-accent text-ink font-semibold py-3 rounded disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Continue'}
        </button>
      </form>
    </div>
  );
}
