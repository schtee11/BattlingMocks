import { Component } from 'react';
import { Button } from './ui/Button.jsx';

// Detects the Vite-specific "old chunk hash" error that fires when a deploy
// lands while the user has an old tab open — the hashed JS filenames
// referenced by index.js no longer exist on the CDN, so React.lazy imports
// 404. The fix is a plain page reload, which re-fetches index.html and the
// new hashed bundles. We set a sessionStorage sentinel so we don't loop
// forever if the reload itself fails for some other reason.
function isStaleChunkError(err) {
  const msg = String(err?.message || err || '');
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    /Loading chunk \d+ failed/.test(msg)
  );
}

const RELOAD_SENTINEL = 'mds_reloaded_for_stale_chunk';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info);
    // Auto-reload on stale chunk errors — but only once per tab to avoid
    // reload loops if the fresh deploy itself is broken.
    if (isStaleChunkError(error)) {
      try {
        if (!sessionStorage.getItem(RELOAD_SENTINEL)) {
          sessionStorage.setItem(RELOAD_SENTINEL, '1');
          // Small delay so the sentinel write lands before reload.
          setTimeout(() => window.location.reload(), 150);
        }
      } catch {
        // sessionStorage blocked (private mode / cookies off) — best-effort reload
        setTimeout(() => window.location.reload(), 150);
      }
    }
  }

  render() {
    if (this.state.error) {
      const stale = isStaleChunkError(this.state.error);
      return (
        <div className="max-w-md mx-auto px-4 py-24 text-center">
          <h1 className="text-2xl font-bold text-text-primary mb-2">
            {stale ? 'Updating…' : 'Something went wrong'}
          </h1>
          <p className="text-text-secondary mb-4 text-sm">
            {stale
              ? 'A new version was deployed. Refreshing…'
              : String(this.state.error.message || this.state.error)}
          </p>
          <Button onClick={() => {
            try { sessionStorage.removeItem(RELOAD_SENTINEL); } catch {}
            location.reload();
          }}>Reload</Button>
        </div>
      );
    }
    return this.props.children;
  }
}
