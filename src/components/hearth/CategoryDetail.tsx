import { Transaction, BudgetCategory, BudgetTransfer, NOTES_REQUIRED_CATEGORIES } from '@/types/budget';
import { ProgressBar } from './ProgressBar';
import { ArrowLeft, Trash2, ArrowLeftRight, ArrowDownLeft } from 'lucide-react';
import { format } from 'date-fns';

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}

interface DetailCategory {
  id: string;
  name: string;
  budgeted: number;
}

interface CategoryDetailProps {
  category: DetailCategory;
  categories: BudgetCategory[];
  fixedExpenses?: { id: string; name: string }[];
  transactions: Transaction[];
  deposits?: Transaction[];
  transfers: BudgetTransfer[];
  spent: number;
  transferAdjustment: number;
  onBack: () => void;
  onDeleteTransaction: (id: string) => void;
}

export function CategoryDetail({ category, categories, fixedExpenses = [], transactions, deposits = [], transfers, spent, transferAdjustment, onBack, onDeleteTransaction }: CategoryDetailProps) {
  const adjustedBudget = category.budgeted + transferAdjustment;
  const remaining = adjustedBudget - spent;
  const sorted = [...transactions].sort((a, b) => b.date.localeCompare(a.date));
  const isDescriptionCategory = NOTES_REQUIRED_CATEGORIES.includes(category.id);
  // Build a combined lookup map for both variable categories and fixed expenses
  const nameMap: Record<string, string> = {};
  categories.forEach(c => { nameMap[c.id] = c.name; });
  fixedExpenses.forEach(e => { nameMap[e.id] = e.name; });

  // Transfers involving this category
  const relevantTransfers = transfers.filter(
    t => t.fromCategoryId === category.id || t.toCategoryId === category.id
  ).sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="min-h-screen bg-background max-w-lg mx-auto">
      <div className="px-6 pt-12 safe-top">
        <button onClick={onBack} className="flex items-center gap-1 text-accent text-sm font-medium mb-4 active:scale-95 transition-transform">
          <ArrowLeft size={16} /> Back
        </button>
        <h1 className="font-display text-2xl font-bold text-foreground">{category.name}</h1>
      </div>

      <div className="px-6 mt-4">
        <div className="bg-card rounded-xl p-5 shadow-sm animate-fade-up" style={{ animationFillMode: 'both' }}>
          <div className="flex justify-between items-baseline mb-3">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Budgeted</p>
              <p className="text-xl font-display font-semibold text-foreground">{formatCurrency(adjustedBudget)}</p>
              {transferAdjustment !== 0 && (
                <p className="text-[10px] text-muted-foreground">
                  {formatCurrency(category.budgeted)} {transferAdjustment > 0 ? '+' : ''}{formatCurrency(transferAdjustment)} moved
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Remaining</p>
              <p className={`text-xl font-display font-semibold ${remaining < 0 ? 'text-destructive' : 'text-foreground'}`}>
                {formatCurrency(remaining)}
              </p>
            </div>
          </div>
          <ProgressBar value={spent} max={adjustedBudget} />
          <p className="text-xs text-muted-foreground mt-2 tabular-nums">{formatCurrency(spent)} net spent</p>
          {deposits.length > 0 && (
            <p className="text-[10px] text-muted-foreground">
              includes {formatCurrency(deposits.reduce((s, d) => s + Math.abs(d.amount), 0))} in reimbursements
            </p>
          )}
        </div>
      </div>

      {/* Transfer Log */}
      {relevantTransfers.length > 0 && (
        <div className="px-6 mt-6">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Fund Transfers</h3>
          <div className="bg-card rounded-lg shadow-sm divide-y divide-border overflow-hidden">
            {relevantTransfers.map((t, i) => {
              const isFrom = t.fromCategoryId === category.id;
              const otherName = nameMap[isFrom ? t.toCategoryId : t.fromCategoryId] || 'Unknown';
              return (
                <div key={t.id} className="flex items-center gap-3 px-4 py-3 animate-fade-up"
                  style={{ animationDelay: `${i * 40}ms`, animationFillMode: 'both' }}>
                  <ArrowLeftRight size={12} className="text-muted-foreground/50 shrink-0" />
                  <div className="flex-1">
                    <span className="text-sm text-foreground">
                      {isFrom ? `→ ${otherName}` : `← ${otherName}`}
                    </span>
                    <p className="text-[11px] text-muted-foreground">{format(new Date(t.date), 'MMM d')}</p>
                  </div>
                  <span className={`text-sm font-medium tabular-nums ${isFrom ? 'text-destructive' : 'text-accent'}`}>
                    {isFrom ? '-' : '+'}{formatCurrency(t.amount)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {/* Deposit Reimbursements */}
      {deposits.length > 0 && (
        <div className="px-6 mt-6">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Reimbursements</h3>
          <div className="bg-card rounded-lg shadow-sm divide-y divide-border overflow-hidden">
            {deposits.map((d, i) => (
              <div key={d.id} className="flex items-center gap-3 px-4 py-3 animate-fade-up"
                style={{ animationDelay: `${i * 40}ms`, animationFillMode: 'both' }}>
                <ArrowDownLeft size={12} className="text-accent shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-foreground truncate">{d.description || 'Deposit'}</span>
                  <p className="text-[11px] text-muted-foreground">{format(new Date(d.date), 'MMM d')}</p>
                </div>
                <span className="text-sm font-medium tabular-nums text-accent">+{formatCurrency(Math.abs(d.amount))}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="px-6 mt-6 pb-6">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Transactions</h3>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No transactions yet</p>
        ) : (
          <div className="bg-card rounded-lg shadow-sm divide-y divide-border overflow-hidden">
            {sorted.map((t, i) => (
              <div
                key={t.id}
                className="flex items-center gap-3 px-4 py-3 animate-fade-up"
                style={{ animationDelay: `${i * 40}ms`, animationFillMode: 'both' }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-baseline">
                    <span className={`text-sm font-medium text-foreground truncate ${isDescriptionCategory ? 'max-w-[60%]' : ''}`}>
                      {t.description || '(no description)'}
                    </span>
                    <span className="text-sm font-medium tabular-nums text-foreground ml-2">{formatCurrency(t.amount)}</span>
                  </div>
                  {isDescriptionCategory && t.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{t.description}</p>
                  )}
                  <span className="text-[11px] text-muted-foreground">{format(new Date(t.date), 'MMM d, yyyy')}</span>
                </div>
                <button
                  onClick={() => onDeleteTransaction(t.id)}
                  className="p-1.5 text-muted-foreground/40 hover:text-destructive active:scale-95 transition-all"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
