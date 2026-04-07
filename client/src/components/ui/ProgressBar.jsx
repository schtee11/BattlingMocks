export function ProgressBar({ value, max = 32 }) {
  const segs = Array.from({ length: max }, (_, i) => i < value);
  return (
    <div className="flex gap-0.5 w-full">
      {segs.map((filled, i) => (
        <div
          key={i}
          className={`h-1.5 flex-1 rounded-full transition-colors ${
            filled ? 'bg-accent' : 'bg-slate-700'
          }`}
        />
      ))}
    </div>
  );
}
