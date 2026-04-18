import { useEffect } from 'react';

// Lightweight document meta updater. Sets document.title and optionally
// updates the meta description + og:title + og:description tags so each
// route has distinct SEO metadata without pulling in react-helmet-async.
//
// Usage:
//   usePageMeta({ title: 'Leaderboard', description: 'See the live standings' });
//
// Title is automatically suffixed with " · MockDraft Showdown" unless the
// caller passes suffix: false (e.g. the homepage uses a custom full title).
const SITE_ORIGIN = 'https://mockdraftshowdown.com';

export function usePageMeta({ title, description, suffix = true, path } = {}) {
  useEffect(() => {
    const fullTitle = title ? (suffix ? `${title} · MockDraft Showdown` : title) : null;
    if (fullTitle) document.title = fullTitle;

    if (description) {
      upsertMeta('description', description, 'name');
      upsertMeta('og:description', description, 'property');
      upsertMeta('twitter:description', description, 'name');
    }
    if (fullTitle) {
      upsertMeta('og:title', fullTitle, 'property');
      upsertMeta('twitter:title', fullTitle, 'name');
    }

    // Per-route canonical + og:url. Crawlers use canonical to collapse
    // duplicates; on a SPA we have to keep it accurate as routes change.
    const canonicalPath =
      path || (typeof window !== 'undefined' ? window.location.pathname : '/');
    const canonicalUrl = `${SITE_ORIGIN}${canonicalPath === '/' ? '/' : canonicalPath}`;
    upsertLink('canonical', canonicalUrl);
    upsertMeta('og:url', canonicalUrl, 'property');
  }, [title, description, suffix, path]);
}

function upsertMeta(key, content, attr) {
  if (typeof document === 'undefined') return;
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertLink(rel, href) {
  if (typeof document === 'undefined') return;
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}
