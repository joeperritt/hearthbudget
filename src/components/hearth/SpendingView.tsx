import { useState } from 'react';
import { BudgetCategory, FixedExpense, Transaction } from '@/types/budget';
import { MonthHeader } from './MonthHeader';
import { ProgressBar } from './ProgressBar';
import { ChevronRight, ArrowLeftRight } from 'lucide-react';

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function formatCurrency2(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}

function CategoryCard({
  category, spent, onSelect, onMoveFunds, delay,
}: {
  category: BudgetCategory; spent: number; onSelect: () => void; onMoveFunds: () => void; delay: number;
}) {
  const remaining = category.budgeted - spent;
  return (
    <div
      className="w-full bg-card rounded-lg p-4 shadow-sm text-left active:scale-[0.98] transition-transform animate-fade-up flex items-center gap-3"
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}
    >
      <button onClick={onSelect} className="flex-1 min-w-0 text-left">
        <div className="flex justify-between items-baseline mb-1">
          <span className="font-medium text-sm text-foreground truncate">{category.name}</span>
          <span className={`text-xs font-medium tabular-nums ${remaining < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
            {formatCurrency(remaining)} left
          </span>
        </div>
        <ProgressBar value={spent} max={category.budgeted} className="mb-1.5" />
        <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
          <span>{formatCurrency(spent)} of {formatCurrency(category.budgeted)}</span>
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

function FixedExpenseCard({ expense, spent, onSelect, onMoveFunds, delay }: { expense: FixedExpense; spent: number; onSelect: () => void; onMoveFunds: () => void; delay: number }) {
  const remaining = expense.amount - spent;
  return (
    <div
      className="w-full bg-card rounded-lg p-4 shadow-sm text-left active:scale-[0.98] transition-transform animate-fade-up flex items-center gap-3"
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}
    >
      <button onClick={onSelect} className="flex-1 min-w-0 text-left">
        <div className="flex justify-between items-baseline mb-1">
          <span className="font-medium text-sm text-foreground truncate">{expense.name}</span>
          <span className={`text-xs font-medium tabular-nums ${remaining < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
            {formatCurrency2(remaining)} left
          </span>
        </div>
        <ProgressBar value={spent} max={expense.amount} className="mb-1.5" />
        <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
          <span>{formatCurrency2(spent)} of {formatCurrency2(expense.amount)}</span>
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

interface SpendingViewProps {
  categories: BudgetCategory[];
  fixedExpenses: FixedExpense[];
  transactions: Transaction[];
  spentByCategory: Record<string, number>;
  onSelectCategory: (id: string) => void;
  onSelectFixedExpense: (id: string) => void;
  onMoveFunds: (fromCategoryId: string) => void;
  onMoveFundsFixed: (fromFixedId: string) => void;
  monthLabel: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}

export function SpendingView({
  categories, fixedExpenses, transactions, spentByCategory, onSelectCategory, onSelectFixedExpense, onMoveFunds, onMoveFundsFixed, monthLabel, onPrevMonth, onNextMonth,
}: SpendingViewProps) {
  const [mode, setMode] = useState<'variable' | 'fixed'>('variable');

  const shared = categories.filter(c => c.group === 'shared');
  const joe = categories.filter(c => c.group === 'joe');
  const katie = categories.filter(c => c.group === 'katie');

  const bills = fixedExpenses.filter(e => e.group === 'bills');
  const savings = fixedExpenses.filter(e => e.group === 'savings');
  const tithe = fixedExpenses.filter(e => e.group === 'tithe');

  // Build spent map for fixed expenses
  const fixedSpentMap: Record<string, number> = {};
  transactions.forEach(t => {
    if (fixedExpenses.some(e => e.id === t.categoryId)) {
      fixedSpentMap[t.categoryId] = (fixedSpentMap[t.categoryId] || 0) + t.amount;
    }
  });

  let delay = 0;

  return (
    <div className="max-w-lg mx-auto">
      <div className="px-6 pt-12 safe-top">
        <h1 className="font-display text-xl font-bold text-foreground">Spending</h1>
      </div>
      <MonthHeader monthLabel={monthLabel} onPrev={onPrevMonth} onNext={onNextMonth} />

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
            <CategoryCard key={c.id} category={c} spent={spentByCategory[c.id] || 0}
              onSelect={() => onSelectCategory(c.id)} onMoveFunds={() => onMoveFunds(c.id)} delay={(delay++) * 40} />
          ))}
          <SectionLabel label="Joe" delay={(delay++) * 40} />
          {joe.map(c => (
            <CategoryCard key={c.id} category={c} spent={spentByCategory[c.id] || 0}
              onSelect={() => onSelectCategory(c.id)} onMoveFunds={() => onMoveFunds(c.id)} delay={(delay++) * 40} />
          ))}
          <SectionLabel label="Katie" delay={(delay++) * 40} />
          {katie.map(c => (
            <CategoryCard key={c.id} category={c} spent={spentByCategory[c.id] || 0}
              onSelect={() => onSelectCategory(c.id)} onMoveFunds={() => onMoveFunds(c.id)} delay={(delay++) * 40} />
          ))}
        </div>
      ) : (
        <div className="px-6 pb-6 space-y-1">
          <SectionLabel label="Fixed Bills" delay={0} />
          {bills.map((e, i) => (
            <FixedExpenseCard key={e.id} expense={e} spent={fixedSpentMap[e.id] || 0}
              onSelect={() => onSelectFixedExpense(e.id)} onMoveFunds={() => onMoveFundsFixed(e.id)} delay={(i + 1) * 40} />
          ))}
          <SectionLabel label="Savings Buckets" delay={(bills.length + 1) * 40} />
          {savings.map((e, i) => (
            <FixedExpenseCard key={e.id} expense={e} spent={fixedSpentMap[e.id] || 0}
              onSelect={() => onSelectFixedExpense(e.id)} onMoveFunds={() => onMoveFundsFixed(e.id)} delay={(bills.length + i + 2) * 40} />
          ))}
          <SectionLabel label="Tithe / Giving" delay={(bills.length + savings.length + 2) * 40} />
          {tithe.map((e, i) => (
            <FixedExpenseCard key={e.id} expense={e} spent={fixedSpentMap[e.id] || 0}
              onSelect={() => onSelectFixedExpense(e.id)} onMoveFunds={() => onMoveFundsFixed(e.id)} delay={(bills.length + savings.length + i + 3) * 40} />
          ))}
        </div>
      )}
    </div>
  );
}
