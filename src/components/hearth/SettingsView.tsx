import { useState } from 'react';
import { BudgetCategory, FixedExpense, GIVING_VARIABLE_CATEGORY } from '@/types/budget';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { format, addMonths } from 'date-fns';

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}

function fmtWhole(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

interface SettingsViewProps {
  categories: BudgetCategory[];
  fixedExpenses: FixedExpense[];
  currentMonth: Date;
  onUpdateCategories: (cats: BudgetCategory[]) => void;
  onUpdateFixedExpenses: (exps: FixedExpense[]) => void;
  onStartMonth: (nextMonth: Date, cats: BudgetCategory[], expenses: FixedExpense[]) => void;
  onBack: () => void;
}

type GroupType = 'shared' | 'joe' | 'katie';
type FixedGroupType = 'bills' | 'savings' | 'tithe';

export function SettingsView({ categories, fixedExpenses, currentMonth, onUpdateCategories, onUpdateFixedExpenses, onStartMonth, onBack }: SettingsViewProps) {
  const nextMonth = addMonths(currentMonth, 1);
  const nextMonthShort = format(nextMonth, 'MMMM');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Add category state
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatGroup, setNewCatGroup] = useState<GroupType>('shared');
  const [newCatBudget, setNewCatBudget] = useState('');

  // Add fixed expense state
  const [showAddFixed, setShowAddFixed] = useState<FixedGroupType | null>(null);
  const [newFixedName, setNewFixedName] = useState('');
  const [newFixedAmount, setNewFixedAmount] = useState('');

  // Next month budgets
  const [nextCats, setNextCats] = useState<BudgetCategory[]>(() => categories.map(c => ({ ...c })));
  const [nextFixed, setNextFixed] = useState<FixedExpense[]>(() => fixedExpenses.map(e => ({ ...e })));

  const startEdit = (id: string, currentVal: number) => {
    setEditingId(id);
    setEditValue(String(currentVal));
  };

  const saveCategoryEdit = (id: string) => {
    const val = parseFloat(editValue);
    if (!isNaN(val)) {
      onUpdateCategories(categories.map(c => c.id === id ? { ...c, budgeted: val } : c));
      setNextCats(cats => cats.map(c => c.id === id ? { ...c, budgeted: val } : c));
    }
    setEditingId(null);
  };

  const saveExpenseEdit = (id: string) => {
    const val = parseFloat(editValue);
    if (!isNaN(val)) {
      onUpdateFixedExpenses(fixedExpenses.map(e => e.id === id ? { ...e, amount: val } : e));
      setNextFixed(exps => exps.map(e => e.id === id ? { ...e, amount: val } : e));
    }
    setEditingId(null);
  };

  const startRename = (id: string, name: string) => {
    setRenamingId(id);
    setRenameValue(name);
  };

  const saveRename = (id: string, isFixed: boolean) => {
    if (renameValue.trim()) {
      if (isFixed) {
        onUpdateFixedExpenses(fixedExpenses.map(e => e.id === id ? { ...e, name: renameValue.trim() } : e));
        setNextFixed(exps => exps.map(e => e.id === id ? { ...e, name: renameValue.trim() } : e));
      } else {
        onUpdateCategories(categories.map(c => c.id === id ? { ...c, name: renameValue.trim() } : c));
        setNextCats(cats => cats.map(c => c.id === id ? { ...c, name: renameValue.trim() } : c));
      }
    }
    setRenamingId(null);
  };

  const deleteCategory = (id: string) => {
    onUpdateCategories(categories.filter(c => c.id !== id));
    setNextCats(cats => cats.filter(c => c.id !== id));
  };

  const deleteFixedExpense = (id: string) => {
    onUpdateFixedExpenses(fixedExpenses.filter(e => e.id !== id));
    setNextFixed(exps => exps.filter(e => e.id !== id));
  };

  const addCategory = () => {
    if (!newCatName.trim()) return;
    const budget = parseFloat(newCatBudget) || 0;
    const newCat: BudgetCategory = {
      id: newCatName.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now(),
      name: newCatName.trim(),
      budgeted: budget,
      group: newCatGroup,
    };
    onUpdateCategories([...categories, newCat]);
    setNextCats(cats => [...cats, { ...newCat }]);
    setNewCatName('');
    setNewCatBudget('');
    setShowAddCategory(false);
  };

  const addFixedExpense = (group: FixedGroupType) => {
    if (!newFixedName.trim()) return;
    const amount = parseFloat(newFixedAmount) || 0;
    const newExp: FixedExpense = {
      id: newFixedName.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now(),
      name: newFixedName.trim(),
      amount,
      group,
    };
    onUpdateFixedExpenses([...fixedExpenses, newExp]);
    setNextFixed(exps => [...exps, { ...newExp }]);
    setNewFixedName('');
    setNewFixedAmount('');
    setShowAddFixed(null);
  };

  const moveCategory = (id: string, direction: 'up' | 'down') => {
    const group = categories.find(c => c.id === id)?.group;
    if (!group) return;
    const newCats = [...categories];
    const gItems = newCats.filter(c => c.group === group);
    const gIdx = gItems.findIndex(c => c.id === id);
    if (direction === 'up' && gIdx > 0) {
      [gItems[gIdx - 1], gItems[gIdx]] = [gItems[gIdx], gItems[gIdx - 1]];
    } else if (direction === 'down' && gIdx < gItems.length - 1) {
      [gItems[gIdx], gItems[gIdx + 1]] = [gItems[gIdx + 1], gItems[gIdx]];
    }
    const result = newCats.filter(c => c.group !== group);
    const insertAt = categories.findIndex(c => c.group === group);
    result.splice(insertAt, 0, ...gItems);
    onUpdateCategories(result);
    setNextCats(result.map(c => ({ ...c })));
  };

  const moveFixedExpense = (id: string, direction: 'up' | 'down') => {
    const group = fixedExpenses.find(e => e.id === id)?.group;
    if (!group) return;
    const newExps = [...fixedExpenses];
    const gItems = newExps.filter(e => e.group === group);
    const gIdx = gItems.findIndex(e => e.id === id);
    if (direction === 'up' && gIdx > 0) {
      [gItems[gIdx - 1], gItems[gIdx]] = [gItems[gIdx], gItems[gIdx - 1]];
    } else if (direction === 'down' && gIdx < gItems.length - 1) {
      [gItems[gIdx], gItems[gIdx + 1]] = [gItems[gIdx + 1], gItems[gIdx]];
    }
    const result = newExps.filter(e => e.group !== group);
    const insertAt = fixedExpenses.findIndex(e => e.group === group);
    result.splice(insertAt, 0, ...gItems);
    onUpdateFixedExpenses(result);
    setNextFixed(result.map(e => ({ ...e })));
  };

  // Next month budget edit
  const saveNextCatEdit = (id: string) => {
    const v = parseFloat(editValue);
    if (!isNaN(v)) setNextCats(cats => cats.map(c => c.id === id ? { ...c, budgeted: v } : c));
    setEditingId(null);
  };

  const saveNextFixedEdit = (id: string) => {
    const v = parseFloat(editValue);
    if (!isNaN(v)) setNextFixed(exps => exps.map(e => e.id === id ? { ...e, amount: v } : e));
    setEditingId(null);
  };

  const groupLabels: Record<GroupType, string> = { shared: 'Shared', joe: "Joe's", katie: "Katie's" };
  const fixedGroupLabels: Record<FixedGroupType, string> = { bills: 'Fixed Bills', savings: 'Savings Buckets', tithe: 'Tithe/Giving' };

  // Next month totals
  const hostingGiftsAmt = nextCats.find(c => c.id === GIVING_VARIABLE_CATEGORY)?.budgeted || 0;
  const variableTotal = nextCats.reduce((s, c) => s + c.budgeted, 0);
  const fixedBills = nextFixed.filter(e => e.group === 'bills');
  const savingsBuckets = nextFixed.filter(e => e.group === 'savings');
  const titheItems = nextFixed.filter(e => e.group === 'tithe');
  const fixedTotal = fixedBills.reduce((s, e) => s + e.amount, 0);
  const savingsTotal = savingsBuckets.reduce((s, e) => s + e.amount, 0);
  const rawTithe = titheItems.reduce((s, e) => s + e.amount, 0);
  const titheTotal = rawTithe + hostingGiftsAmt;
  const budgetTotal = variableTotal + fixedTotal + savingsTotal + rawTithe;

  function renderItemRow(item: { id: string; name: string }, value: number, saveEdit: (id: string) => void, isFixed: boolean, group: { items: { id: string }[] }) {
    const idx = group.items.findIndex(i => i.id === item.id);
    return (
      <div key={item.id} className="flex items-center gap-2 px-3 py-2.5">
        <div className="flex flex-col gap-0.5 shrink-0">
          <button onClick={() => isFixed ? moveFixedExpense(item.id, 'up') : moveCategory(item.id, 'up')} disabled={idx === 0}
            className="text-muted-foreground/40 disabled:opacity-20 active:scale-90 transition-all text-[10px] leading-none">▲</button>
          <button onClick={() => isFixed ? moveFixedExpense(item.id, 'down') : moveCategory(item.id, 'down')} disabled={idx === group.items.length - 1}
            className="text-muted-foreground/40 disabled:opacity-20 active:scale-90 transition-all text-[10px] leading-none">▼</button>
        </div>
        <div className="flex-1 min-w-0">
          {renamingId === item.id ? (
            <div className="flex gap-1.5">
              <input value={renameValue} onChange={e => setRenameValue(e.target.value)}
                className="flex-1 px-2 py-1 text-sm rounded bg-background border border-border focus:outline-none focus:ring-2 focus:ring-accent/30"
                autoFocus onKeyDown={e => e.key === 'Enter' && saveRename(item.id, isFixed)} />
              <button onClick={() => saveRename(item.id, isFixed)} className="text-xs text-accent font-medium">Save</button>
            </div>
          ) : (
            <button onClick={() => startRename(item.id, item.name)} className="text-sm text-foreground text-left truncate block w-full">
              {item.name}
            </button>
          )}
        </div>
        <div className="shrink-0">
          {editingId === `cur-${item.id}` ? (
            <div className="flex gap-1.5">
              <input type="number" step="0.01" value={editValue} onChange={e => setEditValue(e.target.value)}
                className="w-20 px-2 py-1 text-right text-sm rounded bg-background border border-border tabular-nums focus:outline-none focus:ring-2 focus:ring-accent/30"
                autoFocus onKeyDown={e => e.key === 'Enter' && saveEdit(item.id)} />
              <button onClick={() => saveEdit(item.id)} className="text-xs text-accent font-medium">Save</button>
            </div>
          ) : (
            <button onClick={() => startEdit(`cur-${item.id}`, value)}
              className="text-sm font-medium tabular-nums text-foreground active:scale-95 transition-transform">
              {formatCurrency(value)}
            </button>
          )}
        </div>
        <button onClick={() => isFixed ? deleteFixedExpense(item.id) : deleteCategory(item.id)}
          className="p-1 text-muted-foreground/30 hover:text-destructive active:scale-95 transition-all shrink-0">
          <Trash2 size={12} />
        </button>
      </div>
    );
  }

  function renderAddFixedForm(group: FixedGroupType) {
    if (showAddFixed !== group) return null;
    return (
      <div className="bg-accent/5 border border-accent/20 rounded-lg p-3 mb-3 space-y-2">
        <input value={newFixedName} onChange={e => setNewFixedName(e.target.value)} placeholder="Name"
          className="w-full px-3 py-2 rounded-lg bg-card border border-border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent/30" autoFocus />
        <input type="number" value={newFixedAmount} onChange={e => setNewFixedAmount(e.target.value)} placeholder="$0.00"
          className="w-full px-3 py-2 rounded-lg bg-card border border-border text-sm tabular-nums text-foreground text-right focus:outline-none focus:ring-1 focus:ring-accent/30" />
        <div className="flex gap-2">
          <button onClick={() => addFixedExpense(group)} className="flex-1 py-2 rounded-lg bg-accent text-accent-foreground text-xs font-semibold active:scale-[0.98] transition-transform">Add</button>
          <button onClick={() => setShowAddFixed(null)} className="px-4 py-2 rounded-lg bg-card border border-border text-xs font-medium text-muted-foreground active:scale-[0.98] transition-transform">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto pb-28">
      <div className="px-6 pt-12 safe-top">
        <button onClick={onBack} className="flex items-center gap-1 text-accent text-sm font-medium mb-4 active:scale-95 transition-transform">
          <ArrowLeft size={16} /> Back
        </button>
        <h1 className="font-display text-xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage budget amounts & categories</p>
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

        {/* Variable Categories */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Variable Categories</h3>
            <button onClick={() => setShowAddCategory(!showAddCategory)}
              className="flex items-center gap-1 text-xs text-accent font-medium active:scale-95 transition-transform">
              <Plus size={14} /> Add
            </button>
          </div>

          {showAddCategory && (
            <div className="bg-accent/5 border border-accent/20 rounded-lg p-3 mb-3 space-y-2">
              <input value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="Category name"
                className="w-full px-3 py-2 rounded-lg bg-card border border-border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent/30" autoFocus />
              <div className="flex gap-2">
                <select value={newCatGroup} onChange={e => setNewCatGroup(e.target.value as GroupType)}
                  className="flex-1 px-2 py-2 rounded-lg bg-card border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent/30">
                  <option value="shared">Shared</option>
                  <option value="joe">Joe</option>
                  <option value="katie">Katie</option>
                </select>
                <input type="number" value={newCatBudget} onChange={e => setNewCatBudget(e.target.value)} placeholder="$0"
                  className="w-24 px-2 py-2 rounded-lg bg-card border border-border text-sm tabular-nums text-foreground text-right focus:outline-none focus:ring-1 focus:ring-accent/30" />
              </div>
              <div className="flex gap-2">
                <button onClick={addCategory} className="flex-1 py-2 rounded-lg bg-accent text-accent-foreground text-xs font-semibold active:scale-[0.98] transition-transform">Add Category</button>
                <button onClick={() => setShowAddCategory(false)} className="px-4 py-2 rounded-lg bg-card border border-border text-xs font-medium text-muted-foreground active:scale-[0.98] transition-transform">Cancel</button>
              </div>
            </div>
          )}

          {(['shared', 'joe', 'katie'] as GroupType[]).map(group => {
            const groupCats = categories.filter(c => c.group === group);
            return (
              <div key={group} className="mb-4">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{groupLabels[group]}</p>
                <div className="bg-card rounded-lg shadow-sm divide-y divide-border overflow-hidden">
                  {groupCats.map(c => renderItemRow(c, c.budgeted, saveCategoryEdit, false, { items: groupCats }))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Fixed Expenses with full CRUD */}
        {(['bills', 'savings', 'tithe'] as FixedGroupType[]).map(group => {
          const items = fixedExpenses.filter(e => e.group === group);
          return (
            <div key={group} className="mb-8">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{fixedGroupLabels[group]}</h3>
                <button onClick={() => setShowAddFixed(showAddFixed === group ? null : group)}
                  className="flex items-center gap-1 text-xs text-accent font-medium active:scale-95 transition-transform">
                  <Plus size={14} /> Add
                </button>
              </div>
              {renderAddFixedForm(group)}
              <div className="bg-card rounded-lg shadow-sm divide-y divide-border overflow-hidden">
                {items.map(e => renderItemRow(e, e.amount, saveExpenseEdit, true, { items }))}
              </div>
            </div>
          );
        })}

        {/* Next Month Budget */}
        <div className="mt-8">
          <h2 className="font-display text-lg font-bold text-foreground mb-4">{nextMonthShort} Budget</h2>

          {/* Next Month Variable */}
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Variable Budgets</h3>
          {(['shared', 'joe', 'katie'] as GroupType[]).map(group => {
            const cats = nextCats.filter(c => c.group === group);
            return (
              <div key={group} className="mb-4">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{groupLabels[group]}</p>
                <div className="bg-card rounded-lg shadow-sm divide-y divide-border overflow-hidden">
                  {cats.map(c => (
                    <div key={c.id} className="flex justify-between items-center px-4 py-2.5">
                      <span className="text-sm text-foreground">{c.name}</span>
                      {editingId === `next-cat-${c.id}` ? (
                        <div className="flex gap-1.5">
                          <input type="number" step="1" value={editValue} onChange={e => setEditValue(e.target.value)}
                            className="w-20 px-2 py-1 text-right text-sm rounded bg-background border border-border tabular-nums focus:outline-none focus:ring-2 focus:ring-accent/30"
                            autoFocus onKeyDown={e => e.key === 'Enter' && saveNextCatEdit(c.id)} />
                          <button onClick={() => saveNextCatEdit(c.id)} className="text-xs text-accent font-medium">Save</button>
                        </div>
                      ) : (
                        <button onClick={() => startEdit(`next-cat-${c.id}`, c.budgeted)}
                          className="text-sm font-medium tabular-nums text-foreground active:scale-95 transition-transform">
                          {fmtWhole(c.budgeted)}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Next Month Fixed, Savings, Tithe */}
          {([
            { key: 'bills' as FixedGroupType, label: 'Fixed Bills', items: fixedBills },
            { key: 'savings' as FixedGroupType, label: 'Savings Buckets', items: savingsBuckets },
            { key: 'tithe' as FixedGroupType, label: 'Tithe/Giving', items: titheItems },
          ]).map(({ key, label, items }) => (
            <div key={key} className="mb-4">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">{label}</h3>
              <div className="bg-card rounded-lg shadow-sm divide-y divide-border overflow-hidden">
                {items.map(e => (
                  <div key={e.id} className="flex justify-between items-center px-4 py-2.5">
                    <span className="text-sm text-foreground">{e.name}</span>
                    {editingId === `next-fix-${e.id}` ? (
                      <div className="flex gap-1.5">
                        <input type="number" step="0.01" value={editValue} onChange={ev => setEditValue(ev.target.value)}
                          className="w-24 px-2 py-1 text-right text-sm rounded bg-background border border-border tabular-nums focus:outline-none focus:ring-2 focus:ring-accent/30"
                          autoFocus onKeyDown={ev => ev.key === 'Enter' && saveNextFixedEdit(e.id)} />
                        <button onClick={() => saveNextFixedEdit(e.id)} className="text-xs text-accent font-medium">Save</button>
                      </div>
                    ) : (
                      <button onClick={() => startEdit(`next-fix-${e.id}`, e.amount)}
                        className="text-sm font-medium tabular-nums text-foreground active:scale-95 transition-transform">
                        {formatCurrency(e.amount)}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Budget Summary */}
          <div className="bg-card rounded-lg shadow-sm px-4 py-3 mb-4">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-muted-foreground">Variable Total</span>
              <span className="font-medium tabular-nums">{fmtWhole(variableTotal)}</span>
            </div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-muted-foreground">Fixed Bills</span>
              <span className="font-medium tabular-nums">{formatCurrency(fixedTotal)}</span>
            </div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-muted-foreground">Savings Buckets</span>
              <span className="font-medium tabular-nums">{formatCurrency(savingsTotal)}</span>
            </div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-muted-foreground">Tithe/Giving</span>
              <span className="font-medium tabular-nums">{formatCurrency(titheTotal)}</span>
            </div>
            <div className="border-t border-border mt-2 pt-2 flex justify-between text-sm">
              <span className="font-semibold text-foreground">Total Budget</span>
              <span className="font-semibold tabular-nums text-foreground">{formatCurrency(budgetTotal)}</span>
            </div>
          </div>

          {/* Start Month Button */}
          <button
            onClick={() => onStartMonth(nextMonth, nextCats, nextFixed)}
            className="w-full py-4 rounded-xl bg-accent text-accent-foreground font-display font-semibold text-base active:scale-[0.98] transition-transform shadow-lg"
          >
            Start {nextMonthShort}
          </button>
        </div>
      </div>
    </div>
  );
}
