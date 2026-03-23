import { useState } from 'react';
import { BudgetCategory, FixedExpense } from '@/types/budget';
import { ArrowLeft, Plus, Trash2, GripVertical } from 'lucide-react';

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}

interface SettingsViewProps {
  categories: BudgetCategory[];
  fixedExpenses: FixedExpense[];
  onUpdateCategories: (cats: BudgetCategory[]) => void;
  onUpdateFixedExpenses: (exps: FixedExpense[]) => void;
  onBack: () => void;
}

type GroupType = 'shared' | 'joe' | 'katie';

export function SettingsView({ categories, fixedExpenses, onUpdateCategories, onUpdateFixedExpenses, onBack }: SettingsViewProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatGroup, setNewCatGroup] = useState<GroupType>('shared');
  const [newCatBudget, setNewCatBudget] = useState('');

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

  const startRename = (id: string, name: string) => {
    setRenamingId(id);
    setRenameValue(name);
  };

  const saveRename = (id: string) => {
    if (renameValue.trim()) {
      onUpdateCategories(categories.map(c => c.id === id ? { ...c, name: renameValue.trim() } : c));
    }
    setRenamingId(null);
  };

  const deleteCategory = (id: string) => {
    onUpdateCategories(categories.filter(c => c.id !== id));
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
    setNewCatName('');
    setNewCatBudget('');
    setShowAddCategory(false);
  };

  const moveCategory = (id: string, direction: 'up' | 'down') => {
    const group = categories.find(c => c.id === id)?.group;
    if (!group) return;
    const groupCats = categories.filter(c => c.group === group);
    const otherCats = categories.filter(c => c.group !== group);
    const idx = groupCats.findIndex(c => c.id === id);
    if (direction === 'up' && idx > 0) {
      [groupCats[idx - 1], groupCats[idx]] = [groupCats[idx], groupCats[idx - 1]];
    } else if (direction === 'down' && idx < groupCats.length - 1) {
      [groupCats[idx], groupCats[idx + 1]] = [groupCats[idx + 1], groupCats[idx]];
    }
    // Rebuild in order: shared, joe, katie
    const ordered = [
      ...groupCats.filter(c => c.group === 'shared'),
      ...otherCats.filter(c => c.group === 'shared'),
      ...groupCats.filter(c => c.group === 'joe'),
      ...otherCats.filter(c => c.group === 'joe'),
      ...groupCats.filter(c => c.group === 'katie'),
      ...otherCats.filter(c => c.group === 'katie'),
    ].filter((c, i, arr) => arr.findIndex(x => x.id === c.id) === i);
    // Simpler: just replace in-place keeping original order
    const newCats = [...categories];
    const gStart = newCats.findIndex(c => c.group === group);
    const gItems = newCats.filter(c => c.group === group);
    const gIdx = gItems.findIndex(c => c.id === id);
    if (direction === 'up' && gIdx > 0) {
      [gItems[gIdx - 1], gItems[gIdx]] = [gItems[gIdx], gItems[gIdx - 1]];
    } else if (direction === 'down' && gIdx < gItems.length - 1) {
      [gItems[gIdx], gItems[gIdx + 1]] = [gItems[gIdx + 1], gItems[gIdx]];
    }
    const result = newCats.filter(c => c.group !== group);
    // Insert group items at original position
    const insertAt = categories.findIndex(c => c.group === group);
    result.splice(insertAt, 0, ...gItems);
    onUpdateCategories(result);
  };

  const groupLabels: Record<GroupType, string> = { shared: 'Shared', joe: "Joe's", katie: "Katie's" };

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

        {/* Category Manager */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Variable Categories</h3>
            <button
              onClick={() => setShowAddCategory(!showAddCategory)}
              className="flex items-center gap-1 text-xs text-accent font-medium active:scale-95 transition-transform"
            >
              <Plus size={14} /> Add
            </button>
          </div>

          {showAddCategory && (
            <div className="bg-accent/5 border border-accent/20 rounded-lg p-3 mb-3 space-y-2">
              <input
                value={newCatName}
                onChange={e => setNewCatName(e.target.value)}
                placeholder="Category name"
                className="w-full px-3 py-2 rounded-lg bg-card border border-border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent/30"
                autoFocus
              />
              <div className="flex gap-2">
                <select
                  value={newCatGroup}
                  onChange={e => setNewCatGroup(e.target.value as GroupType)}
                  className="flex-1 px-2 py-2 rounded-lg bg-card border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent/30"
                >
                  <option value="shared">Shared</option>
                  <option value="joe">Joe</option>
                  <option value="katie">Katie</option>
                </select>
                <input
                  type="number"
                  value={newCatBudget}
                  onChange={e => setNewCatBudget(e.target.value)}
                  placeholder="$0"
                  className="w-24 px-2 py-2 rounded-lg bg-card border border-border text-sm tabular-nums text-foreground text-right focus:outline-none focus:ring-1 focus:ring-accent/30"
                />
              </div>
              <div className="flex gap-2">
                <button onClick={addCategory} className="flex-1 py-2 rounded-lg bg-accent text-accent-foreground text-xs font-semibold active:scale-[0.98] transition-transform">
                  Add Category
                </button>
                <button onClick={() => setShowAddCategory(false)} className="px-4 py-2 rounded-lg bg-card border border-border text-xs font-medium text-muted-foreground active:scale-[0.98] transition-transform">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {(['shared', 'joe', 'katie'] as GroupType[]).map(group => {
            const groupCats = categories.filter(c => c.group === group);
            return (
              <div key={group} className="mb-4">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{groupLabels[group]}</p>
                <div className="bg-card rounded-lg shadow-sm divide-y divide-border overflow-hidden">
                  {groupCats.map((c, idx) => (
                    <div key={c.id} className="flex items-center gap-2 px-3 py-2.5">
                      <div className="flex flex-col gap-0.5 shrink-0">
                        <button onClick={() => moveCategory(c.id, 'up')} disabled={idx === 0}
                          className="text-muted-foreground/40 disabled:opacity-20 active:scale-90 transition-all text-[10px] leading-none">▲</button>
                        <button onClick={() => moveCategory(c.id, 'down')} disabled={idx === groupCats.length - 1}
                          className="text-muted-foreground/40 disabled:opacity-20 active:scale-90 transition-all text-[10px] leading-none">▼</button>
                      </div>
                      <div className="flex-1 min-w-0">
                        {renamingId === c.id ? (
                          <div className="flex gap-1.5">
                            <input
                              value={renameValue}
                              onChange={e => setRenameValue(e.target.value)}
                              className="flex-1 px-2 py-1 text-sm rounded bg-background border border-border focus:outline-none focus:ring-2 focus:ring-accent/30"
                              autoFocus
                              onKeyDown={e => e.key === 'Enter' && saveRename(c.id)}
                            />
                            <button onClick={() => saveRename(c.id)} className="text-xs text-accent font-medium">Save</button>
                          </div>
                        ) : (
                          <button onClick={() => startRename(c.id, c.name)} className="text-sm text-foreground text-left truncate block w-full">
                            {c.name}
                          </button>
                        )}
                      </div>
                      <div className="shrink-0">
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
                      <button onClick={() => deleteCategory(c.id)} className="p-1 text-muted-foreground/30 hover:text-destructive active:scale-95 transition-all shrink-0">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
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
