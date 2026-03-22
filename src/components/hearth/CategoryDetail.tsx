import { Transaction, BudgetCategory } from '@/types/budget';
import { ProgressBar } from './ProgressBar';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { format } from 'date-fns';

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}

interface CategoryDetailProps {
  category: BudgetCategory;
  transactions: Transaction[];
  spent: number;
  onBack: () => void;
  onDeleteTransaction: (id: string) => void;
}

export function CategoryDetail({ category, transactions, spent, onBack, onDeleteTransaction }: CategoryDetailProps) {
  const remaining = category.budgeted - spent;
  const sorted = [...transactions].sort((a, b) => b.date.localeCompare(a.date));

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
              <p className="text-xl font-display font-semibold text-foreground">{formatCurrency(category.budgeted)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Remaining</p>
              <p className={`text-xl font-display font-semibold ${remaining < 0 ? 'text-destructive' : 'text-foreground'}`}>
                {formatCurrency(remaining)}
              </p>
            </div>
          </div>
          <ProgressBar value={spent} max={category.budgeted} />
          <p className="text-xs text-muted-foreground mt-2 tabular-nums">{formatCurrency(spent)} spent</p>
        </div>
      </div>

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
                    <span className="text-sm font-medium text-foreground truncate">{t.description}</span>
                    <span className="text-sm font-medium tabular-nums text-foreground ml-2">{formatCurrency(t.amount)}</span>
                  </div>
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
