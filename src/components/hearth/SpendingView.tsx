import { useState } from 'react';
import { BudgetCategory, FixedExpense, Transaction, INCOME_CATEGORY, DEPOSIT_CATEGORY, TRANSFER_CATEGORY, CC_PAYMENT_CATEGORY } from '@/types/budget';

import { ProgressBar } from './ProgressBar';
import { ChevronRight, ArrowLeftRight } from 'lucide-react';

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}

function CategoryCard({
  category, spent, transferAdj, onSelect, onMoveFunds, delay,
}: {
  category: BudgetCategory; spent: number; transferAdj: number; onSelect: () => void; onMoveFunds: () => void; delay: number;
}) {
  const adjustedBudget = category.budgeted + transferAdj;
  const remaining = adjustedBudget - spent;
  return (
    <div
      className="w-full bg-card rounded-lg p-4 shadow-sm text-left active:scale-[0.98] transition-transform animate-fade-up flex items-center gap-3"
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}
    >
      <button onClick={onSelect} className="flex-1 min-w-0 text-left">
        <div className="flex justify-between items-baseline mb-1">
          <span className="font-medium text-sm text-foreground truncate">{category.name}</span>
          <span className={`text-xs font-medium tabular-nums ${remaining < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
            {remaining < 0 ? `-${formatCurrency(Math.abs(remaining))} over` : `${formatCurrency(remaining)} left`}
          </span>
        </div>
        <ProgressBar value={spent} max={adjustedBudget} className="mb-1.5" />
        <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
          <span>{formatCurrency(spent)} of {formatCurrency(adjustedBudget)}</span>
        </div>
      </button>
      <button onClick={onMoveFunds} className="p-1.5 text-muted-foreground/40 hover:text-accent active:scale-90 transition-all shrink-0" title="Move funds">
        <ArrowLeftRight size={14} />
      </button>
      <button onClick={onSelect} className="shrink-0">
        <ChevronRight size={16} className="text-muted-foreground/50" />
      </button>
    </div>
  );
}

function FixedExpenseCard({ expense, spent, transferAdj, onSelect, onMoveFunds, delay }: { expense: FixedExpense; spent: number; transferAdj: number; onSelect: () => void; onMoveFunds: () => void; delay: number }) {
  const adjustedBudget = expense.amount + transferAdj;
  const remaining = adjustedBudget - spent;
  return (
    <div
      className="w-full bg-card rounded-lg p-4 shadow-sm text-left active:scale-[0.98] transition-transform animate-fade-up flex items-center gap-3"
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}
    >
      <button onClick={onSelect} className="flex-1 min-w-0 text-left">
        <div className="flex justify-between items-baseline mb-1">
          <span className="font-medium text-sm text-foreground truncate">{expense.name}</span>
          <span className={`text-xs font-medium tabular-nums ${remaining < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
            {remaining < 0 ? `-${formatCurrency(Math.abs(remaining))} over` : `${formatCurrency(remaining)} left`}
          </span>
        </div>
        <ProgressBar value={spent} max={adjustedBudget} className="mb-1.5" />
        <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
          <span>{formatCurrency(spent)} of {formatCurrency(adjustedBudget)}</span>
        </div>
      </button>
      <button onClick={onMoveFunds} className="p-1.5 text-muted-foreground/40 hover:text-accent active:scale-90 transition-all shrink-0" title="Move funds">
        <ArrowLeftRight size={14} />
      </button>
      <button onClick={onSelect} className="shrink-0">
        <ChevronRight size={16} className="text-muted-foreground/50" />
      </button>
    </div>
  );
}

function SectionLabel({ label, delay }: { label: string; delay: number }) {
  return (
    <h3
      className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mt-5 mb-2 animate-fade-up"
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}
    >
      {label}
    </h3>
  );
}

function SummaryCard({ label, budgeted, spent, delay }: { label: string; budgeted: number; spent?: number; delay: number }) {
  return (
    <div
      className="bg-card rounded-lg p-4 shadow-sm animate-fade-up"
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}
    >
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
      <p className="text-xl font-display font-semibold text-foreground">{formatCurrency(budgeted)}</p>
      {spent !== undefined && (
        <>
          <div className="flex justify-between text-xs text-muted-foreground mt-2 mb-1">
            <span>{formatCurrency(spent)} spent</span>
            {spent > budgeted ? (
              <span className="text-destructive font-medium">-{formatCurrency(spent - budgeted)} over</span>
            ) : (
              <span>{formatCurrency(budgeted - spent)} left</span>
            )}
          </div>
          <ProgressBar value={spent} max={budgeted} />
        </>
      )}
    </div>
  );
}

interface SpendingViewProps {
  categories: BudgetCategory[];
  fixedExpenses: FixedExpense[];
  transactions: Transaction[];
  spentByCategory: Record<string, number>;
  transferAdjustments: Record<string, number>;
  onSelectCategory: (id: string) => void;
  onSelectFixedExpense: (id: string) => void;
  onMoveFunds: (fromCategoryId: string) => void;
  onMoveFundsFixed: (fromFixedId: string) => void;
  monthLabel: string;
  totalBudget: number;
  variableBudget: number;
  variableSpent: number;
  fixedTotal: number;
  fixedSpent: number;
}

export function SpendingView({
  categories, fixedExpenses, transactions, spentByCategory, transferAdjustments, onSelectCategory, onSelectFixedExpense, onMoveFunds, onMoveFundsFixed, monthLabel,
  totalBudget, variableBudget, variableSpent, fixedTotal, fixedSpent,
}: SpendingViewProps) {
  const [mode, setMode] = useState<'variable' | 'fixed'>('variable');

  const totalSpent = variableSpent + fixedSpent;

  const shared = categories.filter(c => c.group === 'shared');
  const joe = categories.filter(c => c.group === 'joe');
  const katie = categories.filter(c => c.group === 'katie');

  const bills = fixedExpenses.filter(e => e.group === 'bills');
  const savings = fixedExpenses.filter(e => e.group === 'savings');
  const tithe = fixedExpenses.filter(e => e.group === 'tithe');

  // Build spent map for fixed expenses
  const fixedSpentMap: Record<string, number> = {};
  transactions.filter(t =>
    t.transactionType === 'expense' &&
    t.categoryId !== INCOME_CATEGORY &&
    t.categoryId !== DEPOSIT_CATEGORY &&
    t.categoryId !== TRANSFER_CATEGORY &&
    t.categoryId !== CC_PAYMENT_CATEGORY
  ).forEach(t => {
    if (fixedExpenses.some(e => e.id === t.categoryId)) {
      fixedSpentMap[t.categoryId] = (fixedSpentMap[t.categoryId] || 0) + t.amount;
    }
  });

  let delay = 0;

  return (
    <div className="max-w-lg mx-auto">
      <div className="px-6 pt-12 safe-top">
        <h1 className="font-display text-xl font-bold text-foreground">{monthLabel} Budget</h1>
      </div>

      {/* Total Monthly Budget */}
      <div className="px-6 mt-4 mb-4 animate-fade-up" style={{ animationDelay: '50ms', animationFillMode: 'both' }}>
        <div className="bg-primary rounded-xl p-5 shadow-lg">
          <p className="text-xs font-medium text-primary-foreground/70 uppercase tracking-wide">Total Monthly Budget</p>
          <p className="text-3xl font-display font-bold text-primary-foreground mt-1">{formatCurrency(totalBudget)}</p>
          <div className="mt-4">
            <div className="flex justify-between text-xs text-primary-foreground/70 mb-1.5">
              <span>{formatCurrency(totalSpent)} committed</span>
              {totalSpent > totalBudget ? (
                <span className="text-destructive-foreground font-semibold">-{formatCurrency(totalSpent - totalBudget)} over budget</span>
              ) : (
                <span>{formatCurrency(totalBudget - totalSpent)} remaining</span>
              )}
            </div>
            <div className="h-2 rounded-full bg-primary-foreground/20 overflow-hidden">
              <div
                className="h-full rounded-full bg-accent transition-all duration-500"
                style={{ width: `${Math.min((totalSpent / totalBudget) * 100, 100)}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="px-6 grid grid-cols-2 gap-3 mb-4">
        <SummaryCard label="Variable" budgeted={variableBudget} spent={variableSpent} delay={100} />
        <SummaryCard label="Fixed Bills" budgeted={fixedTotal} spent={fixedSpent} delay={150} />
      </div>

      {/* Segmented Toggle */}
      <div className="px-6 mb-4">
        <div className="flex bg-card rounded-lg p-1 shadow-sm">
          {(['variable', 'fixed'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 py-2 rounded-md text-xs font-semibold transition-colors active:scale-[0.98] ${
                mode === m ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground'
              }`}
            >
              {m === 'variable' ? 'Variable' : 'Fixed'}
            </button>
          ))}
        </div>
      </div>

      {mode === 'variable' ? (
        <div className="px-6 pb-6 space-y-1">
          <SectionLabel label="Shared" delay={delay++} />
          {shared.map(c => (
            <CategoryCard key={c.id} category={c} spent={spentByCategory[c.id] || 0} transferAdj={transferAdjustments[c.id] || 0}
              onSelect={() => onSelectCategory(c.id)} onMoveFunds={() => onMoveFunds(c.id)} delay={(delay++) * 40} />
          ))}
          <SectionLabel label="Joe" delay={(delay++) * 40} />
          {joe.map(c => (
            <CategoryCard key={c.id} category={c} spent={spentByCategory[c.id] || 0} transferAdj={transferAdjustments[c.id] || 0}
              onSelect={() => onSelectCategory(c.id)} onMoveFunds={() => onMoveFunds(c.id)} delay={(delay++) * 40} />
          ))}
          <SectionLabel label="Katie" delay={(delay++) * 40} />
          {katie.map(c => (
            <CategoryCard key={c.id} category={c} spent={spentByCategory[c.id] || 0} transferAdj={transferAdjustments[c.id] || 0}
              onSelect={() => onSelectCategory(c.id)} onMoveFunds={() => onMoveFunds(c.id)} delay={(delay++) * 40} />
          ))}
        </div>
      ) : (
        <div className="px-6 pb-6 space-y-1">
          <SectionLabel label="Fixed Bills" delay={0} />
          {bills.map((e, i) => (
            <FixedExpenseCard key={e.id} expense={e} spent={fixedSpentMap[e.id] || 0} transferAdj={transferAdjustments[e.id] || 0}
              onSelect={() => onSelectFixedExpense(e.id)} onMoveFunds={() => onMoveFundsFixed(e.id)} delay={(i + 1) * 40} />
          ))}
          <SectionLabel label="Savings Buckets" delay={(bills.length + 1) * 40} />
          {savings.map((e, i) => (
            <FixedExpenseCard key={e.id} expense={e} spent={fixedSpentMap[e.id] || 0} transferAdj={transferAdjustments[e.id] || 0}
              onSelect={() => onSelectFixedExpense(e.id)} onMoveFunds={() => onMoveFundsFixed(e.id)} delay={(bills.length + i + 2) * 40} />
          ))}
          <SectionLabel label="Tithe / Giving" delay={(bills.length + savings.length + 2) * 40} />
          {tithe.map((e, i) => (
            <FixedExpenseCard key={e.id} expense={e} spent={fixedSpentMap[e.id] || 0} transferAdj={transferAdjustments[e.id] || 0}
              onSelect={() => onSelectFixedExpense(e.id)} onMoveFunds={() => onMoveFundsFixed(e.id)} delay={(bills.length + savings.length + i + 3) * 40} />
          ))}
        </div>
      )}
    </div>
  );
}
