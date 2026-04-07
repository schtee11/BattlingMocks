import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';

export default function Navbar() {
  const { user, signOut } = useAuth();
  const linkCls = ({ isActive }) =>
    `relative px-3 py-4 text-[12px] font-display font-semibold uppercase tracking-[0.16em] transition-colors ${
      isActive ? 'text-white' : 'text-text-secondary hover:text-white'
    }`;
  const activeBar = (
    <span className="absolute left-2 right-2 bottom-[10px] h-[2px] rounded-full bg-gradient-accent" />
  );
  return (
    <nav
      className="sticky top-0 z-40"
      style={{
        background: 'rgba(4,8,15,0.65)',
        backdropFilter: 'blur(16px) saturate(130%)',
        WebkitBackdropFilter: 'blur(16px) saturate(130%)',
      }}
    >
      <div className="max-w-6xl mx-auto px-4 flex items-center justify-between flex-wrap">
        <Link to="/" className="flex items-center gap-2.5 py-3 group">
          <div className="w-8 h-8 rounded-md flex items-center justify-center font-display font-bold text-bg-deep" style={{ background: 'var(--gradient-accent)' }}>
            M
          </div>
          <div className="font-display font-bold text-[18px] uppercase tracking-[0.08em] leading-none">
            <span className="text-white">Mockdraft</span>{' '}
            <span className="text-accent">Showdown</span>
          </div>
        </Link>
        <div className="flex items-center">
          <NavLink to="/draft" className={linkCls}>
            {({ isActive }) => (<><span>Draft</span>{isActive && activeBar}</>)}
          </NavLink>
          <NavLink to="/leaderboard" className={linkCls}>
            {({ isActive }) => (<><span>Leaderboard</span>{isActive && activeBar}</>)}
          </NavLink>
          {user && (
            <NavLink to="/my-mock" className={linkCls}>
              {({ isActive }) => (<><span>My Mock</span>{isActive && activeBar}</>)}
            </NavLink>
          )}
          {user ? (
            <div className="flex items-center gap-2.5 pl-3 ml-2 border-l border-border-subtle">
              {user.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt=""
                  className="w-6 h-6 rounded-full ring-1 ring-border-focus"
                />
              ) : (
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center font-display font-bold text-[10px] text-bg-deep"
                  style={{ background: 'var(--gradient-accent)' }}
                >
                  {user.display_name?.[0]?.toUpperCase() || '?'}
                </div>
              )}
              <span className="font-display uppercase tracking-[0.14em] text-[11px] text-text-secondary hidden sm:inline">
                {user.display_name}
              </span>
              <button
                onClick={signOut}
                className="font-display uppercase tracking-[0.14em] text-[10px] text-text-muted hover:text-white transition"
              >
                Sign out
              </button>
            </div>
          ) : (
            <NavLink to="/join" className={linkCls}>
              {({ isActive }) => (<><span>Join</span>{isActive && activeBar}</>)}
            </NavLink>
          )}
        </div>
      </div>
      <div className="h-px w-full" style={{ background: 'var(--gradient-accent)', opacity: 0.3 }} />
    </nav>
  );
}
