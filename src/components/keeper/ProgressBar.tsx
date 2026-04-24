export function ProgressBar({ value, max, className = '' }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const over = value > max;

  return (
    <div className={`h-1.5 rounded-full bg-muted overflow-hidden ${className}`}>
      <div
        className={`h-full rounded-full transition-all duration-500 ease-out ${
          over ? 'bg-destructive' : 'bg-accent'
        }`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
