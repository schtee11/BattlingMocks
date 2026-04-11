import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, linkProviderUrl } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { prettyName } from '../lib/displayName.js';
import { Card } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Spinner } from '../components/ui/Spinner.jsx';
import { Avatar } from '../components/ui/Avatar.jsx';

// Display metadata for each OAuth provider. Keep in sync with the server
// PROVIDERS map in routes/auth.js.
const PROVIDER_META = {
  discord: {
    label: 'Discord',
    color: '#5865F2',
  },
  google: {
    label: 'Google',
    color: '#ffffff',
  },
};

function DiscordIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M20.317 4.369A19.79 19.79 0 0 0 16.558 3c-.197.35-.42.82-.573 1.197a18.28 18.28 0 0 0-5.972 0A14.36 14.36 0 0 0 9.425 3a19.74 19.74 0 0 0-3.76 1.369C2.104 9.66 1.15 14.813 1.583 19.88a19.9 19.9 0 0 0 5.99 3.04c.48-.65.91-1.34 1.28-2.06-.7-.26-1.37-.59-2-.97.17-.12.34-.24.5-.37 3.86 1.78 8.04 1.78 11.87 0 .17.13.33.25.5.37-.64.38-1.31.71-2 .97.37.72.8 1.41 1.28 2.06a19.9 19.9 0 0 0 5.99-3.04c.5-5.85-.89-10.96-3.7-15.51zM8.02 16.15c-1.18 0-2.15-1.1-2.15-2.44 0-1.35.95-2.45 2.15-2.45 1.2 0 2.17 1.1 2.15 2.45 0 1.34-.95 2.44-2.15 2.44zm7.96 0c-1.18 0-2.15-1.1-2.15-2.44 0-1.35.95-2.45 2.15-2.45s2.17 1.1 2.15 2.45c0 1.34-.95 2.44-2.15 2.44z" />
    </svg>
  );
}

function GoogleIcon(props) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

function ProviderIcon({ provider, className }) {
  if (provider === 'discord') return <DiscordIcon className={className} />;
  if (provider === 'google') return <GoogleIcon className={className} />;
  return null;
}

export default function Settings() {
  const { user, signOut } = useAuth();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyProvider, setBusyProvider] = useState(null);

  // Redirect to /join if not signed in. The settings page is only meaningful
  // once there's a user to manage.
  useEffect(() => {
    if (!user) nav('/join', { replace: true });
  }, [user, nav]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await api.getUserIdentities(user.id);
        if (!cancelled) setData(res);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Could not load linked accounts.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user) return null;

  const linked = data?.identities || [];
  const linkedProviders = new Set(linked.map((i) => i.provider));
  const available = (data?.available_providers || []).filter(
    (p) => !linkedProviders.has(p)
  );

  async function handleUnlink(provider) {
    const label = PROVIDER_META[provider]?.label || provider;
    if (linked.length <= 1) {
      toast.error("You can't unlink your only sign-in method.");
      return;
    }
    const ok = window.confirm(
      `Unlink ${label}? You'll only be able to sign in with your other linked providers after this.`
    );
    if (!ok) return;
    setBusyProvider(provider);
    try {
      await api.unlinkProvider(user.id, provider);
      const res = await api.getUserIdentities(user.id);
      setData(res);
      toast.success(`${label} unlinked.`);
    } catch (e) {
      if (/cannot_unlink_last/i.test(e.message)) {
        toast.error("You can't unlink your only sign-in method.");
      } else {
        toast.error(e.message || 'Could not unlink.');
      }
    } finally {
      setBusyProvider(null);
    }
  }

  function handleLink(provider) {
    // Full-page redirect into the OAuth flow. The callback will bounce back
    // to /auth/callback#linked=1 and then navigate back here.
    window.location.href = linkProviderUrl(provider, user.id);
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-10 md:py-14 route-fade">
      <div className="mb-6">
        <div className="caption text-accent">Account</div>
        <h1 className="font-display text-[28px] text-text-primary mt-1">Settings</h1>
      </div>

      {/* Profile summary */}
      <Card glass className="p-5 mb-4">
        <div className="flex items-center gap-4">
          <Avatar url={user.avatar_url} name={user.display_name} size="md" />
          <div className="min-w-0 flex-1">
            <div className="font-display uppercase tracking-[0.14em] text-[11px] text-text-muted">
              Signed in as
            </div>
            <div className="font-display text-[18px] text-text-primary truncate">
              {prettyName(user.display_name)}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </Card>

      {/* Linked providers */}
      <Card glass className="p-5">
        <div className="caption text-text-muted mb-1">Sign-in methods</div>
        <p className="text-text-secondary text-[12.5px] mb-5">
          Link multiple providers so you can sign in with either one and land in the
          same account.
        </p>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Spinner className="w-6 h-6" label="Loading linked accounts" />
          </div>
        )}

        {error && !loading && (
          <div
            className="text-[12.5px] p-3 rounded-md border"
            style={{
              color: 'var(--error-text)',
              borderColor: 'var(--error-border)',
              background: 'var(--error-bg, transparent)',
            }}
          >
            {error}
          </div>
        )}

        {!loading && !error && (
          <ul className="space-y-2.5">
            {linked.map((ident) => {
              const meta = PROVIDER_META[ident.provider] || {
                label: ident.provider,
                color: '#888',
              };
              const isOnly = linked.length <= 1;
              return (
                <li
                  key={ident.provider}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border-subtle"
                >
                  <div
                    className="w-9 h-9 rounded-md flex items-center justify-center shrink-0"
                    style={{ backgroundColor: meta.color }}
                  >
                    <ProviderIcon
                      provider={ident.provider}
                      className={`w-5 h-5 ${
                        ident.provider === 'discord' ? 'text-white' : ''
                      }`}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-display uppercase tracking-[0.12em] text-[12px] text-text-primary">
                      {meta.label}
                    </div>
                    <div className="text-[11px] text-text-muted truncate">
                      {ident.email || 'Linked'}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isOnly || busyProvider === ident.provider}
                    onClick={() => handleUnlink(ident.provider)}
                    title={isOnly ? "You can't unlink your only sign-in method" : ''}
                  >
                    {busyProvider === ident.provider ? '…' : 'Unlink'}
                  </Button>
                </li>
              );
            })}

            {available.map((provider) => {
              const meta = PROVIDER_META[provider] || {
                label: provider,
                color: '#888',
              };
              return (
                <li
                  key={provider}
                  className="flex items-center gap-3 p-3 rounded-lg border border-dashed border-border-subtle"
                >
                  <div
                    className="w-9 h-9 rounded-md flex items-center justify-center shrink-0 opacity-60"
                    style={{ backgroundColor: meta.color }}
                  >
                    <ProviderIcon
                      provider={provider}
                      className={`w-5 h-5 ${
                        provider === 'discord' ? 'text-white' : ''
                      }`}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-display uppercase tracking-[0.12em] text-[12px] text-text-secondary">
                      {meta.label}
                    </div>
                    <div className="text-[11px] text-text-muted">Not linked</div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleLink(provider)}
                  >
                    Link
                  </Button>
                </li>
              );
            })}

            {linked.length === 0 && available.length === 0 && (
              <li className="text-[12px] text-text-muted text-center py-6">
                No providers configured on the server.
              </li>
            )}
          </ul>
        )}
      </Card>

      <div className="text-center mt-5">
        <Link
          to="/draft"
          className="caption text-text-muted hover:text-text-primary transition"
        >
          ← Back to draft
        </Link>
      </div>
    </div>
  );
}
