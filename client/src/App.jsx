import { Routes, Route, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import Navbar from './components/Navbar.jsx';
import Home from './pages/Home.jsx';
import Join from './pages/Join.jsx';
import Draft from './pages/Draft.jsx';
import LeaderboardPage from './pages/LeaderboardPage.jsx';
import MyMock from './pages/MyMock.jsx';
import Admin from './pages/Admin.jsx';
import AuthCallback from './pages/AuthCallback.jsx';
import NotFound from './pages/NotFound.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';

export default function App() {
  const location = useLocation();
  return (
    <div className="min-h-screen text-slate-100">
      <Navbar />
      <ErrorBoundary>
        <div key={location.pathname} className="route-fade">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/join" element={<Join />} />
            <Route path="/draft" element={<Draft />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/my-mock" element={<MyMock />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
      </ErrorBoundary>
      <Toaster
        position="top-right"
        toastOptions={{
          style: { background: '#111827', color: '#f1f5f9', border: '1px solid rgba(255,255,255,0.06)' },
        }}
      />
    </div>
  );
}
