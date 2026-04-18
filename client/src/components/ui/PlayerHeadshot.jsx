import { useState, useEffect } from 'react';
import { posHex } from '../../lib/positions.js';
import { playerImageUrl } from '../../lib/api.js';

const SIZES = {
  xs: { box: 'w-7 h-7', text: 'text-[10px]' },
  sm: { box: 'w-9 h-9', text: 'text-[12px]' },
  md: { box: 'w-12 h-12', text: 'text-[14px]' },
  lg: { box: 'w-16 h-16', text: 'text-[18px]' },
};

export function PlayerHeadshot({ url, name, position, size = 'sm', className = '' }) {
  const [error, setError] = useState(false);
  const s = SIZES[size] || SIZES.sm;
  const initial = (name || '?').trim()[0]?.toUpperCase() || '?';
  const color = position ? posHex(position) : '#334155';

  // Reset error if the url changes
  useEffect(() => { setError(false); }, [url]);

  if (!url || error) {
    return (
      <div
        className={`${s.box} ${s.text} rounded-full flex items-center justify-center font-display font-bold shrink-0 ${className}`}
        style={{
          backgroundColor: `${color}22`,
          color,
          boxShadow: `inset 0 0 0 1px ${color}55`,
        }}
        aria-hidden
      >
        {initial}
      </div>
    );
  }

  return (
    <img
      // ESPN CDN images get routed through our server-side proxy.
      // Hitting ESPN directly from mobile Safari (no-referrer + Safari UA)
      // returns placeholders / nothing for most prospects, so the whole
      // app looked photo-less on iPhones. Non-ESPN URLs pass through.
      src={playerImageUrl(url)}
      alt={name ? `${name} NFL draft headshot` : ''}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setError(true)}
      className={`${s.box} rounded-full object-cover shrink-0 ring-1 ring-border-subtle ${className}`}
      style={{ backgroundColor: `${color}22` }}
    />
  );
}
