import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';

export default function Home() {
  const [settings, setSettings] = useState(null);
  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {});
  }, []);
  return (
    <div className="max-w-3xl mx-auto px-4 py-16 text-center">
      <h1 className="text-5xl font-extrabold text-white mb-4">
        Submit your <span className="text-accent">2026 NFL Mock Draft</span>
      </h1>
      <p className="text-slate-300 text-lg mb-8">
        Predict all 32 first-round picks. Compete on the public leaderboard once the real draft kicks off.
      </p>
      <div className="flex justify-center gap-3 flex-wrap">
        <Link to="/join" className="bg-accent text-ink font-semibold px-6 py-3 rounded-lg">
          Make Your Mock
        </Link>
        <Link to="/leaderboard" className="border border-slate-600 text-slate-200 px-6 py-3 rounded-lg">
          View Leaderboard
        </Link>
      </div>
      {settings && (
        <div className="mt-10 text-slate-400">
          <div className="text-sm">Draft Year: {settings.draft_year}</div>
          <div className="text-2xl font-bold text-white mt-1">
            {settings.mock_count} mocks submitted
          </div>
          {settings.is_locked && (
            <div className="mt-3 inline-block bg-amber-900/40 text-amber-300 px-3 py-1 rounded">
              Submissions locked — draft in progress
            </div>
          )}
        </div>
      )}
    </div>
  );
}
