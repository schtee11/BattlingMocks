import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DISCORD_AUTH_URL } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { prettyName } from '../lib/displayName.js';
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
  const { user } = useAuth();
  const nav = useNavigate();

  useEffect(() => { if (user) nav('/draft'); }, [user, nav]);

  if (user) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 route-fade">
        <Card glass className="p-7 text-center">
          <div className="caption text-accent">Welcome back</div>
          <div className="text-text-primary font-display text-2xl mt-1 mb-4 uppercase">{prettyName(user.display_name)}</div>
          <Link to="/draft"><Button size="lg">Enter The War Room →</Button></Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 py-20 route-fade">
      <Card glass className="p-8">
        <div className="caption text-accent">2026 NFL Draft</div>
        <h1 className="font-display display-xl text-[32px] text-text-primary mt-1">Claim Your Spot</h1>
        <p className="text-text-secondary text-[13px] mt-2 mb-6">
          Sign in with Discord to start building your mock draft and compete on the leaderboard.
        </p>

        <a
          href={DISCORD_AUTH_URL}
          className="w-full inline-flex items-center justify-center gap-2.5 rounded-lg px-6 py-3.5 text-sm font-display font-semibold uppercase tracking-[0.14em] text-text-primary transition hover:brightness-110"
          style={{ backgroundColor: '#5865F2', boxShadow: '0 0 24px -8px rgba(88,101,242,0.6)' }}
        >
          <DiscordIcon className="w-[18px] h-[18px]" />
          Continue with Discord
        </a>

        <p className="text-text-muted text-[11px] mt-4 text-center">
          We only read your username and avatar. Nothing is posted to Discord on your behalf.
        </p>
      </Card>
    </div>
  );
}
