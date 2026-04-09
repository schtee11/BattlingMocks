import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { TeamLogo } from './ui/TeamLogo.jsx';
import tradeValuesChart from '../lib/tradeValues2026.json';

// Pure client-side trade proposal using the Rich Hill value chart. Shared by
// the Team Mock simulator and the Round 1 Draft page.
//
// Two modes:
//   - Team Mock:  user controls a single team → pass `userTeam` and the
//                 "From" side is fixed. Used for "I want to trade up" flows.
//   - Round 1:    pass `fromTeamEditable={true}` so the user can pick BOTH
//                 sides of the hypothetical trade. `userTeam` becomes the
//                 initial "From" selection.
//
// Props:
//   userTeam           - abbr used as the initial "From" team
//   fromTeamEditable   - if true, render a "From" team selector at the top
//   liveOrder          - sorted draft_order rows ({ pick_number, team, round })
//   picksMadeCount     - sequential cutoff (Team Mock mode — picks 1..N locked)
//   lockedPicks        - Set<number> of specific pick_numbers to exclude
//                        (R1 Draft mode where picks aren't sequential)
//   onClockTeam        - team currently on the clock (pre-selects as partner)
//   onClose            - called to dismiss the modal
//   onAccepted         - called with { fromTeam, partnerTeam, yourPicks,
//                        theirPicks } when the trade is accepted
export function TradeModal({
  userTeam,
  fromTeamEditable = false,
  liveOrder,
  picksMadeCount = 0,
  lockedPicks,
  onClockTeam,
  onClose,
  onAccepted,
}) {
  const [fromTeam, setFromTeam] = useState(userTeam);
  const effectiveFromTeam = fromTeamEditable ? fromTeam : userTeam;
  const valueMap = useMemo(() => {
    const m = new Map();
    for (const r of tradeValuesChart) m.set(r.pick, r.value);
    return m;
  }, []);

  const futurePicks = useMemo(
    () => liveOrder.filter((s) => {
      // Exclude explicitly locked picks (R1 Draft mode) AND the sequential
      // "already made" cutoff (Team Mock mode).
      if (lockedPicks && lockedPicks.has(s.pick_number)) return false;
      if (s.pick_number <= picksMadeCount) return false;
      return true;
    }),
    [liveOrder, picksMadeCount, lockedPicks]
  );
  const myFuturePicks = useMemo(
    () => futurePicks.filter((s) => s.team === effectiveFromTeam),
    [futurePicks, effectiveFromTeam]
  );
  const otherTeams = useMemo(() => {
    const nextPickByTeam = new Map();
    for (const s of futurePicks) {
      if (s.team === effectiveFromTeam) continue;
      if (!nextPickByTeam.has(s.team)) nextPickByTeam.set(s.team, s.pick_number);
    }
    return [...nextPickByTeam.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([t]) => t);
  }, [futurePicks, effectiveFromTeam]);

  // All teams with future picks — used for the "From" dropdown when editable.
  const allTeams = useMemo(() => {
    const nextPickByTeam = new Map();
    for (const s of futurePicks) {
      if (!nextPickByTeam.has(s.team)) nextPickByTeam.set(s.team, s.pick_number);
    }
    return [...nextPickByTeam.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([t]) => t);
  }, [futurePicks]);

  const initialPartner = useMemo(() => {
    if (onClockTeam && onClockTeam !== effectiveFromTeam) return onClockTeam;
    return otherTeams[0] || null;
  }, [onClockTeam, effectiveFromTeam, otherTeams]);

  const [partnerTeam, setPartnerTeam] = useState(initialPartner);
  const [yourSelected, setYourSelected] = useState(new Set());
  const [theirSelected, setTheirSelected] = useState(new Set());

  useEffect(() => { setTheirSelected(new Set()); }, [partnerTeam]);
  // When the user switches "From" team (R1 dual-mode), reset both sides and
  // re-seed the partner to a still-valid team.
  useEffect(() => {
    setYourSelected(new Set());
    setTheirSelected(new Set());
    setPartnerTeam((cur) => (cur && cur !== effectiveFromTeam ? cur : otherTeams[0] || null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveFromTeam]);

  const partnerFuturePicks = useMemo(
    () => futurePicks.filter((s) => s.team === partnerTeam),
    [futurePicks, partnerTeam]
  );

  const yourTotal = [...yourSelected].reduce((n, p) => n + (valueMap.get(p) ?? 0), 0);
  const theirTotal = [...theirSelected].reduce((n, p) => n + (valueMap.get(p) ?? 0), 0);
  const yourCount = yourSelected.size;
  const theirCount = theirSelected.size;

  // Realistic NFL trade acceptance rules:
  //   1. Hard reject 1-for-1 swaps — real teams never trade a single pick
  //      for another single pick regardless of chart value.
  //   2. Trading UP (giving more picks, receiving fewer) requires the user
  //      to pay a 10% premium over chart value.
  //   3. Trading DOWN (giving fewer picks, receiving more) — bot takes up
  //      to a 5% discount since they're getting quantity for quality.
  //   4. Equal pick count (2-for-2) needs at least chart parity.
  // When fromTeamEditable is true the user is an observer simulating
  // realistic trades between any two teams — all wording stays neutral and
  // references the teams by name. When false (Team Mock mode), the user IS
  // the "from" team so "you" wording is appropriate.
  function evaluateTrade() {
    if (yourCount === 0 || theirCount === 0) {
      return { ok: false, reason: 'empty', text: 'Pick at least one from each side' };
    }
    if (yourCount === 1 && theirCount === 1) {
      return {
        ok: false,
        reason: 'one_for_one',
        text: fromTeamEditable
          ? 'No 1-for-1 swaps — add more picks to the deal'
          : `${partnerTeam} won't do a 1-for-1 swap — add more picks`,
      };
    }
    const minRatio = yourCount > theirCount ? 1.10 : yourCount < theirCount ? 0.95 : 1.00;
    const required = theirTotal * minRatio;
    if (yourTotal < required) {
      const shortBy = Math.ceil(required - yourTotal);
      return {
        ok: false,
        reason: 'undervalued',
        text: fromTeamEditable
          ? `${partnerTeam} rejects — ${effectiveFromTeam} needs to add ${shortBy} value`
          : `${partnerTeam} rejects — needs ${shortBy} more value`,
      };
    }
    if (yourTotal > required * 1.15) {
      return {
        ok: true,
        reason: 'overpaying',
        text: fromTeamEditable
          ? `Accepted — ${effectiveFromTeam} overpays`
          : "Accepted — you're overpaying",
      };
    }
    return {
      ok: true,
      reason: 'fair',
      text: fromTeamEditable ? 'Fair trade — both sides accept' : `${partnerTeam} accepts`,
    };
  }

  const evalResult = evaluateTrade();
  const canPropose = evalResult.ok;

  function handlePropose() {
    if (!evalResult.ok) {
      toast.error(evalResult.text);
      return;
    }
    onAccepted({
      fromTeam: effectiveFromTeam,
      partnerTeam,
      yourPicks: [...yourSelected],
      theirPicks: [...theirSelected],
    });
  }

  function togglePick(set, setter, pickNum) {
    const next = new Set(set);
    if (next.has(pickNum)) next.delete(pickNum);
    else next.add(pickNum);
    setter(next);
  }

  function pickButton(slot, selected, onClick) {
    const value = valueMap.get(slot.pick_number) ?? 0;
    return (
      <button
        key={slot.pick_number}
        onClick={onClick}
        className={`text-left px-2 py-1.5 rounded-md border text-[11px] transition ${
          selected
            ? 'border-accent bg-accent/[0.1] text-text-primary'
            : 'border-border-subtle bg-bg-surface/40 text-text-secondary hover:border-border-focus'
        }`}
      >
        <div className="font-mono font-semibold">
          #{slot.pick_number} <span className="text-text-muted">· R{slot.round}</span>
        </div>
        <div className="text-[9.5px] text-text-muted">val {value}</div>
      </button>
    );
  }

  const verdictColor =
    !evalResult.ok ? '#ef4444' : evalResult.reason === 'overpaying' ? '#eab308' : '#22c55e';
  const verdictText = evalResult.text;
  const verdictSubtext = (() => {
    if (yourCount === 0 && theirCount === 0) return '';
    if (fromTeamEditable) {
      // Neutral team-based phrasing for R1 simulation mode.
      if (yourCount > theirCount) {
        return `${effectiveFromTeam} trading UP (${yourCount} → ${theirCount} picks)`;
      }
      if (yourCount < theirCount) {
        return `${effectiveFromTeam} trading DOWN (${yourCount} → ${theirCount} picks)`;
      }
      return `Even pick count (${yourCount}-for-${theirCount})`;
    }
    // Team Mock mode: user IS the team, "you" phrasing is fine.
    if (yourCount > theirCount) return `You're trading UP (${yourCount} → ${theirCount} picks)`;
    if (yourCount < theirCount) return `You're trading DOWN (${yourCount} → ${theirCount} picks)`;
    return `Even pick count (${yourCount}-for-${theirCount})`;
  })();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[90vh] rounded-2xl border border-border-subtle bg-bg-deep flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border-subtle flex items-center justify-between">
          <div>
            <h2 className="font-display text-[16px] font-bold uppercase tracking-[0.1em] text-text-primary">
              {fromTeamEditable ? 'Simulate Trade' : 'Propose Trade'}
            </h2>
            <p className="text-[10.5px] text-text-muted">Rich Hill value chart</p>
          </div>
          <button
            onClick={onClose}
            className="font-display text-[11px] uppercase tracking-wider text-text-muted hover:text-text-primary transition px-2 py-1"
          >
            Close
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* "From" team selector — only shown in dual-team mode (R1 draft
              page). In team-mock mode the user's team is fixed. */}
          {fromTeamEditable && (
            <div>
              <div className="font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted mb-2">
                Trade From
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {allTeams.map((abbr) => (
                  <button
                    key={abbr}
                    onClick={() => setFromTeam(abbr)}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10px] font-display font-semibold uppercase tracking-wider transition ${
                      effectiveFromTeam === abbr
                        ? 'border-accent bg-accent/[0.1] text-text-primary'
                        : 'border-border-subtle text-text-secondary hover:border-border-focus'
                    }`}
                  >
                    <TeamLogo abbr={abbr} size="xs" />
                    {abbr}
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* Partner team selector */}
          <div>
            <div className="font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted mb-2">
              Trade With
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {otherTeams.map((abbr) => (
                <button
                  key={abbr}
                  onClick={() => setPartnerTeam(abbr)}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10px] font-display font-semibold uppercase tracking-wider transition ${
                    partnerTeam === abbr
                      ? 'border-accent bg-accent/[0.1] text-text-primary'
                      : 'border-border-subtle text-text-secondary hover:border-border-focus'
                  }`}
                >
                  <TeamLogo abbr={abbr} size="xs" />
                  {abbr}
                </button>
              ))}
            </div>
          </div>

          {/* Two sides */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <TeamLogo abbr={effectiveFromTeam} size="xs" />
                <span className="font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                  {fromTeamEditable ? `${effectiveFromTeam} Gives` : 'You Give'}
                </span>
                <span className="ml-auto font-mono text-[11px] text-text-primary">{yourTotal}</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 max-h-60 overflow-y-auto pr-1">
                {myFuturePicks.map((s) =>
                  pickButton(s, yourSelected.has(s.pick_number), () =>
                    togglePick(yourSelected, setYourSelected, s.pick_number)
                  )
                )}
                {myFuturePicks.length === 0 && (
                  <div className="col-span-3 text-[11px] text-text-muted py-2">
                    No remaining picks.
                  </div>
                )}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <TeamLogo abbr={partnerTeam} size="xs" />
                <span className="font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                  {fromTeamEditable ? `${partnerTeam || '—'} Gives` : 'You Get'}
                </span>
                <span className="ml-auto font-mono text-[11px] text-text-primary">{theirTotal}</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 max-h-60 overflow-y-auto pr-1">
                {partnerFuturePicks.map((s) =>
                  pickButton(s, theirSelected.has(s.pick_number), () =>
                    togglePick(theirSelected, setTheirSelected, s.pick_number)
                  )
                )}
                {partnerFuturePicks.length === 0 && (
                  <div className="col-span-3 text-[11px] text-text-muted py-2">
                    No picks remaining.
                  </div>
                )}
              </div>
            </div>
          </div>

          {(yourSelected.size > 0 || theirSelected.size > 0) && (
            <div className="flex items-center gap-3 p-3 rounded-lg border border-border-subtle bg-bg-surface/40">
              <div className="w-2 h-10 rounded-full shrink-0" style={{ background: verdictColor }} />
              <div className="flex-1 min-w-0">
                <div
                  className="font-display text-[12px] font-bold uppercase tracking-[0.12em] truncate"
                  style={{ color: verdictColor }}
                >
                  {verdictText}
                </div>
                {verdictSubtext && (
                  <div className="text-[10.5px] text-text-muted truncate">{verdictSubtext}</div>
                )}
              </div>
              <div className="text-right text-[10.5px] font-mono text-text-muted shrink-0">
                {yourTotal} ↔ {theirTotal}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border-subtle flex gap-2">
          <button
            onClick={onClose}
            className="font-display font-semibold text-[11px] uppercase tracking-[0.12em] text-text-secondary rounded-lg px-4 py-2 border border-border-subtle hover:border-border-focus transition"
          >
            Cancel
          </button>
          <button
            onClick={handlePropose}
            disabled={!canPropose}
            title={!canPropose ? evalResult.text : ''}
            className="flex-1 font-display font-bold text-[11px] uppercase tracking-[0.14em] text-bg-deep rounded-lg px-4 py-2 transition hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'var(--gradient-accent)' }}
          >
            {canPropose
              ? fromTeamEditable
                ? 'Execute Trade'
                : `Propose to ${partnerTeam || '—'}`
              : 'Trade Not Allowed'}
          </button>
        </div>
      </div>
    </div>
  );
}
