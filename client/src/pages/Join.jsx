import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DISCORD_AUTH_URL, GOOGLE_AUTH_URL } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { prettyName } from '../lib/displayName.js';
import { Card } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';

function DiscordIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M20.317 4.369A19.79 19.79 0 0 0 16.558 3c-.197.35-.42.82-.573 1.197a18.28 18.28 0 0 0-5.972 0A14.36 14.36 0 0 0 9.425 3a19.74 19.74 0 0 0-3.76 1.369C2.104 9.66 1.15 14.813 1.583 19.88a19.9 19.9 0 0 0 5.99 3.04c.48-.65.91-1.34 1.28-2.06-.7-.26-1.37-.59-2-.97.17-.12.34-.24.5-.37 3.86 1.78 8.04 1.78 11.87 0 .17.13.33.25.5.37-.64.38-1.31.71-2 .97.37.72.8 1.41 1.28 2.06a19.9 19.9 0 0 0 5.99-3.04c.5-5.85-.89-10.96-3.7-15.51zM8.02 16.15c-1.18 0-2.15-1.1-2.15-2.44 0-1.35.95-2.45 2.15-2.45 1.2 0 2.17 1.1 2.15 2.45 0 1.34-.95 2.44-2.15 2.44zm7.96 0c-1.18 0-2.15-1.1-2.15-2.44 0-1.35.95-2.45 2.15-2.45s2.17 1.1 2.15 2.45c0 1.34-.95 2.44-2.15 2.44z" />
    </svg>
  );
}

// Official Google "G" mark. Multi-colored paths, no fill="currentColor".
function GoogleIcon(props) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

export default function Join() {
  const { user } = useAuth();
  const nav = useNavigate();

  useEffect(() => {
    if (user) nav('/draft');
  }, [user, nav]);

  if (user) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 route-fade">
        <Card glass className="p-7 text-center">
          <div className="caption text-accent">Welcome back</div>
          <div className="text-text-primary font-display text-2xl mt-1 mb-4 uppercase">
            {prettyName(user.display_name)}
          </div>
          <Link to="/draft">
            <Button size="lg">Enter The War Room →</Button>
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 py-16 md:py-20 route-fade">
      <Card glass className="p-7 md:p-8">
        <div className="caption text-accent">2026 NFL Draft</div>
        <h1 className="font-display display-xl text-[32px] text-text-primary mt-1">
          Claim Your Spot
        </h1>
        <p className="text-text-secondary text-[13.5px] leading-relaxed mt-2 mb-6">
          Sign in to start building your mock draft and compete on the public
          leaderboard.
        </p>

        <a
          href={DISCORD_AUTH_URL}
          className="w-full inline-flex items-center justify-center gap-2.5 rounded-lg px-6 py-3.5 text-sm font-display font-semibold uppercase tracking-[0.14em] text-text-primary transition hover:brightness-110 active:scale-[0.99]"
          style={{
            backgroundColor: '#5865F2',
            boxShadow: '0 0 24px -8px rgba(88,101,242,0.6)',
          }}
        >
          <DiscordIcon className="w-[18px] h-[18px]" />
          Continue with Discord
        </a>

        {/* "or" divider between provider buttons */}
        <div className="flex items-center gap-3 my-3 text-text-muted text-[10px] uppercase tracking-[0.18em]">
          <div className="flex-1 h-px bg-border-subtle" />
          or
          <div className="flex-1 h-px bg-border-subtle" />
        </div>

        <a
          href={GOOGLE_AUTH_URL}
          className="w-full inline-flex items-center justify-center gap-2.5 rounded-lg px-6 py-3.5 text-sm font-display font-semibold uppercase tracking-[0.14em] text-[#1f1f1f] transition hover:brightness-95 active:scale-[0.99]"
          style={{
            backgroundColor: '#ffffff',
            boxShadow: '0 0 24px -10px rgba(255,255,255,0.35)',
          }}
        >
          <GoogleIcon className="w-[18px] h-[18px]" />
          Continue with Google
        </a>

        {/* Reassurance block — eliminates the "what are you going to do with
            my account?" hesitation the OAuth buttons create. */}
        <ul className="mt-5 space-y-2 text-[12px] text-text-muted">
          <li className="flex items-start gap-2">
            <svg
              viewBox="0 0 24 24"
              className="w-3.5 h-3.5 mt-0.5 text-accent shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            We only read your public name and avatar.
          </li>
          <li className="flex items-start gap-2">
            <svg
              viewBox="0 0 24 24"
              className="w-3.5 h-3.5 mt-0.5 text-accent shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Nothing is posted on your behalf.
          </li>
          <li className="flex items-start gap-2">
            <svg
              viewBox="0 0 24 24"
              className="w-3.5 h-3.5 mt-0.5 text-accent shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            100% free, no paywall.
          </li>
        </ul>
      </Card>

      <div className="text-center mt-5">
        <Link
          to="/"
          className="caption text-text-muted hover:text-text-primary transition inline-flex items-center gap-1.5"
        >
          <svg
            viewBox="0 0 24 24"
            className="w-3 h-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to home
        </Link>
      </div>
    </div>
  );
}
