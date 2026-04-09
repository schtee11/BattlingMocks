import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './index.css';

// Safety net for Vite code-split stale-hash errors. After a deploy the old
// tab references hashed JS filenames that no longer exist on the CDN —
// React.lazy imports reject and normally get caught by the ErrorBoundary,
// but unhandled rejections can also escape through this channel. Reload the
// page once per tab to pick up the fresh bundles.
const RELOAD_SENTINEL = 'mds_reloaded_for_stale_chunk';
window.addEventListener('unhandledrejection', (e) => {
  const msg = String(e.reason?.message || e.reason || '');
  const isStale =
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('Importing a module script failed');
  if (!isStale) return;
  try {
    if (sessionStorage.getItem(RELOAD_SENTINEL)) return; // avoid loops
    sessionStorage.setItem(RELOAD_SENTINEL, '1');
  } catch {}
  setTimeout(() => window.location.reload(), 150);
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
