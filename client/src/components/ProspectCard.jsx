import { useDraggable } from '@dnd-kit/core';
import { posHex } from '../lib/positions.js';
import { PositionBadge } from './ui/Badge.jsx';

export function ProspectCard({ player, used, selected, onClick }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `player-${player.id}`,
    disabled: used,
  });

  const color = posHex(player.position);

  const base = 'relative p-2.5 rounded-lg cursor-pointer transition-all duration-150 touch-none border';
  const state = selected
    ? 'border-accent bg-accent/[0.07] shadow-glow'
    : used
    ? 'border-white/5 opacity-40 hover:border-white/5 cursor-not-allowed'
    : 'border-border-subtle bg-bg-surface/40 hover:border-border-focus hover:-translate-y-[1px] hover:bg-white/[0.03]';
  const dragging = isDragging ? 'opacity-50 rotate-1' : '';

  return (
    <li
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className={`${base} ${state} ${dragging}`}
      style={
        !used && !selected
          ? { borderLeft: `3px solid transparent` }
          : selected
          ? { borderLeft: `3px solid ${color}` }
          : undefined
      }
      aria-label={`${player.name}, ${player.position}, ${player.school}`}
    >
      <div className="flex items-center gap-2">
        <div className="font-mono text-[10px] text-text-muted w-6 shrink-0 text-right">
          {player.rank ?? ''}
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-[13.5px] font-semibold truncate ${used ? 'line-through text-text-muted' : 'text-white'}`}>
            {player.name}
          </div>
          <div className="text-[10.5px] text-text-muted truncate">{player.school}</div>
        </div>
        <PositionBadge position={player.position} muted={used} />
      </div>
    </li>
  );
}
