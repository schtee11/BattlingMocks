// Shared empty state. Every list/table/data view should drop into this
// instead of rendering a raw "No data" string. Gives the user an icon, a
// headline, plain-language context, and an optional CTA.
//
// Usage:
//   <EmptyState
//     icon={<SomeSvg />}      // optional — falls back to a neutral circle
//     title="No mocks yet"
//     description="Be the first to submit a mock for the 2026 draft."
//     action={<Link to="/draft"><Button>Start a Mock</Button></Link>}
//   />
export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
  className = '',
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${
        compact ? 'py-8 px-4' : 'py-14 px-6'
      } ${className}`}
      role="status"
    >
      <div
        className={`flex items-center justify-center rounded-full mb-4 ${
          compact ? 'w-12 h-12' : 'w-16 h-16'
        }`}
        style={{
          background:
            'radial-gradient(circle at center, rgb(var(--accent-rgb) / 0.12) 0%, transparent 70%)',
          border: '1px solid var(--border-subtle)',
        }}
        aria-hidden="true"
      >
        {icon || (
          <svg
            viewBox="0 0 24 24"
            className={compact ? 'w-6 h-6 text-text-muted' : 'w-7 h-7 text-text-muted'}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M8 15h8" />
            <path d="M9 9h.01" />
            <path d="M15 9h.01" />
          </svg>
        )}
      </div>
      <h3
        className={`font-display font-bold uppercase tracking-[0.14em] text-text-primary ${
          compact ? 'text-[14px]' : 'text-[17px]'
        }`}
      >
        {title}
      </h3>
      {description && (
        <p
          className={`text-text-secondary mt-1.5 max-w-sm ${
            compact ? 'text-[12px]' : 'text-[13px]'
          }`}
        >
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
