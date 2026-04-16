import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { TeamLogo } from './ui/TeamLogo.jsx';
import tradeValuesChart from '../lib/tradeValues2026.json';
import { getAlgoConfig } from '../lib/algoConfig.js';

// ── Probability helpers ─────────────────────────────────────────────────────
// Trades have a % chance of acceptance based on how far the mover-up's value
// is from the required threshold. Fair deals are nearly always accepted;
// underpays drop steeply; extreme overpays are dampened (unrealistic gifts).
//
// The live preview ONLY shows the probability — accept/reject is decided
// by a deterministic hash roll at proposal time (handlePropose). This keeps
// the preview monotonic: more value → higher %, always.

// Hard-reject limit is read from algo config so it's admin-tunable.
// Kept as a file-level accessor so the sigmoid comment below stays legible.
function hardUnderpayLimit() { return -(getAlgoConfig().hardUnderpayLimit ?? 0.25); }

// Acceptance probability curve:
//   Sigmoid base centered at -8% surplus (fair ≈ 94%) with an exponential
//   dampener above +30% surplus to make gift trades very unlikely.
//
//   +10% → 99.8%   (slight overpay — partner happy)
//   +5%  → 99%     (good deal)
//    0%  → 94%     (fair — almost always accepted)
//   -5%  → 74%     (slight underpay — decent chance)
//   -8%  → 50%     (midpoint)
//   -10% → 33%     (getting risky)
//   -15% → 8%      (very unlikely)
//   +35% → ~47%    (starting to look unrealistic)
//   +50% → ~5%     (gift trade — nearly impossible)
function acceptanceProbability(surplusPct) {
  const base = 1 / (1 + Math.exp(-0.35 * ((surplusPct * 100) + 8)));
  // Dampen extreme overpays — real teams don't make gift trades
  if (surplusPct > 0.30) {
    const excess = (surplusPct - 0.30) * 100;
    return base * Math.exp(-0.15 * excess);
  }
  return base;
}

// Deterministic random from trade contents — used ONLY at proposal time so
// the live preview never shows an accept/reject that contradicts the %.
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
  // Tracks hashes of trades the AI has already declined so the user can't
  // re-propose identical terms — they must change the deal first.
  const [rejectedHashes, setRejectedHashes] = useState(new Set());

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
          ? 'Not realistic — 1-for-1 swaps rarely happen. Add more picks to the deal'
          : `${partnerTeam} won't do a 1-for-1 swap — add more picks`,
      };
    }

    // Block re-proposing an identical deal that was already declined.
    // The hash is deterministic so spamming would always get the same result.
    const currentHash = tradeHash(effectiveFromTeam, partnerTeam, [...yourSelected], [...theirSelected]);
    if (rejectedHashes.has(currentHash)) {
      return {
        ok: false,
        reason: 'rejected',
        text: fromTeamEditable
          ? 'These exact terms were already rejected — change the deal to re-check'
          : `${partnerTeam} already said no — change the terms to try again`,
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

    // Premium: mover-up pays a base % for moving up, plus an extra % when
    // the top pick in the deal is in the top 5. Both are admin-tunable.
    const cfg = getAlgoConfig();
    let premium = cfg.tradeBasePremium ?? 0.05;
    if (topPickInDeal <= 5) premium += cfg.tradeTop5Bonus ?? 0.03;

    const required = moverDownTotal * (1 + premium);

    // Surplus: positive = mover-up is overpaying, negative = underpaying.
    const surplus = moverUpTotal - required;
    const surplusPct = required > 0 ? surplus / required : 0;

    // Acceptance probability must always be evaluated from the PARTNER's perspective.
    // When FROM is mover-up (fromIsMovingUp=true): positive surplus = BUF overpays = partner happy → accept.
    // When PARTNER is mover-up (fromIsMovingUp=false): positive surplus = partner overpays = partner unhappy → decline.
    // Flip the sign in the second case so the sigmoid always reads correctly.
    const partnerSurplusPct = fromIsMovingUp ? surplusPct : -surplusPct;

    // Hard reject: extreme lowballs only.
    if (surplusPct < hardUnderpayLimit()) {
      const shortBy = Math.ceil(-surplus);
      return {
        ok: false,
        reason: 'hard_underpay',
        text: fromTeamEditable
          ? `Outside fair-trade zone — ${moverUpTeam} underpaying by ~${shortBy}`
          : fromIsMovingUp
            ? `Too far off — add ~${shortBy} more value`
            : `Too far off — not enough value back (~${shortBy} more needed from ${partnerTeam})`,
      };
    }

    // Acceptance probability — fair deals ~94%, overpays higher,
    // underpays drop steeply, extreme overpays dampened.
    const prob = acceptanceProbability(partnerSurplusPct);
    const probPct = Math.round(prob * 100);

    // Preview shows only the probability — NOT accepted/rejected yet.
    // The actual roll happens in handlePropose so the live preview is
    // always monotonic: more value → higher %, no hash-driven surprises.
    // shortBy: how much more value BUF needs to add to reach the fair threshold.
    // Mover-up=FROM: need to close the gap between offer and required.
    // Mover-up=PARTNER: BUF needs to add picks until theirTotal / (1+premium) ≈ yourTotal.
    const shortBy = fromIsMovingUp
      ? (surplus < 0 ? Math.ceil(-surplus) : 0)
      : (surplus > 0 ? Math.ceil(theirTotal / (1 + premium) - yourTotal) : 0);
    let previewText;
    if (probPct >= 80) {
      previewText = fromTeamEditable
        ? `Fair-trade zone — both sides likely agree (${probPct}%)`
        : `${partnerTeam} very likely accepts (${probPct}%)`;
    } else if (probPct >= 50) {
      previewText = fromTeamEditable
        ? `Near fair-trade zone — coin flip (${probPct}%)`
        : `${partnerTeam} might accept (${probPct}%)`;
    } else if (probPct >= 25) {
      previewText = fromTeamEditable
        ? `Below fair zone — ${moverUpTeam} needs ~${shortBy} more value (${probPct}%)`
        : `${partnerTeam} probably declines (${probPct}%) — add ~${shortBy} more value`;
    } else {
      previewText = fromTeamEditable
        ? `Well below fair zone — ${moverUpTeam} needs ~${shortBy} more value (${probPct}%)`
        : `Add ~${shortBy} more value (${probPct}%)`;
    }
    return {
      ok: 'pending',
      probability: probPct,
      surplusPct,
      fromIsMovingUp,
      moverUpTeam,
      reason: 'pending',
      text: previewText,
    };
  }

  const evalResult = evaluateTrade();

  // Only hard structural violations block the button entirely. Probabilistic
  // deals always allow proposing — the actual roll happens on click.
  const HARD_BLOCK_REASONS = new Set(['empty', 'one_for_one', 'hard_underpay', 'rejected']);
  const canPropose = !HARD_BLOCK_REASONS.has(evalResult.reason);

  function handlePropose() {
    if (!canPropose) {
      toast.error(evalResult.text);
      return;
    }
    // Apply deterministic roll NOW (at proposal time, not in the preview).
    // This keeps the live preview strictly probability-based while still
    // giving a concrete accept/reject outcome when the user clicks Propose.
    const prob = (evalResult.probability ?? 0) / 100;
    const roll = tradeHash(
      effectiveFromTeam,
      partnerTeam,
      [...yourSelected],
      [...theirSelected]
    );
    if (roll >= prob) {
      // Lock this exact deal so re-proposing it is blocked — user must change terms.
      setRejectedHashes((prev) => new Set([...prev, roll]));
      toast.error(
        fromTeamEditable
          ? `Trade rejected — outside fair-trade zone this time (${evalResult.probability}% odds)`
          : `${partnerTeam} declined — change the terms to try again (${evalResult.probability}%)`
      );
      return;
    }
    onAccepted({
      fromTeam: effectiveFromTeam,
      partnerTeam,
      yourPicks: [...yourSelected],
      theirPicks: [...theirSelected],
    });
  }

  // Force Trade — bypass ALL evaluation rules and apply the trade as-is.
  // Only requires both sides to have at least one pick selected (can't
  // force nothing). Users can force 1-for-1, overpays, underpays — it's
  // their sandbox.
  function handleForce() {
    if (yourCount === 0 || theirCount === 0) {
      toast.error('Pick at least one from each side');
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

  // Verdict palette — driven by probability bands so color is monotonic:
  //   ≥ 80% → green   (very likely accepted)
  //   ≥ 50% → yellow  (might accept)
  //   ≥ 25% → orange  (probably declines)
  //   < 25% → red     (very unlikely / hard blocks)
  const verdictColor = (() => {
    if (evalResult.reason === 'hard_underpay' || evalResult.reason === 'empty' || evalResult.reason === 'one_for_one') return '#ef4444';
    const pct = evalResult.probability ?? 0;
    if (pct >= 80) return '#22c55e';
    if (pct >= 50) return '#eab308';
    if (pct >= 25) return '#f97316';
    return '#ef4444';
  })();
  const verdictText = evalResult.text;
  const verdictSubtext = (() => {
    if (yourCount === 0 && theirCount === 0) return '';
    if (fromTeamEditable) {
      // Neutral arbiter framing — identify the team moving up (receiving the
      // best pick in the deal) so readers see the direction without the app
      // appearing to side with either franchise.
      const moverUp = evalResult.moverUpTeam;
      const moverDown = moverUp === effectiveFromTeam ? partnerTeam : effectiveFromTeam;
      if (moverUp && moverDown && yourCount !== theirCount) {
        return `${moverUp} moves up · ${moverDown} moves down (${yourCount}-for-${theirCount})`;
      }
      return `${yourCount}-for-${theirCount} swap`;
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
        // `max-h-[calc(100dvh-2rem)]` handles short viewports (MacBook Pro at
        // full-screen with dock, 13" laptops, browser devtools open) where
        // `90vh` would still clip the footer. `dvh` tracks the *dynamic*
        // viewport so mobile URL bars don't cut us off either.
        className="w-full max-w-2xl rounded-2xl border border-border-subtle bg-bg-deep flex flex-col overflow-hidden"
        style={{ maxHeight: 'min(90vh, calc(100dvh - 2rem))' }}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border-subtle flex items-center justify-between">
          <div>
            <h2 className="font-display text-[16px] font-bold uppercase tracking-[0.1em] text-text-primary">
              {fromTeamEditable ? 'Simulate Trade' : 'Propose Trade'}
            </h2>
            <p className="text-[10.5px] text-text-muted">
              {fromTeamEditable
                ? 'Neutral arbiter · fair-trade zone (Rich Hill chart)'
                : 'Rich Hill value chart'}
            </p>
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
          {/* Team selectors. In arbiter (R1) mode both sides live in a single
              two-column grid of logo-only buttons so the modal stays short
              even with all 32 teams visible. Abbreviations appear in the
              section header once a team is picked, and as a hover title on
              each chip. Team-mock mode shows just the partner picker. */}
          {fromTeamEditable ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-baseline justify-between mb-2">
                  <span className="font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                    Team A
                  </span>
                  <span className="font-display text-[10px] font-bold uppercase tracking-wider text-accent">
                    {effectiveFromTeam || '—'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {allTeams.map((abbr) => {
                    const selected = effectiveFromTeam === abbr;
                    return (
                      <button
                        key={abbr}
                        onClick={() => setFromTeam(abbr)}
                        title={abbr}
                        aria-label={abbr}
                        className={`w-7 h-7 flex items-center justify-center rounded-md border transition ${
                          selected
                            ? 'border-accent bg-accent/[0.12]'
                            : 'border-border-subtle hover:border-border-focus opacity-70 hover:opacity-100'
                        }`}
                      >
                        <TeamLogo abbr={abbr} size="xs" />
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <div className="flex items-baseline justify-between mb-2">
                  <span className="font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                    Team B
                  </span>
                  <span className="font-display text-[10px] font-bold uppercase tracking-wider text-accent">
                    {partnerTeam || '—'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {otherTeams.map((abbr) => {
                    const selected = partnerTeam === abbr;
                    return (
                      <button
                        key={abbr}
                        onClick={() => setPartnerTeam(abbr)}
                        title={abbr}
                        aria-label={abbr}
                        className={`w-7 h-7 flex items-center justify-center rounded-md border transition ${
                          selected
                            ? 'border-accent bg-accent/[0.12]'
                            : 'border-border-subtle hover:border-border-focus opacity-70 hover:opacity-100'
                        }`}
                      >
                        <TeamLogo abbr={abbr} size="xs" />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
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
          )}

          {/* Two sides */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <TeamLogo abbr={effectiveFromTeam} size="xs" />
                <span className="font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                  {fromTeamEditable ? `${effectiveFromTeam} Sends` : 'You Give'}
                </span>
                <span className="ml-auto font-mono text-[11px] text-text-primary">{yourTotal}</span>
              </div>
              <div
                className="grid grid-cols-3 gap-1.5 overflow-y-auto pr-1"
                // Scale with the viewport so short-screen laptops (13" MBP
                // with browser chrome) still see the verdict + footer without
                // having to scroll the modal body.
                style={{ maxHeight: 'min(15rem, 28dvh)' }}
              >
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
                  {fromTeamEditable ? `${partnerTeam || '—'} Sends` : 'You Get'}
                </span>
                <span className="ml-auto font-mono text-[11px] text-text-primary">{theirTotal}</span>
              </div>
              <div
                className="grid grid-cols-3 gap-1.5 overflow-y-auto pr-1"
                // Scale with the viewport so short-screen laptops (13" MBP
                // with browser chrome) still see the verdict + footer without
                // having to scroll the modal body.
                style={{ maxHeight: 'min(15rem, 28dvh)' }}
              >
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
            disabled={yourCount === 0 || theirCount === 0}
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
                ? 'Propose Trade'
                : `Propose to ${partnerTeam || '—'}`
              : fromTeamEditable
                ? 'Not in Fair Zone'
                : 'Trade Not Allowed'}
          </button>
        </div>
      </div>
    </div>
  );
}
