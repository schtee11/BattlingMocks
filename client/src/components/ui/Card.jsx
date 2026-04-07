export function Card({ className = '', glass = false, children, ...rest }) {
  const base = glass
    ? 'glass rounded-xl shadow-glass'
    : 'bg-panel border border-border-subtle rounded-xl shadow-card bg-gradient-card';
  return (
    <div className={`${base} ${className}`} {...rest}>
      {children}
    </div>
  );
}
