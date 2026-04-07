import { posColor } from '../../lib/positions.js';

export function Badge({ children, className = '', tone }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide rounded-full ring-1 ${tone || 'bg-slate-500/15 text-slate-300 ring-slate-500/30'} ${className}`}
    >
      {children}
    </span>
  );
}

export function PositionBadge({ position, className = '' }) {
  const c = posColor(position);
  return (
    <Badge tone={`${c.bg} ${c.text} ring-1 ${c.ring}`} className={className}>
      {position}
    </Badge>
  );
}
