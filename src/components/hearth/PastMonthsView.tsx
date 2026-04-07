import { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, Inbox, ChevronRight, ChevronLeft } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

interface SnapshotRow {
  id: string;
  month: string;
  categories: Array<{ slug?: string; id?: string; name?: string; budgeted?: number; group?: string }>;
  fixed_expenses: Array<{ slug?: string; id?: string; name?: string; amount?: number; group?: string }>;
  transactions_summary: {
    totalTransactions?: number;
    totalSpent?: number;
    spentByCategory?: Record<string, number>;
  };
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function fmtFull(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}

interface PastMonthsViewProps {
  onBack: () => void;
}

export function PastMonthsView({ onBack }: PastMonthsViewProps) {
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from('budget_month_snapshots')
        .select('*')
        .order('month', { ascending: false });
      if (data) setSnapshots(data as unknown as SnapshotRow[]);
      setLoading(false);
    }
    fetch();
  }, []);

  const formatMonth = (month: string) => {
    try {
      return format(new Date(month + '-01T00:00:00'), 'MMMM yyyy');
    } catch {
      return month;
    }
  };

  const detail = useMemo(() => {
    if (!detailId) return null;
    return snapshots.find(s => s.id === detailId) || null;
  }, [detailId, snapshots]);

  // Detail view
  if (detail) {
    const spent = detail.transactions_summary?.spentByCategory || {};
    const cats = detail.categories || [];
    const fixed = detail.fixed_expenses || [];
    const fixedIds = new Set(fixed.map(e => e.slug || e.id || ''));

    // Variable rows sorted by spent desc
    const variableRows = cats
      .map(c => {
        const id = c.slug || c.id || '';
        return { name: c.name || id, amount: Math.max(0, spent[id] || 0) };
      })
      .filter(r => r.amount > 0)
      .sort((a, b) => b.amount - a.amount);

    // Fixed rows in original order (sort_order from snapshot)
    const fixedRows = fixed
      .map(e => {
        const id = e.slug || e.id || '';
        return { name: e.name || id, amount: Math.max(0, spent[id] || 0), group: e.group || 'bills' };
      })
      .filter(r => r.amount > 0);

    const givingRows = fixedRows.filter(r => r.group === 'tithe');
    const savingsRows = fixedRows.filter(r => r.group === 'savings');
    const billRows = fixedRows.filter(r => r.group === 'bills');

    const totalGiving = givingRows.reduce((s, r) => s + r.amount, 0);
    const totalSavings = savingsRows.reduce((s, r) => s + r.amount, 0);

    return (
      <div className="max-w-lg mx-auto pb-8">
        <div className="px-6 pt-12 safe-top">
          <button
            onClick={() => setDetailId(null)}
            className="flex items-center gap-1 text-accent text-sm font-medium mb-4 active:scale-95 transition-transform"
          >
            <ChevronLeft size={16} /> Past Months
          </button>
          <h1 className="font-display text-xl font-bold text-foreground">{formatMonth(detail.month)}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {detail.transactions_summary?.totalTransactions || 0} transactions · {fmt(detail.transactions_summary?.totalSpent || 0)} total
          </p>
        </div>

        <div className="px-6 mt-6 space-y-6">
          {/* Variable */}
          {variableRows.length > 0 && (
            <div>
              <h2 className="font-display text-sm font-semibold text-foreground mb-2">Variable Spending</h2>
              <div className="bg-card rounded-xl shadow-sm divide-y divide-border overflow-hidden">
                {variableRows.map((r, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-foreground">{r.name}</span>
                    <span className="text-sm font-medium tabular-nums text-foreground">{fmtFull(r.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fixed Bills */}
          {billRows.length > 0 && (
            <div>
              <h2 className="font-display text-sm font-semibold text-foreground mb-2">Fixed Bills</h2>
              <div className="bg-card rounded-xl shadow-sm divide-y divide-border overflow-hidden">
                {billRows.map((r, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-foreground">{r.name}</span>
                    <span className="text-sm font-medium tabular-nums text-foreground">{fmtFull(r.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Giving */}
          {givingRows.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-display text-sm font-semibold text-foreground">Giving</h2>
                <span className="text-xs text-muted-foreground tabular-nums">{fmt(totalGiving)} total</span>
              </div>
              <div className="bg-card rounded-xl shadow-sm divide-y divide-border overflow-hidden">
                {givingRows.map((r, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-foreground">{r.name}</span>
                    <span className="text-sm font-medium tabular-nums text-foreground">{fmtFull(r.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Savings */}
          {savingsRows.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-display text-sm font-semibold text-foreground">Savings</h2>
                <span className="text-xs text-muted-foreground tabular-nums">{fmt(totalSavings)} total</span>
              </div>
              <div className="bg-card rounded-xl shadow-sm divide-y divide-border overflow-hidden">
                {savingsRows.map((r, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-foreground">{r.name}</span>
                    <span className="text-sm font-medium tabular-nums text-foreground">{fmtFull(r.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // List view
  return (
    <div className="max-w-lg mx-auto pb-8">
      <div className="px-6 pt-12 safe-top">
        <button onClick={onBack} className="flex items-center gap-1 text-accent text-sm font-medium mb-4 active:scale-95 transition-transform">
          <ArrowLeft size={16} /> Back
        </button>
        <h1 className="font-display text-xl font-bold text-foreground">Past Months</h1>
        <p className="text-sm text-muted-foreground mt-1">Budget & spending history</p>
      </div>

      <div className="px-6 mt-6">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          </div>
        ) : snapshots.length === 0 ? (
          <div className="bg-card rounded-xl shadow-sm px-4 py-10 flex flex-col items-center justify-center">
            <Inbox size={28} className="text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground font-medium">No history yet</p>
            <p className="text-[11px] text-muted-foreground/60 mt-1 text-center max-w-[220px]">
              History will appear here after your first full month completes.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {snapshots.map(snap => {
              const summary = snap.transactions_summary || {};
              return (
                <button
                  key={snap.id}
                  onClick={() => setDetailId(snap.id)}
                  className="w-full bg-card rounded-xl shadow-sm p-4 flex items-center justify-between active:scale-[0.98] transition-transform text-left"
                >
                  <div>
                    <p className="text-sm font-semibold text-foreground">{formatMonth(snap.month)}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {summary.totalTransactions || 0} transactions · {fmt(summary.totalSpent || 0)} spent
                    </p>
                  </div>
                  <ChevronRight size={16} className="text-muted-foreground" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
