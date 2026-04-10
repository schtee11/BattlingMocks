import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { TeamLogo } from './ui/TeamLogo.jsx';
import tradeValuesChart from '../lib/tradeValues2026.json';

// ── Probability helpers ─────────────────────────────────────────────────────
// Instead of hard accept/reject, trades have a % chance of acceptance based
// on how far the mover-up's value is from the required threshold. The same
// trade always gives the same verdict via a deterministic seed (no flickering
// on re-render), but tweaking the package rerolls.

// Logistic curve: midpoint at -3% surplus, steepness 0.3.
//   +10% surplus → 98% accept
//   +5%          → 92%
//    0% (fair)   → 71%
//   -3%          → 50%
//   -8%          → 18%
//   -15%         → 3%
function acceptanceProbability(surplusPct) {
  return 1 / (1 + Math.exp(-0.3 * ((surplusPct * 100) + 3)));
}

// Deterministic random from trade contents — same picks = same roll.
function tradeHash(from, partner, aPicks, bPicks) {
  const key = [from, partner, ...aPicks.sort((a, b) => a - b), '|', ...bPicks.sort((a, b) => a - b)].join(',');
  let h = 0;
  for (let i = 0; i < key.length; i++) h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  const x = Math.sin(Math.abs(h) + 1) * 10000;
  return x - Math.floor(x); // 0..1
}

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
  //
  // Context-aware acceptance:
  //
  //   1. Hard-reject 1-for-1 swaps — real teams never trade a single pick
  //      for a single pick regardless of chart value.
  //
  //   2. Direction premium — NFL teams demand compensation for moving picks:
  //        - Trading UP (giving more picks, getting fewer): +8% per extra
  //          pick given up. 2-for-1 = 8%, 3-for-1 = 16%, 4-for-1 = 24%.
  //        - Trading DOWN (giving fewer, getting more): up to -12% discount
  //          because quantity-for-quality deals close more easily.
  //
  //   3. Top-pick resistance — teams don't love giving up elite picks even
  //      at chart value. The partner demands a premium scaled to the best
  //      pick they're giving up:
  //        - Top 3 overall: +20%
  //        - Top 10:        +12%
  //        - Top 20:        +6%
  //        - R1 (21-32):    +3%
  //
  //   4. Package dilution — giving 4+ picks for 1 adds another 5% premium
  //      because consolidating value into one slot is inherently risky.
  //
  // All of the above produce a single required value. The difference
  // between actual and required drives the verdict (close/fair/overpaying/
  // rejected). Deterministic — same trade inputs always give the same
  // verdict so the preview doesn't flicker on re-render.
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

    // Symmetric check: figure out who's "moving up" (the team that ends up
    // with the single best pick in the deal) and require THAT team to pay a
    // premium. This handles both directions naturally — whether the FROM side
    // is moving up or down, the mover-up is always the one who must overpay.
    const fromBest = Math.min(...yourSelected);
    const partnerBest = Math.min(...theirSelected);
    const topPickInDeal = Math.min(fromBest, partnerBest);

    // Who receives that top pick? The OPPOSITE side of whoever gives it.
    const fromIsMovingUp = partnerBest < fromBest;
    const moverUpTotal = fromIsMovingUp ? yourTotal : theirTotal;
    const moverDownTotal = fromIsMovingUp ? theirTotal : yourTotal;
    const moverUpCount = fromIsMovingUp ? yourCount : theirCount;
    const moverDownCount = fromIsMovingUp ? theirCount : yourCount;
    const moverUpTeam = fromIsMovingUp ? effectiveFromTeam : partnerTeam;

    // Direction premium: giving multiple picks for fewer costs more.
    let premium = 0;
    if (moverUpCount > moverDownCount) {
      premium += 0.06 * (moverUpCount - moverDownCount);
    }

    // Package dilution — 4+ picks for 1 adds risk.
    if (moverUpCount >= 4 && moverDownCount === 1) premium += 0.04;

    // Top-pick resistance: the best pick in the deal is hard to pry loose.
    if (topPickInDeal <= 3) premium += 0.10;
    else if (topPickInDeal <= 10) premium += 0.06;
    else if (topPickInDeal <= 20) premium += 0.03;

    const required = moverDownTotal * (1 + premium);

    // Surplus: positive = mover-up is overpaying, negative = underpaying.
    const surplus = moverUpTotal - required;
    const surplusPct = required > 0 ? surplus / required : 0;

    // Acceptance probability from the logistic curve.
    const prob = acceptanceProbability(surplusPct);
    const probPct = Math.round(prob * 100);

    // Deterministic roll seeded from the trade contents. Same trade = same
    // outcome. Modify a single pick and it rerolls.
    const roll = tradeHash(
      effectiveFromTeam,
      partnerTeam,
      [...yourSelected],
      [...theirSelected]
    );
    const accepted = roll < prob;

    // Grade the verdict based on probability and acceptance.
    if (probPct >= 95) {
      // Near-certain: always goes through, might be overpaying.
      return {
        ok: true,
        probability: probPct,
        reason: surplusPct > 0.15 ? 'overpaying' : 'good',
        text: fromTeamEditable
          ? surplusPct > 0.15 ? `Accepted — ${moverUpTeam} overpays (${probPct}%)` : `Accepted (${probPct}%)`
          : surplusPct > 0.15 ? `Accepted — you're overpaying (${probPct}%)` : `${partnerTeam} accepts (${probPct}%)`,
      };
    }
    if (accepted) {
      return {
        ok: true,
        probability: probPct,
        reason: probPct >= 70 ? 'fair' : 'lucky',
        text: fromTeamEditable
          ? `Accepted (${probPct}% chance)`
          : `${partnerTeam} accepts (${probPct}% chance)`,
      };
    }
    // Rejected — show probability so user knows how close they are.
    const shortBy = surplus < 0 ? Math.ceil(-surplus) : 0;
    return {
      ok: false,
      probability: probPct,
      reason: probPct >= 35 ? 'close' : 'undervalued',
      text: fromTeamEditable
        ? probPct >= 35
          ? `Rejected this time (${probPct}%) — tweak the deal`
          : `${moverUpTeam} needs to add ~${shortBy} more value (${probPct}%)`
        : probPct >= 35
          ? `Rejected (${probPct}%) — tweak the deal`
          : `Rejected — needs ~${shortBy} more value (${probPct}%)`,
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

  // Force Trade — bypass the bot's evaluation entirely and apply the trade
  // as-is. Still enforces the minimum sanity checks (both sides have picks
  // selected, no hard 1-for-1). Useful when the user wants to simulate a
  // specific historical or hypothetical trade the bot wouldn't accept on
  // pure chart math.
  function handleForce() {
    if (yourCount === 0 || theirCount === 0) {
      toast.error('Pick at least one from each side');
      return;
    }
    if (yourCount === 1 && theirCount === 1) {
      toast.error('1-for-1 swaps are still off the table');
      return;
    }
    onAccepted({
      fromTeam: effectiveFromTeam,
      partnerTeam,
      yourPicks: [...yourSelected],
      theirPicks: [...theirSelected],
    });
    toast('Trade forced through', { icon: '⚡' });
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

  // Verdict palette — richer feedback for the probabilistic model:
  //   fair / good / lucky → green (accepted)
  //   overpaying          → yellow (accepted but gave up too much)
  //   close               → orange (rejected but within striking distance)
  //   undervalued / others→ red (clear reject)
  const verdictColor = (() => {
    if (evalResult.reason === 'overpaying') return '#eab308';
    if (evalResult.reason === 'close') return '#f97316';
    if (evalResult.reason === 'lucky') return '#34d399'; // mint — got lucky
    if (evalResult.ok) return '#22c55e';
    return '#ef4444';
  })();
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
        <div className="px-5 py-4 border-t border-border-subtle flex gap-2 items-center">
          <button
            onClick={onClose}
            className="font-display font-semibold text-[11px] uppercase tracking-[0.12em] text-text-secondary rounded-lg px-4 py-2 border border-border-subtle hover:border-border-focus transition"
          >
            Cancel
          </button>
          {/* Force Trade — always visible, styled as a subdued override.
              Skips the bot's evaluation but still blocks empty/1-for-1. */}
          <button
            onClick={handleForce}
            disabled={yourCount === 0 || theirCount === 0 || (yourCount === 1 && theirCount === 1)}
            title="Override the bot and accept this trade anyway"
            className="font-display font-semibold text-[10px] uppercase tracking-[0.12em] text-gold rounded-lg px-3 py-2 border border-gold/40 hover:bg-gold/[0.08] transition disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Force
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
