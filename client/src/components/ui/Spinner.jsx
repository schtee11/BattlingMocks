// Tiny inline spinner primitive. Used for async feedback inside buttons,
// loading cards, and anywhere a full skeleton would be overkill. Sized via
// Tailwind classes — pass className to override (e.g. "w-4 h-4").
export function Spinner({ className = 'w-5 h-5', label = 'Loading' }) {
  return (
    <span
      role="status"
      aria-label={label}
      className={`inline-block rounded-full border-2 border-accent border-t-transparent animate-spin ${className}`}
    />
  );
}
