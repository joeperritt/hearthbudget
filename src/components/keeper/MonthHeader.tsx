import { ChevronLeft, ChevronRight } from 'lucide-react';

export function MonthHeader({
  monthLabel,
  onPrev,
  onNext,
}: {
  monthLabel: string;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-6 py-4">
      <button onClick={onPrev} className="p-2 -ml-2 text-muted-foreground active:scale-95 transition-transform">
        <ChevronLeft size={20} />
      </button>
      <h2 className="font-display text-lg font-semibold text-foreground">{monthLabel}</h2>
      <button onClick={onNext} className="p-2 -mr-2 text-muted-foreground active:scale-95 transition-transform">
        <ChevronRight size={20} />
      </button>
    </div>
  );
}
