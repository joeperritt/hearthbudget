import { useMemo, useState } from 'react';
import { Transaction, BudgetCategory, BudgetTransfer, FixedExpense, categoryRequiresNotes, INCOME_CATEGORY, DEPOSIT_CATEGORY, TRANSFER_CATEGORY, CC_PAYMENT_CATEGORY, PRIOR_MONTH_CATEGORY } from '@/types/budget';
import { ProgressBar } from './ProgressBar';
import { AppAccount } from '@/hooks/useAccounts';
import { ArrowLeft, ArrowLeftRight, Search, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { getTransactionAmountPresentation } from '@/lib/transactionAmountDisplay';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
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
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(Math.abs(n));
}

interface DetailCategory {
  id: string;
  name: string;
  budgeted: number;
}

interface CategoryDetailProps {
  category: DetailCategory;
  categories: BudgetCategory[];
  fixedExpenses?: FixedExpense[];
  transactions: Transaction[];
  deposits?: Transaction[];
  transfers: BudgetTransfer[];
  spent: number;
  transferAdjustment: number;
  onBack: () => void;
  onDeleteTransaction: (id: string) => void;
  onDeleteTransfer?: (id: string) => Promise<void> | void;
  onGoToTransaction?: (transactionId: string) => void;
  accounts?: AppAccount[];
}

export function CategoryDetail({ category, categories, fixedExpenses = [], transactions, deposits = [], transfers, spent, transferAdjustment, onBack, onDeleteTransaction, onDeleteTransfer, onGoToTransaction, accounts = [] }: CategoryDetailProps) {
  const [selectedTransfer, setSelectedTransfer] = useState<BudgetTransfer | null>(null);
  const [pendingDeleteTransferId, setPendingDeleteTransferId] = useState<string | null>(null);
  const [deletingTransfer, setDeletingTransfer] = useState(false);
  const adjustedBudget = category.budgeted + transferAdjustment;
  const accountLabelMap = useMemo(() => {
    const m: Record<string, string> = {};
    accounts.forEach(a => { m[a.id] = a.label; });
    return m;
  }, [accounts]);
  const remaining = adjustedBudget - spent;
  const sorted = [...transactions].sort((a, b) => b.date.localeCompare(a.date));
  // Build a combined lookup map for both variable categories and fixed expenses
  const nameMap: Record<string, string> = {};
  categories.forEach(c => { nameMap[c.id] = c.name; });
  fixedExpenses.forEach(e => { nameMap[e.id] = e.name; });
  const fixedMap = Object.fromEntries(fixedExpenses.map(e => [e.id, e]));

  // Transfers involving this category
  const relevantTransfers = transfers.filter(
    t => t.fromCategoryId === category.id || t.toCategoryId === category.id
  ).sort((a, b) => b.date.localeCompare(a.date));

  const renderTxRow = (t: Transaction, i: number) => {
    const isCcPayment = t.transactionType === 'cc-payment' || t.categoryId === CC_PAYMENT_CATEGORY;
    const isIncome = !isCcPayment && (t.categoryId === INCOME_CATEGORY || (t.transactionType === 'income' && t.categoryId !== PRIOR_MONTH_CATEGORY));
    const isTransfer = t.categoryId === TRANSFER_CATEGORY;
    const isPriorMonth = t.categoryId === PRIOR_MONTH_CATEGORY;
    const isDeposit = t.categoryId === DEPOSIT_CATEGORY || t.transactionType === 'deposit';
    const isExcluded = isIncome || isDeposit || isTransfer || isCcPayment || isPriorMonth;
    const isIgnored = isIncome || isTransfer || isPriorMonth;

    const accountIdx = accounts.findIndex(a => a.id === t.account);

    return (
      <div
        key={t.id}
        onClick={() => onGoToTransaction?.(t.id)}
        className={`flex items-center gap-3 px-4 py-3 animate-fade-up cursor-pointer active:bg-muted/50 transition-colors ${isIgnored ? 'opacity-30 grayscale' : ''}`}
        style={{ animationDelay: `${i * 30}ms`, animationFillMode: 'both' }}
      >
        <span className={`text-[10px] font-semibold px-2 py-1 rounded-full shrink-0 whitespace-nowrap ${
          accountIdx === 0
            ? 'bg-primary text-primary-foreground'
            : accountIdx === 1
              ? 'bg-accent text-accent-foreground'
              : 'bg-muted text-muted-foreground'
        }`}>
          {accountLabelMap[t.account] || t.account}
        </span>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">
            {t.description || '(no description)'}
            {fixedMap[t.categoryId] && (
              <span className="ml-1.5 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full align-middle">fixed</span>
            )}
            {t.isTransferToSavings && (
              <span className="ml-1.5 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full align-middle">savings</span>
            )}
          </p>
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
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {format(new Date(t.date), 'MMM d')}
          </p>
        </div>

        <Search size={14} className="text-muted-foreground/40 shrink-0" />
      </div>
    );
  };

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
          {(() => {
            const refundTotal = deposits.reduce((s, d) => s + Math.abs(d.amount), 0);
            const grossSpent = spent + refundTotal;
            return (
              <>
                <p className="text-xs text-muted-foreground mt-2 tabular-nums">{formatCurrency(spent)} net spent</p>
                {refundTotal > 0 && (
                  <p className="text-[10px] text-muted-foreground tabular-nums">
                    ({formatCurrency(grossSpent)} spent − {formatCurrency(refundTotal)} in refunds)
                  </p>
                )}
              </>
            );
          })()}
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
                <div
                  key={t.id}
                  onClick={() => setSelectedTransfer(t)}
                  className="flex items-center gap-3 px-4 py-3 animate-fade-up cursor-pointer active:bg-muted/50 transition-colors"
                  style={{ animationDelay: `${i * 40}ms`, animationFillMode: 'both' }}
                >
                  <ArrowLeftRight size={12} className="text-muted-foreground/50 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">
                      {isFrom ? `→ ${otherName}` : `← ${otherName}`}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{format(new Date(t.date), 'MMM d')}</p>
                  </div>
                  <span className={`text-sm font-medium tabular-nums shrink-0 ${isFrom ? 'text-destructive' : 'text-accent'}`}>
                    {isFrom ? '-' : '+'}{formatCurrency(t.amount)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}


      <div className="px-6 mt-6 pb-6">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Transactions</h3>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No transactions yet</p>
        ) : (
          <div className="bg-card rounded-lg shadow-sm divide-y divide-border overflow-hidden">
            {sorted.map((t, i) => renderTxRow(t, i))}
          </div>
        )}
      </div>
      <Dialog open={!!selectedTransfer} onOpenChange={(o) => !o && setSelectedTransfer(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Fund Transfer</DialogTitle>
            <DialogDescription>Reallocation between budget categories.</DialogDescription>
          </DialogHeader>
          {selectedTransfer && (() => {
            const fromName = nameMap[selectedTransfer.fromCategoryId] || 'Unknown';
            const toName = nameMap[selectedTransfer.toCategoryId] || 'Unknown';
            return (
              <div className="space-y-3 py-2">
                <div className="flex justify-between items-baseline">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">Date</span>
                  <span className="text-sm font-medium text-foreground">{format(new Date(selectedTransfer.date), 'MMM d, yyyy')}</span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">Amount</span>
                  <span className="text-sm font-semibold tabular-nums text-foreground">{formatCurrency(selectedTransfer.amount)}</span>
                </div>
                <div className="pt-2 border-t border-border">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">Movement</p>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-foreground font-medium">{fromName}</span>
                    <ArrowLeftRight size={14} className="text-muted-foreground" />
                    <span className="text-foreground font-medium">{toName}</span>
                  </div>
                </div>
              </div>
            );
          })()}
          <DialogFooter className="sm:justify-between gap-2">
            <Button variant="ghost" onClick={() => setSelectedTransfer(null)}>Close</Button>
            {onDeleteTransfer && (
              <Button
                variant="destructive"
                onClick={() => selectedTransfer && setPendingDeleteTransferId(selectedTransfer.id)}
                className="gap-1.5"
              >
                <Trash2 size={14} /> Delete this transfer
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingDeleteTransferId} onOpenChange={(o) => !o && setPendingDeleteTransferId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this fund transfer?</AlertDialogTitle>
            <AlertDialogDescription>
              This will reverse the reallocation between the two categories. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingTransfer}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletingTransfer}
              onClick={async (e) => {
                e.preventDefault();
                if (!pendingDeleteTransferId || !onDeleteTransfer) return;
                try {
                  setDeletingTransfer(true);
                  await onDeleteTransfer(pendingDeleteTransferId);
                  toast.success('Fund transfer deleted');
                  setPendingDeleteTransferId(null);
                  setSelectedTransfer(null);
                } catch (err) {
                  toast.error('Failed to delete transfer');
                } finally {
                  setDeletingTransfer(false);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingTransfer ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
