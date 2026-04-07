import { useDroppable } from '@dnd-kit/core';
import { PositionBadge } from './ui/Badge.jsx';

export function PickSlot({ slot, team, player, onClear, onClick, isActive }) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot-${slot}` });
  return (
    <li
      ref={setNodeRef}
      onClick={onClick}
      tabIndex={0}
      aria-label={`Pick ${slot}${team ? ` - ${team.team_name}` : ''}${player ? ` - ${player.name}` : ' - empty'}`}
      className={`group flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-all animate-slide-in
        ${player ? 'border-accent/30 bg-ink' : 'border-slate-700 hover:border-slate-500 bg-surface'}
        ${isOver ? 'ring-2 ring-accent shadow-glow' : ''}
        ${isActive ? 'ring-1 ring-accent/50' : ''}
      `}
    >
      <div className="flex items-center justify-center w-9 h-9 rounded-full bg-slate-800 font-bold text-accent text-sm ring-1 ring-slate-700 shrink-0">
        {slot}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-slate-500 truncate">
          {team ? team.team_name : '—'}
        </div>
        {player ? (
          <div className="flex items-center gap-2 mt-0.5">
            <div className="text-white font-medium truncate">{player.name}</div>
            <PositionBadge position={player.position} />
            <div className="text-xs text-slate-500 truncate hidden sm:block">{player.school}</div>
          </div>
        ) : (
          <div className="text-slate-600 text-sm italic">empty</div>
        )}
      </div>
      {player && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClear?.();
          }}
          className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition p-1"
          aria-label={`Clear pick ${slot}`}
        >
          ✕
        </button>
      )}
    </li>
  );
}
