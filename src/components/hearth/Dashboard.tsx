import { MonthHeader } from './MonthHeader';
import { ProgressBar } from './ProgressBar';
import { Plus } from 'lucide-react';

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
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
            <span>{formatCurrency(Math.max(budgeted - spent, 0))} left</span>
          </div>
          <ProgressBar value={spent} max={budgeted} />
        </>
      )}
    </div>
  );
}

interface DashboardProps {
  monthLabel: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  totalBudget: number;
  variableBudget: number;
  variableSpent: number;
  fixedTotal: number;
  savingsTotal: number;
  titheTotal: number;
  onAddTransaction: () => void;
}

export function Dashboard({
  monthLabel, onPrevMonth, onNextMonth,
  totalBudget, variableBudget, variableSpent,
  fixedTotal, savingsTotal, titheTotal, onAddTransaction,
}: DashboardProps) {
  const totalSpent = variableSpent + fixedTotal + savingsTotal + titheTotal;

  return (
    <div className="max-w-lg mx-auto">
      <div className="px-6 pt-12 pb-2 safe-top">
        <h1 className="font-display text-2xl font-bold text-foreground">Hearth</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Your household budget</p>
      </div>

      <MonthHeader monthLabel={monthLabel} onPrev={onPrevMonth} onNext={onNextMonth} />

      <div className="px-6 mb-6 animate-fade-up" style={{ animationDelay: '50ms', animationFillMode: 'both' }}>
        <div className="bg-primary rounded-xl p-5 shadow-lg">
          <p className="text-xs font-medium text-primary-foreground/70 uppercase tracking-wide">Total Monthly Budget</p>
          <p className="text-3xl font-display font-bold text-primary-foreground mt-1">{formatCurrency(totalBudget)}</p>
          <div className="mt-4">
            <div className="flex justify-between text-xs text-primary-foreground/70 mb-1.5">
              <span>{formatCurrency(totalSpent)} committed</span>
              <span>{formatCurrency(Math.max(totalBudget - totalSpent, 0))} remaining</span>
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

      <div className="px-6 grid grid-cols-2 gap-3">
        <SummaryCard label="Variable" budgeted={variableBudget} spent={variableSpent} delay={100} />
        <SummaryCard label="Fixed Bills" budgeted={fixedTotal} delay={150} />
        <SummaryCard label="Savings" budgeted={savingsTotal} delay={200} />
        <SummaryCard label="Tithe/Giving" budgeted={titheTotal} delay={250} />
      </div>

      <button
        onClick={onAddTransaction}
        className="fixed bottom-24 right-6 w-14 h-14 rounded-full bg-accent text-accent-foreground shadow-lg flex items-center justify-center active:scale-95 transition-transform z-40"
      >
        <Plus size={24} strokeWidth={2.5} />
      </button>
    </div>
  );
}
