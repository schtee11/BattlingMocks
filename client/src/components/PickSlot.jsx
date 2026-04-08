import { useEffect, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { posHex } from '../lib/positions.js';
import { PositionBadge } from './ui/Badge.jsx';
import { TeamLogo } from './ui/TeamLogo.jsx';
import { PlayerHeadshot } from './ui/PlayerHeadshot.jsx';

export function PickSlot({ slot, team, player, onClear, onClick, isActive }) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot-${slot}` });
  const [flash, setFlash] = useState(false);
  const [prevPid, setPrevPid] = useState(player?.id ?? null);

  useEffect(() => {
    if (player?.id && player.id !== prevPid) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 700);
      setPrevPid(player.id);
      return () => clearTimeout(t);
    }
    if (!player?.id) setPrevPid(null);
  }, [player?.id, prevPid]);

  const posColor = player ? posHex(player.position) : null;

  const baseCls =
    'group relative flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-[transform,border-color,background-color,box-shadow] duration-150 will-anim';
  const filledCls = player
    ? 'bg-bg-elevated border border-border-subtle hover:border-border-focus'
    : 'bg-bg-surface/40 border border-dashed border-border-subtle hover:border-border-focus hover:bg-white/[0.02]';
  const overCls = isOver ? 'ring-2 ring-accent shadow-glow scale-[1.01]' : '';
  const activeCls = isActive && !player ? 'border-accent/40 bg-accent/[0.04]' : '';
  const flashCls = flash ? 'animate-flash' : '';

  return (
    <li
      ref={setNodeRef}
      onClick={onClick}
      tabIndex={0}
      aria-label={`Pick ${slot}${team ? ` - ${team.team_name}` : ''}${player ? ` - ${player.name}` : ' - empty'}`}
      className={`${baseCls} ${filledCls} ${overCls} ${activeCls} ${flashCls}`}
      style={player ? { borderLeft: `3px solid ${posColor}` } : undefined}
    >
      {/* Pick number badge — 40px */}
      <div
        className="relative flex items-center justify-center w-10 h-10 rounded-full font-mono font-bold text-[13px] shrink-0 transition-colors"
        style={
          player
            ? { backgroundColor: posColor, color: '#04080f', boxShadow: `0 0 18px -6px ${posColor}` }
            : { backgroundColor: 'transparent', color: '#7a8ba8', boxShadow: 'inset 0 0 0 1.5px rgba(255,255,255,0.1)' }
        }
      >
        {slot}
      </div>

      {/* Team logo — 36px, always visible */}
      <div className="w-9 h-9 flex items-center justify-center shrink-0">
        <TeamLogo abbr={team?.team} size="md" />
      </div>

      {/* Player headshot — only when filled, 36px to match team logo */}
      {player && (
        <PlayerHeadshot
          url={player.headshot_url}
          name={player.name}
          position={player.position}
          size="sm"
        />
      )}

      {/* Text column */}
      <div className="flex-1 min-w-0 leading-tight">
        <div className="caption text-[9.5px] tracking-[0.22em] truncate">
          <span>{team?.team || '—'}</span>
          {team?.team_name && (
            <span className="ml-1.5 text-text-muted normal-case tracking-normal font-sans font-normal text-[10.5px] hidden md:inline">
              {team.team_name}
            </span>
          )}
        </div>
        {player ? (
          <div className="flex items-center gap-2 mt-1">
            <div className="text-text-primary font-semibold truncate text-[14px]">{player.name}</div>
            <PositionBadge position={player.position} />
            <div className="text-[11px] text-text-muted truncate hidden lg:block">{player.school}</div>
          </div>
        ) : (
          <div className="caption mt-1 text-text-muted text-[10px]">Select player</div>
        )}
      </div>

      {player && (
        <button
          onClick={(e) => { e.stopPropagation(); onClear?.(); }}
          className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-400 transition p-1 text-sm shrink-0"
          aria-label={`Clear pick ${slot}`}
          tabIndex={-1}
        >
          ✕
        </button>
      )}
    </li>
  );
}
