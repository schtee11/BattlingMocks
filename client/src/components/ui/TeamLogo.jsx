import { useState, useEffect } from 'react';
import { teamLogoUrl } from '../../lib/teams.js';
import { playerImageUrl } from '../../lib/api.js';

const SIZES = {
  xs: 'w-5 h-5',
  sm: 'w-7 h-7',
  md: 'w-9 h-9',
  lg: 'w-12 h-12',
  xl: 'w-16 h-16',
};

export function TeamLogo({ abbr, size = 'sm', className = '' }) {
  const [error, setError] = useState(false);
  const url = teamLogoUrl(abbr);
  const cls = SIZES[size] || SIZES.sm;

  // Reset error state if the abbr changes (e.g. after a trade swap)
  useEffect(() => { setError(false); }, [abbr]);

  if (!abbr || !url || error) {
    return (
      <div
        className={`${cls} flex items-center justify-center text-[9px] font-display font-bold uppercase tracking-wide text-text-muted bg-bg-elevated rounded-full border border-border-subtle shrink-0 ${className}`}
        aria-hidden
      >
        {abbr || '—'}
      </div>
    );
  }

  return (
    <img
      // Route the ESPN CDN team logo through our server-side proxy so
      // mobile Safari actually renders it — see PlayerHeadshot for the
      // full rationale.
      src={playerImageUrl(url)}
      alt={`${abbr} logo`}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setError(true)}
      className={`${cls} object-contain shrink-0 ${className}`}
    />
  );
}
