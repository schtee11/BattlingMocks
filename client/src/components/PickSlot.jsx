import { memo, useCallback, useEffect, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { posHex } from '../lib/positions.js';
import { PositionBadge } from './ui/Badge.jsx';
import { TeamLogo } from './ui/TeamLogo.jsx';
import { PlayerHeadshot } from './ui/PlayerHeadshot.jsx';

// Memoized so that picking a single slot only re-renders that one row
// instead of all 32. Parent passes STABLE onClear/onClick identities (via
// useCallback with empty deps + latestRef pattern) so the memo comparator
// stays effective — inline arrow functions would defeat it.
function PickSlotInner({ slot, team, player, onClear, onClick, isActive, isConfident, onToggleConfident }) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot-${slot}` });
  const [flash, setFlash] = useState(false);
  const [prevPid, setPrevPid] = useState(player?.id ?? null);

  // Bind slot into the handlers so the parent can pass slot-agnostic
  // callbacks and still get per-slot behavior.
  const handleClick = useCallback(() => onClick?.(slot), [onClick, slot]);
  const handleClear = useCallback(
    (e) => { e.stopPropagation(); onClear?.(slot); },
    [onClear, slot]
  );
  // Confidence-pick toggle — only enabled when the slot is filled and a
  // toggle handler is provided. Clicking the star never triggers the parent
  // slot click (stopPropagation).
  const handleToggleConfident = useCallback(
    (e) => { e.stopPropagation(); onToggleConfident?.(slot); },
    [onToggleConfident, slot]
  );

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
      onClick={handleClick}
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
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className="caption text-text-muted text-[10px] shrink-0">Select player</span>
            {Array.isArray(team?.team_needs) && team.team_needs.length > 0 && (
              <>
                <span className="text-text-muted text-[10px] px-0.5">·</span>
                {team.team_needs.map((need) => (
                  <PositionBadge key={need} position={need} />
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Confidence-pick star — only on filled slots, only when the parent
          wires up onToggleConfident (TeamMock and legacy flows skip it). */}
      {player && onToggleConfident && (
        <button
          onClick={handleToggleConfident}
          className={`shrink-0 rounded-full w-7 h-7 flex items-center justify-center transition-all ${
            isConfident
              ? 'text-gold shadow-glow-gold bg-gold/10 ring-1 ring-gold/50'
              : 'text-text-muted hover:text-gold hover:bg-gold/5 opacity-60 hover:opacity-100'
          }`}
          aria-label={isConfident ? `Remove confidence pick ${slot}` : `Mark pick ${slot} as confidence pick`}
          title={isConfident ? 'Confidence pick (1.5× on exact match)' : 'Mark as confidence pick'}
          tabIndex={-1}
        >
          <span className="font-display text-[14px] leading-none">★</span>
        </button>
      )}

      {player && (
        <button
          onClick={handleClear}
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

export const PickSlot = memo(PickSlotInner, (prev, next) =>
  prev.slot === next.slot &&
  prev.team === next.team &&
  prev.player === next.player &&
  prev.isActive === next.isActive &&
  prev.isConfident === next.isConfident &&
  prev.onClear === next.onClear &&
  prev.onClick === next.onClick &&
  prev.onToggleConfident === next.onToggleConfident
);
