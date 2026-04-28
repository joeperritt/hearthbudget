import { useEffect, useMemo, useState } from 'react';
import { BudgetCategory, FixedExpense, Transaction } from '@/types/budget';
import { format } from 'date-fns';
import { SettingsView } from './SettingsView';
import { AlertCircle, Info, Pencil, Sparkles, Tags } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { filterForMonth } from '@/hooks/useBudgetData';
import { SpendingAnalyzer } from './SpendingAnalyzer';
import { BucketMappingSheet } from './BucketMappingSheet';
import { useCategoryBucketMap } from '@/hooks/useCategoryBucketMap';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

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
}

export function BudgetTabView({
  categories, fixedExpenses, currentMonth,
  onUpdateCategories, onUpdateFixedExpenses,
  onAddCategoryForMonth, onAddFixedExpenseForMonth,
  onRemoveCategoryFromMonth, onRemoveFixedExpenseFromMonth,
  unassignedCount, spentByCategory, transferAdjustments, monthTransactions,
  planningData, onUpdatePlanningData, initialViewMonth,
}: BudgetTabViewProps) {
  const [viewMonthKey, setViewMonthKey] = useState(() => initialViewMonth || format(currentMonth, 'yyyy-MM'));
  const [analyzerOpen, setAnalyzerOpen] = useState(false);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [hasPlaid, setHasPlaid] = useState(false);
  const { profile } = useAuth();
  const { map: bucketMap } = useCategoryBucketMap();

  useEffect(() => {
    const householdId = profile?.household_id;
    if (!householdId) return;
    supabase
      .from('plaid_items')
      .select('id', { count: 'exact', head: true })
      .eq('household_id', householdId)
      .then(({ count }) => setHasPlaid((count || 0) > 0));
  }, [profile?.household_id]);

  useEffect(() => {
    if (initialViewMonth) setViewMonthKey(initialViewMonth);
  }, [initialViewMonth]);
  const [takeHomeInput, setTakeHomeInput] = useState(() => {
    const total = (parseFloat(planningData.netIncome || '') || 0) + (parseFloat(planningData.katieNetIncome || '') || 0);
    return total > 0 ? formatWithCommas(String(total)) : '';
  });

  useEffect(() => {
    setViewMonthKey(format(currentMonth, 'yyyy-MM'));
  }, [currentMonth]);

  const monthCategories = useMemo(() => filterForMonth(categories, viewMonthKey), [categories, viewMonthKey]);
  const monthFixedExpenses = useMemo(() => filterForMonth(fixedExpenses, viewMonthKey), [fixedExpenses, viewMonthKey]);

  // Use the live input value for real-time surplus calculation
  const totalTakeHome = parseNumeric(takeHomeInput);

  // Budget totals — sum ALL categories and fixed expenses
  const allCategoriesTotal = monthCategories.reduce((s, c) => s + c.budgeted, 0);
  const fixedTotal = monthFixedExpenses.reduce((s, e) => s + e.amount, 0);
  const budgetTotal = allCategoriesTotal + fixedTotal;

  // Surplus = take-home minus budget total, nothing else
  const surplus = totalTakeHome - budgetTotal;
  const isSurplus = surplus >= 0;

  // Count mappable items vs unmapped — categories/fixed-expenses with structural
  // groups (savings/tithe/giving) auto-resolve and are excluded from the count.
  const mappingStats = useMemo(() => {
    const isStructural = (g: string) => {
      const lower = (g || '').toLowerCase();
      return lower === 'savings' || lower === 'saving' || lower === 'tithe' || lower === 'giving';
    };
    let total = 0;
    let mapped = 0;
    for (const c of monthCategories) {
      if (isStructural(c.group)) continue;
      total += 1;
      if (bucketMap[c.id]) mapped += 1;
    }
    for (const f of monthFixedExpenses) {
      if (isStructural(f.group)) continue;
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

  return (
    <div className="max-w-lg mx-auto pb-8">
      <div className="px-6 pt-12 safe-top">
        <h1 className="font-display text-2xl lg:text-3xl font-bold tracking-tight text-foreground">Budget</h1>
      </div>

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
                value={takeHomeInput}
                onChange={handleTakeHomeChange}
                onBlur={handleTakeHomeBlur}
                placeholder="0"
                className="w-24 text-right text-sm font-semibold tabular-nums text-foreground bg-transparent border-b border-amber-400/60 outline-none focus:border-amber-500 transition-colors py-0.5"
              />
              <Pencil className="w-3 h-3 text-amber-500 flex-shrink-0" />
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
        </div>

        {hasPlaid && (
          <Button
            variant="outline"
            size="sm"
            className="mt-3 w-full border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950/30"
            onClick={() => setAnalyzerOpen(true)}
          >
            <Sparkles className="w-4 h-4 mr-1.5" />
            Analyze my spending with AI
          </Button>
        )}
      </div>

      <SpendingAnalyzer
        open={analyzerOpen}
        onOpenChange={setAnalyzerOpen}
        categories={categories}
        onApply={onUpdateCategories}
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
    </div>
  );
}
