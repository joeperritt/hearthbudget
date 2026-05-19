import { useEffect, useState } from 'react';
import { BudgetCategory, BudgetTransfer, FixedExpense, Transaction, DEPOSIT_CATEGORY, INCOME_CATEGORY, TRANSFER_CATEGORY, CC_PAYMENT_CATEGORY, PRIOR_MONTH_CATEGORY } from '@/types/budget';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

interface MoveFundsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: BudgetCategory[];
  fixedExpenses?: FixedExpense[];
  fromCategoryId: string;
  onMove: (transfer: Omit<BudgetTransfer, 'id'>) => void;
  monthTransactions?: Transaction[];
  transferAdjustments?: Record<string, number>;
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(Math.abs(n));
}

const EXCLUDED_CATS = new Set([DEPOSIT_CATEGORY, INCOME_CATEGORY, TRANSFER_CATEGORY, CC_PAYMENT_CATEGORY, PRIOR_MONTH_CATEGORY]);

interface BucketStats {
  budgeted: number;
  netSpent: number;
}

function getBucketStats(
  id: string,
  categories: BudgetCategory[],
  fixedExpenses: FixedExpense[],
  transactions: Transaction[],
  transferAdjustment: number,
): BucketStats | null {
  const cat = categories.find(c => c.id === id);
  const fixed = fixedExpenses.find(e => e.id === id);
  const baseBudget = cat?.budgeted ?? fixed?.amount ?? 0;
  if (baseBudget === 0 && transferAdjustment === 0) return null;
  const budgeted = baseBudget + transferAdjustment;

  const spent = transactions
    .filter(t => t.categoryId === id && t.transactionType === 'expense' && !EXCLUDED_CATS.has(t.categoryId))
    .reduce((s, t) => s + t.amount, 0);
  const deposits = transactions
    .filter(t => t.categoryId === id && t.transactionType === 'deposit')
    .reduce((s, t) => s + Math.abs(t.amount), 0);

  return { budgeted, netSpent: spent - deposits };
}

/** green < 75%, yellow 75–99%, red >= 100% */
function fillClass(pct: number, translucent = false) {
  if (pct >= 100) return translucent ? 'bg-destructive/40' : 'bg-destructive';
  if (pct >= 75) return translucent ? 'bg-yellow-500/40' : 'bg-yellow-500';
  return translucent ? 'bg-green-500/40' : 'bg-green-500';
}

interface TransferBarProps {
  label: string;
  stats: BucketStats;
  /** Positive = bucket loses funds (FROM); Negative = bucket gains funds (TO) */
  delta: number;
}

function TransferBar({ label, stats, delta }: TransferBarProps) {
  const { netSpent } = stats;
  const oldBudget = stats.budgeted;
  const newBudget = Math.max(oldBudget - delta, 0); // delta>0 reduces, delta<0 increases
  const oldRemaining = oldBudget - netSpent;
  const newRemaining = newBudget - netSpent;
  const hasDelta = delta !== 0;

  // Bar scaled to whichever budget is largest, so growth (TO) extends right
  const scaleMax = Math.max(oldBudget, newBudget, netSpent, 1);

  const spentPct = Math.min((netSpent / scaleMax) * 100, 100);
  const oldBudgetRatio = (netSpent / Math.max(oldBudget, 1)) * 100;
  const newBudgetRatio = newBudget > 0 ? (netSpent / newBudget) * 100 : 100;

  const overOld = netSpent > oldBudget;
  const overNew = netSpent > newBudget;

  // Translucent overlay region representing the delta
  let overlayLeftPct = 0;
  let overlayWidthPct = 0;
  let overlayClass = '';
  if (hasDelta) {
    if (delta > 0) {
      // FROM: budget shrinks; overlay covers the area being pulled out (between newBudget and oldBudget)
      const start = (newBudget / scaleMax) * 100;
      const end = (oldBudget / scaleMax) * 100;
      overlayLeftPct = Math.max(start, 0);
      overlayWidthPct = Math.max(end - start, 0);
      overlayClass = fillClass(newBudgetRatio, true);
    } else {
      // TO: budget grows; overlay covers the area being added (between oldBudget and newBudget)
      const start = (oldBudget / scaleMax) * 100;
      const end = (newBudget / scaleMax) * 100;
      overlayLeftPct = Math.max(start, 0);
      overlayWidthPct = Math.max(end - start, 0);
      overlayClass = fillClass(newBudgetRatio, true);
    }
  }

  return (
    <div>
      <div className="flex justify-between items-baseline mb-1">
        <span className="text-xs font-medium text-foreground">{label}</span>
      </div>
      <div className="relative h-1.5 rounded-full bg-muted overflow-hidden">
        {/* Solid spent fill */}
        <div
          className={`absolute left-0 top-0 h-full transition-all duration-300 ease-out ${fillClass(oldBudgetRatio)}`}
          style={{ width: `${spentPct}%` }}
        />
        {/* Translucent delta overlay */}
        {hasDelta && overlayWidthPct > 0 && (
          <div
            className={`absolute top-0 h-full transition-all duration-300 ease-out ${overlayClass}`}
            style={{ left: `${overlayLeftPct}%`, width: `${overlayWidthPct}%` }}
          />
        )}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {formatCurrency(netSpent)} spent
          {hasDelta && (
            <span className="ml-1 text-muted-foreground/70">
              · {delta > 0 ? '−' : '+'}{formatCurrency(Math.abs(delta))} transfer
            </span>
          )}
        </span>
        <span className="text-[10px] tabular-nums font-medium flex items-center gap-1.5">
          {hasDelta ? (
            <>
              <span className="text-muted-foreground">
                {overOld ? `-${formatCurrency(Math.abs(oldRemaining))} over` : `${formatCurrency(oldRemaining)} left`}
              </span>
              <span className="text-muted-foreground">→</span>
              <span className={overNew ? 'text-destructive' : 'text-primary'}>
                {overNew ? `Over by ${formatCurrency(Math.abs(newRemaining))}` : `${formatCurrency(newRemaining)} left`}
              </span>
            </>
          ) : (
            <span className={overOld ? 'text-destructive' : 'text-muted-foreground'}>
              {overOld ? `-${formatCurrency(Math.abs(oldRemaining))} over` : `${formatCurrency(oldRemaining)} left`}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

export function MoveFundsSheet({ open, onOpenChange, categories, fixedExpenses = [], fromCategoryId, onMove, monthTransactions = [], transferAdjustments = {} }: MoveFundsSheetProps) {
  const [toCategoryId, setToCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  // When no `fromCategoryId` is supplied (e.g. the global "Transfer Between
  // Buckets" entry point), let the user pick the source too.
  const [pickedFromId, setPickedFromId] = useState('');
  const effectiveFromId = fromCategoryId || pickedFromId;
  const fromIsLocked = !!fromCategoryId;

  // Reset internal selections whenever the sheet closes/reopens or the preset
  // changes, so a fresh open never carries stale state.
  useEffect(() => {
    if (!open) {
      setToCategoryId('');
      setAmount('');
      setPickedFromId('');
    }
  }, [open, fromCategoryId]);

  const allItems = [
    ...categories.map(c => ({ id: c.id, name: c.name })),
    ...fixedExpenses.map(e => ({ id: e.id, name: e.name })),
  ];
  const otherItems = allItems.filter(c => c.id !== effectiveFromId);
  const fromItem = allItems.find(c => c.id === effectiveFromId);

  const amt = parseFloat(amount) || 0;

  const fromStats = effectiveFromId
    ? getBucketStats(effectiveFromId, categories, fixedExpenses, monthTransactions, transferAdjustments[effectiveFromId] || 0)
    : null;
  const toStats = toCategoryId
    ? getBucketStats(toCategoryId, categories, fixedExpenses, monthTransactions, transferAdjustments[toCategoryId] || 0)
    : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveFromId || !toCategoryId || amt <= 0) return;
    onMove({
      date: new Date().toISOString().slice(0, 10),
      fromCategoryId: effectiveFromId,
      toCategoryId,
      amount: amt,
    });
    setAmount('');
    setToCategoryId('');
    setPickedFromId('');
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-w-[560px] mx-auto bg-background">
        <SheetHeader>
          <SheetTitle className="font-display text-lg">Move Funds</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4 pb-8">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">From</label>
            <div className="w-full mt-1 px-3 py-2.5 rounded-lg bg-muted/50 border border-border text-sm text-foreground">
              {fromItem?.name || 'Unknown'}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">To</label>
            <select
              value={toCategoryId}
              onChange={e => setToCategoryId(e.target.value)}
              className="w-full mt-1 px-3 py-2.5 rounded-lg bg-card border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
            >
              <option value="">Select category…</option>
              {otherItems.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Amount</label>
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="$0.00"
              className="w-full mt-1 px-3 py-2.5 rounded-lg bg-card border border-border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent/30 tabular-nums"
            />
          </div>

          {(fromStats || toStats) && (
            <div className="space-y-3 px-3 py-3 rounded-lg bg-muted/30 border border-border">
              {fromStats && (
                <TransferBar
                  label={fromItem?.name ? `From · ${fromItem.name}` : 'From'}
                  stats={fromStats}
                  delta={amt}
                />
              )}
              {toStats && (
                <TransferBar
                  label={`To · ${allItems.find(i => i.id === toCategoryId)?.name ?? ''}`}
                  stats={toStats}
                  delta={-amt}
                />
              )}
            </div>
          )}

          <button
            type="submit"
            className="w-full py-3 rounded-xl bg-accent text-accent-foreground font-semibold text-sm active:scale-[0.98] transition-transform shadow-sm"
          >
            Move Funds
          </button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
