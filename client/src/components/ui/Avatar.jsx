import { prettyName } from '../../lib/displayName.js';

const SIZES = {
  xs: { box: 'w-6 h-6', text: 'text-[10px]' },
  sm: { box: 'w-8 h-8', text: 'text-[12px]' },
  md: { box: 'w-10 h-10', text: 'text-[14px]' },
  lg: { box: 'w-14 h-14', text: 'text-[18px]' },
};

export function Avatar({ url, name, size = 'sm', className = '' }) {
  const s = SIZES[size] || SIZES.sm;
  const initial = prettyName(name)?.[0]?.toUpperCase() || '?';
  if (url) {
    return (
      <img
        src={url}
        alt=""
        width={24}
        height={24}
        loading="lazy"
        decoding="async"
        className={`${s.box} rounded-full ring-1 ring-border-focus object-cover shrink-0 ${className}`}
      />
    );
  }
  return (
    <div
      className={`${s.box} ${s.text} rounded-full flex items-center justify-center font-display font-bold text-bg-deep shrink-0 ${className}`}
      style={{ background: 'var(--gradient-accent)' }}
      aria-hidden="true"
    >
      {initial}
    </div>
  );
}
