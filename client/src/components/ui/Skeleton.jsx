export function Skeleton({ className = '' }) {
  return (
    <div className={`relative overflow-hidden bg-white/[0.03] rounded ${className}`}>
      <div
        className="absolute inset-0 -translate-x-full animate-shimmer"
        style={{
          background:
            'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.05) 50%, transparent 100%)',
        }}
      />
    </div>
  );
}
