import { lazy, Suspense } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import Navbar from './components/Navbar.jsx';
import Home from './pages/Home.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import { Skeleton } from './components/ui/Skeleton.jsx';

// Code-split every non-landing route so the initial bundle stays small.
const Join = lazy(() => import('./pages/Join.jsx'));
const Draft = lazy(() => import('./pages/Draft.jsx'));
const LeaderboardPage = lazy(() => import('./pages/LeaderboardPage.jsx'));
const MyMock = lazy(() => import('./pages/MyMock.jsx'));
const Admin = lazy(() => import('./pages/Admin.jsx'));
const TeamMock = lazy(() => import('./pages/TeamMock.jsx'));
const AuthCallback = lazy(() => import('./pages/AuthCallback.jsx'));
const NotFound = lazy(() => import('./pages/NotFound.jsx'));
const Live = lazy(() => import('./pages/Live.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const BigBoard = lazy(() => import('./pages/BigBoard.jsx'));

function RouteLoader() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-10 space-y-3">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-6 w-48" />
      <div className="mt-6 space-y-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const location = useLocation();
  return (
    <div className="h-full flex flex-col text-text-primary">
      <Navbar />
      <div className="flex-1 min-h-0">
      <ErrorBoundary>
        <div key={location.pathname} className="route-fade h-full">
          <Suspense fallback={<RouteLoader />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/join" element={<Join />} />
              <Route path="/draft" element={<Draft />} />
              <Route path="/leaderboard" element={<LeaderboardPage />} />
              <Route path="/my-mock" element={<MyMock />} />
              <Route path="/team-mock" element={<TeamMock />} />
              <Route path="/live" element={<Live />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/my-board" element={<BigBoard />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </div>
      </ErrorBoundary>
      </div>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: 'var(--bg-surface)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)',
          },
        }}
      />
    </div>
  );
}
