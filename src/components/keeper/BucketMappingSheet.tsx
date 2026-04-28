import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Check, ChevronRight, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CFP_BUCKETS, getBucket, suggestBucket } from "@/lib/cfpBuckets";
import { BudgetCategory, FixedExpense } from "@/types/budget";
import { useCategoryBucketMap } from "@/hooks/useCategoryBucketMap";
import { toast } from "@/hooks/use-toast";

interface CategoryItem {
  slug: string;
  name: string;
  group: string;
  kind: "variable" | "fixed";
}

interface BucketMappingSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: BudgetCategory[];
  fixedExpenses: FixedExpense[];
}

/**
 * Bottom-sheet UI that walks the user through assigning each of their
 * categories (variable + fixed) to a CFP bucket. Every category is shown —
 * even savings/tithe groups — because many "savings" categories are actually
 * sinking funds for delayed expenses (vacation savings → Travel, etc.) and
 * the user is the one who knows which is which.
 *
 * Tapping the row name opens the full picker. Rows with a smart suggestion
 * also show an "Approve" pill on the right that assigns in one tap.
 */
export function BucketMappingSheet({
  open, onOpenChange, categories, fixedExpenses,
}: BucketMappingSheetProps) {
  const { map, setMapping, clearMapping, loading } = useCategoryBucketMap();
  const [pickerSlug, setPickerSlug] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!open) {
      setPickerSlug(null);
      setShowAll(false);
    }
  }, [open]);

  // Build the unified list of mappable items. Show every category — no
  // structural exclusions.
  const items = useMemo<CategoryItem[]>(() => {
    const list: CategoryItem[] = [];
    for (const c of categories) {
      list.push({ slug: c.id, name: c.name, group: c.group, kind: "variable" });
    }
    for (const f of fixedExpenses) {
      list.push({ slug: f.id, name: f.name, group: f.group, kind: "fixed" });
    }
    return list;
  }, [categories, fixedExpenses]);

  const unmapped = useMemo(() => items.filter(i => !map[i.slug]), [items, map]);
  const mapped = useMemo(() => items.filter(i => map[i.slug]), [items, map]);
  const showList = unmapped.length > 0 || showAll ? items : mapped;

  const pickerItem = pickerSlug ? items.find(i => i.slug === pickerSlug) : null;
  const suggested = pickerItem ? suggestBucket(pickerItem.name, pickerItem.group) : null;
  const currentBucket = pickerSlug ? map[pickerSlug]?.bucket_key : null;

  const handlePick = async (bucketKey: string) => {
    if (!pickerItem) return;
    await setMapping(pickerItem.slug, bucketKey, pickerItem.kind);
    toast({
      title: `${pickerItem.name} → ${getBucket(bucketKey)?.label}`,
      description: "Mapping saved.",
    });
    setPickerSlug(null);
  };

  // One-tap approve from the list view (no picker open).
  const handleApprove = async (item: CategoryItem, bucketKey: string) => {
    await setMapping(item.slug, bucketKey, item.kind);
    toast({
      title: `${item.name} → ${getBucket(bucketKey)?.label}`,
      description: "Mapping saved.",
    });
  };

  const handleSkip = () => setPickerSlug(null);

  const handleClear = async () => {
    if (!pickerItem) return;
    await clearMapping(pickerItem.slug);
    setPickerSlug(null);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[88vh] overflow-hidden p-0 flex flex-col">
        {!pickerItem ? (
          <>
            <SheetHeader className="px-5 pt-5 pb-3 border-b border-border">
              <SheetTitle className="font-display text-xl">
                Map categories to CFP buckets
              </SheetTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Tap a category to choose its Certified Financial Planner (CFP) bucket. We'll suggest one based on the name — confirm or change.
              </p>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto px-5 py-3">
              {loading ? (
                <div className="text-center text-sm text-muted-foreground py-12">Loading…</div>
              ) : items.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-12">
                  No categories to map yet. Add some categories to your budget first.
                </div>
              ) : (
                <>
                  {unmapped.length > 0 && (
                    <div className="mb-4">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-2">
                        Needs mapping ({unmapped.length})
                      </div>
                      <div className="space-y-1.5">
                        {unmapped.map(item => {
                          const sug = suggestBucket(item.name, item.group);
                          const sugBucket = sug ? getBucket(sug) : null;
                          return (
                            <button
                              key={item.slug}
                              type="button"
                              onClick={() => setPickerSlug(item.slug)}
                              className="w-full flex items-center justify-between gap-2 p-3 bg-card rounded-lg border border-border hover:border-amber-300 transition-colors text-left"
                            >
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-foreground truncate">{item.name}</div>
                                {sugBucket && (
                                  <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                                    <Sparkles className="w-3 h-3 text-amber-500" />
                                    Suggested: {sugBucket.label}
                                  </div>
                                )}
                              </div>
                              <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {mapped.length > 0 && (
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-2 mt-4">
                        Mapped ({mapped.length})
                      </div>
                      <div className="space-y-1.5">
                        {mapped.map(item => {
                          const bucketKey = map[item.slug]?.bucket_key;
                          const bucket = bucketKey ? getBucket(bucketKey) : null;
                          return (
                            <button
                              key={item.slug}
                              type="button"
                              onClick={() => setPickerSlug(item.slug)}
                              className="w-full flex items-center justify-between gap-2 p-2.5 bg-muted/40 rounded-lg border border-transparent hover:border-border transition-colors text-left"
                            >
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-foreground truncate">{item.name}</div>
                                <div className="text-[11px] text-muted-foreground mt-0.5">
                                  → {bucket?.label || bucketKey}
                                </div>
                              </div>
                              <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="px-5 py-3 border-t border-border bg-background">
              <Button onClick={() => onOpenChange(false)} className="w-full" variant="default">
                Done
              </Button>
            </div>
          </>
        ) : (
          // ---------- Bucket picker (second screen) ----------
          <>
            <SheetHeader className="px-5 pt-5 pb-3 border-b border-border">
              <button
                type="button"
                onClick={handleSkip}
                className="text-xs text-muted-foreground mb-2 flex items-center gap-1 hover:text-foreground"
              >
                <X className="w-3 h-3" /> Cancel
              </button>
              <SheetTitle className="font-display text-lg">
                "{pickerItem.name}" — pick a bucket
              </SheetTitle>
              {suggested && (
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-amber-500" />
                  Suggested: <span className="font-medium text-foreground">{getBucket(suggested)?.label}</span>
                </p>
              )}
            </SheetHeader>

            <div className="flex-1 overflow-y-auto px-5 py-3">
              <div className="space-y-1.5">
                {CFP_BUCKETS.map(b => {
                  const isSuggested = b.key === suggested;
                  const isCurrent = b.key === currentBucket;
                  return (
                    <button
                      key={b.key}
                      type="button"
                      onClick={() => handlePick(b.key)}
                      className={cn(
                        "w-full flex items-start justify-between gap-3 p-3 rounded-lg border transition-colors text-left",
                        isCurrent
                          ? "bg-amber-50 dark:bg-amber-950/30 border-amber-400"
                          : isSuggested
                            ? "bg-card border-amber-300 hover:border-amber-400"
                            : "bg-card border-border hover:border-amber-200",
                      )}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                          {b.label}
                          {isSuggested && !isCurrent && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200 font-medium">
                              suggested
                            </span>
                          )}
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                            {b.role}
                          </span>
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                          {b.description}
                        </div>
                        <div className="text-[10px] text-muted-foreground/80 mt-0.5">
                          Guideline {b.guideline_kind === "max" ? "≤" : b.guideline_kind === "min" ? "≥" : "~"} {b.guideline_pct}%
                        </div>
                      </div>
                      {isCurrent && <Check className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />}
                    </button>
                  );
                })}
              </div>

              {currentBucket && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="mt-4 text-xs text-muted-foreground hover:text-destructive transition-colors w-full text-center py-2"
                >
                  Remove mapping
                </button>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
