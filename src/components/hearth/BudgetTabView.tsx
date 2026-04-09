import { useState } from 'react';
import { BudgetCategory, FixedExpense, Transaction } from '@/types/budget';
import { ArrowRight } from 'lucide-react';
import { format } from 'date-fns';
import { SettingsView } from './SettingsView';

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
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
  onOpenPlanning: () => void;
}

export function BudgetTabView({
  categories, fixedExpenses, currentMonth,
  onUpdateCategories, onUpdateFixedExpenses,
  unassignedCount, spentByCategory, transferAdjustments, monthTransactions,
  planningData, onUpdatePlanningData, onOpenPlanning,
}: BudgetTabViewProps) {
  // Take-home income from planning data
  const primaryNet = parseFloat(planningData.netIncome || '') || 0;
  const partnerNet = parseFloat(planningData.katieNetIncome || '') || 0;
  const totalTakeHome = primaryNet + partnerNet;

  // Budget totals
  const variableTotal = categories.filter(c => c.group !== 'giving' && c.group !== 'savings').reduce((s, c) => s + c.budgeted, 0);
  const givingVarTotal = categories.filter(c => c.group === 'giving').reduce((s, c) => s + c.budgeted, 0);
  const savingsVarTotal = categories.filter(c => c.group === 'savings').reduce((s, c) => s + c.budgeted, 0);
  const fixedTotal = fixedExpenses.reduce((s, e) => s + e.amount, 0);
  const budgetTotal = variableTotal + givingVarTotal + savingsVarTotal + fixedTotal;

  const surplus = totalTakeHome - budgetTotal;
  const isSurplus = surplus >= 0;

  const [takeHomeInput, setTakeHomeInput] = useState(() => {
    const total = (parseFloat(planningData.netIncome || '') || 0) + (parseFloat(planningData.katieNetIncome || '') || 0);
    return total > 0 ? String(total) : '';
  });

  const handleTakeHomeBlur = () => {
    const val = parseFloat(takeHomeInput) || 0;
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
            <button
              onClick={onOpenPlanning}
              className="flex items-center gap-1 text-sm text-muted-foreground active:scale-95 transition-transform"
            >
              Avg. Monthly Take-Home <ArrowRight size={12} className="text-accent" />
            </button>
            <div className="flex items-center gap-0.5">
              <span className="text-sm text-muted-foreground">$</span>
              <input
                type="number"
                value={takeHomeInput}
                onChange={e => setTakeHomeInput(e.target.value)}
                onBlur={handleTakeHomeBlur}
                placeholder="0"
                className="w-24 text-right text-sm font-semibold tabular-nums text-foreground bg-transparent border-none outline-none"
              />
            </div>
          </div>

      {/* Budget Total & Surplus/Deficit */}
      <div className="px-6 mt-3">
        <div className="bg-card rounded-xl shadow-sm p-4 space-y-2">
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
