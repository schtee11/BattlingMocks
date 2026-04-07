import { useDraggable } from '@dnd-kit/core';
import { PositionBadge } from './ui/Badge.jsx';

export function ProspectCard({ player, used, selected, onClick }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `player-${player.id}`,
    disabled: used,
  });

  return (
    <li
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className={`p-2.5 rounded-lg border cursor-pointer transition-all touch-none
        ${selected ? 'border-accent bg-accent/10 shadow-glow' : 'border-slate-700 hover:border-slate-500'}
        ${used ? 'opacity-40 line-through cursor-not-allowed hover:border-slate-700' : ''}
        ${isDragging ? 'opacity-50' : ''}
      `}
      aria-label={`${player.name}, ${player.position}, ${player.school}`}
    >
      <div className="flex items-center gap-2">
        <div className="text-xs font-mono text-slate-500 w-6 shrink-0">
          {player.rank ?? ''}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-white text-sm font-medium truncate">{player.name}</div>
          <div className="text-xs text-slate-500 truncate">{player.school}</div>
        </div>
        <PositionBadge position={player.position} />
      </div>
    </li>
  );
}
