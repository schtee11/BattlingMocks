import { useEffect, useState } from 'react';

// Live countdown to a target Date. Accepts either a Date or an ISO string.
// Re-renders once per second; stops at zero. Designed to be composed inside
// a Card — the parent controls layout, we only render the 4 unit blocks.
//
// Props:
//   target    : Date | string (required)
//   label     : optional caption above the digits
//   onExpire  : callback fired once when the countdown first hits zero
//   compact   : if true, smaller digits (for nav/header use)
//
// The target is memoized via ref so passing a new Date() every parent render
// doesn't cause the interval to restart.
export function CountdownTimer({ target, label, onExpire, compact = false }) {
  const targetMs = target instanceof Date ? target.getTime() : new Date(target).getTime();
  const [now, setNow] = useState(() => Date.now());
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (expired) return;
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expired]);

  const diff = Math.max(0, targetMs - now);
  useEffect(() => {
    if (diff === 0 && !expired) {
      setExpired(true);
      onExpire?.();
    }
  }, [diff, expired, onExpire]);

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  const seconds = Math.floor((diff / 1000) % 60);

  const units = [
    { label: 'Days', value: days },
    { label: 'Hours', value: hours },
    { label: 'Minutes', value: minutes },
    { label: 'Seconds', value: seconds },
  ];

  const digitClass = compact
    ? 'font-mono font-bold text-xl md:text-2xl tabular text-text-primary leading-none'
    : 'font-mono font-bold text-4xl md:text-5xl tabular text-text-primary leading-none';
  const labelClass = compact
    ? 'caption mt-0.5 text-[9px]'
    : 'caption mt-2 text-[10px]';

  return (
    <div className="text-center">
      {label && <div className="caption text-accent mb-3">{label}</div>}
      <div className={compact ? 'flex gap-3 justify-center' : 'grid grid-cols-4 gap-3 md:gap-6 max-w-xl mx-auto'}>
        {units.map((u) => (
          <div
            key={u.label}
            className={compact ? 'min-w-[48px]' : 'rounded-lg border py-3 md:py-4'}
            style={
              compact
                ? undefined
                : {
                    background: 'rgba(255,255,255,0.02)',
                    borderColor: 'var(--border-subtle)',
                    boxShadow: '0 0 0 1px rgba(0,229,255,0.04) inset',
                  }
            }
          >
            <div className={digitClass}>
              {String(u.value).padStart(2, '0')}
            </div>
            <div className={labelClass}>{u.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// The single source of truth for the 2026 NFL Draft kickoff time.
// Round 1 begins at 8:00 PM ET on Thursday, April 23, 2026.
// ET = UTC-4 during April (EDT). Exported so other components can import
// the same timestamp without re-computing.
export const DRAFT_START_2026 = new Date('2026-04-23T20:00:00-04:00');
