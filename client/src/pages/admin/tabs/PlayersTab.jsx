import { useState } from 'react';
import ProspectsTab from './ProspectsTab.jsx';
import PlayerRanksTab from './PlayerRanksTab.jsx';

// Players hub — Prospects (CRUD on the players table) and Player Ranks
// (bulk rank import + edit) share a data source, so we group them behind
// one top-level tab with a sub-switch. Both components stay standalone.
const SUBTABS = [
  ['prospects', 'Prospects'],
  ['ranks',     'Player Ranks'],
];

export default function PlayersTab({ adminKey, syncYear, players, refresh }) {
  const [sub, setSub] = useState('prospects');

  return (
    <div className="space-y-3">
      <div className="flex gap-1 border-b border-border-subtle overflow-x-auto">
        {SUBTABS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setSub(id)}
            className={`px-3 py-2 whitespace-nowrap border-b-2 transition font-display font-semibold text-[10px] uppercase tracking-[0.14em] ${
              sub === id ? 'border-accent text-text-primary' : 'border-transparent text-text-muted hover:text-text-primary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {sub === 'prospects' && (
        <ProspectsTab
          adminKey={adminKey}
          syncYear={syncYear}
          players={players}
          refresh={refresh}
        />
      )}
      {sub === 'ranks' && <PlayerRanksTab adminKey={adminKey} refresh={refresh} />}
    </div>
  );
}
