// Consistent page header across routes. Replaces the ad-hoc
// "caption + h1 + right-side chip" block each page used to hand-roll, so
// we only tune one place when the design changes.
//
// Usage:
//   <PageHeader
//     eyebrow="Standings"
//     title="Leaderboard"
//     description="Live rankings during the 2026 draft."
//     actions={<Button>Find Me</Button>}
//   />
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className = '',
}) {
  return (
    <header
      className={`flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 flex-wrap ${className}`}
    >
      <div className="min-w-0">
        {eyebrow && <div className="caption text-accent">{eyebrow}</div>}
        <h1 className="font-display display-xl text-display text-text-primary mt-1 break-words">
          {title}
        </h1>
        {description && (
          <p className="text-text-secondary text-[13.5px] leading-relaxed mt-2 max-w-2xl">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="shrink-0 flex items-center gap-2 flex-wrap">{actions}</div>
      )}
    </header>
  );
}
