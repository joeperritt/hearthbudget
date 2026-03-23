import { useState } from 'react';
import { MonthHeader } from './MonthHeader';
import { ProgressBar } from './ProgressBar';
import { Plus, Pencil, Check } from 'lucide-react';

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
  onPrevMonth: () => void;
  onNextMonth: () => void;
  totalBudget: number;
  variableBudget: number;
  variableSpent: number;
  fixedTotal: number;
  savingsTotal: number;
  titheTotal: number;
  onAddTransaction: () => void;
  joeAmexTotal: number;
  katieAmexTotal: number;
  checkingBalance: number;
  onCheckingBalanceChange: (val: number) => void;
}

export function Dashboard({
  monthLabel, onPrevMonth, onNextMonth,
  totalBudget, variableBudget, variableSpent,
  fixedTotal, savingsTotal, titheTotal, onAddTransaction,
  joeAmexTotal, katieAmexTotal, checkingBalance, onCheckingBalanceChange,
}: DashboardProps) {
  const totalSpent = variableSpent + fixedTotal + savingsTotal + titheTotal;
  const combinedCredit = joeAmexTotal + katieAmexTotal;
  const [editingChecking, setEditingChecking] = useState(false);
  const [checkingValue, setCheckingValue] = useState(String(checkingBalance));

  const saveChecking = () => {
    const v = parseFloat(checkingValue) || 0;
    onCheckingBalanceChange(v);
    setEditingChecking(false);
  };

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
            {editingChecking ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">$</span>
                <input
                  type="number"
                  step="0.01"
                  value={checkingValue}
                  onChange={e => setCheckingValue(e.target.value)}
                  className="w-24 text-right px-2 py-1 rounded bg-background border border-border text-sm tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && saveChecking()}
                />
                <button onClick={saveChecking} className="p-1 text-accent active:scale-95 transition-transform">
                  <Check size={14} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setEditingChecking(true); setCheckingValue(String(checkingBalance)); }}
                className="flex items-center gap-1.5 text-sm font-medium tabular-nums text-foreground active:scale-95 transition-transform"
              >
                {formatCurrency2(checkingBalance)}
                <Pencil size={12} className="text-muted-foreground/40" />
              </button>
            )}
          </div>
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
