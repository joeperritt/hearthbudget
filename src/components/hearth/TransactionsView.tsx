import { useState, useEffect } from 'react';
import { Transaction, BudgetCategory, FixedExpense, AccountSource, INCOME_CATEGORY, DEPOSIT_CATEGORY, TRANSFER_CATEGORY, CC_PAYMENT_CATEGORY, PRIOR_MONTH_CATEGORY } from '@/types/budget';
import { supabase } from '@/integrations/supabase/client';
import { Plus, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { getTransactionAmountPresentation } from '@/lib/transactionAmountDisplay';

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(Math.abs(n));
}

type Filter = 'all' | AccountSource;

interface TransactionsViewProps {
  transactions: Transaction[];
  categories: BudgetCategory[];
  fixedExpenses: FixedExpense[];
  monthLabel: string;
  onAddTransaction: () => void;
  onDeleteTransaction: (id: string) => void;
  onEditTransaction: (tx: Transaction) => void;
}

const ACCOUNT_LABELS: Record<AccountSource, string> = {
  'joe-amex': "Joe's Amex",
  'katie-amex': "Katie's Amex",
  'checking': 'Checking',
};

export function TransactionsView({
  transactions, categories, fixedExpenses, monthLabel, onAddTransaction, onDeleteTransaction, onEditTransaction,
}: TransactionsViewProps) {
  const [filter, setFilter] = useState<Filter>('all');

  const catMap = Object.fromEntries(categories.map(c => [c.id, c]));
  const fixedMap = Object.fromEntries(fixedExpenses.map(e => [e.id, e]));

  const filtered = filter === 'all' ? transactions : transactions.filter(t => t.account === filter);
  const sorted = [...filtered].sort((a, b) => b.date.localeCompare(a.date));

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'joe-amex', label: "Joe's Amex" },
    { id: 'katie-amex', label: "Katie's Amex" },
    { id: 'checking', label: 'Checking' },
  ];

  return (
    <div className="max-w-lg mx-auto">
      <div className="px-6 pt-12 pb-4 safe-top">
        <h1 className="font-display text-xl font-bold text-foreground">{monthLabel} Budget</h1>
      </div>

      <div className="px-6 flex gap-2 mb-4 overflow-x-auto no-scrollbar">
        {filters.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors active:scale-95 whitespace-nowrap ${
              filter === f.id
                ? 'bg-primary text-primary-foreground'
                : 'bg-card text-muted-foreground'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="px-6 pb-6">
        {sorted.length === 0 ? (
          <div className="text-center py-16 animate-fade-in">
            <p className="text-muted-foreground text-sm mb-3">No transactions yet</p>
            <button
              onClick={onAddTransaction}
              className="inline-flex items-center gap-1.5 text-accent text-sm font-medium active:scale-95 transition-transform"
            >
              <Plus size={16} /> Add your first transaction
            </button>
          </div>
        ) : (
          <div className="bg-card rounded-lg shadow-sm divide-y divide-border overflow-hidden">
            {sorted.map((t, i) => {
              const isCcPayment = t.transactionType === 'cc-payment' || t.categoryId === CC_PAYMENT_CATEGORY;
              const isIncome = !isCcPayment && (t.categoryId === INCOME_CATEGORY || (t.transactionType === 'income' && t.categoryId !== PRIOR_MONTH_CATEGORY));
              const isTransfer = t.categoryId === TRANSFER_CATEGORY;
              const isPriorMonth = t.categoryId === PRIOR_MONTH_CATEGORY;
              const isDeposit = t.categoryId === DEPOSIT_CATEGORY || t.transactionType === 'deposit';
              const isExcluded = isIncome || isDeposit || isTransfer || isCcPayment || isPriorMonth;
              const isIgnored = isIncome || isTransfer || isPriorMonth;
              
              return (
                <div
                  key={t.id}
                  onClick={() => onEditTransaction(t)}
                  className={`flex items-center gap-3 px-4 py-3 animate-fade-up cursor-pointer active:bg-muted/50 transition-colors ${isIgnored ? 'opacity-30 grayscale' : ''}`}
                  style={{ animationDelay: `${i * 30}ms`, animationFillMode: 'both' }}
                >
                  {/* Left — account pill */}
                  <span className={`text-[10px] font-semibold px-2 py-1 rounded-full shrink-0 whitespace-nowrap ${
                    t.account === 'joe-amex'
                      ? 'bg-primary text-primary-foreground'
                      : t.account === 'katie-amex'
                        ? 'bg-accent text-accent-foreground'
                        : 'bg-muted text-muted-foreground'
                  }`}>
                    {ACCOUNT_LABELS[t.account]}
                  </span>

                  {/* Center — category + merchant + notes */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {isCcPayment ? (
                        <span className="text-muted-foreground italic">
                          CC Payment
                          {t.categoryId !== CC_PAYMENT_CATEGORY && (catMap[t.categoryId] || fixedMap[t.categoryId]) && (
                            <span className="ml-1 text-muted-foreground/80">→ {catMap[t.categoryId]?.name || fixedMap[t.categoryId]?.name}</span>
                          )}
                        </span>
                      ) : isPriorMonth ? (
                        <span className="text-muted-foreground italic">Prior Month</span>
                      ) : isTransfer ? (
                        <span className="text-muted-foreground italic">Transfer</span>
                      ) : isIncome ? (
                        <span className="text-muted-foreground italic">Income</span>
                      ) : isDeposit ? (
                        <span className="text-muted-foreground italic">
                          Deposit
                          {t.categoryId !== DEPOSIT_CATEGORY && (catMap[t.categoryId] || fixedMap[t.categoryId]) && (
                            <span className="ml-1 text-muted-foreground/80">→ {catMap[t.categoryId]?.name || fixedMap[t.categoryId]?.name}</span>
                          )}
                        </span>
                      ) : (
                        <>
                          {catMap[t.categoryId]?.name || fixedMap[t.categoryId]?.name || (t.categoryId === 'unassigned' ? 'Unassigned' : 'Unknown')}
                          {fixedMap[t.categoryId] && (
                            <span className="ml-1.5 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full align-middle">fixed</span>
                          )}
                          {t.isTransferToSavings && (
                            <span className="ml-1.5 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full align-middle">savings</span>
                          )}
                        </>
                      )}
                    </p>
                    {t.description ? (
                      <p className="text-[11px] text-muted-foreground truncate mt-0.5">{t.description}</p>
                    ) : null}
                    {t.notes ? (
                      <p className="text-[10px] text-muted-foreground/70 italic truncate mt-0.5">📝 {t.notes}</p>
                    ) : null}
                  </div>

                  {/* Right — amount + date */}
                  <div className="text-right shrink-0">
                    {(() => {
                      const { colorClassName, prefix, value } = getTransactionAmountPresentation(t, { isExcluded });
                      return (
                        <p className={`text-sm font-medium tabular-nums ${colorClassName}`}>
                          {prefix}{formatCurrency(value)}
                        </p>
                      );
                    })()}
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {format(new Date(t.date), 'MMM d')}
                    </p>
                  </div>

                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteTransaction(t.id); }}
                    className="p-1.5 text-muted-foreground/40 hover:text-destructive active:scale-95 transition-all"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
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
