export function WidgetSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2 py-2 animate-pulse" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="h-4 rounded bg-muted" style={{ width: `${85 - i * 15}%` }} />)}
    </div>
  );
}
