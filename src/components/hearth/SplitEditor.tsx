import { useState } from 'react';
import { BudgetCategory, FixedExpense, Transaction, categoryRequiresNotes } from '@/types/budget';
import { Plus, Trash2 } from 'lucide-react';
import { CategoryBudgetMini } from './CategoryBudgetMini';

export interface SplitLine {
  categoryId: string;
  amount: string;
  notes?: string;
}

interface SplitEditorProps {
  totalAmount: number;
  mode: 'variable' | 'fixed';
  categories: BudgetCategory[];
  fixedExpenses: FixedExpense[];
  lines: SplitLine[];
  onChange: (lines: SplitLine[]) => void;
  transactions?: Transaction[];
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}

export function SplitEditor({ totalAmount, mode, categories, fixedExpenses, lines, onChange, transactions = [] }: SplitEditorProps) {
  const allocated = lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const remaining = Math.round((totalAmount - allocated) * 100) / 100;

  const updateLine = (index: number, updates: Partial<SplitLine>) => {
    const next = lines.map((l, i) => i === index ? { ...l, ...updates } : l);
    onChange(next);
  };

  const addLine = () => {
    const prefill = remaining > 0 ? remaining.toFixed(2) : '';
    const defaultCat = mode === 'variable' ? 'unassigned' : (fixedExpenses[0]?.id || '');
    onChange([...lines, { categoryId: defaultCat, amount: prefill, notes: '' }]);
  };

  const removeLine = (index: number) => {
    if (lines.length <= 2) return;
    onChange(lines.filter((_, i) => i !== index));
  };

  const sortedCategories = [...categories].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="animate-fade-up space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Split Categories</label>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          Total: {formatCurrency(totalAmount)}
        </span>
      </div>

      <div className="space-y-2">
        {lines.map((line, i) => {
          const needsNotes = NOTES_REQUIRED_CATEGORIES.includes(line.categoryId);
          return (
            <div key={i}>
              <div className="flex gap-2 items-center">
                {mode === 'variable' ? (
                  <select
                    value={line.categoryId}
                    onChange={e => updateLine(i, { categoryId: e.target.value })}
                    className="flex-1 min-w-0 px-2.5 py-2 rounded-lg bg-card border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
                  >
                    <option value="unassigned">Unassigned</option>
                    {sortedCategories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                ) : (
                  <select
                    value={line.categoryId}
                    onChange={e => updateLine(i, { categoryId: e.target.value })}
                    className="flex-1 min-w-0 px-2.5 py-2 rounded-lg bg-card border border-accent/40 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
                  >
                    {fixedExpenses.filter(e => e.group === 'bills').length > 0 && (
                      <optgroup label="Bills">
                        {fixedExpenses.filter(e => e.group === 'bills').sort((a, b) => a.name.localeCompare(b.name)).map(e => (
                          <option key={e.id} value={e.id}>{e.name}</option>
                        ))}
                      </optgroup>
                    )}
                    {fixedExpenses.filter(e => e.group === 'savings').length > 0 && (
                      <optgroup label="Savings">
                        {fixedExpenses.filter(e => e.group === 'savings').sort((a, b) => a.name.localeCompare(b.name)).map(e => (
                          <option key={e.id} value={e.id}>{e.name}</option>
                        ))}
                      </optgroup>
                    )}
                    {fixedExpenses.filter(e => e.group === 'tithe').length > 0 && (
                      <optgroup label="Tithe / Giving">
                        {fixedExpenses.filter(e => e.group === 'tithe').sort((a, b) => a.name.localeCompare(b.name)).map(e => (
                          <option key={e.id} value={e.id}>{e.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                )}
                <input
                  type="number"
                  step="0.01"
                  value={line.amount}
                  onChange={e => updateLine(i, { amount: e.target.value })}
                  placeholder="$0.00"
                  className="w-24 px-2.5 py-2 rounded-lg bg-card border border-border text-sm text-foreground tabular-nums text-right focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
                <button
                  type="button"
                  onClick={() => removeLine(i)}
                  disabled={lines.length <= 2}
                  className="p-1.5 text-muted-foreground/50 hover:text-destructive active:scale-90 transition-all disabled:opacity-30"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              {needsNotes && (
                <input
                  type="text"
                  value={line.notes || ''}
                  onChange={e => updateLine(i, { notes: e.target.value })}
                  placeholder="Note required for this category"
                  className={`mt-1 w-full px-2.5 py-1.5 rounded-lg bg-card border text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30 ${
                    !line.notes?.trim() ? 'border-destructive/50' : 'border-border'
                  }`}
                />
              )}
              <CategoryBudgetMini
                categoryId={line.categoryId}
                categories={categories}
                fixedExpenses={fixedExpenses}
                transactions={transactions}
              />
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={addLine}
          className="flex items-center gap-1 text-xs font-medium text-accent active:scale-95 transition-transform"
        >
          <Plus size={14} /> Add line
        </button>
        <span className={`text-xs font-semibold tabular-nums ${
          Math.abs(remaining) < 0.01 ? 'text-green-600' : 'text-destructive'
        }`}>
          {Math.abs(remaining) < 0.01
            ? '✓ Balanced'
            : remaining > 0
              ? `${formatCurrency(remaining)} remaining`
              : `-${formatCurrency(Math.abs(remaining))} over`
          }
        </span>
      </div>
    </div>
  );
}
