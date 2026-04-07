import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';

export default function Navbar() {
  const { user, signOut } = useAuth();
  const linkCls = ({ isActive }) =>
    `px-3 py-2 rounded ${isActive ? 'bg-accent text-ink' : 'text-slate-300 hover:text-white'}`;
  return (
    <nav className="bg-panel border-b border-slate-800">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between flex-wrap gap-2">
        <Link to="/" className="text-xl font-bold text-white">
          MockDraft <span className="text-accent">Showdown</span>
        </Link>
        <div className="flex items-center gap-1 flex-wrap">
          <NavLink to="/draft" className={linkCls}>Draft</NavLink>
          <NavLink to="/leaderboard" className={linkCls}>Leaderboard</NavLink>
          {user && <NavLink to="/my-mock" className={linkCls}>My Mock</NavLink>}
          {user ? (
            <div className="flex items-center gap-2 ml-2">
              <span className="text-slate-400 text-sm hidden sm:inline">{user.display_name}</span>
              <button onClick={signOut} className="text-xs text-slate-400 hover:text-white">sign out</button>
            </div>
          ) : (
            <NavLink to="/join" className={linkCls}>Join</NavLink>
          )}
        </div>
      </div>
    </nav>
  );
}
