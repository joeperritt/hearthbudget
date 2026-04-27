import { Transaction, BudgetCategory, FixedExpense, DEPOSIT_CATEGORY, INCOME_CATEGORY, TRANSFER_CATEGORY, CC_PAYMENT_CATEGORY, PRIOR_MONTH_CATEGORY } from '@/types/budget';

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(Math.abs(n));
}

interface CategoryBudgetMiniProps {
  categoryId: string;
  categories: BudgetCategory[];
  fixedExpenses: FixedExpense[];
  transactions: Transaction[];
  /**
   * Signed pending amount for the in-flight transaction.
   * Positive = expense (adds to spent / pushes bar forward).
   * Negative = refund/deposit (subtracts from spent / pulls bar backward).
   */
  pendingAmount?: number;
  /** IDs of transactions being edited — excluded from spent calculation to avoid double-counting */
  excludeTransactionIds?: string[];
  /** Net category transfer adjustment for this category (positive = received, negative = sent) */
  transferAdjustment?: number;
}

export function CategoryBudgetMini({ categoryId, categories, fixedExpenses, transactions, pendingAmount = 0, excludeTransactionIds = [], transferAdjustment = 0 }: CategoryBudgetMiniProps) {
  if (!categoryId || categoryId === 'unassigned') return null;

  const cat = categories.find(c => c.id === categoryId);
  const fixed = fixedExpenses.find(e => e.id === categoryId);
  const baseBudget = cat?.budgeted ?? fixed?.amount ?? 0;
  if (baseBudget === 0 && transferAdjustment === 0) return null;

  const budgeted = baseBudget + transferAdjustment;
  if (budgeted <= 0) return null;

  const EXCLUDED_CATS = new Set([DEPOSIT_CATEGORY, INCOME_CATEGORY, TRANSFER_CATEGORY, CC_PAYMENT_CATEGORY, PRIOR_MONTH_CATEGORY]);

  const excludeSet = new Set(excludeTransactionIds);

  const spent = transactions
    .filter(t => t.categoryId === categoryId && t.transactionType === 'expense' && !EXCLUDED_CATS.has(t.categoryId) && !excludeSet.has(t.id))
    .reduce((s, t) => s + t.amount, 0);

  const deposits = transactions
    .filter(t => t.categoryId === categoryId && t.transactionType === 'deposit' && !excludeSet.has(t.id))
    .reduce((s, t) => s + Math.abs(t.amount), 0);

  const netSpent = spent - deposits;
  const remaining = budgeted - netSpent;
  const spentPct = Math.min(Math.max((netSpent / budgeted) * 100, 0), 100);
  const over = netSpent > budgeted;

  // Pending projection — amount is signed:
  //   positive => expense, adds to spent (forward bar)
  //   negative => refund, subtracts from spent (backward bar)
  const hasPending = pendingAmount !== 0;
  const isRefund = pendingAmount < 0;
  const projectedSpent = netSpent + pendingAmount;
  const projectedRemaining = budgeted - projectedSpent;
  const projectedPct = Math.min(Math.max((projectedSpent / budgeted) * 100, 0), 100);
  const deltaPct = Math.abs(projectedPct - spentPct);
  const projectedOver = projectedSpent > budgeted;

  return (
    <div className="mt-1.5">
      <div className="h-1.5 rounded-full bg-muted overflow-hidden flex">
        {hasPending && isRefund ? (
          <>
            {/* Solid filled portion = projected (lower) spend */}
            <div
              className={`h-full rounded-l-full transition-all duration-500 ease-out ${projectedOver ? 'bg-destructive' : 'bg-accent'}`}
              style={{ width: `${projectedPct}%` }}
            />
            {/* Faded refund delta = the budget being returned */}
            {deltaPct > 0 && (
              <div
                className="h-full transition-all duration-500 ease-out bg-success/40"
                style={{ width: `${deltaPct}%` }}
              />
            )}
          </>
        ) : (
          <>
            <div
              className={`h-full rounded-l-full transition-all duration-500 ease-out ${over ? 'bg-destructive' : 'bg-accent'}`}
              style={{ width: `${spentPct}%` }}
            />
            {hasPending && deltaPct > 0 && (
              <div
                className={`h-full transition-all duration-500 ease-out ${projectedOver ? 'bg-destructive/50' : 'bg-accent/50'}`}
                style={{ width: `${deltaPct}%` }}
              />
            )}
          </>
        )}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {formatCurrency(netSpent)} spent
          {transferAdjustment !== 0 && (
            <span className="ml-1 text-muted-foreground/70">
              · {transferAdjustment > 0 ? '+' : '−'}{formatCurrency(transferAdjustment)} transfer
            </span>
          )}
        </span>
        <span className="text-[10px] tabular-nums font-medium flex items-center gap-1.5">
          {hasPending ? (
            <>
              <span className="text-muted-foreground">
                {over ? `-${formatCurrency(Math.abs(remaining))} over` : `${formatCurrency(remaining)} left`}
              </span>
              <span className="text-muted-foreground">→</span>
              <span className={projectedOver ? 'text-destructive' : isRefund ? 'text-success' : 'text-primary'}>
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
      {hasPending && isRefund && (
        <p className="mt-1 text-[10px] text-success">
          Refunded {formatCurrency(pendingAmount)} back to budget
        </p>
      )}
    </div>
  );
}
