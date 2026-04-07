import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { Card } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';

const ERRORS = {
  not_configured: 'Discord sign-in is not configured on the server.',
  invalid_state: 'Invalid state — please try again.',
  auth_failed: 'Discord sign-in failed. Please try again.',
  access_denied: 'You cancelled the Discord login.',
};

export default function AuthCallback() {
  const { setUser } = useAuth();
  const nav = useNavigate();
  const [error, setError] = useState(null);

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, '');
    const params = new URLSearchParams(hash);
    const err = params.get('error');
    const id = params.get('id');

    if (err) {
      setError(ERRORS[err] || err);
      return;
    }
    if (!id) {
      setError('Missing user id.');
      return;
    }

    (async () => {
      try {
        const u = await api.getUser(id);
        setUser(u);
        toast.success(`Welcome, ${u.display_name}`);
        // Clear the hash before routing
        window.history.replaceState(null, '', '/draft');
        nav('/draft', { replace: true });
      } catch (e) {
        setError(e.message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center route-fade">
        <Card glass className="p-7">
          <div className="caption text-red-400">Sign-in Error</div>
          <div className="text-white font-display text-xl mt-2 mb-4">{error}</div>
          <Link to="/join"><Button>Back to Join</Button></Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 py-24 text-center route-fade">
      <div className="caption text-accent">Signing you in…</div>
      <div className="mt-6 flex justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    </div>
  );
}
