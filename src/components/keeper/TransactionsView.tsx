import { useState, useEffect, useMemo } from 'react';
import { Transaction, BudgetCategory, FixedExpense, BudgetTransfer, AccountSource, INCOME_CATEGORY, DEPOSIT_CATEGORY, TRANSFER_CATEGORY, CC_PAYMENT_CATEGORY, USER_IGNORE_CATEGORY, PRIOR_MONTH_CATEGORY, IGNORE_CATEGORY_SLUGS } from '@/types/budget';
import { Plus, Trash2, ChevronDown, ChevronUp, ArrowLeftRight, ArrowUp, ArrowDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { filterForMonth } from '@/hooks/useBudgetData';
import { getTransactionAmountPresentation } from '@/lib/transactionAmountDisplay';
import { AppAccount } from '@/hooks/useAccounts';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(Math.abs(n));
}

type Filter = 'all' | 'manual' | 'unassigned' | 'budget-transfers' | 'transfers-hidden' | string;

interface TransactionsViewProps {
  allTransactions: Transaction[];
  allTransfers?: BudgetTransfer[];
  categories: BudgetCategory[];
  fixedExpenses: FixedExpense[];
  initialMonth: string; // YYYY-MM
  onAddTransaction: () => void;
  onDeleteTransaction: (id: string) => void | Promise<void>;
  onEditTransaction: (tx: Transaction, splitSiblings?: Transaction[]) => void;
  accounts?: AppAccount[];
  initialFilter?: Filter;
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

interface TransferRow {
  type: 'transfer';
  transfer: BudgetTransfer;
}

type DisplayRow = SplitGroup | SingleTx | TransferRow;

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

  return rows;
}

export function TransactionsView({
  allTransactions, allTransfers = [], categories: allCategories, fixedExpenses: allFixedExpenses,
  initialMonth, onAddTransaction, onDeleteTransaction, onEditTransaction, accounts = [], initialFilter,
}: TransactionsViewProps) {
  // Internal month browsing — initialized from the household's active month.
  const [viewMonth, setViewMonth] = useState(initialMonth);
  useEffect(() => { setViewMonth(initialMonth); }, [initialMonth]);

  const monthLabel = useMemo(() => {
    try {
      const [y, m] = viewMonth.split('-').map(Number);
      return format(new Date(y, m - 1, 1), 'MMMM yyyy');
    } catch { return viewMonth; }
  }, [viewMonth]);

  const stepMonth = (delta: number) => {
    const [y, m] = viewMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setViewMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const transactions = useMemo(
    () => allTransactions.filter(t => t.budgetMonth === viewMonth),
    [allTransactions, viewMonth]
  );
  const transfers = useMemo(
    () => allTransfers.filter(t => t.date.startsWith(viewMonth)),
    [allTransfers, viewMonth]
  );
  const categories = useMemo(() => filterForMonth(allCategories, viewMonth), [allCategories, viewMonth]);
  const fixedExpenses = useMemo(() => filterForMonth(allFixedExpenses, viewMonth), [allFixedExpenses, viewMonth]);

  const [filter, setFilter] = useState<Filter>(initialFilter ?? 'all');
  // Re-apply when navigating in with a new initialFilter (e.g., from Home → Unassigned link)
  useEffect(() => { if (initialFilter) setFilter(initialFilter); }, [initialFilter]);
  const [showTransfers, setShowTransfers] = useState(true);
  // Pagination — render the most recent N rows, reveal more in 50-row chunks.
  // Resets on filter change, month switch, or transfer toggle.
  const PAGE_SIZE = 50;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [filter, viewMonth, showTransfers]);
  const [expandedSplits, setExpandedSplits] = useState<Set<string>>(new Set());
  type SortKey = 'date' | 'amount' | 'account' | 'category';
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'date' ? 'desc' : 'asc'); }
  };

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleConfirmDelete = async () => {
    if (!pendingDeleteId) return;
    setDeleting(true);
    try {
      await onDeleteTransaction(pendingDeleteId);
      toast.success('Transaction deleted');
      setPendingDeleteId(null);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete transaction');
    } finally {
      setDeleting(false);
    }
  };

  const accountLabels: Record<string, string> = Object.fromEntries(accounts.map(a => [a.id, a.label]));

  const catMap = Object.fromEntries(categories.map(c => [c.id, c]));
  const fixedMap = Object.fromEntries(fixedExpenses.map(e => [e.id, e]));
  const nameFor = (id: string) => catMap[id]?.name || fixedMap[id]?.name || id;

  // Unassigned should ONLY surface real transactions awaiting categorization.
  // Budget transfers (internal accounting moves) live in a separate `transfers` array
  // and are intentionally excluded from txRows when the unassigned or budget-transfers filters are active.
  const filtered = filter === 'all'
    ? transactions
    : filter === 'manual'
      ? transactions.filter(t => t.source === 'manual')
      : filter === 'unassigned'
        ? transactions.filter(t => t.categoryId === 'unassigned')
        : filter === 'budget-transfers'
          ? [] // budget transfers are not transactions; render only transferRows below
          : transactions.filter(t => t.account === filter);
  const txRows = groupSplitTransactions(filtered);

  // Show transfers when:
  // - filter is 'all' or an account-scoped filter AND user hasn't toggled them off
  // - filter is 'budget-transfers' (always show, regardless of toggle)
  // Hide transfers when filter is 'unassigned' or 'manual'
  const shouldRenderTransfers =
    filter === 'budget-transfers'
      ? true
      : filter === 'unassigned' || filter === 'manual'
        ? false
        : showTransfers;
  const transferRows: TransferRow[] = shouldRenderTransfers
    ? transfers.map(tr => ({ type: 'transfer' as const, transfer: tr }))
    : [];

  // Combine + sort all rows
  const rowAccount = (r: DisplayRow) => r.type === 'split' ? r.account : r.type === 'transfer' ? '' : r.transaction.account;
  const rowDate = (r: DisplayRow) => r.type === 'split' ? r.date : r.type === 'transfer' ? r.transfer.date : r.transaction.date;
  const rowAmount = (r: DisplayRow) => r.type === 'split' ? r.totalAmount : r.type === 'transfer' ? r.transfer.amount : r.transaction.amount;
  const rowCategory = (r: DisplayRow) => {
    if (r.type === 'transfer') return 'Transfer';
    const t = r.type === 'split' ? r.transactions[0] : r.transaction;
    return catMap[t.categoryId]?.name || fixedMap[t.categoryId]?.name || t.categoryId;
  };
  const rows: DisplayRow[] = [...txRows, ...transferRows].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'date') cmp = rowDate(a).localeCompare(rowDate(b));
    else if (sortKey === 'amount') cmp = rowAmount(a) - rowAmount(b);
    else if (sortKey === 'account') cmp = (accountLabels[rowAccount(a)] || rowAccount(a)).localeCompare(accountLabels[rowAccount(b)] || rowAccount(b));
    else if (sortKey === 'category') cmp = rowCategory(a).localeCompare(rowCategory(b));
    return sortDir === 'asc' ? cmp : -cmp;
  });

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
    { id: 'unassigned', label: 'Unassigned' },
    ...accounts.map(a => ({ id: a.id, label: a.label })),
    { id: 'manual', label: 'Manual' },
    ...(transfers.length > 0 ? [{ id: 'budget-transfers' as Filter, label: 'Budget Transfers' }] : []),
  ];

  const renderTransfer = (tr: BudgetTransfer, i: number) => (
    <div
      key={`tr-${tr.id}`}
      className="flex items-center gap-3 px-4 py-3 animate-fade-up lg:border-b lg:border-border/60 lg:last:border-0"
      style={{ animationDelay: `${i * 30}ms`, animationFillMode: 'both' }}
    >
      <span className="text-[10px] lg:text-xs font-semibold px-2 py-1 rounded-full shrink-0 whitespace-nowrap bg-muted text-muted-foreground inline-flex items-center gap-1 lg:w-32 lg:justify-center">
        <ArrowLeftRight size={10} strokeWidth={2.5} />
        Transfer
      </span>
      <div className="flex-1 min-w-0 lg:flex lg:items-baseline lg:gap-2">
        <p className="text-sm lg:text-base lg:font-semibold font-medium text-foreground truncate">Budget Transfer</p>
        <p className="text-[11px] lg:text-sm text-muted-foreground truncate mt-0.5 lg:mt-0">
          {nameFor(tr.fromCategoryId)} → {nameFor(tr.toCategoryId)}
        </p>
      </div>
      <div className="text-right shrink-0 lg:flex lg:items-center lg:gap-6">
        <p className="text-sm lg:text-base font-medium lg:font-semibold tabular-nums text-muted-foreground">
          {formatCurrency(tr.amount)}
        </p>
        <p className="text-[11px] lg:text-sm text-muted-foreground mt-0.5 lg:mt-0 lg:w-16 lg:text-right">
          {format(new Date(tr.date), 'MMM d')}
        </p>
      </div>
      <div className="w-[26px] shrink-0" />
    </div>
  );

  const renderSingleTx = (t: Transaction, i: number, splitGroup?: SplitGroup) => {
    const indent = !!splitGroup;
    const isCcPayment = t.transactionType === 'cc-payment' || t.categoryId === CC_PAYMENT_CATEGORY;
    const isIncome = !isCcPayment && (t.categoryId === INCOME_CATEGORY || (t.transactionType === 'income' && t.categoryId !== PRIOR_MONTH_CATEGORY));
    const isTransfer = t.categoryId === TRANSFER_CATEGORY || t.transactionType === 'transfer';
    const isPriorMonth = t.categoryId === PRIOR_MONTH_CATEGORY;
    const isDeposit = t.categoryId === DEPOSIT_CATEGORY || t.transactionType === 'deposit';
    const isUserIgnore = t.categoryId === USER_IGNORE_CATEGORY;
    const isExcluded = isIncome || isDeposit || isTransfer || isCcPayment || isPriorMonth || isUserIgnore;
    // Whole row is muted as a single visual unit when transaction is ignored
    const isMuted = isExcluded;

    const handleClick = () => {
      if (splitGroup) {
        onEditTransaction(splitGroup.transactions[0], splitGroup.transactions);
      } else {
        onEditTransaction(t);
      }
    };

    return (
      <div
        key={t.id}
        id={`tx-${t.id}`}
        onClick={handleClick}
        className={`flex items-center gap-3 px-4 py-3 lg:py-3 animate-fade-up cursor-pointer active:bg-muted/50 transition-all lg:border-b lg:border-border/60 lg:last:border-0 ${isMuted ? 'opacity-60' : ''} ${indent ? 'bg-muted/30 pl-8' : ''}`}
        style={{ animationDelay: `${i * 30}ms`, animationFillMode: 'both' }}
      >
        <span className={`text-[10px] lg:text-xs font-semibold px-2 py-1 rounded-full shrink-0 whitespace-nowrap lg:w-32 lg:text-center ${
          isMuted
            ? 'bg-muted text-muted-foreground'
            : accounts.findIndex(a => a.id === t.account) === 0
              ? 'bg-primary text-primary-foreground'
              : accounts.findIndex(a => a.id === t.account) === 1
                ? 'bg-accent text-accent-foreground'
                : 'bg-muted text-muted-foreground'
        }`}>
          {accountLabels[t.account] || t.account}
        </span>
        {t.source === 'manual' && !indent && !isMuted && (
          <span className="text-[10px] lg:text-xs font-semibold px-2 py-1 rounded-full shrink-0 whitespace-nowrap bg-muted text-muted-foreground">
            Manual
          </span>
        )}

        <div className="flex-1 min-w-0 lg:flex lg:items-baseline lg:gap-2">
          <p className={`text-sm lg:text-base font-semibold truncate ${isMuted ? 'text-muted-foreground' : 'text-foreground'}`}>
            {isMuted ? (
              // Use the merchant/description as the primary label for muted rows
              <span>{t.description || 'Ignored'}</span>
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
          {!isMuted && !indent && t.description ? (
            <p className="text-[11px] lg:text-xs text-muted-foreground/70 truncate mt-0.5 lg:mt-0 font-normal">{t.description}</p>
          ) : null}
          {t.notes ? (
            <p className={`text-[10px] lg:text-xs italic truncate mt-0.5 lg:mt-0 ${isMuted ? 'text-muted-foreground/80' : 'text-muted-foreground/70'}`}>📝 {t.notes}</p>
          ) : null}
        </div>

        <div className="text-right shrink-0 lg:flex lg:items-center lg:gap-6">
          {(() => {
            const { colorClassName, prefix, value } = getTransactionAmountPresentation(t, { isExcluded });
            // Force muted color on ignored rows so the whole row reads as a single deemphasized unit
            const amountClass = isMuted ? 'text-muted-foreground' : colorClassName;
            return (
              <p className={`text-sm lg:text-base font-medium lg:font-semibold tabular-nums ${amountClass}`}>
                {prefix}{formatCurrency(value)}
              </p>
            );
          })()}
          {!indent && (
            <p className={`text-[11px] lg:text-sm mt-0.5 lg:mt-0 lg:w-16 lg:text-right ${isMuted ? 'text-muted-foreground/80' : 'text-muted-foreground'}`}>
              {format(new Date(t.date), 'MMM d')}
            </p>
          )}
        </div>

        {!indent && (
          <button
            onClick={(e) => { e.stopPropagation(); setPendingDeleteId(t.id); }}
            aria-label="Delete transaction"
            className="p-1.5 text-muted-foreground/60 hover:text-destructive active:scale-95 transition-all"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-lg mx-auto">
      <div className="px-6 pt-12 pb-4 safe-top flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl lg:text-3xl font-bold tracking-tight text-foreground">{monthLabel} Budget</h1>
        <button
          onClick={onAddTransaction}
          className="hidden lg:inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-accent-foreground text-sm font-semibold shadow-sm hover:opacity-90 active:scale-95 transition-all"
        >
          <Plus size={16} strokeWidth={2.5} />
          Add Transaction
        </button>
      </div>

      <div className="px-6 flex gap-2 mb-2 overflow-x-auto no-scrollbar">
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

      {transfers.length > 0 && filter !== 'budget-transfers' && filter !== 'unassigned' && filter !== 'manual' && (
        <div className="px-6 mb-4">
          <button
            onClick={() => setShowTransfers(s => !s)}
            className={`px-3 py-1 rounded-full text-[11px] font-medium transition-colors active:scale-95 inline-flex items-center gap-1.5 ${
              showTransfers ? 'bg-card text-foreground' : 'bg-muted text-muted-foreground'
            }`}
          >
            <ArrowLeftRight size={11} strokeWidth={2.5} />
            {showTransfers ? 'Hide budget transfers' : 'Show budget transfers'} ({transfers.length})
          </button>
        </div>
      )}

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
            {/* Desktop sortable header */}
            <div className="hidden lg:flex items-center gap-3 px-4 py-2 bg-muted/30 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              {(() => {
                const SortBtn = ({ k, label, className = '' }: { k: typeof sortKey; label: string; className?: string }) => (
                  <button onClick={() => toggleSort(k)} className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${className}`}>
                    {label}
                    {sortKey === k && (sortDir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
                  </button>
                );
                return (
                  <>
                    <div className="lg:w-32 lg:text-center"><SortBtn k="account" label="Account" /></div>
                    <div className="flex-1 min-w-0"><SortBtn k="category" label="Category / Merchant" /></div>
                    <div className="lg:flex lg:items-center lg:gap-6">
                      <SortBtn k="amount" label="Amount" />
                      <div className="lg:w-16 lg:text-right"><SortBtn k="date" label="Date" /></div>
                    </div>
                    <div className="w-[26px] shrink-0" />
                  </>
                );
              })()}
            </div>
            {rows.slice(0, visibleCount).map((row, i) => {
              if (row.type === 'transfer') {
                return renderTransfer(row.transfer, i);
              }
              if (row.type === 'single') {
                return renderSingleTx(row.transaction, i);
              }

              // Split group
              const expanded = expandedSplits.has(row.key);
              return (
                <div key={row.key}>
                  <div
                    onClick={() => toggleSplit(row.key)}
                    className="flex items-center gap-3 px-4 py-3 lg:py-3 animate-fade-up cursor-pointer active:bg-muted/50 transition-all lg:border-b lg:border-border/60 lg:last:border-0"
                    style={{ animationDelay: `${i * 30}ms`, animationFillMode: 'both' }}
                  >
                    <span className={`text-[10px] lg:text-xs font-semibold px-2 py-1 rounded-full shrink-0 whitespace-nowrap lg:w-32 lg:text-center ${
                      accounts.findIndex(a => a.id === row.account) === 0
                        ? 'bg-primary text-primary-foreground'
                        : accounts.findIndex(a => a.id === row.account) === 1
                          ? 'bg-accent text-accent-foreground'
                          : 'bg-muted text-muted-foreground'
                    }`}>
                      {accountLabels[row.account] || row.account}
                    </span>

                    <div className="flex-1 min-w-0 lg:flex lg:items-baseline lg:gap-2">
                      <p className="text-sm lg:text-base font-semibold truncate text-foreground">
                        Split
                      </p>
                      {row.description ? (
                        <p className="text-[11px] lg:text-xs text-muted-foreground/70 truncate mt-0.5 lg:mt-0 font-normal">{row.description}</p>
                      ) : null}
                      {row.notes ? (
                        <p className="text-[10px] lg:text-xs italic truncate mt-0.5 lg:mt-0 text-muted-foreground/70">📝 {row.notes}</p>
                      ) : null}
                    </div>

                    <div className="text-right shrink-0 lg:flex lg:items-center lg:gap-6">
                      <p className="text-sm lg:text-base font-medium lg:font-semibold tabular-nums text-foreground">
                        {formatCurrency(row.totalAmount)}
                      </p>
                      <p className="text-[11px] lg:text-sm text-muted-foreground mt-0.5 lg:mt-0 lg:w-16 lg:text-right">
                        {format(new Date(row.date), 'MMM d')}
                      </p>
                    </div>

                    <div className="w-[26px] shrink-0 flex items-center justify-center text-muted-foreground/70">
                      {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
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
        {rows.length > visibleCount && (
          <div className="mt-4 flex flex-col items-center gap-2">
            <button
              onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
              className="px-5 py-2 rounded-full bg-card text-foreground text-xs font-semibold shadow-sm border border-border active:scale-95 transition-transform"
            >
              Show 50 more
            </button>
            <p className="text-[10px] text-muted-foreground">
              Showing {visibleCount} of {rows.length}
            </p>
          </div>
        )}
      </div>

      <button
        onClick={onAddTransaction}
        className="lg:hidden fixed bottom-24 right-6 w-14 h-14 rounded-full bg-accent text-accent-foreground shadow-lg flex items-center justify-center active:scale-95 transition-transform z-40"
      >
        <Plus size={24} strokeWidth={2.5} />
      </button>

      <AlertDialog open={!!pendingDeleteId} onOpenChange={(o) => !o && setPendingDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this transaction?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the transaction and update your budget totals. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleConfirmDelete(); }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
