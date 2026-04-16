import { TeamLogo } from './ui/TeamLogo.jsx';
import { formatPickLabelCompact } from '../lib/futurePicks.js';

// Trade offers panel — shown beside the user's on-the-clock UI in team_mock.
// Renders one card per bot-team offer. Cards persist until dismissed (no
// auto-expiry) so the user always has a moment to consider, even if they
// move around in the picks UI.
//
// Card framing is from the USER's perspective: "they send X, you send Y".
// That mirrors how a real GM thinks when a phone rings — "what am I getting,
// what am I giving up?" — rather than the modal's neutral arbiter framing.
//
// Each offer carries an `id` (botTeam-userPick-botPick) so the parent can
// track per-card dismissal without losing the overall offer set when it
// recomputes (e.g. the user picks something else and on-clock advances).
export function TradeOffersPanel({ offers, onAccept, onDismiss, onDismissAll }) {
  if (!offers || offers.length === 0) return null;

  return (
    <div className="rounded-xl border border-gold/40 bg-gradient-to-br from-bg-surface/90 to-bg-deep p-3 sm:p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Phone icon — mirrors the "ring ring" of an incoming GM call */}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            className="text-gold animate-pulse"
            aria-hidden="true"
          >
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
          <span className="font-display text-[11px] font-bold uppercase tracking-[0.14em] text-gold">
            Incoming Trade {offers.length > 1 ? 'Offers' : 'Offer'}
          </span>
          <span className="font-mono text-[10px] text-text-muted">×{offers.length}</span>
        </div>
        {offers.length > 1 && (
          <button
            onClick={onDismissAll}
            className="font-display text-[9px] uppercase tracking-wider text-text-muted hover:text-text-secondary transition px-2 py-1"
            title="Dismiss all offers and pick a player instead"
          >
            Dismiss all
          </button>
        )}
      </div>
      <div className="space-y-2">
        {offers.map((o) => (
          <OfferCard key={o.id} offer={o} onAccept={onAccept} onDismiss={onDismiss} />
        ))}
      </div>
    </div>
  );
}

function OfferCard({ offer, onAccept, onDismiss }) {
  const { botTeam, theirPicks, yourPicks, summary } = offer;
  // Surplus shading — within ±2% feels "even", positive = good for user.
  const surplusColor =
    summary.surplusPct >= 4 ? '#22c55e'
    : summary.surplusPct >= 0 ? '#eab308'
    : '#f97316';
  const surplusLabel =
    summary.surplusPct >= 4 ? 'Slight overpay (good for you)'
    : summary.surplusPct >= 0 ? 'Fair'
    : 'Slight discount (good for them)';

  return (
    <div className="rounded-lg border border-border-subtle bg-bg-deep/70 p-3 space-y-2.5 transition hover:border-gold/40">
      <div className="flex items-center gap-2">
        <TeamLogo abbr={botTeam} size="sm" />
        <div className="flex-1 min-w-0">
          <div className="font-display text-[11px] font-bold uppercase tracking-wider text-text-primary">
            {botTeam} wants to move up
          </div>
          <div className="text-[10px] text-text-muted truncate">{surplusLabel}</div>
        </div>
        <div
          className="font-mono text-[10px] font-semibold"
          style={{ color: surplusColor }}
          title="User-side surplus vs strict fair value"
        >
          {summary.surplusPct >= 0 ? '+' : ''}{summary.surplusPct}%
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md border border-accent/30 bg-accent/[0.06] p-2">
          <div className="font-display text-[9px] font-semibold uppercase tracking-[0.14em] text-accent mb-1">
            You Get
          </div>
          <div className="font-mono text-[11px] text-text-primary leading-tight">
            {theirPicks.map(formatPickLabelCompact).join(' · ')}
          </div>
          <div className="text-[9px] text-text-muted mt-1">val {summary.theirValue}</div>
        </div>
        <div className="rounded-md border border-border-subtle bg-bg-surface/40 p-2">
          <div className="font-display text-[9px] font-semibold uppercase tracking-[0.14em] text-text-muted mb-1">
            You Send
          </div>
          <div className="font-mono text-[11px] text-text-primary leading-tight">
            {yourPicks.map(formatPickLabelCompact).join(' · ')}
          </div>
          <div className="text-[9px] text-text-muted mt-1">val {summary.yourValue}</div>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => onDismiss(offer.id)}
          className="font-display font-semibold text-[10px] uppercase tracking-[0.12em] text-text-secondary rounded-md px-3 py-1.5 border border-border-subtle hover:border-border-focus transition"
        >
          Reject
        </button>
        <button
          onClick={() => onAccept(offer)}
          className="flex-1 font-display font-bold text-[10px] uppercase tracking-[0.14em] text-bg-deep rounded-md px-3 py-1.5 transition hover:brightness-110"
          style={{ background: 'var(--gradient-accent)' }}
        >
          Accept Trade
        </button>
      </div>
    </div>
  );
}
