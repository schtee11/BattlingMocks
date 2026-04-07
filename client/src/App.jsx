import { Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar.jsx';
import Home from './pages/Home.jsx';
import Join from './pages/Join.jsx';
import Draft from './pages/Draft.jsx';
import LeaderboardPage from './pages/LeaderboardPage.jsx';
import MyMock from './pages/MyMock.jsx';
import Admin from './pages/Admin.jsx';

export default function App() {
  return (
    <div className="min-h-screen bg-ink text-slate-100">
      <Navbar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/join" element={<Join />} />
        <Route path="/draft" element={<Draft />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="/my-mock" element={<MyMock />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </div>
  );
}
