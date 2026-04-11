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
export function usePageMeta({ title, description, suffix = true } = {}) {
  useEffect(() => {
    if (title) {
      const full = suffix ? `${title} · MockDraft Showdown` : title;
      document.title = full;
    }
    if (description) {
      upsertMeta('description', description, 'name');
      upsertMeta('og:description', description, 'property');
      upsertMeta('twitter:description', description, 'name');
    }
    if (title) {
      const ogTitle = suffix ? `${title} · MockDraft Showdown` : title;
      upsertMeta('og:title', ogTitle, 'property');
      upsertMeta('twitter:title', ogTitle, 'name');
    }
  }, [title, description, suffix]);
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
