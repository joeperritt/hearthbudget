import { useMemo, useRef, useEffect, useCallback } from 'react';
import { BudgetCategory } from '@/types/budget';

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function abbreviate(name: string, maxLen = 10): string {
  if (name.length <= maxLen) return name;
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

  // Shuffle once on mount using a ref so it doesn't re-shuffle on data updates
  const shuffleRef = useRef<string[] | null>(null);
  const shuffled = useMemo(() => {
    if (!shuffleRef.current || shuffleRef.current.length !== items.length) {
      const indices = items.map((_, i) => i);
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      shuffleRef.current = indices.map(i => items[i]?.id).filter(Boolean);
    }
    // Re-order items by saved shuffle order
    const order = shuffleRef.current;
    const byId = new Map(items.map(it => [it.id, it]));
    return order.map(id => byId.get(id)).filter(Boolean) as typeof items;
  }, [items]);

  // Duplicate the list for seamless infinite scroll
  const tickerItems = useMemo(() => [...shuffled, ...shuffled], [shuffled]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const scrollStart = useRef(0);
  const animRef = useRef<number>(0);
  const speedRef = useRef(0.5); // px per frame

  // Auto-scroll ticker
  const tick = useCallback(() => {
    const el = scrollRef.current;
    if (!el || isDragging.current) {
      animRef.current = requestAnimationFrame(tick);
      return;
    }
    el.scrollLeft += speedRef.current;
    // When we've scrolled past the first set, jump back seamlessly
    const halfWidth = el.scrollWidth / 2;
    if (el.scrollLeft >= halfWidth) {
      el.scrollLeft -= halfWidth;
    }
    animRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [tick]);

  // Drag/touch handlers
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    isDragging.current = true;
    dragStartX.current = e.clientX;
    scrollStart.current = scrollRef.current?.scrollLeft || 0;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current || !scrollRef.current) return;
    const dx = e.clientX - dragStartX.current;
    scrollRef.current.scrollLeft = scrollStart.current - dx;
  }, []);

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  if (shuffled.length === 0) return null;

  return (
    <div className="mt-4 animate-fade-up" style={{ animationDelay: '200ms', animationFillMode: 'both' }}>
      <h3 className="px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Category Snapshot</h3>
      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-hidden pb-2 pl-6 cursor-grab active:cursor-grabbing select-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {tickerItems.map((item, idx) => {
          const isOver = item.remaining < 0;
          return (
            <div
              key={`${item.id}-${idx}`}
              onPointerUp={(e) => {
                // Only fire tap if not dragged
                const dx = Math.abs(e.clientX - dragStartX.current);
                if (dx < 5) onSelectCategory?.(item.id);
              }}
              className="shrink-0 w-[110px] h-[110px] bg-card rounded-xl shadow-sm p-3 flex flex-col justify-between cursor-pointer active:scale-95 transition-transform"
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
