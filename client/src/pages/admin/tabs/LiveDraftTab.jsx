import EnterResultsTab from './EnterResultsTab.jsx';
import ScoringTab from './ScoringTab.jsx';

// Live Draft — the draft-night operations surface. Enter actual picks on top,
// then lock + run scoring in the card below. The two existing tab components
// are rendered back-to-back so each stays a self-contained unit.
export default function LiveDraftTab({
  adminKey,
  syncYear,
  setSyncYear,
  players,
  actuals,
  order,
  refresh,
  settings,
  setSettings,
}) {
  return (
    <div className="space-y-5">
      <EnterResultsTab
        adminKey={adminKey}
        syncYear={syncYear}
        setSyncYear={setSyncYear}
        players={players}
        actuals={actuals}
        order={order}
        refresh={refresh}
      />
      <ScoringTab
        adminKey={adminKey}
        settings={settings}
        setSettings={setSettings}
        refresh={refresh}
      />
    </div>
  );
}
