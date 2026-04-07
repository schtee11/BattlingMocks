import { posHex } from '../../lib/positions.js';

export function Badge({ children, className = '', style }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] rounded-full ring-1 font-display ${className}`}
      style={style}
    >
      {children}
    </span>
  );
}

export function PositionBadge({ position, muted = false, className = '' }) {
  const color = posHex(position);
  const style = muted
    ? {
        backgroundColor: 'rgba(255,255,255,0.05)',
        color: 'rgba(255,255,255,0.35)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)',
      }
    : {
        backgroundColor: `${color}1f`, // ~12% alpha
        color,
        boxShadow: `inset 0 0 0 1px ${color}55`,
      };
  return (
    <Badge className={`ring-0 ${className}`} style={style}>
      {position}
    </Badge>
  );
}
