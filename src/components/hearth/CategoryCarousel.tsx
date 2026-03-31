import { useMemo, useRef, useState, useEffect } from 'react';
import { BudgetCategory } from '@/types/budget';

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function abbreviate(name: string, maxLen = 10): string {
  if (name.length <= maxLen) return name;
  // Try to split on space/dash and abbreviate
  const parts = name.split(/[\s\-\/]+/);
  if (parts.length > 1) {
    return parts.map(p => p.slice(0, 3)).join('/');
  }
  return name.slice(0, maxLen);
}

interface CategoryCarouselProps {
  categories: BudgetCategory[];
  spentByCategory: Record<string, number>;
  transferAdjustments: Record<string, number>;
  onSelectCategory?: (id: string) => void;
}

export function CategoryCarousel({ categories, spentByCategory, transferAdjustments, onSelectCategory }: CategoryCarouselProps) {
  const items = useMemo(() => {
    return categories.map(c => {
      const spent = spentByCategory[c.id] || 0;
      const adj = transferAdjustments[c.id] || 0;
      const remaining = c.budgeted + adj - spent;
      const pct = c.budgeted > 0 ? Math.min(spent / (c.budgeted + adj), 1) : 0;
      return { ...c, spent, remaining, pct };
    });
  }, [categories, spentByCategory, transferAdjustments]);

  // Shuffle once on mount
  const shuffled = useMemo(() => {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }, [items]);

  const scrollRef = useRef<HTMLDivElement>(null);

  if (shuffled.length === 0) return null;

  return (
    <div className="px-6 mt-4 animate-fade-up" style={{ animationDelay: '200ms', animationFillMode: 'both' }}>
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Category Snapshot</h3>
      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-hide"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {shuffled.map(item => {
          const isOver = item.remaining < 0;
          return (
            <div
              key={item.id}
              onClick={() => onSelectCategory?.(item.id)}
              className="snap-start shrink-0 w-[110px] h-[110px] bg-card rounded-xl shadow-sm p-3 flex flex-col justify-between cursor-pointer active:scale-95 transition-transform"
            >
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide leading-tight truncate">
                {abbreviate(item.name)}
              </p>
              <div>
                <p className={`text-lg font-display font-bold tabular-nums leading-none ${isOver ? 'text-destructive' : 'text-foreground'}`}>
                  {isOver ? '-' : ''}{formatCurrency(Math.abs(item.remaining))}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {isOver ? 'over' : 'left'}
                </p>
              </div>
              {/* Mini progress bar */}
              <div className="h-1 rounded-full bg-secondary overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${isOver ? 'bg-destructive' : 'bg-accent'}`}
                  style={{ width: `${Math.min(item.pct * 100, 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
