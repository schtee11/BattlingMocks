import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';

export default function Navbar() {
  const { user, signOut } = useAuth();
  const linkCls = ({ isActive }) =>
    `px-3 py-1.5 rounded-lg text-sm font-medium transition ${
      isActive ? 'bg-accent/15 text-accent' : 'text-slate-300 hover:text-white hover:bg-white/5'
    }`;
  return (
    <nav className="sticky top-0 z-40 bg-panel/70 backdrop-blur-md border-b border-border">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between flex-wrap gap-2">
        <Link to="/" className="flex items-center gap-2 group">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-gold flex items-center justify-center font-black text-ink">
            M
          </div>
          <span className="text-lg font-bold text-white">
            MockDraft <span className="text-accent">Showdown</span>
          </span>
        </Link>
        <div className="flex items-center gap-1 flex-wrap">
          <NavLink to="/draft" className={linkCls}>Draft</NavLink>
          <NavLink to="/leaderboard" className={linkCls}>Leaderboard</NavLink>
          {user && <NavLink to="/my-mock" className={linkCls}>My Mock</NavLink>}
          {user ? (
            <div className="flex items-center gap-2 ml-2 pl-2 border-l border-slate-800">
              <span className="text-slate-400 text-xs hidden sm:inline">{user.display_name}</span>
              <button
                onClick={signOut}
                className="text-xs text-slate-500 hover:text-white transition"
              >
                sign out
              </button>
            </div>
          ) : (
            <NavLink to="/join" className={linkCls}>Join</NavLink>
          )}
        </div>
      </div>
    </nav>
  );
}
