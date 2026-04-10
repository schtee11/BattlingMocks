import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import { prettyName } from '../lib/displayName.js';
import { ThemeToggle } from './ThemeToggle.jsx';
import { Avatar } from './ui/Avatar.jsx';

export default function Navbar() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const linkCls = ({ isActive }) =>
    `relative px-2 sm:px-3 py-2.5 sm:py-4 text-[10px] sm:text-[12px] font-display font-semibold uppercase tracking-[0.16em] transition-colors ${
      isActive ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'
    }`;
  const activeBar = (
    <span className="absolute left-2 right-2 bottom-[6px] sm:bottom-[10px] h-[2px] rounded-full bg-gradient-accent" />
  );
  return (
    <nav
      className="sticky top-0 z-40"
      style={{
        background: 'var(--nav-bg)',
        backdropFilter: 'blur(16px) saturate(130%)',
        WebkitBackdropFilter: 'blur(16px) saturate(130%)',
      }}
    >
      <div className="max-w-6xl mx-auto px-4 flex items-center justify-between flex-wrap">
        <Link to="/" className="flex items-center gap-2 sm:gap-2.5 py-1.5 sm:py-2.5 group">
          <img
            src="/mds-logo.png"
            alt="MockDraft Showdown"
            width="40"
            height="40"
            className="w-7 h-7 sm:w-10 sm:h-10 rounded-md object-contain shrink-0"
            draggable={false}
          />
          <div className="font-display font-bold text-[18px] uppercase tracking-[0.08em] leading-none hidden sm:block">
            <span className="text-text-primary">Mockdraft</span>{' '}
            <span className="text-accent">Showdown</span>
          </div>
        </Link>
        <div className="flex items-center">
          <NavLink to="/draft" className={linkCls}>
            {({ isActive }) => (<><span>Draft</span>{isActive && activeBar}</>)}
          </NavLink>
          <NavLink
            to="/team-mock"
            className={linkCls}
            onClick={(e) => {
              if (location.pathname === '/team-mock') {
                e.preventDefault();
                navigate('/team-mock', { state: { reset: Date.now() }, replace: true });
              }
            }}
          >
            {({ isActive }) => (<><span>Team Mock</span>{isActive && activeBar}</>)}
          </NavLink>
          <NavLink to="/leaderboard" className={linkCls}>
            {({ isActive }) => (<><span>Leaderboard</span>{isActive && activeBar}</>)}
          </NavLink>
          {user && (
            <NavLink to="/my-mock" className={linkCls}>
              {({ isActive }) => (<><span>My Mock</span>{isActive && activeBar}</>)}
            </NavLink>
          )}
          <div className="ml-1 mr-1"><ThemeToggle /></div>
          {user ? (
            <div className="flex items-center gap-1.5 sm:gap-2.5 pl-2 sm:pl-3 ml-1 sm:ml-2 border-l border-border-subtle">
              <Avatar url={user.avatar_url} name={user.display_name} size="xs" />
              <span className="font-display uppercase tracking-[0.14em] text-[11px] text-text-secondary hidden sm:inline">
                {prettyName(user.display_name)}
              </span>
              <button
                onClick={signOut}
                className="font-display uppercase tracking-[0.14em] text-[10px] text-text-muted hover:text-text-primary transition hidden sm:block"
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
              Login
            </Link>
          )}
        </div>
      </div>
      <div className="h-px w-full" style={{ background: 'var(--gradient-accent)', opacity: 0.3 }} />
    </nav>
  );
}
