import { useState } from 'react';
import { ProgressBar } from './ProgressBar';
import { Plus, Inbox, RefreshCw } from 'lucide-react';
import { Transaction, AccountSource, BudgetCategory } from '@/types/budget';
import { CategoryCarousel } from './CategoryCarousel';
import { supabase } from '@/integrations/supabase/client';
import { getTransactionAmountPresentation } from '@/lib/transactionAmountDisplay';

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}

function SummaryCard({ label, budgeted, spent, delay }: { label: string; budgeted: number; spent?: number; delay: number }) {
  return (
    <div
      className="bg-card rounded-lg p-4 shadow-sm animate-fade-up"
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}
    >
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
      <p className="text-xl font-display font-semibold text-foreground">{formatCurrency(budgeted)}</p>
      {spent !== undefined && (
        <>
          <div className="flex justify-between text-xs text-muted-foreground mt-2 mb-1">
            <span>{formatCurrency(spent)} spent</span>
            {spent > budgeted ? (
              <span className="text-destructive font-medium">-{formatCurrency(spent - budgeted)} over</span>
            ) : (
              <span>{formatCurrency(budgeted - spent)} left</span>
            )}
          </div>
          <ProgressBar value={spent} max={budgeted} />
        </>
      )}
    </div>
  );
}

type AccountFilter = 'all' | AccountSource;

const ACCOUNT_FILTERS: { id: AccountFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'joe-amex', label: 'Joe' },
  { id: 'katie-amex', label: 'Katie' },
  { id: 'checking', label: 'Checking' },
];

function UnassignedSection({ unassignedTransactions, onEditTransaction }: { unassignedTransactions: Transaction[]; onEditTransaction: (tx: Transaction) => void }) {
  const [filter, setFilter] = useState<AccountFilter>('all');
  const filtered = filter === 'all' ? unassignedTransactions : unassignedTransactions.filter(t => t.account === filter);

  return (
    <div className="px-6 mt-6 mb-6 animate-fade-up" style={{ animationDelay: '350ms', animationFillMode: 'both' }}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider shrink-0">Unassigned</h3>
        <div className="flex gap-1">
          {ACCOUNT_FILTERS.map(f => (
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
                <span className="text-[11px] text-muted-foreground">{tx.date} · {tx.account}</span>
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

interface DashboardProps {
  monthLabel: string;
  totalBudget: number;
  variableBudget: number;
  variableSpent: number;
  fixedTotal: number;
  fixedSpent: number;
  onAddTransaction: () => void;
  joeAmexGross: number;
  katieAmexGross: number;
  totalPayoffs: number;
  checkingSpent: number;
  unassignedTransactions: Transaction[];
  onEditTransaction: (tx: Transaction) => void;
  onSyncComplete?: () => void;
}

export function Dashboard({
  monthLabel,
  totalBudget, variableBudget, variableSpent,
  fixedTotal, fixedSpent, onAddTransaction,
  joeAmexGross, katieAmexGross, totalPayoffs, checkingSpent,
  unassignedTransactions, onEditTransaction, onSyncComplete,
}: DashboardProps) {
  const combinedCredit = Math.max(joeAmexGross + katieAmexGross - totalPayoffs, 0);
  const totalSpent = variableSpent + fixedSpent;
  const totalRemaining = totalBudget - totalSpent;

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

  return (
    <div className="max-w-lg mx-auto">
      <div className="px-6 pt-12 pb-2 safe-top flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">{monthLabel} Budget</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Your household budget</p>
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

      <div className="px-6 mb-6 animate-fade-up" style={{ animationDelay: '50ms', animationFillMode: 'both' }}>
        <div className="bg-primary rounded-xl p-5 shadow-lg">
          <p className="text-xs font-medium text-primary-foreground/70 uppercase tracking-wide">Total Monthly Budget</p>
          <p className="text-3xl font-display font-bold text-primary-foreground mt-1">{formatCurrency(totalBudget)}</p>
          <div className="mt-4">
            <div className="flex justify-between text-xs text-primary-foreground/70 mb-1.5">
              <span>{formatCurrency(totalSpent)} committed</span>
              {totalSpent > totalBudget ? (
                <span className="text-destructive-foreground font-semibold">-{formatCurrency(totalSpent - totalBudget)} over budget</span>
              ) : (
                <span>{formatCurrency(totalBudget - totalSpent)} remaining</span>
              )}
            </div>
            <div className="h-2 rounded-full bg-primary-foreground/20 overflow-hidden">
              <div
                className="h-full rounded-full bg-accent transition-all duration-500"
                style={{ width: `${Math.min((totalSpent / totalBudget) * 100, 100)}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="px-6 grid grid-cols-2 gap-3">
        <SummaryCard label="Variable" budgeted={variableBudget} spent={variableSpent} delay={100} />
        <SummaryCard label="Fixed Bills" budgeted={fixedTotal} spent={fixedSpent} delay={150} />
      </div>

      {/* Account Snapshot */}
      <div className="px-6 mt-6 animate-fade-up" style={{ animationDelay: '300ms', animationFillMode: 'both' }}>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Account Snapshot</h3>
        <div className="bg-card rounded-lg shadow-sm divide-y divide-border overflow-hidden">
          <div className="flex justify-between items-center px-4 py-3">
            <span className="text-sm text-foreground">Joe's Amex</span>
            <span className="text-sm font-medium tabular-nums text-foreground">{formatCurrency(joeAmexGross)}</span>
          </div>
          <div className="flex justify-between items-center px-4 py-3">
            <span className="text-sm text-foreground">Katie's Amex</span>
            <span className="text-sm font-medium tabular-nums text-foreground">{formatCurrency(katieAmexGross)}</span>
          </div>
          {totalPayoffs > 0 && (
            <div className="flex justify-between items-center px-4 py-3">
              <span className="text-sm text-muted-foreground">Total Payoffs</span>
              <span className="text-sm font-medium tabular-nums text-muted-foreground">−{formatCurrency(totalPayoffs)}</span>
            </div>
          )}
          <div className="flex justify-between items-center px-4 py-3 bg-accent/5">
            <span className="text-sm font-semibold text-foreground">Combined Credit Due</span>
            <span className="text-sm font-semibold tabular-nums text-foreground">{formatCurrency(combinedCredit)}</span>
          </div>
          <div className="flex justify-between items-center px-4 py-3">
            <span className="text-sm text-foreground">Checking Spent</span>
            <span className="text-sm font-medium tabular-nums text-foreground">{formatCurrency(checkingSpent)}</span>
          </div>
        </div>
        {lastSynced && (
          <p className="text-[10px] text-accent text-center mt-1.5 animate-fade-in">{lastSynced}</p>
        )}
      </div>

      {/* Budget Summary */}
      <div className="px-6 mt-4 animate-fade-up" style={{ animationDelay: '320ms', animationFillMode: 'both' }}>
        <div className="bg-card rounded-lg shadow-sm divide-y divide-border overflow-hidden">
          <div className="flex justify-between items-center px-4 py-3">
            <span className="text-sm text-foreground">Total Budgeted</span>
            <span className="text-sm font-medium tabular-nums text-foreground">{formatCurrency(totalBudget)}</span>
          </div>
          <div className="flex justify-between items-center px-4 py-3 bg-accent/5">
            <span className="text-sm font-semibold text-foreground">Total Remaining</span>
            <span className={`text-sm font-semibold tabular-nums ${totalRemaining < 0 ? 'text-destructive' : 'text-foreground'}`}>
              {totalRemaining < 0 ? `-${formatCurrency(Math.abs(totalRemaining))}` : formatCurrency(totalRemaining)}
            </span>
          </div>
        </div>
      </div>

      <UnassignedSection unassignedTransactions={unassignedTransactions} onEditTransaction={onEditTransaction} />

      <button
        onClick={onAddTransaction}
        className="fixed bottom-24 right-6 w-14 h-14 rounded-full bg-accent text-accent-foreground shadow-lg flex items-center justify-center active:scale-95 transition-transform z-40"
      >
        <Plus size={24} strokeWidth={2.5} />
      </button>
    </div>
  );
}
