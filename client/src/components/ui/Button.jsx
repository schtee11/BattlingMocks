const VARIANTS = {
  primary:
    'bg-accent text-ink hover:bg-accent-hover shadow-glow disabled:bg-slate-700 disabled:text-slate-400 disabled:shadow-none',
  secondary:
    'bg-transparent text-slate-100 border border-slate-600 hover:border-accent hover:text-accent disabled:opacity-40',
  ghost:
    'bg-transparent text-slate-300 hover:text-white hover:bg-white/5 disabled:opacity-40',
  danger:
    'bg-red-500/20 text-red-200 border border-red-500/40 hover:bg-red-500/30 disabled:opacity-40',
};

const SIZES = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...rest
}) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 font-semibold rounded-lg transition-all duration-150 disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
