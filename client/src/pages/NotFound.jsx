import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button.jsx';
import { usePageMeta } from '../hooks/usePageMeta.js';

export default function NotFound() {
  usePageMeta({
    title: 'Page Not Found',
    description: 'That page got cut before Round 1. Head back to the lobby or jump into a mock.',
  });

  useEffect(() => {
    let el = document.head.querySelector('meta[name="robots"]');
    const prev = el ? el.getAttribute('content') : null;
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute('name', 'robots');
      document.head.appendChild(el);
    }
    el.setAttribute('content', 'noindex,follow');
    return () => {
      if (prev !== null) el.setAttribute('content', prev);
      else el.setAttribute('content', 'index,follow,max-image-preview:large,max-snippet:-1');
    };
  }, []);

  return (
    <div className="max-w-md mx-auto px-4 py-24 md:py-32 text-center route-fade">
      <div className="caption text-accent">Cut in Round 1</div>
      <div className="font-mono font-bold text-6xl md:text-7xl text-accent mt-2 leading-none">
        404
      </div>
      <h1 className="font-display font-bold uppercase tracking-[0.14em] text-text-primary text-[18px] mt-5">
        Page not found
      </h1>
      <p className="text-text-secondary text-[13.5px] mt-2 leading-relaxed max-w-xs mx-auto">
        That page got cut before Round 1. Head back to the lobby or jump straight into
        a mock.
      </p>
      <div className="mt-6 flex items-center justify-center gap-2 flex-wrap">
        <Link to="/">
          <Button>Back to Home</Button>
        </Link>
        <Link to="/draft">
          <Button variant="secondary">Start a Mock</Button>
        </Link>
      </div>
    </div>
  );
}
