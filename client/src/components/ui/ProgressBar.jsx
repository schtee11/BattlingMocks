import { posHex } from '../../lib/positions.js';

// Segments can be passed the picks map so each filled segment shows the
// color of the position assigned to that pick.
export function ProgressBar({ picks = {}, playerById = new Map(), max = 32 }) {
  return (
    <div className="flex gap-1 w-full">
      {Array.from({ length: max }, (_, i) => {
        const slot = i + 1;
        const pid = picks[slot];
        const p = pid ? playerById.get(pid) : null;
        const filled = !!p;
        const color = p ? posHex(p.position) : null;
        return (
          <div
            key={slot}
            className={`h-2 flex-1 rounded-sm transition-all duration-300 ${
              filled ? 'animate-pop-in' : 'bg-white/5 border border-white/5'
            }`}
            style={
              filled
                ? {
                    backgroundColor: color,
                    boxShadow: `0 0 10px -2px ${color}99`,
                  }
                : undefined
            }
          />
        );
      })}
    </div>
  );
}
