import { FixedExpense } from '@/types/budget';
import { MonthHeader } from './MonthHeader';

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function ExpenseRow({ expense, delay }: { expense: FixedExpense; delay: number }) {
  return (
    <div
      className="flex justify-between items-center py-3 px-1 animate-fade-up"
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}
    >
      <span className="text-sm text-foreground">{expense.name}</span>
      <span className="text-sm font-medium tabular-nums text-foreground">{formatCurrency(expense.amount)}</span>
    </div>
  );
}

function SectionBlock({ title, expenses, startDelay }: { title: string; expenses: FixedExpense[]; startDelay: number }) {
  const total = expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="mb-6">
      <div className="flex justify-between items-baseline mb-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</h3>
        <span className="text-xs font-medium text-accent tabular-nums">{formatCurrency(total)}</span>
      </div>
      <div className="bg-card rounded-lg px-4 shadow-sm divide-y divide-border">
        {expenses.map((e, i) => (
          <ExpenseRow key={e.id} expense={e} delay={startDelay + i * 30} />
        ))}
      </div>
    </div>
  );
}

interface FixedExpensesViewProps {
  expenses: FixedExpense[];
  monthLabel: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}

export function FixedExpensesView({ expenses, monthLabel, onPrevMonth, onNextMonth }: FixedExpensesViewProps) {
  const bills = expenses.filter(e => e.group === 'bills');
  const savings = expenses.filter(e => e.group === 'savings');
  const tithe = expenses.filter(e => e.group === 'tithe');

  return (
    <div className="max-w-lg mx-auto">
      <div className="px-6 pt-12 safe-top">
        <h1 className="font-display text-xl font-bold text-foreground">Fixed Expenses</h1>
      </div>
      <MonthHeader monthLabel={monthLabel} onPrev={onPrevMonth} onNext={onNextMonth} />

      <div className="px-6 pb-6">
        <SectionBlock title="Fixed Bills" expenses={bills} startDelay={50} />
        <SectionBlock title="Savings Buckets" expenses={savings} startDelay={50 + bills.length * 30} />
        <SectionBlock title="Tithe / Giving" expenses={tithe} startDelay={50 + (bills.length + savings.length) * 30} />
      </div>
    </div>
  );
}
