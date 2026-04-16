import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api, invalidateCache } from '../../../lib/api.js';
import { ALGO_DEFAULTS } from '../../../lib/algoConfig.js';
import { Card } from '../../../components/ui/Card.jsx';
import { Button } from '../../../components/ui/Button.jsx';

export default function AlgoTuningTab({ adminKey }) {
  const [algoForm, setAlgoForm] = useState(null); // null = not yet loaded
  const [algoBusy, setAlgoBusy] = useState(false);

  useEffect(() => {
    if (algoForm) return;
    api.adminGetAlgoConfig(adminKey)
      .then((stored) => setAlgoForm({ ...ALGO_DEFAULTS, ...stored }))
      .catch((e) => toast.error(e.message));
    // eslint-disable-next-line
  }, []);

  function algoField(fieldKey, label, opts = {}) {
    const { step = 0.01, min, max, pct = false } = opts;
    const rawVal = algoForm?.[fieldKey] ?? ALGO_DEFAULTS[fieldKey];
    const displayVal = pct ? Math.round(rawVal * 1000) / 10 : rawVal;
    return (
      <label key={fieldKey} className="flex items-center justify-between gap-3">
        <span className="text-[12px] text-text-secondary">{label}</span>
        <div className="flex items-center gap-1 shrink-0">
          <input
            type="number"
            step={pct ? 0.1 : step}
            min={min}
            max={max}
            value={displayVal}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v)) {
                setAlgoForm((f) => ({ ...f, [fieldKey]: pct ? v / 100 : v }));
              }
            }}
            className="w-20 bg-bg-deep border border-border-focus rounded px-2 py-1 text-text-primary text-xs font-mono text-right"
          />
          {pct && <span className="text-text-muted text-[11px]">%</span>}
        </div>
      </label>
    );
  }

  async function saveAlgoConfig() {
    if (!algoForm) return;
    setAlgoBusy(true);
    try {
      await api.adminSaveAlgoConfig(adminKey, algoForm);
      invalidateCache('algo-config');
      toast.success('Algo config saved — takes effect on next draft start');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setAlgoBusy(false);
    }
  }

  async function resetAlgoConfig() {
    if (!window.confirm('Reset all algo settings to defaults?')) return;
    setAlgoBusy(true);
    try {
      await api.adminResetAlgoConfig(adminKey);
      invalidateCache('algo-config');
      setAlgoForm({ ...ALGO_DEFAULTS });
      toast.success('Reset to defaults');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setAlgoBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {!algoForm ? (
        <Card className="p-5"><div className="text-text-muted text-sm">Loading…</div></Card>
      ) : (
        <>
          {/* Draft Engine */}
          <Card className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-text-primary">Draft Engine</h3>
                <p className="text-text-muted text-xs mt-0.5">
                  Controls how the bot picker scores and selects players. Takes effect on the next draft run.
                </p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted mb-1">Scoring curve</div>
              {algoField('decayRate', 'Decay rate (higher = top players dominate more)', { step: 0.005, min: 0.005, max: 0.15 })}
              <div className="font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted mt-4 mb-1">Positional needs boost</div>
              {algoField('needsBoost1', '1st need boost', { pct: true, min: 0, max: 100 })}
              {algoField('needsBoost2', '2nd need boost', { pct: true, min: 0, max: 100 })}
              {algoField('needsBoost3', '3rd need boost', { pct: true, min: 0, max: 100 })}
              <div className="font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted mt-4 mb-1">
                Hard fall caps <span className="normal-case tracking-normal font-normal text-text-muted">(player gets score ×boost after falling maxFall picks past their rank)</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[11px] text-text-muted font-display uppercase tracking-wide mb-1">
                <span>Rank range</span><span className="text-center">Max fall</span><span className="text-center">Boost ×</span>
              </div>
              {[
                ['fallCap1MaxRank', 'fallCap1MaxFall', 'fallCap1Boost', '1 –'],
                ['fallCap2MaxRank', 'fallCap2MaxFall', 'fallCap2Boost', '6 –'],
                ['fallCap3MaxRank', 'fallCap3MaxFall', 'fallCap3Boost', '11 –'],
              ].map(([rankKey, fallKey, boostKey, prefix]) => (
                <div key={rankKey} className="grid grid-cols-3 gap-2 items-center">
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-text-secondary font-mono">{prefix}</span>
                    <input
                      type="number"
                      step={1}
                      min={1}
                      max={500}
                      value={algoForm[rankKey]}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        if (Number.isFinite(v)) setAlgoForm((f) => ({ ...f, [rankKey]: v }));
                      }}
                      className="w-14 bg-bg-deep border border-border-focus rounded px-2 py-1 text-text-primary text-xs font-mono text-right"
                    />
                  </div>
                  <input
                    type="number"
                    step={1}
                    min={0}
                    max={100}
                    value={algoForm[fallKey]}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (Number.isFinite(v)) setAlgoForm((f) => ({ ...f, [fallKey]: v }));
                    }}
                    className="w-full bg-bg-deep border border-border-focus rounded px-2 py-1 text-text-primary text-xs font-mono text-right"
                  />
                  <input
                    type="number"
                    step={1}
                    min={1}
                    max={100}
                    value={algoForm[boostKey]}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (Number.isFinite(v)) setAlgoForm((f) => ({ ...f, [boostKey]: v }));
                    }}
                    className="w-full bg-bg-deep border border-border-focus rounded px-2 py-1 text-text-primary text-xs font-mono text-right"
                  />
                </div>
              ))}
            </div>
          </Card>

          {/* Trade Acceptance */}
          <Card className="p-5">
            <div className="mb-4">
              <h3 className="font-semibold text-text-primary">Trade Acceptance</h3>
              <p className="text-text-muted text-xs mt-0.5">
                Controls how the CPU evaluates trade proposals. Takes effect immediately on the next trade.
              </p>
            </div>
            <div className="space-y-3">
              {algoField('tradeBasePremium', 'Base moving-up premium', { pct: true, min: 0, max: 50 })}
              {algoField('tradeTop5Bonus', 'Extra premium for top-5 pick in deal', { pct: true, min: 0, max: 30 })}
              {algoField('hardUnderpayLimit', 'Hard-reject threshold (underpay %)', { pct: true, min: 1, max: 90 })}
            </div>
          </Card>

          {/* Actions */}
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={resetAlgoConfig} disabled={algoBusy}>
              Reset to Defaults
            </Button>
            <Button onClick={saveAlgoConfig} disabled={algoBusy}>
              {algoBusy ? 'Saving…' : 'Save Config'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
