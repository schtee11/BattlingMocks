export function Card({ className = '', children, ...rest }) {
  return (
    <div
      className={`bg-panel border border-border rounded-xl shadow-card ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
