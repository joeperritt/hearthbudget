import { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, TrendingDown, TrendingUp, BarChart3 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { BudgetCategory, FixedExpense } from '@/types/budget';
import { format, parse } from 'date-fns';

interface SpendingTrendsViewProps {
  activeMonth: string;
  categories: BudgetCategory[];
  fixedExpenses: FixedExpense[];
  spentByCategory: Record<string, number>;
  onBack: () => void;
}

interface SnapshotMonth {
  month: string;
  label: string;
  spentByCategory: Record<string, number>;
  fixedSpent: Record<string, number>;
}

export function SpendingTrendsView({
  activeMonth,
  categories,
  fixedExpenses,
  spentByCategory,
  onBack,
}: SpendingTrendsViewProps) {
  const [previousSnapshot, setPreviousSnapshot] = useState<SnapshotMonth | null>(null);
  const [loading, setLoading] = useState(true);
  const [noHistory, setNoHistory] = useState(false);

  useEffect(() => {
    async function fetchSnapshots() {
      setLoading(true);
      const { data, error } = await supabase
        .from('budget_month_snapshots')
        .select('month, transactions_summary, fixed_expenses, categories')
        .neq('month', activeMonth)
        .order('month', { ascending: false })
        .limit(1);

      if (error || !data || data.length === 0) {
        setNoHistory(true);
        setPreviousSnapshot(null);
        setLoading(false);
        return;
      }

      const snap = data[0];
      const summary = snap.transactions_summary as Record<string, unknown> | null;
      const snapSpent = (summary?.spentByCategory as Record<string, number>) || {};

      // Build fixed spent from snapshot's transactions_summary or derive from fixed_expenses list
      const snapFixedExpenses = (snap.fixed_expenses as Array<{ slug?: string; id?: string; amount?: number }>) || [];
      const snapFixedIds = new Set(snapFixedExpenses.map(e => e.slug || e.id || ''));
      const fixedSpent: Record<string, number> = {};
      for (const [catId, amt] of Object.entries(snapSpent)) {
        if (snapFixedIds.has(catId)) {
          fixedSpent[catId] = amt;
        }
      }

      const d = new Date(snap.month + '-01T00:00:00');
      setPreviousSnapshot({
        month: snap.month,
        label: format(d, 'MMM yyyy'),
        spentByCategory: snapSpent,
        fixedSpent,
      });
      setNoHistory(false);
      setLoading(false);
    }
    fetchSnapshots();
  }, [activeMonth]);

  const currentLabel = useMemo(() => {
    try {
      return format(new Date(activeMonth + '-01T00:00:00'), 'MMM yyyy');
    } catch {
      return activeMonth;
    }
  }, [activeMonth]);

  // Separate current month spent into variable vs fixed
  const fixedIds = useMemo(() => new Set(fixedExpenses.map(e => e.id)), [fixedExpenses]);
  const variableIds = useMemo(() => new Set(categories.map(c => c.id)), [categories]);

  const currentVariableSpent = useMemo(() => {
    const map: Record<string, number> = {};
    for (const [id, amt] of Object.entries(spentByCategory)) {
      if (variableIds.has(id)) map[id] = amt;
    }
    return map;
  }, [spentByCategory, variableIds]);

  const currentFixedSpent = useMemo(() => {
    const map: Record<string, number> = {};
    for (const [id, amt] of Object.entries(spentByCategory)) {
      if (fixedIds.has(id)) map[id] = amt;
    }
    return map;
  }, [spentByCategory, fixedIds]);

  const prevVariableSpent = useMemo(() => {
    if (!previousSnapshot) return {};
    const map: Record<string, number> = {};
    for (const [id, amt] of Object.entries(previousSnapshot.spentByCategory)) {
      if (!previousSnapshot.fixedSpent[id]) map[id] = amt;
    }
    return map;
  }, [previousSnapshot]);

  // Totals
  const currentTotal = Object.values(spentByCategory).reduce((s, v) => s + Math.max(0, v), 0);
  const prevTotal = previousSnapshot
    ? Object.values(previousSnapshot.spentByCategory).reduce((s, v) => s + Math.max(0, v), 0)
    : 0;
  const hasMeaningfulPrior = prevTotal > 0;
  const hasTwoMonths = !!previousSnapshot && hasMeaningfulPrior;
  const pctChange = prevTotal > 0 ? ((currentTotal - prevTotal) / prevTotal) * 100 : 0;
  const spendingDecreased = currentTotal < prevTotal;

  // Build sorted variable category rows
  const variableRows = useMemo(() => {
    const allIds = new Set([
      ...Object.keys(currentVariableSpent),
      ...Object.keys(prevVariableSpent),
      ...categories.map(c => c.id),
    ]);
    const rows = Array.from(allIds)
      .filter(id => id !== 'unassigned')
      .map(id => {
        const cat = categories.find(c => c.id === id);
        return {
          id,
          name: cat?.name || id,
          current: Math.max(0, currentVariableSpent[id] || 0),
          previous: Math.max(0, prevVariableSpent[id] || 0),
        };
      })
      .filter(r => r.current > 0 || r.previous > 0)
      .sort((a, b) => b.current - a.current);
    return rows;
  }, [currentVariableSpent, prevVariableSpent, categories]);

  // Build sorted fixed rows
  const fixedRows = useMemo(() => {
    const prevFixed = previousSnapshot?.fixedSpent || {};
    const allIds = new Set([
      ...Object.keys(currentFixedSpent),
      ...Object.keys(prevFixed),
      ...fixedExpenses.map(e => e.id),
    ]);
    return Array.from(allIds)
      .map(id => {
        const expIdx = fixedExpenses.findIndex(e => e.id === id);
        const exp = expIdx >= 0 ? fixedExpenses[expIdx] : undefined;
        return {
          id,
          name: exp?.name || id,
          current: Math.max(0, currentFixedSpent[id] || 0),
          previous: Math.max(0, prevFixed[id] || 0),
          sortIdx: expIdx >= 0 ? expIdx : 999,
        };
      })
      .filter(r => r.current > 0 || r.previous > 0)
      .sort((a, b) => a.sortIdx - b.sortIdx);
  }, [currentFixedSpent, previousSnapshot, fixedExpenses]);

  const maxVariable = useMemo(
    () => Math.max(...variableRows.map(r => Math.max(r.current, r.previous)), 1),
    [variableRows]
  );
  const maxFixed = useMemo(
    () => Math.max(...fixedRows.map(r => Math.max(r.current, r.previous)), 1),
    [fixedRows]
  );

  

  return (
    <div className="max-w-lg mx-auto pb-8">
      {/* Header */}
      <div className="px-6 pt-12 safe-top flex items-center gap-3">
        <button onClick={onBack} className="p-1 -ml-1 active:scale-95 transition-transform">
          <ArrowLeft size={20} className="text-foreground" />
        </button>
        <div>
          <h1 className="font-display text-xl font-bold text-foreground">Spending Trends</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Month over month comparison</p>
        </div>
      </div>

      {loading ? (
        <div className="px-6 mt-10 flex justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        </div>
      ) : noHistory && !hasTwoMonths ? (
        /* Empty state — no snapshots at all */
        <div className="px-6 mt-10 text-center space-y-3">
          <div className="w-14 h-14 mx-auto rounded-full bg-accent/10 flex items-center justify-center">
            <BarChart3 size={28} className="text-accent" />
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-xs mx-auto">
            Spending trends will populate after your first full month of budget data is saved.
          </p>
        </div>
      ) : (
        <div className="px-6 mt-6 space-y-6">
          {/* Single-month notice */}
          {!hasTwoMonths && (
            <div className="bg-accent/10 rounded-lg p-3 text-center">
              <p className="text-xs text-accent-foreground/70">
                Comparison will appear once a second month of data is available.
              </p>
            </div>
          )}

          {/* Summary bar */}
          <div className="bg-card rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="text-center flex-1">
                {hasTwoMonths && (
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                    {previousSnapshot!.label}
                  </p>
                )}
                {hasTwoMonths && (
                  <p className="text-lg font-semibold tabular-nums text-foreground">
                    ${prevTotal.toFixed(0)}
                  </p>
                )}
              </div>
              {hasTwoMonths && (
                <div className="flex flex-col items-center px-4">
                  {spendingDecreased ? (
                    <TrendingDown size={20} className="text-success" />
                  ) : (
                    <TrendingUp size={20} className="text-destructive" />
                  )}
                  <span
                    className={`text-xs font-semibold mt-0.5 ${
                      spendingDecreased ? 'text-success' : 'text-destructive'
                    }`}
                  >
                    {pctChange > 0 ? '+' : ''}
                    {pctChange.toFixed(0)}%
                  </span>
                </div>
              )}
              <div className="text-center flex-1">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                  {currentLabel}
                </p>
                <p className="text-lg font-semibold tabular-nums text-foreground">
                  ${currentTotal.toFixed(0)}
                </p>
              </div>
            </div>
          </div>

          {/* Month legend */}
          {hasTwoMonths && (
            <div className="flex items-center gap-4 justify-center">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-primary" />
                <span className="text-[10px] text-muted-foreground">{previousSnapshot!.label}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-accent" />
                <span className="text-[10px] text-muted-foreground">{currentLabel}</span>
              </div>
            </div>
          )}

          {/* Variable categories */}
          {variableRows.length > 0 && (
            <div>
              <h2 className="font-display text-sm font-semibold text-foreground mb-3">
                Variable Spending
              </h2>
              <div className="space-y-3">
                {variableRows.map(row => (
                  <CategoryBar
                    key={row.id}
                    name={row.name}
                    current={row.current}
                    previous={hasTwoMonths ? row.previous : undefined}
                    max={maxVariable}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Fixed bills */}
          {fixedRows.length > 0 && (
            <div>
              <h2 className="font-display text-sm font-semibold text-foreground mb-3">
                Fixed Bills
              </h2>
              <div className="space-y-3">
                {fixedRows.map(row => (
                  <CategoryBar
                    key={row.id}
                    name={row.name}
                    current={row.current}
                    previous={hasTwoMonths ? row.previous : undefined}
                    max={maxFixed}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CategoryBar({
  name,
  current,
  previous,
  max,
}: {
  name: string;
  current: number;
  previous?: number;
  max: number;
}) {
  const currentPct = Math.max(2, (current / max) * 100);
  const prevPct = previous !== undefined ? Math.max(2, (previous / max) * 100) : 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground truncate max-w-[50%]">{name}</span>
        <div className="flex items-center gap-3 text-xs tabular-nums">
          {previous !== undefined && (
            <span className="text-muted-foreground">${previous.toFixed(0)}</span>
          )}
          <span className="text-foreground font-medium">${current.toFixed(0)}</span>
        </div>
      </div>
      <div className="space-y-0.5">
        {previous !== undefined && (
          <div className="h-3 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${prevPct}%` }}
            />
          </div>
        )}
        <div className="h-3 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-accent transition-all duration-500"
            style={{ width: `${currentPct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
