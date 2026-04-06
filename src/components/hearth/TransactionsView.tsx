import { useState } from 'react';
import { Transaction, BudgetCategory, FixedExpense, AccountSource, INCOME_CATEGORY, DEPOSIT_CATEGORY, TRANSFER_CATEGORY, CC_PAYMENT_CATEGORY, PRIOR_MONTH_CATEGORY } from '@/types/budget';
import { Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { format } from 'date-fns';
import { getTransactionAmountPresentation } from '@/lib/transactionAmountDisplay';
import { AppAccount } from '@/hooks/useAccounts';

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(Math.abs(n));
}

type Filter = 'all' | string;

interface TransactionsViewProps {
  transactions: Transaction[];
  categories: BudgetCategory[];
  fixedExpenses: FixedExpense[];
  monthLabel: string;
  onAddTransaction: () => void;
  onDeleteTransaction: (id: string) => void;
  onEditTransaction: (tx: Transaction, splitSiblings?: Transaction[]) => void;
  accounts?: AppAccount[];
}

interface SplitGroup {
  type: 'split';
  key: string;
  transactions: Transaction[];
  totalAmount: number;
  date: string;
  description: string;
  account: AccountSource;
  notes: string;
}

interface SingleTx {
  type: 'single';
  transaction: Transaction;
}

type DisplayRow = SplitGroup | SingleTx;

function groupSplitTransactions(transactions: Transaction[]): DisplayRow[] {
  // Group by description + date + account + notes (split transactions share these)
  const groupMap = new Map<string, Transaction[]>();
  
  for (const t of transactions) {
    // Only group expense transactions (splits are always expenses)
    if (t.transactionType !== 'expense') {
      groupMap.set(`__single_${t.id}`, [t]);
      continue;
    }
    const key = `${t.description}||${t.date}||${t.account}`;
    const existing = groupMap.get(key);
    if (existing) {
      existing.push(t);
    } else {
      groupMap.set(key, [t]);
    }
  }

  const rows: DisplayRow[] = [];
  for (const [key, txs] of groupMap) {
    if (txs.length > 1 && !key.startsWith('__single_')) {
      rows.push({
        type: 'split',
        key,
        transactions: txs,
        totalAmount: txs.reduce((s, t) => s + t.amount, 0),
        date: txs[0].date,
        description: txs[0].description,
        account: txs[0].account,
        notes: txs[0].notes,
      });
    } else {
      for (const t of txs) {
        rows.push({ type: 'single', transaction: t });
      }
    }
  }

  // Sort by date descending
  rows.sort((a, b) => {
    const dateA = a.type === 'split' ? a.date : a.transaction.date;
    const dateB = b.type === 'split' ? b.date : b.transaction.date;
    return dateB.localeCompare(dateA);
  });

  return rows;
}

export function TransactionsView({
  transactions, categories, fixedExpenses, monthLabel, onAddTransaction, onDeleteTransaction, onEditTransaction, accounts = [],
}: TransactionsViewProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [expandedSplits, setExpandedSplits] = useState<Set<string>>(new Set());

  const accountLabels: Record<string, string> = Object.fromEntries(accounts.map(a => [a.id, a.label]));

  const catMap = Object.fromEntries(categories.map(c => [c.id, c]));
  const fixedMap = Object.fromEntries(fixedExpenses.map(e => [e.id, e]));

  const filtered = filter === 'all' ? transactions : transactions.filter(t => t.account === filter);
  const rows = groupSplitTransactions(filtered);

  const toggleSplit = (key: string) => {
    setExpandedSplits(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'joe-amex', label: "Joe's Amex" },
    { id: 'katie-amex', label: "Katie's Amex" },
    { id: 'checking', label: 'Checking' },
  ];

  const renderSingleTx = (t: Transaction, i: number, splitGroup?: SplitGroup) => {
    const indent = !!splitGroup;
    const isCcPayment = t.transactionType === 'cc-payment' || t.categoryId === CC_PAYMENT_CATEGORY;
    const isIncome = !isCcPayment && (t.categoryId === INCOME_CATEGORY || (t.transactionType === 'income' && t.categoryId !== PRIOR_MONTH_CATEGORY));
    const isTransfer = t.categoryId === TRANSFER_CATEGORY;
    const isPriorMonth = t.categoryId === PRIOR_MONTH_CATEGORY;
    const isDeposit = t.categoryId === DEPOSIT_CATEGORY || t.transactionType === 'deposit';
    const isExcluded = isIncome || isDeposit || isTransfer || isCcPayment || isPriorMonth;
    const isIgnored = isIncome || isTransfer || isPriorMonth;

    const handleClick = () => {
      if (splitGroup) {
        // Open edit for the whole split group
        onEditTransaction(splitGroup.transactions[0], splitGroup.transactions);
      } else {
        onEditTransaction(t);
      }
    };

    return (
      <div
        key={t.id}
        onClick={handleClick}
        className={`flex items-center gap-3 px-4 py-3 animate-fade-up cursor-pointer active:bg-muted/50 transition-colors ${isIgnored ? 'opacity-30 grayscale' : ''} ${indent ? 'bg-muted/30 pl-8' : ''}`}
        style={{ animationDelay: `${i * 30}ms`, animationFillMode: 'both' }}
      >
        <span className={`text-[10px] font-semibold px-2 py-1 rounded-full shrink-0 whitespace-nowrap ${
          t.account === 'joe-amex'
            ? 'bg-primary text-primary-foreground'
            : t.account === 'katie-amex'
              ? 'bg-accent text-accent-foreground'
              : 'bg-muted text-muted-foreground'
        }`}>
          {ACCOUNT_LABELS[t.account]}
        </span>

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
          {indent && t.description ? null : t.description ? (
            <p className="text-[11px] text-muted-foreground truncate mt-0.5">{t.description}</p>
          ) : null}
          {t.notes ? (
            <p className="text-[10px] text-muted-foreground/70 italic truncate mt-0.5">📝 {t.notes}</p>
          ) : null}
        </div>

        <div className="text-right shrink-0">
          {(() => {
            const { colorClassName, prefix, value } = getTransactionAmountPresentation(t, { isExcluded });
            return (
              <p className={`text-sm font-medium tabular-nums ${colorClassName}`}>
                {prefix}{formatCurrency(value)}
              </p>
            );
          })()}
          {!indent && (
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {format(new Date(t.date), 'MMM d')}
            </p>
          )}
        </div>

        {!indent && (
          <button
            onClick={(e) => { e.stopPropagation(); onDeleteTransaction(t.id); }}
            className="p-1.5 text-muted-foreground/40 hover:text-destructive active:scale-95 transition-all"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    );
  };

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
        {rows.length === 0 ? (
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
            {rows.map((row, i) => {
              if (row.type === 'single') {
                return renderSingleTx(row.transaction, i);
              }

              // Split group
              const expanded = expandedSplits.has(row.key);
              return (
                <div key={row.key}>
                  <div
                    onClick={() => toggleSplit(row.key)}
                    className="flex items-center gap-3 px-4 py-3 animate-fade-up cursor-pointer active:bg-muted/50 transition-colors"
                    style={{ animationDelay: `${i * 30}ms`, animationFillMode: 'both' }}
                  >
                    <span className={`text-[10px] font-semibold px-2 py-1 rounded-full shrink-0 whitespace-nowrap ${
                      row.account === 'joe-amex'
                        ? 'bg-primary text-primary-foreground'
                        : row.account === 'katie-amex'
                          ? 'bg-accent text-accent-foreground'
                          : 'bg-muted text-muted-foreground'
                    }`}>
                      {ACCOUNT_LABELS[row.account]}
                    </span>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        <span className="text-[10px] font-semibold text-accent bg-accent/15 px-1.5 py-0.5 rounded-full uppercase tracking-wide">Split</span>
                      </p>
                      {row.description ? (
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">{row.description}</p>
                      ) : null}
                      {row.notes ? (
                        <p className="text-[10px] text-muted-foreground/70 italic truncate mt-0.5">📝 {row.notes}</p>
                      ) : null}
                    </div>

                    <div className="text-right shrink-0">
                      <p className="text-sm font-medium tabular-nums text-foreground">
                        {formatCurrency(row.totalAmount)}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {format(new Date(row.date), 'MMM d')}
                      </p>
                    </div>

                    <div className="p-1.5 text-muted-foreground/60">
                      {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </div>
                  </div>

                  {expanded && (
                    <div className="divide-y divide-border/50">
                      {row.transactions.map((t, j) => renderSingleTx(t, j, row))}
                    </div>
                  )}
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
