import { Transaction, BudgetCategory, FixedExpense, DEPOSIT_CATEGORY, INCOME_CATEGORY, TRANSFER_CATEGORY, CC_PAYMENT_CATEGORY, PRIOR_MONTH_CATEGORY } from '@/types/budget';

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(Math.abs(n));
}

interface CategoryBudgetMiniProps {
  categoryId: string;
  categories: BudgetCategory[];
  fixedExpenses: FixedExpense[];
  transactions: Transaction[];
  /** Amount of the current transaction being assigned (positive = expense, shown as pending) */
  pendingAmount?: number;
  /** IDs of transactions being edited — excluded from spent calculation to avoid double-counting */
  excludeTransactionIds?: string[];
}

export function CategoryBudgetMini({ categoryId, categories, fixedExpenses, transactions, pendingAmount = 0, excludeTransactionIds = [] }: CategoryBudgetMiniProps) {
  if (!categoryId || categoryId === 'unassigned') return null;

  const cat = categories.find(c => c.id === categoryId);
  const fixed = fixedExpenses.find(e => e.id === categoryId);
  const budgeted = cat?.budgeted ?? fixed?.amount ?? 0;
  if (budgeted === 0) return null;

  const EXCLUDED_CATS = new Set([DEPOSIT_CATEGORY, INCOME_CATEGORY, TRANSFER_CATEGORY, CC_PAYMENT_CATEGORY, PRIOR_MONTH_CATEGORY]);

  const spent = transactions
    .filter(t => t.categoryId === categoryId && t.transactionType === 'expense' && !EXCLUDED_CATS.has(t.categoryId))
    .reduce((s, t) => s + t.amount, 0);

  const deposits = transactions
    .filter(t => t.categoryId === categoryId && t.transactionType === 'deposit')
    .reduce((s, t) => s + Math.abs(t.amount), 0);

  const netSpent = spent - deposits;
  const remaining = budgeted - netSpent;
  const spentPct = Math.min(Math.max((netSpent / budgeted) * 100, 0), 100);
  const over = netSpent > budgeted;

  // Pending transaction projection
  const hasPending = pendingAmount > 0;
  const projectedSpent = netSpent + pendingAmount;
  const projectedRemaining = budgeted - projectedSpent;
  const pendingPct = hasPending
    ? Math.min(Math.max((projectedSpent / budgeted) * 100, 0), 100) - spentPct
    : 0;
  const projectedOver = projectedSpent > budgeted;

  return (
    <div className="mt-1.5">
      <div className="h-1.5 rounded-full bg-muted overflow-hidden flex">
        <div
          className={`h-full rounded-l-full transition-all duration-500 ease-out ${over ? 'bg-destructive' : 'bg-accent'}`}
          style={{ width: `${spentPct}%` }}
        />
        {hasPending && pendingPct > 0 && (
          <div
            className={`h-full transition-all duration-500 ease-out ${projectedOver ? 'bg-destructive/50' : 'bg-accent/50'}`}
            style={{ width: `${pendingPct}%` }}
          />
        )}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {formatCurrency(netSpent)} spent
        </span>
        <span className="text-[10px] tabular-nums font-medium flex items-center gap-1.5">
          {hasPending ? (
            <>
              <span className="text-muted-foreground">
                {over ? `-${formatCurrency(Math.abs(remaining))} over` : `${formatCurrency(remaining)} left`}
              </span>
              <span className="text-muted-foreground">→</span>
              <span className={projectedOver ? 'text-destructive' : 'text-primary'}>
                {projectedOver ? `-${formatCurrency(Math.abs(projectedRemaining))} over` : `${formatCurrency(projectedRemaining)} left`}
              </span>
            </>
          ) : (
            <span className={over ? 'text-destructive' : 'text-muted-foreground'}>
              {over ? `-${formatCurrency(Math.abs(remaining))} over` : `${formatCurrency(remaining)} left`}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
