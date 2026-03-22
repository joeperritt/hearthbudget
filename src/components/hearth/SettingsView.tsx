import { useState } from 'react';
import { BudgetCategory, FixedExpense } from '@/types/budget';

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}

interface SettingsViewProps {
  categories: BudgetCategory[];
  fixedExpenses: FixedExpense[];
  onUpdateCategories: (cats: BudgetCategory[]) => void;
  onUpdateFixedExpenses: (exps: FixedExpense[]) => void;
}

export function SettingsView({ categories, fixedExpenses, onUpdateCategories, onUpdateFixedExpenses }: SettingsViewProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const startEdit = (id: string, currentVal: number) => {
    setEditingId(id);
    setEditValue(String(currentVal));
  };

  const saveCategoryEdit = (id: string) => {
    const val = parseFloat(editValue);
    if (!isNaN(val)) {
      onUpdateCategories(categories.map(c => c.id === id ? { ...c, budgeted: val } : c));
    }
    setEditingId(null);
  };

  const saveExpenseEdit = (id: string) => {
    const val = parseFloat(editValue);
    if (!isNaN(val)) {
      onUpdateFixedExpenses(fixedExpenses.map(e => e.id === id ? { ...e, amount: val } : e));
    }
    setEditingId(null);
  };

  return (
    <div className="max-w-lg mx-auto">
      <div className="px-6 pt-12 safe-top">
        <h1 className="font-display text-xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage budget amounts</p>
      </div>

      <div className="px-6 mt-6 pb-6">
        {/* Profiles */}
        <div className="mb-8">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Household</h3>
          <div className="bg-card rounded-lg shadow-sm p-4 flex gap-4">
            <div className="flex-1 text-center">
              <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center mx-auto text-sm font-semibold">J</div>
              <p className="text-sm font-medium text-foreground mt-1.5">Joe</p>
            </div>
            <div className="flex-1 text-center">
              <div className="w-10 h-10 rounded-full bg-accent text-accent-foreground flex items-center justify-center mx-auto text-sm font-semibold">K</div>
              <p className="text-sm font-medium text-foreground mt-1.5">Katie</p>
            </div>
          </div>
        </div>

        {/* Variable budgets */}
        <div className="mb-8">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Variable Budgets</h3>
          <div className="bg-card rounded-lg shadow-sm divide-y divide-border overflow-hidden">
            {categories.map(c => (
              <div key={c.id} className="flex justify-between items-center px-4 py-3">
                <span className="text-sm text-foreground">{c.name}</span>
                {editingId === `cat-${c.id}` ? (
                  <div className="flex gap-1.5">
                    <input
                      type="number"
                      step="0.01"
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      className="w-20 px-2 py-1 text-right text-sm rounded bg-background border border-border tabular-nums focus:outline-none focus:ring-2 focus:ring-accent/30"
                      autoFocus
                      onKeyDown={e => e.key === 'Enter' && saveCategoryEdit(c.id)}
                    />
                    <button onClick={() => saveCategoryEdit(c.id)} className="text-xs text-accent font-medium">Save</button>
                  </div>
                ) : (
                  <button
                    onClick={() => startEdit(`cat-${c.id}`, c.budgeted)}
                    className="text-sm font-medium tabular-nums text-foreground active:scale-95 transition-transform"
                  >
                    {formatCurrency(c.budgeted)}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Fixed expenses */}
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Fixed Expenses</h3>
          <div className="bg-card rounded-lg shadow-sm divide-y divide-border overflow-hidden">
            {fixedExpenses.map(e => (
              <div key={e.id} className="flex justify-between items-center px-4 py-3">
                <span className="text-sm text-foreground">{e.name}</span>
                {editingId === `exp-${e.id}` ? (
                  <div className="flex gap-1.5">
                    <input
                      type="number"
                      step="0.01"
                      value={editValue}
                      onChange={ev => setEditValue(ev.target.value)}
                      className="w-20 px-2 py-1 text-right text-sm rounded bg-background border border-border tabular-nums focus:outline-none focus:ring-2 focus:ring-accent/30"
                      autoFocus
                      onKeyDown={ev => ev.key === 'Enter' && saveExpenseEdit(e.id)}
                    />
                    <button onClick={() => saveExpenseEdit(e.id)} className="text-xs text-accent font-medium">Save</button>
                  </div>
                ) : (
                  <button
                    onClick={() => startEdit(`exp-${e.id}`, e.amount)}
                    className="text-sm font-medium tabular-nums text-foreground active:scale-95 transition-transform"
                  >
                    {formatCurrency(e.amount)}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
