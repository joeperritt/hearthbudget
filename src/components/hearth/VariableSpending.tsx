import { BudgetCategory } from '@/types/budget';
import { MonthHeader } from './MonthHeader';
import { ProgressBar } from './ProgressBar';
import { ChevronRight } from 'lucide-react';

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function CategoryCard({
  category, spent, onSelect, delay,
}: {
  category: BudgetCategory; spent: number; onSelect: () => void; delay: number;
}) {
  const remaining = category.budgeted - spent;

  return (
    <button
      onClick={onSelect}
      className="w-full bg-card rounded-lg p-4 shadow-sm text-left active:scale-[0.98] transition-transform animate-fade-up flex items-center gap-3"
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}
    >
      <div className="flex-1 min-w-0">
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
      </div>
      <ChevronRight size={16} className="text-muted-foreground/50 shrink-0" />
    </button>
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

interface VariableSpendingProps {
  categories: BudgetCategory[];
  spentByCategory: Record<string, number>;
  onSelectCategory: (id: string) => void;
  monthLabel: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}

export function VariableSpending({
  categories, spentByCategory, onSelectCategory, monthLabel, onPrevMonth, onNextMonth,
}: VariableSpendingProps) {
  const shared = categories.filter(c => c.group === 'shared');
  const joe = categories.filter(c => c.group === 'joe');
  const katie = categories.filter(c => c.group === 'katie');

  let delay = 0;

  return (
    <div className="max-w-lg mx-auto">
      <div className="px-6 pt-12 safe-top">
        <h1 className="font-display text-xl font-bold text-foreground">Variable Spending</h1>
      </div>
      <MonthHeader monthLabel={monthLabel} onPrev={onPrevMonth} onNext={onNextMonth} />

      <div className="px-6 pb-6 space-y-1">
        <SectionLabel label="Shared" delay={delay++} />
        {shared.map(c => (
          <CategoryCard
            key={c.id}
            category={c}
            spent={spentByCategory[c.id] || 0}
            onSelect={() => onSelectCategory(c.id)}
            delay={(delay++) * 40}
          />
        ))}

        <SectionLabel label="Joe" delay={(delay++) * 40} />
        {joe.map(c => (
          <CategoryCard
            key={c.id}
            category={c}
            spent={spentByCategory[c.id] || 0}
            onSelect={() => onSelectCategory(c.id)}
            delay={(delay++) * 40}
          />
        ))}

        <SectionLabel label="Katie" delay={(delay++) * 40} />
        {katie.map(c => (
          <CategoryCard
            key={c.id}
            category={c}
            spent={spentByCategory[c.id] || 0}
            onSelect={() => onSelectCategory(c.id)}
            delay={(delay++) * 40}
          />
        ))}
      </div>
    </div>
  );
}
