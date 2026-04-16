import { useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../../lib/api.js';
import { Card } from '../../../components/ui/Card.jsx';
import { Button } from '../../../components/ui/Button.jsx';

export default function ScoringTab({ adminKey, settings, setSettings, refresh }) {
  const [scoreBusy, setScoreBusy] = useState(false);
  const [scoreSummary, setScoreSummary] = useState(null);

  async function runScore() {
    if (scoreBusy) return;
    setScoreBusy(true);
    const id = toast.loading('Scoring every mock…');
    try {
      const r = await api.runScore(adminKey);
      setScoreSummary(r);
      toast.dismiss(id);
      toast.success(`Scored ${r.total_mocks} mocks`);
      refresh?.();
    } catch (e) {
      toast.dismiss(id);
      toast.error(e.message);
    } finally {
      setScoreBusy(false);
    }
  }

  async function setLock(val) {
    try {
      const r = await api.toggleLock(adminKey, val);
      setSettings((s) => ({ ...s, is_locked: r.is_locked }));
      toast.success(r.is_locked ? 'Locked' : 'Unlocked');
    } catch (e) {
      toast.error(e.message);
    }
  }

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card className="p-5">
        <h3 className="font-semibold text-text-primary mb-3">Run scoring</h3>
        <p className="text-text-secondary text-sm mb-3">
          Safe to re-run as more actual picks are entered.
        </p>
        <Button onClick={runScore} disabled={scoreBusy}>
          {scoreBusy ? 'Scoring…' : 'Score all mocks'}
        </Button>
        {settings?.scoring_run_at && (
          <div className="mt-3 text-xs text-text-muted">
            Last run: {new Date(settings.scoring_run_at).toLocaleString()}
          </div>
        )}
        {scoreSummary && (
          <div className="mt-4 text-sm text-text-secondary space-y-0.5">
            <div>Total mocks: {scoreSummary.total_mocks}</div>
            <div>Scored (non-zero): {scoreSummary.scored}</div>
            <div>Average: {scoreSummary.avg_score}</div>
            <div>Highest: {scoreSummary.max_score}</div>
          </div>
        )}
      </Card>
      <Card className="p-5">
        <h3 className="font-semibold text-text-primary mb-3">Submissions lock</h3>
        <div className="text-sm text-text-secondary mb-3">
          Current status: <span className={settings?.is_locked ? 'text-amber-300' : 'text-emerald-300'}>
            {settings?.is_locked ? 'Locked' : 'Open'}
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="danger" onClick={() => setLock(true)} disabled={settings?.is_locked}>Lock</Button>
          <Button variant="secondary" onClick={() => setLock(false)} disabled={!settings?.is_locked}>Unlock</Button>
        </div>
      </Card>
    </div>
  );
}
