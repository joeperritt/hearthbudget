import { useState, useMemo } from 'react';
import { format, differenceInDays, startOfMonth, addMonths } from 'date-fns';
import { ProgressBar } from './ProgressBar';
import { Plus, Inbox, RefreshCw, CreditCard, Building2, BarChart3, ChevronDown, ChevronUp } from 'lucide-react';
import { Transaction, AccountSource, BudgetCategory, FixedExpense, CC_PAYMENT_CATEGORY } from '@/types/budget';
import { CategoryCarousel } from './CategoryCarousel';
import { supabase } from '@/integrations/supabase/client';
import { getTransactionAmountPresentation } from '@/lib/transactionAmountDisplay';
import { AppAccount } from '@/hooks/useAccounts';

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}

type AccountFilter = 'all' | string;

function UnassignedSection({ unassignedTransactions, onEditTransaction, accounts = [] }: { unassignedTransactions: Transaction[]; onEditTransaction: (tx: Transaction) => void; accounts?: AppAccount[] }) {
  const [filter, setFilter] = useState<AccountFilter>('all');
  const filtered = filter === 'all' ? unassignedTransactions : unassignedTransactions.filter(t => t.account === filter);
  const labelMap = useMemo(() => {
    const m: Record<string, string> = {};
    accounts.forEach(a => { m[a.id] = a.label; });
    return m;
  }, [accounts]);

  const accountFilters: { id: AccountFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    ...accounts.map(a => ({ id: a.id, label: a.label })),
  ];

  return (
    <div className="px-6 mt-6 mb-6 animate-fade-up" style={{ animationDelay: '350ms', animationFillMode: 'both' }}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider shrink-0">Unassigned</h3>
        <div className="flex gap-1">
          {accountFilters.map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors active:scale-95 ${
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
          <p className="text-[11px] text-muted-foreground/60 mt-0.5">
            {filter === 'all' ? 'Imported transactions will appear here' : 'No unassigned transactions for this account'}
          </p>
        </div>
      ) : (
        <div className="bg-card rounded-lg shadow-sm divide-y divide-border overflow-hidden">
          {filtered.slice(0, 10).map(tx => (
            <div key={tx.id} onClick={() => onEditTransaction(tx)} className="flex justify-between items-center px-4 py-3 cursor-pointer active:bg-muted/50 transition-colors">
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-sm text-foreground truncate">{tx.description || 'No description'}</span>
                <span className="text-[11px] text-muted-foreground">{tx.date} · {labelMap[tx.account] || tx.account}</span>
              </div>
              {(() => {
                const { colorClassName, prefix, value } = getTransactionAmountPresentation(tx);
                return (
                  <span className={`text-sm font-medium tabular-nums ml-3 ${colorClassName}`}>
                    {prefix}{formatCurrency(value)}
                  </span>
                );
              })()}
            </div>
          ))}
          {filtered.length > 10 && (
            <div className="px-4 py-2 text-center">
              <span className="text-xs text-muted-foreground">+{filtered.length - 10} more</span>
            </div>
          )}
        </div>
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
  return (
    <div className="bg-card rounded-lg shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        {icon}
        <span className="text-sm font-semibold text-foreground">{title}</span>
      </div>

      {/* Stacked bar */}
      <div className="px-4 pt-3 pb-1">
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
}

export function Dashboard({
  monthLabel, onAddTransaction,
  accountSpending, totalPayoffs,
  unassignedTransactions, onEditTransaction, onSyncComplete,
  categories: varCategories, fixedExpenses = [], spentByCategory, transferAdjustments, onSelectCategory, onSelectFixedExpense,
  accounts = [],
  monthTransactions = [],
  totalBudget = 0,
}: DashboardProps) {
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const headers = { Authorization: `Bearer ${session.access_token}` };
      await supabase.functions.invoke('plaid-sync-transactions', { headers });
      setLastSynced('Updated just now');
      onSyncComplete?.();
      setTimeout(() => setLastSynced(null), 5000);
    } catch (e) {
      console.error('Sync failed:', e);
    } finally {
      setSyncing(false);
    }
  };

  // Compute per-bank-group data
  const creditAccounts = accounts.filter(a => a.type === 'credit_card');
  const checkingAccounts = accounts.filter(a => a.type === 'checking');

  // Credit card spending by sub-account
  const creditRows = useMemo(() => {
    return creditAccounts.map(acct => {
      const spent = monthTransactions
        .filter(t => t.account === acct.id && t.transactionType === 'expense')
        .reduce((s, t) => s + t.amount, 0);
      return { label: acct.label, value: spent };
    });
  }, [creditAccounts, monthTransactions]);

  const totalCreditSpent = creditRows.reduce((s, r) => s + r.value, 0);

  // CC payments (payoffs) — money going back
  const creditPayoffs = useMemo(() => {
    return monthTransactions
      .filter(t => creditAccounts.some(a => a.id === t.account) && t.transactionType === 'cc-payment')
      .reduce((s, t) => s + Math.abs(t.amount), 0);
  }, [monthTransactions, creditAccounts]);

  const creditNet = totalCreditSpent - creditPayoffs;

  // Checking spending
  const checkingSpent = useMemo(() => {
    return monthTransactions
      .filter(t => checkingAccounts.some(a => a.id === t.account) && t.transactionType === 'expense')
      .reduce((s, t) => s + t.amount, 0);
  }, [monthTransactions, checkingAccounts]);

  // Checking deposits toward budget
  const checkingDeposits = useMemo(() => {
    return monthTransactions
      .filter(t => checkingAccounts.some(a => a.id === t.account) && t.transactionType === 'deposit')
      .reduce((s, t) => s + Math.abs(t.amount), 0);
  }, [monthTransactions, checkingAccounts]);

  const checkingNet = checkingSpent - checkingDeposits;

  // Overall totals
  const overallSpent = totalCreditSpent + checkingSpent;
  const overallReturns = creditPayoffs + checkingDeposits;
  const overallNet = overallSpent - overallReturns;
  const budgetDifference = totalBudget - overallNet;

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
          <h1 className="font-display text-2xl font-bold text-foreground">{monthLabel} Budget</h1>
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
        <button
          onClick={handleSync}
          disabled={syncing}
          className="w-9 h-9 rounded-full bg-accent/10 text-accent flex items-center justify-center active:scale-95 transition-all mt-1"
          title="Sync accounts"
        >
          <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* 1. Unassigned */}
      <UnassignedSection unassignedTransactions={unassignedTransactions} onEditTransaction={onEditTransaction} accounts={accounts} />

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

      {/* 3. Account Snapshot — By Bank */}
      <div className="px-6 mt-6 space-y-4 animate-fade-up" style={{ animationDelay: '300ms', animationFillMode: 'both' }}>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Account Snapshot</h3>

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
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <BarChart3 size={16} className="text-accent" />
            <span className="text-sm font-semibold text-foreground">Monthly Summary</span>
          </div>

          <div className="divide-y divide-border">
            <div className="flex justify-between items-center px-4 py-2.5">
              <span className="text-sm text-muted-foreground">Total Spent</span>
              <span className="text-sm font-medium tabular-nums text-foreground">{formatCurrency(overallSpent)}</span>
            </div>
            <div className="flex justify-between items-center px-4 py-2.5">
              <span className="text-sm text-muted-foreground">Payoffs & Deposits</span>
              <span className="text-sm font-medium tabular-nums text-accent">−{formatCurrency(overallReturns)}</span>
            </div>
            <div className="flex justify-between items-center px-4 py-3 bg-accent/5">
              <span className="text-sm font-semibold text-foreground">Net Total</span>
              <span className="text-sm font-bold tabular-nums text-foreground">{formatCurrency(overallNet)}</span>
            </div>
          </div>

          {/* Budget comparison */}
          <div className="border-t border-border divide-y divide-border">
            <div className="flex justify-between items-center px-4 py-2.5">
              <span className="text-sm text-muted-foreground">Total Budgeted</span>
              <span className="text-sm font-medium tabular-nums text-foreground">{formatCurrency(totalBudget)}</span>
            </div>
            <div className="flex justify-between items-center px-4 py-3 bg-primary/5">
              <span className="text-sm font-semibold text-foreground">
                {budgetDifference >= 0 ? 'Under Budget' : 'Over Budget'}
              </span>
              <span className={`text-sm font-bold tabular-nums ${budgetDifference >= 0 ? 'text-accent' : 'text-destructive'}`}>
                {budgetDifference >= 0 ? '' : '−'}{formatCurrency(Math.abs(budgetDifference))}
              </span>
            </div>
          </div>
        </div>

        {lastSynced && (
          <p className="text-[10px] text-accent text-center mt-1.5 animate-fade-in">{lastSynced}</p>
        )}
      </div>

      <div className="mb-6" />

      <button
        onClick={onAddTransaction}
        className="fixed bottom-24 right-6 w-14 h-14 rounded-full bg-accent text-accent-foreground shadow-lg flex items-center justify-center active:scale-95 transition-transform z-40"
      >
        <Plus size={24} strokeWidth={2.5} />
      </button>
    </div>
  );
}
