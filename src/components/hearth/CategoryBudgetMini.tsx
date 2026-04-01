import { Transaction, BudgetCategory, FixedExpense, DEPOSIT_CATEGORY, INCOME_CATEGORY, TRANSFER_CATEGORY, CC_PAYMENT_CATEGORY, PRIOR_MONTH_CATEGORY } from '@/types/budget';

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(Math.abs(n));
}

interface CategoryBudgetMiniProps {
  categoryId: string;
  categories: BudgetCategory[];
  fixedExpenses: FixedExpense[];
  transactions: Transaction[];
}

export function CategoryBudgetMini({ categoryId, categories, fixedExpenses, transactions }: CategoryBudgetMiniProps) {
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
  const pct = Math.min(Math.max((netSpent / budgeted) * 100, 0), 100);
  const over = netSpent > budgeted;

  return (
    <div className="mt-1.5">
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${over ? 'bg-destructive' : 'bg-accent'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {formatCurrency(netSpent)} spent
        </span>
        <span className={`text-[10px] tabular-nums font-medium ${over ? 'text-destructive' : 'text-muted-foreground'}`}>
          {over ? `-${formatCurrency(Math.abs(remaining))} over` : `${formatCurrency(remaining)} left`}
        </span>
      </div>
    </div>
  );
}
