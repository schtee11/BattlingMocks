import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import { prettyName } from '../lib/displayName.js';
import { ThemeToggle } from './ThemeToggle.jsx';
import { Avatar } from './ui/Avatar.jsx';

// Plain-language nav labels. Any new route that gets a nav entry should go
// here — the nav renders from this single source so desktop and mobile
// stay in sync and ordering only has to be tweaked in one place.
const NAV_LINKS = [
  { to: '/draft', label: 'Draft', description: 'Predictive mock' },
  { to: '/team-mock', label: 'Team Mock', description: 'GM all 7 rounds' },
  { to: '/leaderboard', label: 'Leaderboard', description: 'Live standings' },
  { to: '/live', label: 'Live', description: 'Draft night' },
];

export default function Navbar() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Auto-close the mobile drawer when the route changes so users don't have
  // to manually dismiss it after navigating.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Lock body scroll when the mobile drawer is open so users can't scroll
  // the page behind it on iOS.
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  const linkCls = ({ isActive }) =>
    `relative inline-flex items-center px-3 py-4 text-[12px] font-display font-semibold uppercase tracking-[0.16em] transition-colors min-h-[44px] ${
      isActive ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'
    }`;

  const activeBar = (
    <span
      className="absolute left-3 right-3 bottom-[10px] h-[2px] rounded-full bg-gradient-accent"
      aria-hidden="true"
    />
  );

  // Team Mock special-case: tapping the nav item while already on Team Mock
  // resets the current session (see TeamMock page for how reset state is
  // consumed). Extracted here so both the desktop and mobile nav share the
  // same intent handling.
  const handleTeamMockClick = (e) => {
    if (location.pathname === '/team-mock') {
      e.preventDefault();
      navigate('/team-mock', { state: { reset: Date.now() }, replace: true });
      setMobileOpen(false);
    }
  };

  const visibleLinks = user
    ? [...NAV_LINKS, { to: '/my-mock', label: 'My Mock', description: 'Your submission' }]
    : NAV_LINKS;

  return (
    <nav
      aria-label="Primary"
      className="sticky top-0 z-40"
      style={{
        background: 'var(--nav-bg)',
        backdropFilter: 'blur(16px) saturate(130%)',
        WebkitBackdropFilter: 'blur(16px) saturate(130%)',
      }}
    >
      <div className="max-w-6xl mx-auto px-4 flex items-center justify-between gap-3">
        <Link
          to="/"
          className="flex items-center gap-2 sm:gap-2.5 py-2 sm:py-2.5 shrink-0"
          aria-label="MockDraft Showdown — Home"
        >
          <img
            src="/mds-logo.png"
            alt=""
            width="40"
            height="40"
            className="w-8 h-8 sm:w-10 sm:h-10 rounded-md object-contain shrink-0"
            draggable={false}
          />
          <div className="font-display font-bold text-[18px] uppercase tracking-[0.08em] leading-none hidden sm:block">
            <span className="text-text-primary">Mockdraft</span>{' '}
            <span className="text-accent">Showdown</span>
          </div>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center">
          {visibleLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={linkCls}
              onClick={link.to === '/team-mock' ? handleTeamMockClick : undefined}
              end={link.to === '/'}
            >
              {({ isActive }) => (
                <>
                  <span>{link.label}</span>
                  {isActive && activeBar}
                </>
              )}
            </NavLink>
          ))}
          <div className="ml-1 mr-1">
            <ThemeToggle />
          </div>
          {user ? (
            <div className="flex items-center gap-2.5 pl-3 ml-1 border-l border-border-subtle">
              <Link
                to="/settings"
                className="flex items-center gap-2.5 group"
                aria-label="Account settings"
                title="Account settings"
              >
                <Avatar url={user.avatar_url} name={user.display_name} size="xs" />
                <span className="font-display uppercase tracking-[0.14em] text-[11px] text-text-secondary group-hover:text-text-primary transition-colors">
                  {prettyName(user.display_name)}
                </span>
              </Link>
              <button
                onClick={signOut}
                className="font-display uppercase tracking-[0.14em] text-[10px] text-text-muted hover:text-text-primary transition"
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link
              to="/join"
              className="ml-2 inline-flex items-center justify-center font-display font-semibold uppercase tracking-[0.14em] text-[11px] text-bg-deep rounded-lg px-4 py-2 transition hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]"
              style={{
                background: 'var(--gradient-accent)',
                boxShadow: '0 0 18px -6px rgba(0,229,255,0.55)',
              }}
            >
              Sign in
            </Link>
          )}
        </div>

        {/* Mobile: theme toggle + hamburger.
            We keep the theme toggle on the top bar so it's always one tap
            away, since it's the only control that affects the entire UI and
            users swap themes mid-session (draft night = dark, day = light). */}
        <div className="flex md:hidden items-center gap-1">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav-drawer"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            className="inline-flex items-center justify-center w-11 h-11 rounded-lg text-text-secondary hover:text-text-primary hover:bg-white/5 transition"
          >
            <svg
              viewBox="0 0 24 24"
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {mobileOpen ? (
                <>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </>
              ) : (
                <>
                  <line x1="4" y1="6" x2="20" y2="6" />
                  <line x1="4" y1="12" x2="20" y2="12" />
                  <line x1="4" y1="18" x2="20" y2="18" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>
      <div
        className="h-px w-full"
        style={{ background: 'var(--gradient-accent)', opacity: 0.3 }}
      />

      {/* Mobile drawer.
          Lives inside the sticky nav so the backdrop covers only the content
          area, not the nav bar itself. The drawer list uses big tap targets
          (min 52px row height) and shows a secondary description so users
          know what each link does without prior knowledge. */}
      {mobileOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 top-[56px] bg-black/60 backdrop-blur-sm animate-fade-in z-10"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div
            id="mobile-nav-drawer"
            className="md:hidden absolute top-full inset-x-0 z-20 border-b border-border-subtle shadow-glass animate-fade-in"
            style={{ background: 'var(--bg-deep)' }}
          >
            <ul className="max-w-6xl mx-auto px-2 py-2">
              {visibleLinks.map((link) => (
                <li key={link.to}>
                  <NavLink
                    to={link.to}
                    end={link.to === '/'}
                    onClick={link.to === '/team-mock' ? handleTeamMockClick : undefined}
                    className={({ isActive }) =>
                      `flex items-center justify-between gap-3 px-4 py-3.5 rounded-lg transition-colors min-h-[52px] ${
                        isActive
                          ? 'bg-accent/[0.08] border border-accent/30'
                          : 'border border-transparent hover:bg-white/[0.03]'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <div className="min-w-0">
                          <div
                            className={`font-display font-semibold uppercase tracking-[0.12em] text-[14px] ${
                              isActive ? 'text-text-primary' : 'text-text-secondary'
                            }`}
                          >
                            {link.label}
                          </div>
                          <div className="text-[11px] text-text-muted mt-0.5">
                            {link.description}
                          </div>
                        </div>
                        <svg
                          viewBox="0 0 24 24"
                          className={`w-4 h-4 shrink-0 transition-colors ${
                            isActive ? 'text-accent' : 'text-text-muted'
                          }`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
            <div className="max-w-6xl mx-auto px-4 py-4 border-t border-border-subtle">
              {user ? (
                <div className="flex items-center justify-between gap-3">
                  <Link
                    to="/settings"
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center gap-3 min-w-0 flex-1 group"
                    aria-label="Account settings"
                  >
                    <Avatar url={user.avatar_url} name={user.display_name} size="sm" />
                    <div className="min-w-0">
                      <div className="font-display uppercase tracking-[0.12em] text-[12px] text-text-primary truncate group-hover:text-accent transition-colors">
                        {prettyName(user.display_name)}
                      </div>
                      <div className="text-[11px] text-text-muted">Account settings</div>
                    </div>
                  </Link>
                  <button
                    onClick={() => {
                      signOut();
                      setMobileOpen(false);
                    }}
                    className="font-display font-semibold uppercase tracking-[0.12em] text-[11px] text-text-secondary hover:text-text-primary transition px-3 py-2 rounded-md border border-border-subtle hover:border-border-focus"
                  >
                    Sign out
                  </button>
                </div>
              ) : (
                <Link
                  to="/join"
                  onClick={() => setMobileOpen(false)}
                  className="w-full inline-flex items-center justify-center font-display font-semibold uppercase tracking-[0.14em] text-[12px] text-bg-deep rounded-lg px-4 py-3 transition hover:brightness-110 active:scale-[0.98]"
                  style={{
                    background: 'var(--gradient-accent)',
                    boxShadow: '0 0 18px -6px rgba(0,229,255,0.55)',
                  }}
                >
                  Sign in
                </Link>
              )}
            </div>
          </div>
        </>
      )}
    </nav>
  );
}
