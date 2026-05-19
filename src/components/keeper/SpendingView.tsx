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
      className="w-full bg-card rounded-lg p-4 shadow-sm text-left active:scale-[0.98] transition-transform animate-fade-up flex items-center gap-3 lg:border lg:border-border/60 lg:shadow-sm"
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}
    >
      <button onClick={onSelect} className="flex-1 min-w-0 text-left">
        <div className="flex justify-between items-baseline mb-1 lg:mb-2">
          <span className="font-medium lg:font-semibold text-sm lg:text-base text-foreground truncate">{category.name}</span>
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
      className="w-full bg-card rounded-lg p-4 shadow-sm text-left active:scale-[0.98] transition-transform animate-fade-up flex items-center gap-3 lg:border lg:border-border/60 lg:shadow-sm"
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}
    >
      <button onClick={onSelect} className="flex-1 min-w-0 text-left">
        <div className="flex justify-between items-baseline mb-1 lg:mb-2">
          <span className="font-medium lg:font-semibold text-sm lg:text-base text-foreground truncate">{expense.name}</span>
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
  /** Opens MoveFunds with no preselected source (global transfer entry point). */
  onOpenTransfer?: () => void;
  monthLabel: string;
  totalBudget: number;
  variableBudget: number;
  variableSpent: number;
  fixedTotal: number;
  fixedSpent: number;
  onEditBudget?: () => void;
  /** Display labels for the two household members so we don't hardcode "Joe" / "Katie". */
  householdMembers?: { primaryName: string; partnerName: string | null };
}

export function SpendingView({
  categories, fixedExpenses, transactions, spentByCategory, transferAdjustments, onSelectCategory, onSelectFixedExpense, onMoveFunds, onMoveFundsFixed, onOpenTransfer, monthLabel,
  totalBudget, variableBudget, variableSpent, fixedTotal, fixedSpent, onEditBudget, householdMembers,
}: SpendingViewProps) {
  const [mode, setMode] = useState<'variable' | 'fixed'>('variable');

  const totalSpent = variableSpent + fixedSpent;

  const shared = categories.filter(c => c.group === 'shared');
  const joe = categories.filter(c => c.group === 'joe');
  const katie = categories.filter(c => c.group === 'katie');

  const bills = fixedExpenses.filter(e => e.group === 'bills');
  const savings = fixedExpenses.filter(e => e.group === 'savings');
  const tithe = fixedExpenses.filter(e => e.group === 'tithe');

  // Use the same spentByCategory map for fixed expenses (already includes deposit offsets)
  const fixedSpentMap = spentByCategory;

  // The DB still uses 'joe' / 'katie' as group keys for historical reasons; the
  // labels here are just display strings that follow the household's actual members.
  const primaryLabel = householdMembers?.primaryName?.trim() || 'Joe';
  const partnerLabel = householdMembers?.partnerName?.trim() || 'Katie';

  let delay = 0;

  const renderVariable = (keyPrefix: string) => (
    <div className="space-y-1">
      {([
        { label: 'Shared', items: shared },
        { label: primaryLabel, items: joe },
        { label: partnerLabel, items: katie },
      ] as const).map(({ label, items }) => items.length > 0 && (
        <div key={`${keyPrefix}-${label}`}>
          <SectionLabel label={label} delay={(delay++) * 40} />
          <div className="space-y-1">
            {items.map(c => (
              <CategoryCard key={c.id} category={c} spent={spentByCategory[c.id] || 0} transferAdj={transferAdjustments[c.id] || 0}
                onSelect={() => onSelectCategory(c.id)} onMoveFunds={() => onMoveFunds(c.id)} delay={(delay++) * 40} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  const renderFixed = (keyPrefix: string) => (
    <div className="space-y-1">
      {([
        { label: 'Fixed', items: bills },
        { label: 'Savings Buckets', items: savings },
        { label: 'Tithe / Giving', items: tithe },
      ] as const).map(({ label, items }) => items.length > 0 && (
        <div key={`${keyPrefix}-${label}`}>
          <SectionLabel label={label} delay={(delay++) * 40} />
          <div className="space-y-1">
            {items.map((e, i) => (
              <FixedExpenseCard key={e.id} expense={e} spent={fixedSpentMap[e.id] || 0} transferAdj={transferAdjustments[e.id] || 0}
                onSelect={() => onSelectFixedExpense(e.id)} onMoveFunds={() => onMoveFundsFixed(e.id)} delay={(i + 1) * 40} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="max-w-lg mx-auto lg:max-w-6xl">
      <div className="px-6 pt-12 safe-top">
        <h1 className="font-display text-2xl lg:text-3xl font-bold tracking-tight text-foreground">{monthLabel} Budget</h1>
      </div>

      {/* Total Budget summary — variable + fixed combined for the whole month picture */}
      <div className="px-6 mt-4 mb-4">
        <div className="animate-fade-up" style={{ animationDelay: '50ms', animationFillMode: 'both' }}>
          <div className="bg-primary rounded-xl p-5 shadow-lg">
            <p className="text-xs font-medium text-primary-foreground/70 uppercase tracking-wide">Total Budget</p>
            <p className="text-3xl font-display font-bold text-primary-foreground mt-1">{formatCurrency(totalBudget)}</p>
            <div className="mt-4">
              <div className="flex justify-between text-xs text-primary-foreground/70 mb-1.5">
                <span>{formatCurrency(totalSpent)} spent</span>
                {totalSpent > totalBudget ? (
                  <span className="text-destructive-foreground font-semibold">-{formatCurrency(totalSpent - totalBudget)} over</span>
                ) : (
                  <span>{formatCurrency(totalBudget - totalSpent)} remaining</span>
                )}
              </div>
              <div className="h-2 rounded-full bg-primary-foreground/20 overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-500"
                  style={{ width: `${totalBudget > 0 ? Math.min((totalSpent / totalBudget) * 100, 100) : 0}%` }}
                />
              </div>
              {(() => {
                const now = new Date();
                const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
                const daysLeft = Math.max(0, lastDay - now.getDate());
                return (
                  <p className="text-[11px] text-primary-foreground/60 mt-2.5">
                    {daysLeft} {daysLeft === 1 ? 'day' : 'days'} left in the month
                  </p>
                );
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* Edit budget link */}
      {onEditBudget && (
        <div className="px-6 mb-4">
          <button
            onClick={onEditBudget}
            className="w-full text-left bg-card rounded-lg p-3 shadow-sm flex items-center gap-3 active:scale-[0.99] transition-transform"
          >
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground leading-snug">
                Want to edit this month's budget or set up future months?{' '}
                <span className="text-accent font-semibold">Go to Budget.</span>
              </p>
            </div>
            <ChevronRight size={16} className="text-muted-foreground/60 shrink-0" />
          </button>
        </div>
      )}

      {/* Global "Transfer Between Buckets" entry point — saves the user from
          having to drill into a single bucket to start a move. */}
      {onOpenTransfer && (
        <div className="px-6 mb-4">
          <button
            onClick={onOpenTransfer}
            className="w-full bg-accent text-accent-foreground rounded-lg p-3 shadow-sm flex items-center justify-center gap-2 text-sm font-semibold active:scale-[0.99] transition-transform"
          >
            <ArrowLeftRight size={16} strokeWidth={2.5} />
            Transfer Between Buckets
          </button>
        </div>
      )}

      {/* Mobile: segmented toggle + single panel */}
      <div className="lg:hidden">
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
        <div className="px-6 pb-6">
          {mode === 'variable' ? renderVariable('m-var') : renderFixed('m-fix')}
        </div>
      </div>

      {/* Desktop: side-by-side */}
      <div className="hidden lg:grid lg:grid-cols-2 lg:gap-8 px-6 pb-10">
        <div>
          <h2 className="text-sm font-bold text-foreground uppercase tracking-wider mb-2">Variable</h2>
          {renderVariable('d-var')}
        </div>
        <div>
          <h2 className="text-sm font-bold text-foreground uppercase tracking-wider mb-2">Fixed</h2>
          {renderFixed('d-fix')}
        </div>
      </div>
    </div>
  );
}
