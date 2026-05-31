import { useEffect, useMemo, useState } from 'react';
import { BudgetCategory, FixedExpense, Transaction } from '@/types/budget';
import { format } from 'date-fns';
import { SettingsView } from './SettingsView';
import { AlertCircle, ArrowLeft, Info, Pencil, Sparkles, Tags, Wallet, X } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { filterForMonth, applyOverridesToCategories, applyOverridesToFixed, type MonthAmountOverrides } from '@/hooks/useBudgetData';
import { SpendingAnalyzer } from './SpendingAnalyzer';
import { BucketMappingSheet } from './BucketMappingSheet';
import { useCategoryBucketMap } from '@/hooks/useCategoryBucketMap';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useHomeCards } from '@/hooks/useHomeCards';
import { useHouseholdFlags } from '@/hooks/useHouseholdFlags';
import { CFP_BUCKETS } from '@/lib/cfpBuckets';
import { BudgetBuilderStep, persistBudgetDrafts, type BucketCategoryDraft } from './BudgetBuilderStep';
import { TooltipProvider } from '@/components/ui/tooltip';
import { toast } from 'sonner';

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}

function formatWithCommas(value: string): string {
  const num = value.replace(/[^0-9.]/g, '');
  const parts = num.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

function parseNumeric(value: string): number {
  return parseFloat(value.replace(/,/g, '')) || 0;
}

interface BudgetTabViewProps {
  categories: BudgetCategory[];
  fixedExpenses: FixedExpense[];
  currentMonth: Date;
  onUpdateCategories: (cats: BudgetCategory[]) => void;
  onUpdateFixedExpenses: (exps: FixedExpense[]) => void;
  onAddCategoryForMonth: (cat: BudgetCategory, scope: 'month-only' | 'month-and-future', month: string) => Promise<void>;
  onAddFixedExpenseForMonth: (exp: FixedExpense, scope: 'month-only' | 'month-and-future', month: string) => Promise<void>;
  onRemoveCategoryFromMonth: (slug: string, month: string, scope: 'month-only' | 'month-and-future') => Promise<void>;
  onRemoveFixedExpenseFromMonth: (slug: string, month: string, scope: 'month-only' | 'month-and-future') => Promise<void>;
  unassignedCount: number;
  spentByCategory: Record<string, number>;
  transferAdjustments: Record<string, number>;
  monthTransactions: Transaction[];
  planningData: Record<string, string>;
  onUpdatePlanningData: (data: Record<string, string>) => void;
  initialViewMonth?: string;
  activeMonth?: string;
  monthAmountOverrides?: MonthAmountOverrides;
  onSetMonthAmountOverride?: (kind: 'category' | 'fixed', slug: string, month: string, amount: number) => Promise<void>;
  onMoveCategoryToFixed?: (slug: string, fixedGroup: 'bills' | 'savings' | 'tithe') => Promise<void>;
  onMoveFixedToCategory?: (slug: string, group: BudgetCategory['group']) => Promise<void>;
  onOpenProfile?: () => void;
  onBack?: () => void;
}

export function BudgetTabView({
  categories, fixedExpenses, currentMonth,
  onUpdateCategories, onUpdateFixedExpenses,
  onAddCategoryForMonth, onAddFixedExpenseForMonth,
  onRemoveCategoryFromMonth, onRemoveFixedExpenseFromMonth,
  unassignedCount, spentByCategory, transferAdjustments, monthTransactions,
  planningData, onUpdatePlanningData, initialViewMonth,
  activeMonth, monthAmountOverrides = {},
  onSetMonthAmountOverride, onMoveCategoryToFixed, onMoveFixedToCategory,
  onOpenProfile, onBack,
}: BudgetTabViewProps) {
  const [viewMonthKey, setViewMonthKey] = useState(() => initialViewMonth || format(currentMonth, 'yyyy-MM'));
  const [analyzerOpen, setAnalyzerOpen] = useState(false);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const { profile } = useAuth();
  const householdId = profile?.household_id ?? null;
  const { map: bucketMap } = useCategoryBucketMap();
  const { update: updateHomeCards } = useHomeCards(householdId);
  const { flags } = useHouseholdFlags(householdId);

  useEffect(() => {
    if (initialViewMonth) setViewMonthKey(initialViewMonth);
  }, [initialViewMonth]);
  const [takeHomeInput, setTakeHomeInput] = useState(() => {
    const total = (parseFloat(planningData.netIncome || '') || 0) + (parseFloat(planningData.katieNetIncome || '') || 0);
    return total > 0 ? formatWithCommas(String(total)) : '';
  });

  const activeMonthKey = format(currentMonth, 'yyyy-MM');
  const isPastMonth = viewMonthKey < activeMonthKey;
  const [pastSnapshot, setPastSnapshot] = useState<any | null>(null);

  useEffect(() => {
    if (!isPastMonth || !householdId) { setPastSnapshot(null); return; }
    let cancelled = false;
    supabase.from('budget_month_snapshots' as any)
      .select('*')
      .eq('household_id', householdId)
      .eq('month', viewMonthKey)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setPastSnapshot(data); });
    return () => { cancelled = true; };
  }, [isPastMonth, householdId, viewMonthKey]);

  useEffect(() => {
    setViewMonthKey(format(currentMonth, 'yyyy-MM'));
  }, [currentMonth]);

  const monthCategories = useMemo(
    () => applyOverridesToCategories(filterForMonth(categories, viewMonthKey), viewMonthKey, monthAmountOverrides),
    [categories, viewMonthKey, monthAmountOverrides],
  );
  const monthFixedExpenses = useMemo(
    () => applyOverridesToFixed(filterForMonth(fixedExpenses, viewMonthKey), viewMonthKey, monthAmountOverrides),
    [fixedExpenses, viewMonthKey, monthAmountOverrides],
  );

  // Use the live input value for real-time surplus calculation
  const totalTakeHome = parseNumeric(takeHomeInput);

  // Budget totals — sum ALL categories and fixed expenses
  const allCategoriesTotal = monthCategories.reduce((s, c) => s + c.budgeted, 0);
  const fixedTotal = monthFixedExpenses.reduce((s, e) => s + e.amount, 0);
  const budgetTotal = allCategoriesTotal + fixedTotal;

  // Surplus = take-home minus budget total, nothing else
  const surplus = totalTakeHome - budgetTotal;
  const isSurplus = surplus >= 0;

  // Count mappable items vs unmapped — every category & fixed expense needs a
  // user-chosen bucket. We no longer auto-resolve savings/tithe groups because
  // many "savings" categories are sinking funds for delayed expenses.
  const mappingStats = useMemo(() => {
    let total = 0;
    let mapped = 0;
    for (const c of monthCategories) {
      total += 1;
      if (bucketMap[c.id]) mapped += 1;
    }
    for (const f of monthFixedExpenses) {
      total += 1;
      if (bucketMap[f.id]) mapped += 1;
    }
    return { total, mapped, unmapped: total - mapped };
  }, [monthCategories, monthFixedExpenses, bucketMap]);

  const handleTakeHomeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9.,]/g, '');
    setTakeHomeInput(formatWithCommas(raw));
  };

  const handleTakeHomeBlur = () => {
    const val = parseNumeric(takeHomeInput);
    // Store entire take-home in netIncome, clear katieNetIncome to prevent double-counting
    onUpdatePlanningData({ ...planningData, netIncome: String(val), katieNetIncome: '0' });
  };

  // Empty-state: show CTA when the household has no categories AND no fixed
  // expenses defined at all (most likely a user who took the "I'll set this
  // up later" escape during onboarding).
  const budgetIsEmpty = categories.length === 0 && fixedExpenses.length === 0;

  return (
    <div className="max-w-lg mx-auto pb-8">
      <div className="px-6 pt-12 safe-top">
        {onBack && (
          <button onClick={onBack} className="flex items-center gap-1 text-accent text-sm font-medium mb-3 active:scale-95 transition-transform">
            <ArrowLeft size={16} /> Back
          </button>
        )}
        <div className="flex items-baseline gap-2">
          <h1 className="font-display text-2xl lg:text-3xl font-bold tracking-tight text-foreground">Budget</h1>
          {isPastMonth && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              {(() => { const [y, m] = viewMonthKey.split('-').map(Number); return format(new Date(y, m - 1, 1), 'MMM yyyy'); })()} · Closed
            </span>
          )}
        </div>
      </div>

      {budgetIsEmpty && (
        <div className="px-6 mt-4">
          <div className="bg-card rounded-xl shadow-sm p-5 border border-accent/40">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-accent/15 flex items-center justify-center shrink-0">
                <Wallet size={20} className="text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-display text-base font-bold text-foreground">
                  Your budget is empty
                </p>
                <p className="text-xs text-muted-foreground leading-snug mt-1">
                  Set it up to start tracking spending against your monthly take-home.
                </p>
                <button
                  type="button"
                  onClick={() => setBuilderOpen(true)}
                  className="mt-3 inline-flex items-center gap-1.5 bg-primary text-primary-foreground text-sm font-semibold py-2 px-4 rounded-lg active:scale-[0.98] transition shadow-sm"
                >
                  Set up budget
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Take-Home, Budget Total & Surplus/Deficit */}
      <div className="px-6 mt-4">
        <div className="bg-card rounded-xl shadow-sm p-4 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              Avg. Monthly Take-Home
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className="inline-flex items-center justify-center rounded-full w-4 h-4 hover:opacity-80 transition-opacity" aria-label="Income info">
                    <Info className="w-3.5 h-3.5 text-amber-500" />
                  </button>
                </PopoverTrigger>
                <PopoverContent side="bottom" align="start" className="w-72 text-xs text-muted-foreground">
                  Enter your household's average monthly net (take-home) pay — the amount deposited into your accounts after taxes and deductions. This is used to calculate your monthly surplus or deficit against your total budget. If your income varies month to month, use a conservative average.
                </PopoverContent>
              </Popover>
            </span>
            <div className="flex items-center gap-1">
              <span className="text-sm text-muted-foreground">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={isPastMonth ? (pastSnapshot ? formatWithCommas(String(((pastSnapshot as any)?.transactions_summary?.takeHome) ?? totalTakeHome)) : takeHomeInput) : takeHomeInput}
                onChange={handleTakeHomeChange}
                onBlur={handleTakeHomeBlur}
                placeholder="0"
                disabled={isPastMonth}
                className={`w-24 text-right text-sm font-semibold tabular-nums text-foreground bg-transparent border-b outline-none transition-colors py-0.5 ${isPastMonth ? 'border-transparent opacity-70' : 'border-amber-400/60 focus:border-amber-500'}`}
              />
              {!isPastMonth && <Pencil className="w-3 h-3 text-amber-500 flex-shrink-0" />}
            </div>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Budget Total</span>
            <span className="text-sm font-semibold tabular-nums text-foreground">{fmt(budgetTotal)}</span>
          </div>
          <div className="border-t border-border pt-2 flex justify-between items-center">
            <span className="text-sm font-semibold text-foreground">
              {isSurplus ? 'Monthly Surplus' : 'Monthly Deficit'}
            </span>
            <span className={`text-sm font-bold tabular-nums ${isSurplus ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>
              {isSurplus ? '+' : '-'}{fmt(Math.abs(surplus))}
            </span>
          </div>

          {/* Anchor Map / Analyze inside the card so the analysis is visibly
              tied to the month's take-home and budget totals shown above. */}
          <div className="border-t border-border pt-3 mt-1">
            <p className="text-[11px] text-muted-foreground mb-2 leading-snug">
              Compare {(() => {
                // Parse YYYY-MM as a LOCAL date — `new Date('2026-04-01')` is
                // UTC midnight, which renders as the prior month in negative
                // timezones (off-by-one bug).
                const [y, m] = viewMonthKey.split('-').map(Number);
                return format(new Date(y, m - 1, 1), 'MMMM');
              })()}'s budget to CFP guidelines.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="sm"
                className="border-border"
                onClick={() => setMappingOpen(true)}
              >
                <Tags className="w-4 h-4 mr-1.5" />
                {mappingStats.unmapped > 0 ? 'Map categories' : 'Edit mapping'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950/30"
                onClick={() => setAnalyzerOpen(true)}
              >
                <Sparkles className="w-4 h-4 mr-1.5" />
                Analyze budget
              </Button>
            </div>
          </div>
        </div>

        {!isPastMonth && mappingStats.total > 0 && mappingStats.unmapped > 0 && (
          <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-amber-900 dark:text-amber-200">
                {mappingStats.unmapped} of {mappingStats.total} categories aren't mapped to a CFP bucket yet
              </div>
              <p className="text-[11px] text-amber-800/80 dark:text-amber-200/80 mt-0.5 leading-snug">
                Mapping powers the budget analyzer. Unmapped categories are skipped from the rollup.
              </p>
              <button
                type="button"
                onClick={() => setMappingOpen(true)}
                className="mt-1.5 text-xs font-medium text-amber-900 dark:text-amber-200 underline underline-offset-2"
              >
                Map them now →
              </button>
            </div>
          </div>
        )}
      </div>

      <SpendingAnalyzer
        open={analyzerOpen}
        onOpenChange={setAnalyzerOpen}
        defaultIncome={totalTakeHome > 0 ? totalTakeHome : undefined}
        viewMonth={viewMonthKey}
        onOpenProfile={onOpenProfile}
      />

      <BucketMappingSheet
        open={mappingOpen}
        onOpenChange={setMappingOpen}
        categories={monthCategories}
        fixedExpenses={monthFixedExpenses}
      />

      {/* Inline Budget Planning (SettingsView in embedded mode) */}
      <div className="mt-4">
        <SettingsView
          categories={categories}
          fixedExpenses={fixedExpenses}
          currentMonth={currentMonth}
          onUpdateCategories={onUpdateCategories}
          onUpdateFixedExpenses={onUpdateFixedExpenses}
          onAddCategoryForMonth={onAddCategoryForMonth}
          onAddFixedExpenseForMonth={onAddFixedExpenseForMonth}
          onRemoveCategoryFromMonth={onRemoveCategoryFromMonth}
          onRemoveFixedExpenseFromMonth={onRemoveFixedExpenseFromMonth}
          onBack={() => {}}
          unassignedCount={unassignedCount}
          spentByCategory={spentByCategory}
          transferAdjustments={transferAdjustments}
          monthTransactions={monthTransactions}
          embedded
          onViewMonthChange={setViewMonthKey}
        />
      </div>

      {builderOpen && householdId && (
        <BudgetBuilderSheet
          householdId={householdId}
          flags={flags}
          monthlyTakeHome={totalTakeHome}
          onClose={() => setBuilderOpen(false)}
          onSaved={async () => {
            await updateHomeCards({
              needs_budget_setup: false,
              budget_setup_dismissed: true,
            });
            
            toast.success('Budget saved!');
            setBuilderOpen(false);
            // Soft-reload to pick up the new categories/fixed expenses.
            // useBudgetData doesn't expose a refetch, and this is a one-time
            // setup action so the cost is acceptable.
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}

/* ============================================================
 * Standalone budget-builder sheet — reuses Step 5 from onboarding
 * so the user can re-enter their starter budget at any time.
 * ============================================================ */
function BudgetBuilderSheet({
  householdId, flags, monthlyTakeHome, onClose, onSaved,
}: {
  householdId: string;
  flags: { has_kids: boolean; has_pets: boolean };
  monthlyTakeHome: number;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Record<string, BucketCategoryDraft[]>>({});
  const [saving, setSaving] = useState(false);

  const visibleBuckets = useMemo(
    () =>
      CFP_BUCKETS.filter(b => {
        if (b.key === 'kids' && !flags.has_kids) return false;
        if (b.key === 'pets' && !flags.has_pets) return false;
        return true;
      }),
    [flags.has_kids, flags.has_pets],
  );

  const totalAllocated = useMemo(() => {
    let total = 0;
    for (const list of Object.values(drafts)) {
      for (const d of list) total += Number(d.amount) || 0;
    }
    return total;
  }, [drafts]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await persistBudgetDrafts(householdId, drafts);
      await onSaved();
    } catch (e) {
      console.error(e);
      toast.error('Could not save budget. Please try again.');
      setSaving(false);
    }
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="fixed inset-0 z-50 bg-background overflow-y-auto">
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border safe-top">
          <div className="max-w-xl mx-auto px-6 py-3 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-foreground">Budget builder</p>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 -m-1.5 text-muted-foreground hover:text-foreground active:scale-90 transition"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="max-w-xl mx-auto px-6 py-8 pb-48">
          <BudgetBuilderStep
            buckets={visibleBuckets}
            drafts={drafts}
            setDrafts={setDrafts}
            monthlyTakeHome={monthlyTakeHome}
            totalAllocated={totalAllocated}
            onComplete={handleSave}
            continueLabel={saving ? 'Saving…' : 'Save budget'}
            title="Set up your budget"
            intro="Add categories under each bucket — track only what matters. Skip the buckets that don't apply."
            hideSkip
          />
        </div>
      </div>
    </TooltipProvider>
  );
}
