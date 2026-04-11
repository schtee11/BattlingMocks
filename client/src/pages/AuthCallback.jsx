import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { prettyName } from '../lib/displayName.js';
import { Card } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Spinner } from '../components/ui/Spinner.jsx';

// User-facing copy for every known server-returned error code. The server
// may still return an arbitrary string — we fall back to that so nothing
// ever silently fails.
const ERRORS = {
  not_configured: {
    title: 'Sign-in unavailable',
    body: 'That sign-in provider is not configured on the server. Try another option or contact the admin.',
  },
  invalid_state: {
    title: 'Session mismatch',
    body: 'The sign-in request expired or was reused. Please start sign-in again.',
  },
  auth_failed: {
    title: 'Sign-in failed',
    body: 'Your sign-in provider did not return a valid session. Please try signing in again.',
  },
  access_denied: {
    title: 'Sign-in cancelled',
    body: 'You dismissed the sign-in prompt before it finished.',
  },
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
      setError(ERRORS[err] || { title: 'Sign-in error', body: err });
      return;
    }
    if (!id) {
      setError({
        title: 'Sign-in error',
        body: 'Missing user id in the callback. Please start sign-in again.',
      });
      return;
    }

    (async () => {
      try {
        const u = await api.getUser(id);
        setUser(u);
        toast.success(`Welcome, ${prettyName(u.display_name)}`);
        window.history.replaceState(null, '', '/draft');
        nav('/draft', { replace: true });
      } catch (e) {
        setError({
          title: 'Sign-in error',
          body: e.message || 'Could not finish signing you in.',
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center route-fade">
        <Card glass className="p-7">
          <div className="caption" style={{ color: 'var(--error-text)' }}>
            {error.title}
          </div>
          <p className="text-text-secondary text-[13.5px] mt-2 mb-5 leading-relaxed">
            {error.body}
          </p>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <Link to="/join">
              <Button>Try again</Button>
            </Link>
            <Link to="/">
              <Button variant="secondary">Back to home</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 py-24 text-center route-fade">
      <div className="caption text-accent">Signing you in…</div>
      <div className="mt-6 flex justify-center">
        <Spinner className="w-10 h-10" label="Signing you in" />
      </div>
      <p className="text-text-muted text-[12px] mt-4">Verifying your session…</p>
    </div>
  );
}
