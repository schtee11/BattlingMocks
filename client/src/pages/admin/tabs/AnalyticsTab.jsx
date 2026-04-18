import { useState } from 'react';
import VolumeStatsTab from './VolumeStatsTab.jsx';
import ConsensusTab from './ConsensusTab.jsx';
import BoardsTab from './BoardsTab.jsx';

// Analytics hub — combines three read-only insight views behind a single
// sub-tab switch. Each sub-tab renders the original, unmodified component
// so they stay testable / extractable. Lazy-render: only the active sub-tab
// mounts so the heavy Consensus/Boards components don't all fire their
// data fetches at once.
const SUBTABS = [
  ['volume',    'Volume Stats'],
  ['consensus', 'Consensus'],
  ['boards',    'Boards'],
];

export default function AnalyticsTab({ adminKey, syncYear, order }) {
  const [sub, setSub] = useState('volume');

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

      {sub === 'volume' && <VolumeStatsTab adminKey={adminKey} syncYear={syncYear} />}
      {sub === 'consensus' && <ConsensusTab order={order} />}
      {sub === 'boards' && <BoardsTab adminKey={adminKey} />}
    </div>
  );
}
