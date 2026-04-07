const VARIANTS = {
  primary:
    'text-ink bg-gradient-accent shadow-glow hover:brightness-110 hover:scale-[1.015] active:scale-[0.99] disabled:bg-none disabled:bg-bg-elevated disabled:text-text-muted disabled:shadow-none disabled:hover:scale-100 disabled:hover:brightness-100',
  secondary:
    'bg-transparent text-text-primary border border-border-focus hover:border-accent hover:text-accent hover:bg-accent/5 disabled:opacity-40',
  ghost:
    'bg-transparent text-text-secondary hover:text-text-primary hover:bg-text-primary/5 disabled:opacity-40',
  outline:
    'bg-transparent text-text-secondary border border-border-subtle hover:text-text-primary hover:border-border-focus disabled:opacity-40',
  danger:
    'bg-red-500/15 text-red-500 border border-red-500/40 hover:bg-red-500/25 disabled:opacity-40',
};

const SIZES = {
  xs: 'px-2.5 py-1 text-[11px]',
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-sm',
  xl: 'px-8 py-4 text-base',
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
      className={`inline-flex items-center justify-center gap-2 font-display font-semibold uppercase tracking-[0.12em] rounded-lg transition-all duration-150 disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
