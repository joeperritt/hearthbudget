import { useMemo, useRef, useEffect, useCallback, useState } from 'react';
import { Check } from 'lucide-react';

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function getFontSize(name: string): string {
  const len = name.length;
  if (len <= 6) return 'text-[11px]';
  if (len <= 10) return 'text-[10px]';
  if (len <= 14) return 'text-[9px]';
  return 'text-[8px]';
}

export interface CarouselItem {
  id: string;
  name: string;
  budgeted: number;
}

interface CategoryCarouselProps {
  title: string;
  items: CarouselItem[];
  spentByCategory: Record<string, number>;
  transferAdjustments: Record<string, number>;
  onSelectCategory?: (id: string) => void;
  compact?: boolean;
}

const CARD_WIDTH = 110;
const CARD_WIDTH_COMPACT = 100;
const GAP = 12;
const SPEED = 0.4;

export function CategoryCarousel({ title, items, spentByCategory, transferAdjustments, onSelectCategory, compact = false }: CategoryCarouselProps) {
  const cardW = compact ? CARD_WIDTH_COMPACT : CARD_WIDTH;
  const cardH = compact ? 56 : 110;
  const computed = useMemo(() => {
    return items.map(c => {
      const spent = spentByCategory[c.id] || 0;
      const adj = transferAdjustments[c.id] || 0;
      const remaining = c.budgeted + adj - spent;
      const pct = c.budgeted > 0 ? Math.min(spent / (c.budgeted + adj), 1) : 0;
      return { ...c, spent, remaining, pct };
    });
  }, [items, spentByCategory, transferAdjustments]);

  // Shuffle once on mount
  const shuffleRef = useRef<string[] | null>(null);
  const shuffled = useMemo(() => {
    if (!shuffleRef.current || shuffleRef.current.length !== computed.length) {
      const indices = computed.map((_, i) => i);
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      shuffleRef.current = indices.map(i => computed[i]?.id).filter(Boolean);
    }
    const order = shuffleRef.current;
    const byId = new Map(computed.map(it => [it.id, it]));
    return order.map(id => byId.get(id)).filter(Boolean) as typeof computed;
  }, [computed]);

  // Duplicate for seamless loop
  const tickerItems = useMemo(() => [...shuffled, ...shuffled], [shuffled]);
  const setWidth = shuffled.length * (cardW + GAP);

  const offsetRef = useRef(0);
  const animRef = useRef(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragOffsetStart = useRef(0);
  const lastPointerX = useRef(0);
  const momentumRef = useRef(0);

  const applyTransform = useCallback(() => {
    if (trackRef.current) {
      trackRef.current.style.transform = `translate3d(${-offsetRef.current}px, 0, 0)`;
    }
  }, []);

  const wrapOffset = useCallback(() => {
    if (setWidth > 0) {
      offsetRef.current = ((offsetRef.current % setWidth) + setWidth) % setWidth;
    }
  }, [setWidth]);

  const tick = useCallback(() => {
    if (!isDragging.current) {
      if (Math.abs(momentumRef.current) > 0.1) {
        offsetRef.current += momentumRef.current;
        momentumRef.current *= 0.95;
      } else {
        momentumRef.current = 0;
        offsetRef.current += SPEED;
      }
    }
    wrapOffset();
    applyTransform();
    animRef.current = requestAnimationFrame(tick);
  }, [wrapOffset, applyTransform]);

  useEffect(() => {
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [tick]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    isDragging.current = true;
    dragStartX.current = e.touches[0].clientX;
    lastPointerX.current = e.touches[0].clientX;
    dragOffsetStart.current = offsetRef.current;
    momentumRef.current = 0;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging.current) return;
    const x = e.touches[0].clientX;
    const dx = dragStartX.current - x;
    offsetRef.current = dragOffsetStart.current + dx;
    momentumRef.current = lastPointerX.current - x;
    lastPointerX.current = x;
  }, []);

  const handleTouchEnd = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    dragStartX.current = e.clientX;
    lastPointerX.current = e.clientX;
    dragOffsetStart.current = offsetRef.current;
    momentumRef.current = 0;
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const dx = dragStartX.current - e.clientX;
    offsetRef.current = dragOffsetStart.current + dx;
    momentumRef.current = lastPointerX.current - e.clientX;
    lastPointerX.current = e.clientX;
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  if (shuffled.length === 0) return null;

  return (
    <div className="mt-4 animate-fade-up" style={{ animationDelay: '200ms', animationFillMode: 'both' }}>
      <h3 className="px-6 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{title}</h3>
      <div
        className="overflow-hidden pl-6"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div
          ref={trackRef}
          className="flex gap-3 will-change-transform select-none"
          style={{ width: `${tickerItems.length * (CARD_WIDTH + GAP)}px` }}
        >
          {tickerItems.map((item, idx) => {
            const isOver = item.remaining < 0;
            const isPerfect = item.budgeted > 0 && item.remaining === 0;

            // Card style based on state
            let cardBg = 'bg-card';
            let labelColor = 'text-muted-foreground';
            let amountColor = 'text-foreground';
            let subColor = 'text-muted-foreground';

            if (isOver) {
              cardBg = 'bg-destructive';
              labelColor = 'text-destructive-foreground';
              amountColor = 'text-destructive-foreground';
              subColor = 'text-destructive-foreground/80';
            } else if (isPerfect) {
              cardBg = 'bg-accent/20';
              labelColor = 'text-accent-foreground';
              amountColor = 'text-accent';
              subColor = 'text-accent';
            }

            return (
              <div
                key={`${item.id}-${idx}`}
                onClick={(e) => {
                  const dx = Math.abs((e as unknown as MouseEvent).clientX - dragStartX.current);
                  if (dx < 8) onSelectCategory?.(item.id);
                }}
                className={`shrink-0 w-[110px] h-[110px] ${cardBg} rounded-xl shadow-sm p-3 flex flex-col justify-between cursor-pointer active:scale-95 transition-transform`}
              >
                <p className={`${getFontSize(item.name)} font-semibold uppercase tracking-wide leading-tight ${labelColor}`} style={{ wordBreak: 'break-word' }}>
                  {item.name}
                </p>
                <div>
                {isPerfect ? (
                    <div>
                      <div className="flex items-center gap-1">
                        <Check size={14} className="text-accent" strokeWidth={3} />
                        <p className={`text-xs font-display font-bold ${amountColor}`}>Done</p>
                      </div>
                      <p className={`text-[10px] mt-0.5 ${subColor}`}>$0 left</p>
                    </div>
                  ) : (
                    <>
                      <p className={`text-lg font-display font-bold tabular-nums leading-none ${amountColor}`}>
                        {isOver ? '-' : ''}{formatCurrency(Math.abs(item.remaining))}
                      </p>
                      <p className={`text-[10px] mt-0.5 ${subColor}`}>
                        {isOver ? 'over' : 'left'}
                      </p>
                    </>
                  )}
                </div>
                {!isOver && !isPerfect && (
                  <div className="h-1 rounded-full bg-secondary overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all bg-accent"
                      style={{ width: `${Math.min(item.pct * 100, 100)}%` }}
                    />
                  </div>
                )}
                {isOver && (
                  <div className="h-1 rounded-full bg-destructive-foreground/20 overflow-hidden">
                    <div className="h-full rounded-full bg-destructive-foreground/40 w-full" />
                  </div>
                )}
                {isPerfect && (
                  <div className="h-1 rounded-full bg-accent/30 overflow-hidden">
                    <div className="h-full rounded-full bg-accent w-full" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
