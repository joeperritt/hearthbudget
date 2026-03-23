import { ProgressBar } from './ProgressBar';
import { Plus, Inbox } from 'lucide-react';

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function formatCurrency2(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
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
  totalBudget: number;
  variableBudget: number;
  variableSpent: number;
  fixedTotal: number;
  fixedSpent: number;
  savingsTotal: number;
  savingsSpent: number;
  titheTotal: number;
  titheSpent: number;
  onAddTransaction: () => void;
  joeAmexTotal: number;
  katieAmexTotal: number;
  checkingBalance: number;
}

export function Dashboard({
  monthLabel,
  totalBudget, variableBudget, variableSpent,
  fixedTotal, fixedSpent, savingsTotal, savingsSpent, titheTotal, titheSpent, onAddTransaction,
  joeAmexTotal, katieAmexTotal, checkingBalance,
}: DashboardProps) {
  const totalSpent = variableSpent + fixedSpent + savingsSpent + titheSpent;
  const combinedCredit = joeAmexTotal + katieAmexTotal;

  return (
    <div className="max-w-lg mx-auto">
      <div className="px-6 pt-12 pb-2 safe-top">
        <h1 className="font-display text-2xl font-bold text-foreground">{monthLabel} Budget</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Your household budget</p>
      </div>

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
        <SummaryCard label="Fixed Bills" budgeted={fixedTotal} spent={fixedSpent} delay={150} />
      </div>

      {/* Account Snapshot */}
      <div className="px-6 mt-6 animate-fade-up" style={{ animationDelay: '300ms', animationFillMode: 'both' }}>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Account Snapshot</h3>
        <div className="bg-card rounded-lg shadow-sm divide-y divide-border overflow-hidden">
          <div className="flex justify-between items-center px-4 py-3">
            <span className="text-sm text-foreground">Joe's Amex</span>
            <span className="text-sm font-medium tabular-nums text-foreground">{formatCurrency2(joeAmexTotal)}</span>
          </div>
          <div className="flex justify-between items-center px-4 py-3">
            <span className="text-sm text-foreground">Katie's Amex</span>
            <span className="text-sm font-medium tabular-nums text-foreground">{formatCurrency2(katieAmexTotal)}</span>
          </div>
          <div className="flex justify-between items-center px-4 py-3 bg-accent/5">
            <span className="text-sm font-semibold text-foreground">Combined Credit Due</span>
            <span className="text-sm font-semibold tabular-nums text-foreground">{formatCurrency2(combinedCredit)}</span>
          </div>
          <div className="flex justify-between items-center px-4 py-3">
            <span className="text-sm text-foreground">Checking Balance</span>
            <span className="text-sm font-medium tabular-nums text-foreground">{formatCurrency2(checkingBalance)}</span>
          </div>
        </div>
      </div>

      {/* Unassigned Transactions */}
      <div className="px-6 mt-6 mb-6 animate-fade-up" style={{ animationDelay: '350ms', animationFillMode: 'both' }}>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Unassigned Transactions</h3>
        <div className="bg-card rounded-lg shadow-sm px-4 py-6 flex flex-col items-center justify-center">
          <Inbox size={24} className="text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground">No unassigned transactions</p>
          <p className="text-[11px] text-muted-foreground/60 mt-0.5">Imported transactions will appear here</p>
        </div>
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
