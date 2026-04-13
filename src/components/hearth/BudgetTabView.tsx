import { useState } from 'react';
import { BudgetCategory, FixedExpense, Transaction } from '@/types/budget';
import { format } from 'date-fns';
import { SettingsView } from './SettingsView';
import { Info } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

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
  unassignedCount: number;
  spentByCategory: Record<string, number>;
  transferAdjustments: Record<string, number>;
  monthTransactions: Transaction[];
  planningData: Record<string, string>;
  onUpdatePlanningData: (data: Record<string, string>) => void;
}

export function BudgetTabView({
  categories, fixedExpenses, currentMonth,
  onUpdateCategories, onUpdateFixedExpenses,
  unassignedCount, spentByCategory, transferAdjustments, monthTransactions,
  planningData, onUpdatePlanningData,
}: BudgetTabViewProps) {
  // Take-home income from planning data
  const primaryNet = parseFloat(planningData.netIncome || '') || 0;
  const partnerNet = parseFloat(planningData.katieNetIncome || '') || 0;
  const totalTakeHome = primaryNet + partnerNet;

  // Budget totals — sum ALL categories and fixed expenses
  const allCategoriesTotal = categories.reduce((s, c) => s + c.budgeted, 0);
  const fixedTotal = fixedExpenses.reduce((s, e) => s + e.amount, 0);
  const budgetTotal = allCategoriesTotal + fixedTotal;

  const surplus = totalTakeHome - budgetTotal;
  const isSurplus = surplus >= 0;

  const [takeHomeInput, setTakeHomeInput] = useState(() => {
    const total = (parseFloat(planningData.netIncome || '') || 0) + (parseFloat(planningData.katieNetIncome || '') || 0);
    return total > 0 ? formatWithCommas(String(total)) : '';
  });

  const handleTakeHomeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9.,]/g, '');
    setTakeHomeInput(formatWithCommas(raw));
  };

  const handleTakeHomeBlur = () => {
    const val = parseNumeric(takeHomeInput);
    onUpdatePlanningData({ ...planningData, netIncome: String(val) });
  };

  return (
    <div className="max-w-lg mx-auto pb-8">
      <div className="px-6 pt-12 safe-top">
        <h1 className="font-display text-xl font-bold text-foreground">Budget</h1>
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
            <div className="flex items-center gap-0.5">
              <span className="text-sm text-muted-foreground">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={takeHomeInput}
                onChange={handleTakeHomeChange}
                onBlur={handleTakeHomeBlur}
                placeholder="0"
                className="w-24 text-right text-sm font-semibold tabular-nums text-foreground bg-transparent border-none outline-none"
              />
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
      </div>

      {/* Inline Budget Planning (SettingsView in embedded mode) */}
      <div className="mt-4">
        <SettingsView
          categories={categories}
          fixedExpenses={fixedExpenses}
          currentMonth={currentMonth}
          onUpdateCategories={onUpdateCategories}
          onUpdateFixedExpenses={onUpdateFixedExpenses}
          onBack={() => {}}
          unassignedCount={unassignedCount}
          spentByCategory={spentByCategory}
          transferAdjustments={transferAdjustments}
          monthTransactions={monthTransactions}
          embedded
        />
      </div>
    </div>
  );
}