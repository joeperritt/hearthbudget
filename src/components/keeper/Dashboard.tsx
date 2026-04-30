import { useState, useMemo, useEffect, useCallback } from 'react';
import { format, differenceInDays, startOfMonth, addMonths, formatDistanceToNow } from 'date-fns';
import { ProgressBar } from './ProgressBar';
import { Plus, Inbox, RefreshCw, CreditCard, Building2, BarChart3, ChevronDown, ChevronUp, AlertTriangle, X, CheckCircle2 } from 'lucide-react';
import { Transaction, AccountSource, BudgetCategory, FixedExpense, CC_PAYMENT_CATEGORY, IGNORE_CATEGORY_SLUGS } from '@/types/budget';
import { CategoryCarousel } from './CategoryCarousel';
import { supabase } from '@/integrations/supabase/client';
import { getTransactionAmountPresentation } from '@/lib/transactionAmountDisplay';
import { AppAccount } from '@/hooks/useAccounts';
import { usePlaidLink } from 'react-plaid-link';
import { toast } from 'sonner';

type ReconnectItem = { id: string; institution_name: string };

function ReconnectBanner({
  items,
  onDismiss,
  onReconnected,
}: {
  items: ReconnectItem[];
  onDismiss: () => void;
  onReconnected: (itemId: string) => void;
}) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [pendingItem, setPendingItem] = useState<ReconnectItem | null>(null);

  const onSuccess = useCallback(
    async (publicToken: string, metadata: any) => {
      try {
        const institution = metadata.institution as Record<string, string> | undefined;
        const accounts = metadata.accounts as Array<Record<string, string>> | undefined;
        await supabase.functions.invoke('plaid-exchange-token', {
          body: { public_token: publicToken, institution_name: institution?.name || pendingItem?.institution_name || '', accounts: accounts || [] },
        });
        if (pendingItem) {
          await supabase
            .from('plaid_items')
            .update({ requires_reconnect: false, last_sync_error: null, sync_failure_count: 0 })
            .eq('id', pendingItem.id);
          onReconnected(pendingItem.id);
        }
        toast.success('Bank reconnected!');
      } catch {
        toast.error('Failed to reconnect bank');
      } finally {
        setLinkToken(null);
        setPendingItem(null);
      }
    },
    [pendingItem, onReconnected]
  );

  const { open: openPlaid, ready: plaidReady } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit: () => { setLinkToken(null); setPendingItem(null); },
  });

  useEffect(() => {
    if (linkToken && plaidReady) openPlaid();
  }, [linkToken, plaidReady, openPlaid]);

  const handleClick = async () => {
    if (items.length > 1) {
      window.dispatchEvent(new CustomEvent('open-bank-connections'));
      return;
    }
    const item = items[0];
    setPendingItem(item);
    try {
      const { data, error } = await supabase.functions.invoke('plaid-create-link-token');
      if (error) throw error;
      setLinkToken(data.link_token);
    } catch {
      toast.error('Failed to initialize reconnection');
      setPendingItem(null);
    }
  };

  return (
    <div className="mx-6 mt-4 bg-destructive/10 border border-destructive/20 rounded-lg p-3.5 flex gap-3 items-start animate-fade-up">
      <AlertTriangle size={18} className="text-destructive shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">
          {items.length === 1
            ? `${items[0].institution_name} needs to be reconnected to continue syncing.`
            : `${items.length} accounts need reconnection: ${items.map(i => i.institution_name).join(', ')}.`}
        </p>
        <button
          onClick={handleClick}
          className="text-sm font-medium text-accent mt-1 active:scale-95"
        >
          Reconnect →
        </button>
      </div>
      <button onClick={onDismiss} className="text-muted-foreground/60 hover:text-foreground" aria-label="Dismiss">
        <X size={16} />
      </button>
    </div>
  );
}


function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}

type AccountFilter = 'all' | string;

function UnassignedSection({
  unassignedTransactions,
  onEditTransaction,
  accounts = [],
  onViewAll,
  onViewAllActivity,
}: {
  unassignedTransactions: Transaction[];
  onEditTransaction: (tx: Transaction) => void;
  accounts?: AppAccount[];
  onViewAll?: () => void;
  onViewAllActivity?: () => void;
}) {
  const [filter, setFilter] = useState<AccountFilter>('all');
  const labelMap = useMemo(() => {
    const m: Record<string, string> = {};
    accounts.forEach(a => { m[a.id] = a.label; });
    return m;
  }, [accounts]);

  const filtered = filter === 'all' ? unassignedTransactions : unassignedTransactions.filter(t => t.account === filter);

  // Positive empty state when nothing is unassigned — keeps the section as a consistent visual anchor
  if (unassignedTransactions.length === 0) {
    return (
      <div className="px-6 mt-6 mb-6 animate-fade-up" style={{ animationDelay: '350ms', animationFillMode: 'both' }}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider shrink-0">Unassigned</h3>
        </div>
        <div className="bg-card rounded-lg shadow-sm px-4 py-6 flex flex-col items-center justify-center">
          <CheckCircle2 size={28} className="text-success mb-2" />
          <p className="text-sm text-foreground">All caught up — no unassigned transactions</p>
          {onViewAllActivity && (
            <button
              onClick={onViewAllActivity}
              className="mt-2 text-[11px] lg:text-xs text-primary hover:underline font-medium"
            >
              View all activity →
            </button>
          )}
        </div>
      </div>
    );
  }

  const accountFilters: { id: AccountFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    ...accounts.map(a => ({ id: a.id, label: a.label })),
  ];

  // Newest-first within current filter; show up to 5
  const sorted = [...filtered].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const visible = sorted.slice(0, 5);
  const total = filtered.length;

  return (
    <div className="px-6 mt-6 mb-6 animate-fade-up" style={{ animationDelay: '350ms', animationFillMode: 'both' }}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider shrink-0">Unassigned</h3>
        <div className="flex gap-1 lg:gap-2">
          {accountFilters.map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-2 py-0.5 lg:px-4 lg:py-2 rounded-full text-[10px] lg:text-sm font-medium transition-colors active:scale-95 ${
                filter === f.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card text-muted-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="bg-card rounded-lg shadow-sm px-4 py-6 flex flex-col items-center justify-center">
          <Inbox size={24} className="text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground">No unassigned transactions</p>
          <p className="text-[11px] text-muted-foreground/60 mt-0.5">No unassigned transactions for this account</p>
        </div>
      ) : (
        <>
          <div className="bg-card rounded-lg shadow-sm divide-y divide-border lg:divide-y-0 overflow-hidden">
            {visible.map(tx => {
              const accountIdx = accounts.findIndex(a => a.id === tx.account);
              const chipClass = accountIdx === 0
                ? 'bg-primary text-primary-foreground'
                : accountIdx === 1
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-muted text-muted-foreground';
              const { colorClassName, prefix, value } = getTransactionAmountPresentation(tx);
              return (
                <div
                  key={tx.id}
                  onClick={() => onEditTransaction(tx)}
                  className="cursor-pointer active:bg-muted/50 transition-colors lg:border-b lg:border-border/60 lg:last:border-0"
                >
                  {/* Mobile layout (unchanged) */}
                  <div className="flex justify-between items-center px-4 py-3 lg:hidden">
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-sm text-foreground truncate">{tx.description || 'No description'}</span>
                      <span className="text-[11px] text-muted-foreground">{tx.date} · {labelMap[tx.account] || tx.account}</span>
                    </div>
                    <span className={`text-sm font-medium tabular-nums ml-3 ${colorClassName}`}>
                      {prefix}{formatCurrency(value)}
                    </span>
                  </div>
                  {/* Desktop layout — matches Activity tab rows */}
                  <div className="hidden lg:flex items-center gap-3 px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full shrink-0 whitespace-nowrap w-32 text-center ${chipClass}`}>
                      {labelMap[tx.account] || tx.account}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-base font-semibold text-foreground truncate">
                        {tx.description || 'No description'}
                      </p>
                    </div>
                    <div className="flex items-center gap-6 shrink-0">
                      <p className={`text-base font-semibold tabular-nums ${colorClassName}`}>
                        {prefix}{formatCurrency(value)}
                      </p>
                      <p className="text-sm text-muted-foreground w-16 text-right">
                        {format(new Date(tx.date), 'MMM d')}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="px-1 pt-2 text-[11px] lg:text-xs text-muted-foreground">
            {total > 5 ? (
              <>
                Showing 5 of {total} unassigned
                {onViewAll && (
                  <>
                    {' — '}
                    <button
                      onClick={onViewAll}
                      className="text-primary hover:underline font-medium"
                    >
                      view all in Activity →
                    </button>
                  </>
                )}
              </>
            ) : (
              <>Showing {total} unassigned</>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Stacked horizontal bar showing spending vs payoffs/deposits */
function StackedBar({ segments }: { segments: { value: number; color: string; label: string }[] }) {
  const total = segments.reduce((s, seg) => s + Math.abs(seg.value), 0);
  if (total === 0) return null;

  return (
    <div className="flex h-3 rounded-full overflow-hidden bg-muted">
      {segments.filter(s => Math.abs(s.value) > 0).map((seg, i) => (
        <div
          key={i}
          className="h-full transition-all duration-500 first:rounded-l-full last:rounded-r-full"
          style={{
            width: `${(Math.abs(seg.value) / total) * 100}%`,
            backgroundColor: seg.color,
          }}
          title={`${seg.label}: ${formatCurrency(Math.abs(seg.value))}`}
        />
      ))}
    </div>
  );
}

function BankSection({
  icon,
  title,
  rows,
  netLabel,
  netValue,
  barSegments,
}: {
  icon: React.ReactNode;
  title: string;
  rows: { label: string; value: number; color?: string }[];
  netLabel: string;
  netValue: number;
  barSegments: { value: number; color: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-card rounded-lg shadow-sm overflow-hidden">
      {/* Collapsed summary row */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 active:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-semibold text-foreground">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold tabular-nums text-foreground">
            Total {netValue < 0 ? '−' : ''}{formatCurrency(Math.abs(netValue))}
          </span>
          {open ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
        </div>
      </button>

      {/* Expanded details */}
      {open && (
        <>
          {/* Stacked bar */}
          <div className="px-4 pt-3 pb-1 border-t border-border">
            <StackedBar segments={barSegments} />
            <div className="flex gap-3 mt-1.5 flex-wrap">
              {barSegments.filter(s => Math.abs(s.value) > 0).map((seg, i) => (
                <div key={i} className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: seg.color }} />
                  <span className="text-[10px] text-muted-foreground">{seg.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Rows */}
          <div className="divide-y divide-border">
            {rows.map((row, i) => (
              <div key={i} className="flex justify-between items-center px-4 py-2.5">
                <span className="text-sm text-muted-foreground">{row.label}</span>
                <span className={`text-sm font-medium tabular-nums ${row.color || 'text-foreground'}`}>
                  {row.value < 0 ? '−' : ''}{formatCurrency(Math.abs(row.value))}
                </span>
              </div>
            ))}
          </div>

          {/* Net total */}
          <div className="flex justify-between items-center px-4 py-3 bg-accent/5 border-t border-border">
            <span className="text-sm font-semibold text-foreground">{netLabel}</span>
            <span className={`text-sm font-bold tabular-nums ${netValue < 0 ? 'text-accent' : 'text-foreground'}`}>
              {netValue < 0 ? '−' : ''}{formatCurrency(Math.abs(netValue))}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/** Banner shown last 3 days of month if unassigned transactions exist */
function EndOfMonthBanner({ count }: { count: number }) {
  const today = new Date();
  const nextMonth = startOfMonth(addMonths(today, 1));
  const daysLeft = differenceInDays(nextMonth, today);

  if (daysLeft > 3 || count === 0) return null;

  return (
    <div className="mx-6 mt-4 bg-destructive/10 border border-destructive/20 rounded-lg p-3.5 flex gap-3 items-start animate-fade-up">
      <AlertTriangle size={18} className="text-destructive shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-medium text-foreground">
          {count} unassigned transaction{count > 1 ? 's' : ''}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Month rolls over automatically on the 1st — clean these up before then.
        </p>
      </div>
    </div>
  );
}

interface DashboardProps {
  monthLabel: string;
  onAddTransaction: () => void;
  accountSpending: { label: string; amount: number; type: string }[];
  totalPayoffs: number;
  unassignedTransactions: Transaction[];
  onEditTransaction: (tx: Transaction) => void;
  onSyncComplete?: () => void;
  categories?: BudgetCategory[];
  fixedExpenses?: FixedExpense[];
  spentByCategory?: Record<string, number>;
  transferAdjustments?: Record<string, number>;
  onSelectCategory?: (id: string) => void;
  onSelectFixedExpense?: (id: string) => void;
  accounts?: AppAccount[];
  monthTransactions?: Transaction[];
  totalBudget?: number;
  totalVariableSpent?: number;
  totalFixedSpent?: number;
  insightsSection?: React.ReactNode;
  /** Optional slot rendered between the sync header and the unassigned section.
   *  Used by Index.tsx to drop in dismissible post-onboarding cards. */
  topBanner?: React.ReactNode;
  onViewAllUnassigned?: () => void;
  onViewAllActivity?: () => void;
}

export function Dashboard({
  monthLabel, onAddTransaction,
  accountSpending, totalPayoffs,
  unassignedTransactions, onEditTransaction, onSyncComplete,
  categories: varCategories, fixedExpenses = [], spentByCategory, transferAdjustments, onSelectCategory, onSelectFixedExpense,
  accounts = [],
  monthTransactions = [],
  totalBudget = 0,
  totalVariableSpent = 0,
  totalFixedSpent = 0,
  insightsSection,
  topBanner,
  onViewAllUnassigned,
  onViewAllActivity,
}: DashboardProps) {
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedLabel, setLastSyncedLabel] = useState<string | null>(null);
  const [flashLabel, setFlashLabel] = useState<string | null>(null);
  const [reconnectItems, setReconnectItems] = useState<{ id: string; institution_name: string }[]>([]);
  const [reconnectDismissed, setReconnectDismissed] = useState(false);

  // Fetch last sync time + items needing reconnect
  useEffect(() => {
    const fetchSyncState = async () => {
      const { data: synced } = await supabase
        .from('plaid_items')
        .select('last_successful_sync_at, last_synced_at')
        .order('last_successful_sync_at', { ascending: false, nullsFirst: false })
        .limit(1);
      const ts = synced?.[0]?.last_successful_sync_at || synced?.[0]?.last_synced_at;
      if (ts) setLastSyncedLabel(formatDistanceToNow(new Date(ts), { addSuffix: true }));

      const { data: reconnect } = await supabase
        .from('plaid_items')
        .select('id, institution_name')
        .eq('requires_reconnect', true);
      setReconnectItems((reconnect || []) as { id: string; institution_name: string }[]);
    };
    fetchSyncState();
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const headers = { Authorization: `Bearer ${session.access_token}` };
      await supabase.functions.invoke('plaid-sync-transactions', { headers });
      setLastSyncedLabel('just now');
      setFlashLabel('Synced!');
      onSyncComplete?.();
      setTimeout(() => setFlashLabel(null), 3000);
    } catch (e) {
      console.error('Sync failed:', e);
    } finally {
      setSyncing(false);
    }
  };

  // Compute per-bank-group data
  const creditAccounts = accounts.filter(a => a.type === 'credit_card');
  const checkingAccounts = accounts.filter(a => a.type === 'checking');

  // Source-of-truth ignore filter — matches Index.isExcluded category-id checks.
  // Any transaction the user (or auto-detection) marked as "ignore" must be
  // FULLY excluded from every aggregate on the snapshot, the same way the
  // Spending tab and Budget tab math handle them.
  const isIgnored = (t: Transaction) => IGNORE_CATEGORY_SLUGS.has(t.categoryId);

  // Credit card spending by sub-account
  const creditRows = useMemo(() => {
    return creditAccounts.map(acct => {
      const spent = monthTransactions
        .filter(t => t.account === acct.id && t.transactionType === 'expense' && !isIgnored(t))
        .reduce((s, t) => s + t.amount, 0);
      return { label: acct.label, value: spent };
    });
  }, [creditAccounts, monthTransactions]);

  const totalCreditSpent = creditRows.reduce((s, r) => s + r.value, 0);

  // CC payments (payoffs) — money going back
  const creditPayoffs = useMemo(() => {
    return monthTransactions
      .filter(t => creditAccounts.some(a => a.id === t.account) && t.transactionType === 'cc-payment' && !isIgnored(t))
      .reduce((s, t) => s + Math.abs(t.amount), 0);
  }, [monthTransactions, creditAccounts]);

  const creditNet = totalCreditSpent - creditPayoffs;

  // Checking spending
  const checkingSpent = useMemo(() => {
    return monthTransactions
      .filter(t => checkingAccounts.some(a => a.id === t.account) && t.transactionType === 'expense' && !isIgnored(t))
      .reduce((s, t) => s + t.amount, 0);
  }, [monthTransactions, checkingAccounts]);

  // Checking deposits toward budget — exclude any deposit the user ignored
  // (e.g. a paycheck that's already accounted for elsewhere).
  const checkingDeposits = useMemo(() => {
    return monthTransactions
      .filter(t => checkingAccounts.some(a => a.id === t.account) && t.transactionType === 'deposit' && !isIgnored(t))
      .reduce((s, t) => s + Math.abs(t.amount), 0);
  }, [monthTransactions, checkingAccounts]);

  const checkingNet = checkingSpent - checkingDeposits;

  // Overall totals — gross spending across all accounts (excludes CC payments, which are internal transfers)
  const overallSpent = useMemo(() => {
    return monthTransactions
      .filter(t => t.transactionType === 'expense' && !isIgnored(t))
      .reduce((s, t) => s + Math.abs(t.amount), 0);
  }, [monthTransactions]);

  // Deposits & credits — money flowing in that offsets spending
  // (checking deposits + credit card refunds/credits + CC payments received on the credit side)
  const overallDeposits = useMemo(() => {
    return monthTransactions
      .filter(t => (t.transactionType === 'deposit' || t.transactionType === 'cc-payment') && !isIgnored(t))
      .reduce((s, t) => s + Math.abs(t.amount), 0);
  }, [monthTransactions]);

  const overallNet = overallSpent - overallDeposits;
  // Over/Under Budget must match the Budget tab exactly. Use the reconciled
  // category-level "spent" value passed in from Index (totalVariableSpent +
  // totalFixedSpent), which already filters ignored transactions and handles
  // transfer adjustments. Fallback to overallNet only if the prop isn't
  // provided (legacy callers).
  const totalSpentForBudget = totalVariableSpent + totalFixedSpent;
  const budgetDifference = totalBudget - totalSpentForBudget;

  // Colors — lighter blue & gold theme
  const spentColor = 'hsl(220 42% 38%)';
  const spentColorAlt = 'hsl(220 42% 52%)';
  const payoffColor = 'hsl(var(--accent))';
  const depositColor = 'hsl(142 71% 45%)'; // green

  // Build a lookup from account slug → display label
  const accountLabelMap = useMemo(() => {
    const map: Record<string, string> = {};
    accounts.forEach(a => { map[a.id] = a.label; });
    return map;
  }, [accounts]);

  return (
    <div className="max-w-lg mx-auto">
      <div className="px-6 pt-12 pb-2 safe-top flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl lg:text-3xl font-bold tracking-tight text-foreground">{monthLabel} Budget</h1>
          {(() => {
            const today = new Date();
            const nextMonth = startOfMonth(addMonths(today, 1));
            const daysLeft = differenceInDays(nextMonth, today);
            return (
              <p className="text-sm text-muted-foreground mt-0.5">
                {format(today, 'EEEE, MMMM d')} · {daysLeft} day{daysLeft !== 1 ? 's' : ''} left
              </p>
            );
          })()}
        </div>
        <div className="flex items-start gap-2 mt-1">
          <button
            onClick={onAddTransaction}
            className="hidden lg:inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-accent-foreground text-sm font-semibold shadow-sm hover:opacity-90 active:scale-95 transition-all"
          >
            <Plus size={16} strokeWidth={2.5} />
            Add Transaction
          </button>
          <div className="flex flex-col items-center gap-1">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="w-9 h-9 rounded-full bg-accent/10 text-accent flex items-center justify-center active:scale-95 transition-all"
              title="Sync accounts"
            >
              <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
            </button>
            {(flashLabel || lastSyncedLabel) && (
              <span className="text-[10px] text-muted-foreground leading-none">
                {flashLabel || `Synced ${lastSyncedLabel}`}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Reconnect banner */}
      {!reconnectDismissed && reconnectItems.length > 0 && (
        <ReconnectBanner
          items={reconnectItems}
          onDismiss={() => setReconnectDismissed(true)}
          onReconnected={(itemId) => {
            setReconnectItems(prev => prev.filter(i => i.id !== itemId));
          }}
        />
      )}

      {/* Post-onboarding setup cards (dismissible) */}
      {topBanner}

      {/* End-of-month unassigned warning */}
      <EndOfMonthBanner count={unassignedTransactions.length} />

      {/* 1. Unassigned */}
      <UnassignedSection unassignedTransactions={unassignedTransactions} onEditTransaction={onEditTransaction} accounts={accounts} onViewAll={onViewAllUnassigned} onViewAllActivity={onViewAllActivity} />

      {/* 2. Variable Categories */}
      {varCategories && spentByCategory && transferAdjustments && (
        <CategoryCarousel
          title="Variable"
          items={varCategories.map(c => ({ id: c.id, name: c.name, budgeted: c.budgeted }))}
          spentByCategory={spentByCategory}
          transferAdjustments={transferAdjustments}
          onSelectCategory={onSelectCategory}
        />
      )}

      {/* 2b. Fixed Bills */}
      {fixedExpenses.length > 0 && spentByCategory && transferAdjustments && (
        <CategoryCarousel
          title="Fixed"
          items={fixedExpenses.map(e => ({ id: e.id, name: e.name, budgeted: e.amount }))}
          spentByCategory={spentByCategory}
          transferAdjustments={transferAdjustments}
          onSelectCategory={onSelectFixedExpense}
          compact
        />
      )}

      {/* Bottom section: two-column layout on desktop */}
      <div className="lg:grid lg:grid-cols-5 lg:gap-6 lg:px-6 lg:mt-6">
        {/* Left column: Account Snapshot + Monthly Summary */}
        <div className="lg:col-span-3">
          <div className="px-6 mt-6 lg:px-0 lg:mt-0 animate-fade-up" style={{ animationDelay: '300ms', animationFillMode: 'both' }}>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Account Snapshot</h3>
            <div className="space-y-4">

            {/* AMEX Section */}
            {creditAccounts.length > 0 && (
              <BankSection
                icon={<CreditCard size={16} className="text-accent" />}
                title="American Express"
                rows={[
                  ...creditRows.map(r => ({ label: r.label, value: r.value })),
                  { label: 'Payoffs toward budget', value: -creditPayoffs, color: 'text-accent' },
                ]}
                netLabel="Net Credit This Month"
                netValue={creditNet}
                barSegments={[
                  ...creditRows.map((r, i) => ({
                    value: r.value,
                    color: i === 0 ? spentColor : spentColorAlt,
                    label: r.label,
                  })),
                  { value: creditPayoffs, color: payoffColor, label: 'Payoffs' },
                ]}
              />
            )}

            {/* Checking Section */}
            {checkingAccounts.length > 0 && (
              <BankSection
                icon={<Building2 size={16} className="text-accent" />}
                title={checkingAccounts.length === 1 ? checkingAccounts[0].label : 'Checking'}
                rows={[
                  { label: 'Total Spent', value: checkingSpent },
                  { label: 'Deposits toward budget', value: -checkingDeposits, color: 'text-accent' },
                ]}
                netLabel="Net Checking This Month"
                netValue={checkingNet}
                barSegments={[
                  { value: checkingSpent, color: spentColor, label: 'Spent' },
                  { value: checkingDeposits, color: depositColor, label: 'Deposits' },
                ]}
              />
            )}

            {/* Overall Summary */}
            <div className="bg-card rounded-lg shadow-sm overflow-hidden">
              <button
                onClick={() => setSummaryOpen(!summaryOpen)}
                className="w-full flex items-center justify-between px-4 py-3 active:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <BarChart3 size={16} className="text-accent" />
                  <span className="text-sm font-semibold text-foreground">Monthly Summary</span>
                </div>
                <div className="flex items-center gap-2">
                  {totalSpentForBudget === 0 ? (
                    <span className="text-sm font-medium tabular-nums text-muted-foreground">
                      No activity yet
                    </span>
                  ) : (
                    <span className={`text-sm font-bold tabular-nums ${budgetDifference >= 0 ? 'text-accent' : 'text-destructive'}`}>
                      {budgetDifference >= 0 ? 'Under Budget' : 'Over Budget'} {formatCurrency(Math.abs(budgetDifference))}
                    </span>
                  )}
                  {summaryOpen ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                </div>
              </button>

              {summaryOpen && (
                <div className="divide-y divide-border border-t border-border">
                  <div className="flex justify-between items-center px-4 py-2.5">
                    <span className="text-sm text-muted-foreground">Total Spent</span>
                    <span className="text-sm font-medium tabular-nums text-foreground">{formatCurrency(overallSpent)}</span>
                  </div>
                  <div className="flex justify-between items-center px-4 py-2.5">
                    <span className="text-sm text-muted-foreground">Deposits & Credits</span>
                    <span className="text-sm font-medium tabular-nums text-muted-foreground">−{formatCurrency(overallDeposits)}</span>
                  </div>
                  <div className="flex justify-between items-center px-4 py-2.5">
                    <span className="text-sm text-muted-foreground">Net Total</span>
                    <span className="text-sm font-medium tabular-nums text-foreground">{formatCurrency(overallNet)}</span>
                  </div>
                  <div className="flex justify-between items-center px-4 py-2.5">
                    <span className="text-sm text-muted-foreground">Total Budgeted</span>
                    <span className="text-sm font-medium tabular-nums text-foreground">{formatCurrency(totalBudget)}</span>
                  </div>
                  <div className="flex justify-between items-center px-4 py-3 bg-primary/5">
                    <span className="text-sm font-semibold text-foreground">
                      {totalSpentForBudget === 0
                        ? 'No activity yet'
                        : budgetDifference >= 0 ? 'Under Budget' : 'Over Budget'}
                    </span>
                    {totalSpentForBudget === 0 ? (
                      <span className="text-sm font-medium tabular-nums text-muted-foreground">—</span>
                    ) : (
                      <span className={`text-sm font-bold tabular-nums ${budgetDifference >= 0 ? 'text-accent' : 'text-destructive'}`}>
                        {budgetDifference >= 0 ? '' : '−'}{formatCurrency(Math.abs(budgetDifference))}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            </div>
          </div>
        </div>

        {/* Right column: AI Insights */}
        <div className="lg:col-span-2 lg:[&>*]:px-0 lg:[&>*]:mt-0">
          {insightsSection}
        </div>
      </div>

      <div className="mb-6" />

      <button
        onClick={onAddTransaction}
        className="lg:hidden fixed bottom-24 right-6 w-14 h-14 rounded-full bg-accent text-accent-foreground shadow-lg flex items-center justify-center active:scale-95 transition-transform z-40"
      >
        <Plus size={24} strokeWidth={2.5} />
      </button>
    </div>
  );
}
