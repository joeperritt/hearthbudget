import { useState, useEffect, useMemo } from 'react';
import { BudgetCategory, FixedExpense, Transaction } from '@/types/budget';
import { ChevronRight, Inbox, ArrowRight } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';

function fmtWhole(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}

interface SnapshotRow {
  id: string;
  month: string;
  categories: any[];
  fixed_expenses: any[];
  transactions_summary: {
    totalTransactions?: number;
    totalSpent?: number;
    spentByCategory?: Record<string, number>;
  };
}

interface BudgetTabViewProps {
  categories: BudgetCategory[];
  fixedExpenses: FixedExpense[];
  currentMonth: Date;
  onUpdateCategories: (cats: BudgetCategory[]) => void;
  onUpdateFixedExpenses: (exps: FixedExpense[]) => void;
  unassignedCount: number;
  spentByCategory: Record<string, number>;
  transferAdjustments: Record<string, number>;
  monthTransactions: Transaction[];
  planningData: Record<string, string>;
  onUpdatePlanningData: (data: Record<string, string>) => void;
  onOpenSettings: () => void;
  onOpenPlanning: () => void;
}

export function BudgetTabView({
  categories, fixedExpenses, currentMonth,
  onUpdateCategories, onUpdateFixedExpenses,
  unassignedCount, spentByCategory, transferAdjustments, monthTransactions,
  planningData, onUpdatePlanningData,
  onOpenSettings, onOpenPlanning,
}: BudgetTabViewProps) {
  const monthLabel = format(currentMonth, 'MMMM yyyy');

  // Take-home income from planning data
  const primaryNet = parseFloat(planningData.netIncome || '') || 0;
  const partnerNet = parseFloat(planningData.katieNetIncome || '') || 0;
  const totalTakeHome = primaryNet + partnerNet;

  // Budget totals
  const variableTotal = categories.filter(c => c.group !== 'giving' && c.group !== 'savings').reduce((s, c) => s + c.budgeted, 0);
  const givingVarTotal = categories.filter(c => c.group === 'giving').reduce((s, c) => s + c.budgeted, 0);
  const savingsVarTotal = categories.filter(c => c.group === 'savings').reduce((s, c) => s + c.budgeted, 0);
  const fixedTotal = fixedExpenses.reduce((s, e) => s + e.amount, 0);
  const budgetTotal = variableTotal + givingVarTotal + savingsVarTotal + fixedTotal;

  const surplus = totalTakeHome - budgetTotal;
  const isSurplus = surplus >= 0;

  // Average take-home handler
  const [takeHomeInput, setTakeHomeInput] = useState(() => {
    const total = (parseFloat(planningData.netIncome || '') || 0) + (parseFloat(planningData.katieNetIncome || '') || 0);
    return total > 0 ? String(total) : '';
  });

  const handleTakeHomeBlur = () => {
    const val = parseFloat(takeHomeInput) || 0;
    // Split evenly as primary net for simplicity
    onUpdatePlanningData({ ...planningData, netIncome: String(val) });
  };

  // Past month snapshots
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(true);
  const [expandedSnapshotId, setExpandedSnapshotId] = useState<string | null>(null);

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from('budget_month_snapshots')
        .select('*')
        .order('month', { ascending: false });
      if (data) setSnapshots(data as unknown as SnapshotRow[]);
      setSnapshotsLoading(false);
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

  // Expanded snapshot detail
  function renderSnapshotDetail(snap: SnapshotRow) {
    const spent = snap.transactions_summary?.spentByCategory || {};
    const cats = snap.categories || [];
    const fixed = snap.fixed_expenses || [];

    const variableRows = cats
      .map(c => {
        const id = c.slug || c.id || '';
        return { name: c.name || id, amount: Math.max(0, spent[id] || 0) };
      })
      .filter(r => r.amount > 0)
      .sort((a, b) => b.amount - a.amount);

    const fixedRows = fixed
      .map(e => {
        const id = e.slug || e.id || '';
        return { name: e.name || id, amount: Math.max(0, spent[id] || 0), group: e.group || 'bills' };
      })
      .filter(r => r.amount > 0);

    const givingRows = fixedRows.filter(r => r.group === 'tithe');
    const savingsRows = fixedRows.filter(r => r.group === 'savings');
    const billRows = fixedRows.filter(r => r.group === 'bills');

    return (
      <div className="mt-2 space-y-3 pb-2">
        {variableRows.length > 0 && (
          <div>
            <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Variable</h4>
            <div className="space-y-1">
              {variableRows.map((r, i) => (
                <div key={i} className="flex justify-between text-xs">
                  <span className="text-foreground">{r.name}</span>
                  <span className="tabular-nums text-foreground">{fmt(r.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {billRows.length > 0 && (
          <div>
            <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Fixed</h4>
            <div className="space-y-1">
              {billRows.map((r, i) => (
                <div key={i} className="flex justify-between text-xs">
                  <span className="text-foreground">{r.name}</span>
                  <span className="tabular-nums text-foreground">{fmt(r.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {givingRows.length > 0 && (
          <div>
            <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Giving</h4>
            <div className="space-y-1">
              {givingRows.map((r, i) => (
                <div key={i} className="flex justify-between text-xs">
                  <span className="text-foreground">{r.name}</span>
                  <span className="tabular-nums text-foreground">{fmt(r.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {savingsRows.length > 0 && (
          <div>
            <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Savings</h4>
            <div className="space-y-1">
              {savingsRows.map((r, i) => (
                <div key={i} className="flex justify-between text-xs">
                  <span className="text-foreground">{r.name}</span>
                  <span className="tabular-nums text-foreground">{fmt(r.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto pb-8">
      <div className="px-6 pt-12 safe-top">
        <h1 className="font-display text-xl font-bold text-foreground">{monthLabel} Budget</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Budget planning & history</p>
      </div>

      {/* Average Monthly Take-Home */}
      <div className="px-6 mt-6">
        <div className="bg-card rounded-xl shadow-sm p-4">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Average Monthly Take-Home
          </label>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-sm text-muted-foreground">$</span>
            <input
              type="number"
              value={takeHomeInput}
              onChange={e => setTakeHomeInput(e.target.value)}
              onBlur={handleTakeHomeBlur}
              placeholder="0"
              className="flex-1 text-2xl font-display font-bold text-foreground bg-transparent border-none outline-none tabular-nums"
            />
          </div>
          <button
            onClick={onOpenPlanning}
            className="flex items-center gap-1 text-xs text-accent font-medium mt-2 active:scale-95 transition-transform"
          >
            Income Planning <ArrowRight size={12} />
          </button>
        </div>
      </div>

      {/* Budget Total & Surplus/Deficit */}
      <div className="px-6 mt-4">
        <div className="bg-card rounded-xl shadow-sm p-4 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Budget Total</span>
            <span className="text-sm font-semibold tabular-nums text-foreground">{fmt(budgetTotal)}</span>
          </div>
          <div className="border-t border-border pt-2 flex justify-between items-center">
            <span className="text-sm font-semibold text-foreground">
              {isSurplus ? 'Monthly Surplus' : 'Monthly Deficit'}
            </span>
            <span className={`text-sm font-bold tabular-nums ${isSurplus ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>
              {isSurplus ? '+' : '-'}{fmt(Math.abs(surplus))}
            </span>
          </div>
        </div>
      </div>

      {/* Budget Planning button */}
      <div className="px-6 mt-4">
        <button
          onClick={onOpenSettings}
          className="w-full bg-card rounded-xl shadow-sm p-4 flex items-center justify-between active:scale-[0.98] transition-transform"
        >
          <div>
            <p className="text-sm font-semibold text-foreground">Budget Planning</p>
            <p className="text-xs text-muted-foreground">Manage categories & budget amounts</p>
          </div>
          <ChevronRight size={16} className="text-muted-foreground" />
        </button>
      </div>

      {/* Past Months History */}
      <div className="px-6 mt-8">
        <h2 className="font-display text-sm font-semibold text-foreground mb-3">Past Months</h2>
        {snapshotsLoading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          </div>
        ) : snapshots.length === 0 ? (
          <div className="bg-card rounded-xl shadow-sm px-4 py-8 flex flex-col items-center justify-center">
            <Inbox size={24} className="text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground font-medium">No history yet</p>
            <p className="text-[11px] text-muted-foreground/60 mt-1 text-center max-w-[220px]">
              History will appear here after your first full month completes.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {snapshots.map(snap => {
              const summary = snap.transactions_summary || {};
              const isExpanded = expandedSnapshotId === snap.id;
              return (
                <div key={snap.id} className="bg-card rounded-xl shadow-sm overflow-hidden">
                  <button
                    onClick={() => setExpandedSnapshotId(isExpanded ? null : snap.id)}
                    className="w-full p-4 flex items-center justify-between active:scale-[0.98] transition-transform text-left"
                  >
                    <div>
                      <p className="text-sm font-semibold text-foreground">{formatMonth(snap.month)}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {summary.totalTransactions || 0} transactions · {fmtWhole(summary.totalSpent || 0)} spent
                      </p>
                    </div>
                    <ChevronRight size={16} className={`text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                  </button>
                  {isExpanded && (
                    <div className="px-4 border-t border-border">
                      {renderSnapshotDetail(snap)}
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
