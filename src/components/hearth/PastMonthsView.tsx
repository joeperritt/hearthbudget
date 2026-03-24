import { useState, useEffect } from 'react';
import { ArrowLeft, Inbox, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

interface MonthSnapshot {
  id: string;
  month: string;
  categories: any[];
  fixed_expenses: any[];
  transactions_summary: {
    totalTransactions?: number;
    totalExpenses?: number;
    totalSpent?: number;
  };
  created_at: string;
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}

interface PastMonthsViewProps {
  onBack: () => void;
}

export function PastMonthsView({ onBack }: PastMonthsViewProps) {
  const [snapshots, setSnapshots] = useState<MonthSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSnapshots() {
      const { data, error } = await supabase
        .from('budget_month_snapshots' as any)
        .select('*')
        .order('month', { ascending: false });
      if (data) {
        setSnapshots(data as unknown as MonthSnapshot[]);
      }
      setLoading(false);
    }
    fetchSnapshots();
  }, []);

  const formatMonthLabel = (month: string) => {
    try {
      return format(new Date(month + '-01T00:00:00'), 'MMMM yyyy');
    } catch {
      return month;
    }
  };

  return (
    <div className="max-w-lg mx-auto">
      <div className="px-6 pt-12 safe-top">
        <button onClick={onBack} className="flex items-center gap-1 text-accent text-sm font-medium mb-4 active:scale-95 transition-transform">
          <ArrowLeft size={16} /> Back
        </button>
        <h1 className="font-display text-xl font-bold text-foreground">Past Months</h1>
        <p className="text-sm text-muted-foreground mt-1">Previous budget & transaction history</p>
      </div>

      <div className="px-6 mt-8 pb-6">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          </div>
        ) : snapshots.length === 0 ? (
          <div className="bg-card rounded-lg shadow-sm px-4 py-10 flex flex-col items-center justify-center">
            <Inbox size={28} className="text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground font-medium">No past months yet</p>
            <p className="text-[11px] text-muted-foreground/60 mt-1 text-center">
              Completed months will appear here after you start a new month in Settings
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {snapshots.map(snap => {
              const isExpanded = expandedMonth === snap.id;
              const summary = snap.transactions_summary || {};
              const cats = snap.categories || [];
              const fixed = snap.fixed_expenses || [];
              const variableTotal = cats.reduce((s: number, c: any) => s + (c.budgeted || 0), 0);
              const fixedTotal = fixed.reduce((s: number, e: any) => s + (e.amount || 0), 0);

              return (
                <div key={snap.id} className="bg-card rounded-lg shadow-sm overflow-hidden">
                  <button
                    onClick={() => setExpandedMonth(isExpanded ? null : snap.id)}
                    className="w-full flex items-center justify-between px-4 py-4 active:bg-muted/50 transition-colors"
                  >
                    <div className="text-left">
                      <p className="text-sm font-semibold text-foreground">{formatMonthLabel(snap.month)}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {summary.totalTransactions || 0} transactions · {formatCurrency(summary.totalSpent || 0)} spent
                      </p>
                    </div>
                    <ChevronRight size={16} className={`text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-border pt-3 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Variable Budget</span>
                        <span className="font-medium tabular-nums">{formatCurrency(variableTotal)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Fixed Budget</span>
                        <span className="font-medium tabular-nums">{formatCurrency(fixedTotal)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Total Spent</span>
                        <span className="font-medium tabular-nums">{formatCurrency(summary.totalSpent || 0)}</span>
                      </div>
                      <div className="border-t border-border pt-2 mt-2">
                        <p className="text-[11px] text-muted-foreground">
                          {cats.length} variable categories · {fixed.length} fixed expenses
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
