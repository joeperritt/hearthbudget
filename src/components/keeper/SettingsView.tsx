import { useState, useEffect, useMemo } from 'react';
import { BudgetCategory, FixedExpense, GIVING_VARIABLE_CATEGORY, Transaction } from '@/types/budget';
import { Switch } from '@/components/ui/switch';
import { ArrowLeft, Plus, Trash2, LogOut, AlertTriangle, MessageSquare, ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { format, addMonths, subMonths, parse } from 'date-fns';
import { useAuth } from '@/hooks/useAuth';
import { ProgressBar } from './ProgressBar';
import { supabase } from '@/integrations/supabase/client';
import { filterForMonth, applyOverridesToCategories, applyOverridesToFixed, type MonthAmountOverrides } from '@/hooks/useBudgetData';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from '@/components/ui/drawer';

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}

function fmtWhole(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

interface MonthSnapshot {
  id: string;
  month: string;
  categories: any[];
  fixed_expenses: any[];
  transfers?: any[];
  transactions_summary: {
    totalTransactions?: number;
    totalExpenses?: number;
    totalSpent?: number;
    grossSpent?: number;
    refundsTotal?: number;
    netSpent?: number;
    spentByCategory?: Record<string, number>;
  };
  created_at: string;
}

type ScopeChoice = 'month-only' | 'month-and-future';

interface PendingAdd {
  type: 'category' | 'fixed';
  item: BudgetCategory | FixedExpense;
  fixedGroup?: 'bills' | 'savings' | 'tithe';
}

interface PendingDelete {
  type: 'category' | 'fixed';
  slug: string;
  name: string;
}

interface SettingsViewProps {
  categories: BudgetCategory[];
  fixedExpenses: FixedExpense[];
  currentMonth: Date;
  onUpdateCategories: (cats: BudgetCategory[]) => void;
  onUpdateFixedExpenses: (exps: FixedExpense[]) => void;
  onAddCategoryForMonth?: (cat: BudgetCategory, scope: ScopeChoice, month: string) => Promise<void>;
  onAddFixedExpenseForMonth?: (exp: FixedExpense, scope: ScopeChoice, month: string) => Promise<void>;
  onRemoveCategoryFromMonth?: (slug: string, month: string, scope: ScopeChoice) => Promise<void>;
  onRemoveFixedExpenseFromMonth?: (slug: string, month: string, scope: ScopeChoice) => Promise<void>;
  onBack: () => void;
  unassignedCount?: number;
  // Current month spending data
  spentByCategory?: Record<string, number>;
  transferAdjustments?: Record<string, number>;
  monthTransactions?: Transaction[];
  /** When true, renders inline without header/back button/logout */
  embedded?: boolean;
  onViewMonthChange?: (month: string) => void;
}

type GroupType = 'shared' | 'joe' | 'katie' | 'giving' | 'savings';
type FixedGroupType = 'bills' | 'savings' | 'tithe';
type ViewTab = 'variable' | 'fixed' | 'savings' | 'giving';

export function SettingsView({
  categories, fixedExpenses, currentMonth,
  onUpdateCategories, onUpdateFixedExpenses,
  onAddCategoryForMonth, onAddFixedExpenseForMonth,
  onRemoveCategoryFromMonth, onRemoveFixedExpenseFromMonth,
  onBack,
  unassignedCount = 0,
  spentByCategory = {}, transferAdjustments = {}, monthTransactions = [],
  embedded = false,
  onViewMonthChange,
}: SettingsViewProps) {
  const { isAdmin, signOut, profile } = useAuth();
  const activeMonthKey = format(currentMonth, 'yyyy-MM');
  const nextMonth = addMonths(currentMonth, 1);
  const nextMonthKey = format(nextMonth, 'yyyy-MM');

  // Month navigation
  const [viewMonthDate, setViewMonthDate] = useState<Date>(embedded ? currentMonth : nextMonth);
  const viewMonthKey = format(viewMonthDate, 'yyyy-MM');
  const viewMonthLabel = format(viewMonthDate, 'MMMM yyyy');

  const isCurrentMonth = viewMonthKey === activeMonthKey;
  const isPastMonth = viewMonthKey < activeMonthKey;
  const isFutureMonth = viewMonthKey > activeMonthKey;
  const isNextMonth = viewMonthKey === nextMonthKey;
  // Current month is editable too — same UX as future months, but the scope
  // prompt copy makes the "this month only vs. future" choice explicit.
  const isEditableMonth = isCurrentMonth || isFutureMonth;

  useEffect(() => {
    onViewMonthChange?.(viewMonthKey);
  }, [onViewMonthChange, viewMonthKey]);

  // Past month snapshot
  const [snapshots, setSnapshots] = useState<MonthSnapshot[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [allSnapshotMonths, setAllSnapshotMonths] = useState<string[]>([]);

  // Household partner display name (for replacing hardcoded "Joe / Katie" copy)
  const [partnerDisplayName, setPartnerDisplayName] = useState<string | null>(null);
  useEffect(() => {
    if (!profile?.household_id || !profile?.user_id) return;
    let cancelled = false;
    supabase
      .from('profiles')
      .select('user_id, display_name')
      .eq('household_id', profile.household_id)
      .then(({ data }) => {
        if (cancelled || !data) return;
        const other = data.find(p => p.user_id !== profile.user_id);
        setPartnerDisplayName(other?.display_name ?? null);
      });
    return () => { cancelled = true; };
  }, [profile?.household_id, profile?.user_id]);

  // Fetch all snapshots once
  useEffect(() => {
    async function fetch() {
      setSnapshotsLoading(true);
      const { data } = await supabase
        .from('budget_month_snapshots' as any)
        .select('*')
        .order('month', { ascending: false });
      if (data) {
        setSnapshots(data as unknown as MonthSnapshot[]);
        setAllSnapshotMonths((data as any[]).map((d: any) => d.month));
      }
      setSnapshotsLoading(false);
    }
    fetch();
  }, []);

  const currentSnapshot = useMemo(
    () => snapshots.find(s => s.month === viewMonthKey),
    [snapshots, viewMonthKey]
  );

  // For past months, ALWAYS recompute spend from live transactions when
  // available — historical snapshot summaries (especially older ones) can be
  // stale or inconsistent (e.g. legacy totalSpent computed differently than
  // spentByCategory). Live recomputation matches the same rules used by the
  // current month and the snapshot writer in useBudgetData.
  const [pastMonthTxns, setPastMonthTxns] = useState<Transaction[]>([]);
  useEffect(() => {
    if (!isPastMonth || !profile?.household_id) {
      setPastMonthTxns([]);
      return;
    }
    let cancelled = false;
    supabase
      .from('transactions')
      .select('*')
      .eq('household_id', profile.household_id)
      .eq('budget_month', viewMonthKey)
      .then(({ data }) => {
        if (cancelled || !data) return;
        setPastMonthTxns(
          data.map((r: any) => ({
            id: r.id,
            date: r.date,
            description: r.description,
            notes: r.notes || '',
            amount: Number(r.amount),
            categoryId: r.category_slug,
            account: r.account,
            isTransferToSavings: r.is_transfer_to_savings,
            transactionType: r.transaction_type,
            enteredBy: r.entered_by,
            budgetMonth: r.budget_month || '',
            source: r.plaid_transaction_id ? 'plaid' : 'manual',
            originalDescription: r.original_description ?? null,
          })) as Transaction[]
        );
      });
    return () => { cancelled = true; };
  }, [isPastMonth, viewMonthKey, profile?.household_id]);

  // Recomputed past-month summary from live transactions (when present).
  const pastMonthLive = useMemo(() => {
    if (!isPastMonth || pastMonthTxns.length === 0) return null;
    const expense = pastMonthTxns.filter(t => t.transactionType === 'expense' && !t.categoryId.startsWith('ignore-'));
    const spentByCat: Record<string, number> = {};
    expense.forEach(t => { spentByCat[t.categoryId] = (spentByCat[t.categoryId] || 0) + t.amount; });
    const grossSpent = expense.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const refundsTotal = expense.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0);
    const netSpent = grossSpent + refundsTotal;
    return {
      spentByCategory: spentByCat,
      summary: {
        totalTransactions: pastMonthTxns.length,
        totalExpenses: expense.length,
        totalSpent: netSpent,
        grossSpent,
        refundsTotal,
        netSpent,
        spentByCategory: spentByCat,
      },
    };
  }, [isPastMonth, pastMonthTxns]);


  // View tab for read-only modes
  const [viewTab, setViewTab] = useState<ViewTab>('variable');

  // Editing state (for future months)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [showConfirmation] = useState(false);
  const [starting] = useState(false);

  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatGroup, setNewCatGroup] = useState<GroupType>('shared');
  const [newCatBudget, setNewCatBudget] = useState('');

  const [showAddFixed, setShowAddFixed] = useState<FixedGroupType | null>(null);
  const [newFixedName, setNewFixedName] = useState('');
  const [newFixedAmount, setNewFixedAmount] = useState('');

  // Scope prompt state
  const [pendingAdd, setPendingAdd] = useState<PendingAdd | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [showScopePrompt, setShowScopePrompt] = useState(false);
  const [scopeAction, setScopeAction] = useState<'add' | 'delete'>('add');

  // Filter categories and fixed expenses by the currently viewed month
  const monthFilteredCats = useMemo(() => filterForMonth(categories, viewMonthKey), [categories, viewMonthKey]);
  const monthFilteredFixed = useMemo(() => filterForMonth(fixedExpenses, viewMonthKey), [fixedExpenses, viewMonthKey]);

  const [nextCats, setNextCats] = useState<BudgetCategory[]>(() => monthFilteredCats.map(c => ({ ...c })));
  const [nextFixed, setNextFixed] = useState<FixedExpense[]>(() => monthFilteredFixed.map(e => ({ ...e })));

  // Reset next cats/fixed when categories change
  // Reset next cats/fixed when categories or viewed month change
  useEffect(() => {
    setNextCats(monthFilteredCats.map(c => ({ ...c })));
  }, [monthFilteredCats]);
  useEffect(() => {
    setNextFixed(monthFilteredFixed.map(e => ({ ...e })));
  }, [monthFilteredFixed]);

  const navigateMonth = (dir: 'prev' | 'next') => {
    setViewMonthDate(d => dir === 'prev' ? subMonths(d, 1) : addMonths(d, 1));
    setViewTab('variable');
  };

  // --- Mutations (only for future months) ---
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
      notesRequired: false,
    };
    // Show scope prompt
    setPendingAdd({ type: 'category', item: newCat });
    setScopeAction('add');
    setShowScopePrompt(true);
    setShowAddCategory(false);
  };

  const toggleNotesRequired = (id: string) => {
    const updated = categories.map(c => c.id === id ? { ...c, notesRequired: !c.notesRequired } : c);
    onUpdateCategories(updated);
    setNextCats(cats => cats.map(c => c.id === id ? { ...c, notesRequired: !c.notesRequired } : c));
  };

  const addFixedExpense = (group: FixedGroupType) => {
    if (!newFixedName.trim()) return;
    const amount = parseFloat(newFixedAmount) || 0;
    const newExp: FixedExpense = {
      id: newFixedName.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now(),
      name: newFixedName.trim(),
      amount,
      group,
      notesRequired: false,
    };
    // Show scope prompt
    setPendingAdd({ type: 'fixed', item: newExp, fixedGroup: group });
    setScopeAction('add');
    setShowScopePrompt(true);
    setShowAddFixed(null);
  };

  // Handle scope choice for add
  const handleScopeChoice = async (scope: ScopeChoice) => {
    setShowScopePrompt(false);

    if (scopeAction === 'add' && pendingAdd) {
      if (pendingAdd.type === 'category') {
        const cat = pendingAdd.item as BudgetCategory;
        if (onAddCategoryForMonth) {
          await onAddCategoryForMonth(cat, scope, viewMonthKey);
        }
        setNewCatName('');
        setNewCatBudget('');
      } else {
        const exp = pendingAdd.item as FixedExpense;
        if (onAddFixedExpenseForMonth) {
          await onAddFixedExpenseForMonth(exp, scope, viewMonthKey);
        }
        setNewFixedName('');
        setNewFixedAmount('');
      }
      setPendingAdd(null);
    }

    if (scopeAction === 'delete' && pendingDelete) {
      if (pendingDelete.type === 'category') {
        if (onRemoveCategoryFromMonth) {
          await onRemoveCategoryFromMonth(pendingDelete.slug, viewMonthKey, scope);
        }
      } else {
        if (onRemoveFixedExpenseFromMonth) {
          await onRemoveFixedExpenseFromMonth(pendingDelete.slug, viewMonthKey, scope);
        }
      }
      setPendingDelete(null);
    }
  };

  // Scoped delete handlers
  const handleDeleteCategory = (id: string, name: string) => {
    setPendingDelete({ type: 'category', slug: id, name });
    setScopeAction('delete');
    setShowScopePrompt(true);
  };

  const handleDeleteFixedExpense = (id: string, name: string) => {
    setPendingDelete({ type: 'fixed', slug: id, name });
    setScopeAction('delete');
    setShowScopePrompt(true);
  };

  const toggleFixedNotesRequired = (id: string) => {
    const updated = fixedExpenses.map(e => e.id === id ? { ...e, notesRequired: !e.notesRequired } : e);
    onUpdateFixedExpenses(updated);
    setNextFixed(exps => exps.map(e => e.id === id ? { ...e, notesRequired: !e.notesRequired } : e));
  };

  const saveNextCatEdit = (id: string) => {
    const v = parseFloat(editValue);
    if (!isNaN(v)) {
      const updated = categories.map(c => c.id === id ? { ...c, budgeted: v } : c);
      setNextCats(filterForMonth(updated, viewMonthKey).map(c => ({ ...c })));
      onUpdateCategories(updated);
    }
    setEditingId(null);
  };

  const saveNextFixedEdit = (id: string) => {
    const v = parseFloat(editValue);
    if (!isNaN(v)) {
      const updated = fixedExpenses.map(e => e.id === id ? { ...e, amount: v } : e);
      setNextFixed(filterForMonth(updated, viewMonthKey).map(e => ({ ...e })));
      onUpdateFixedExpenses(updated);
    }
    setEditingId(null);
  };

  const moveNextCat = (id: string, direction: 'up' | 'down', group: GroupType) => {
    setNextCats(prev => {
      const gItems = prev.filter(c => c.group === group);
      const others = prev.filter(c => c.group !== group);
      const idx = gItems.findIndex(c => c.id === id);
      if (direction === 'up' && idx > 0) {
        [gItems[idx - 1], gItems[idx]] = [gItems[idx], gItems[idx - 1]];
      } else if (direction === 'down' && idx < gItems.length - 1) {
        [gItems[idx], gItems[idx + 1]] = [gItems[idx + 1], gItems[idx]];
      }
      const insertAt = prev.findIndex(c => c.group === group);
      others.splice(insertAt, 0, ...gItems);
      return others;
    });
  };

  const moveNextFixed = (id: string, direction: 'up' | 'down', group: FixedGroupType) => {
    setNextFixed(prev => {
      const gItems = prev.filter(e => e.group === group);
      const others = prev.filter(e => e.group !== group);
      const idx = gItems.findIndex(e => e.id === id);
      if (direction === 'up' && idx > 0) {
        [gItems[idx - 1], gItems[idx]] = [gItems[idx], gItems[idx - 1]];
      } else if (direction === 'down' && idx < gItems.length - 1) {
        [gItems[idx], gItems[idx + 1]] = [gItems[idx + 1], gItems[idx]];
      }
      const insertAt = prev.findIndex(e => e.group === group);
      others.splice(insertAt, 0, ...gItems);
      return others;
    });
  };

  const toggleTitheType = (id: string, currentlyFixed: boolean) => {
    if (currentlyFixed) {
      const item = nextFixed.find(e => e.id === id);
      if (!item) return;
      const newCat: BudgetCategory = {
        id: item.id,
        name: item.name,
        budgeted: item.amount,
        group: 'giving',
        notesRequired: item.notesRequired,
        startMonth: item.startMonth,
        endMonth: item.endMonth,
      };
      setNextFixed(prev => prev.filter(e => e.id !== id));
      setNextCats(prev => [...prev, newCat]);
      onUpdateFixedExpenses(fixedExpenses.filter(e => e.id !== id));
      onUpdateCategories([...categories, newCat]);
    } else {
      const item = nextCats.find(c => c.id === id);
      if (!item) return;
      const newExp: FixedExpense = {
        id: item.id,
        name: item.name,
        amount: item.budgeted,
        group: 'tithe',
        notesRequired: item.notesRequired,
        startMonth: item.startMonth,
        endMonth: item.endMonth,
      };
      setNextCats(prev => prev.filter(c => c.id !== id));
      setNextFixed(prev => [...prev, newExp]);
      onUpdateCategories(categories.filter(c => c.id !== id));
      onUpdateFixedExpenses([...fixedExpenses, newExp]);
    }
  };

  const toggleSavingsType = (id: string, currentlyFixed: boolean) => {
    if (currentlyFixed) {
      // Move from fixed savings to variable savings category
      const item = nextFixed.find(e => e.id === id);
      if (!item) return;
      const newCat: BudgetCategory = {
        id: item.id,
        name: item.name,
        budgeted: item.amount,
        group: 'savings' as any,
        notesRequired: item.notesRequired,
        startMonth: item.startMonth,
        endMonth: item.endMonth,
      };
      setNextFixed(prev => prev.filter(e => e.id !== id));
      setNextCats(prev => [...prev, newCat]);
      onUpdateFixedExpenses(fixedExpenses.filter(e => e.id !== id));
      onUpdateCategories([...categories, newCat]);
    } else {
      // Move from variable savings category to fixed savings
      const item = nextCats.find(c => c.id === id);
      if (!item) return;
      const newExp: FixedExpense = {
        id: item.id,
        name: item.name,
        amount: item.budgeted,
        group: 'savings',
        notesRequired: item.notesRequired,
        startMonth: item.startMonth,
        endMonth: item.endMonth,
      };
      setNextCats(prev => prev.filter(c => c.id !== id));
      setNextFixed(prev => [...prev, newExp]);
      onUpdateCategories(categories.filter(c => c.id !== id));
      onUpdateFixedExpenses([...fixedExpenses, newExp]);
    }
  };

  const primaryLabel = profile?.display_name || 'You';
  const partnerLabel = partnerDisplayName || 'Partner';
  const groupLabels: Record<GroupType, string> = { shared: 'Shared', joe: `${primaryLabel}'s`, katie: `${partnerLabel}'s`, giving: 'Tithe/Giving', savings: 'Savings' };
  const fixedGroupLabels: Record<FixedGroupType, string> = { bills: 'Fixed', savings: 'Savings', tithe: 'Tithe/Giving' };

  // Next month totals
  const savingsVarCats = nextCats.filter(c => c.group === 'savings');
  const givingVarCats = nextCats.filter(c => c.group === 'giving' || c.id === GIVING_VARIABLE_CATEGORY);
  const nonGivingCats = nextCats.filter(c => c.group !== 'giving' && c.group !== 'savings' && c.id !== GIVING_VARIABLE_CATEGORY);
  const variableTotal = nonGivingCats.reduce((s, c) => s + c.budgeted, 0);
  const fixedBills = nextFixed.filter(e => e.group === 'bills');
  const savingsBuckets = nextFixed.filter(e => e.group === 'savings');
  const titheItems = nextFixed.filter(e => e.group === 'tithe');
  const fixedTotal = fixedBills.reduce((s, e) => s + e.amount, 0);
  const savingsFixedTotal = savingsBuckets.reduce((s, e) => s + e.amount, 0);
  const savingsVarTotal = savingsVarCats.reduce((s, c) => s + c.budgeted, 0);
  const savingsTotal = savingsFixedTotal + savingsVarTotal;
  const givingVarTotal = givingVarCats.reduce((s, c) => s + c.budgeted, 0);
  const rawTithe = titheItems.reduce((s, e) => s + e.amount, 0);
  const titheTotal = rawTithe + givingVarTotal;
  const budgetTotal = variableTotal + fixedTotal + savingsTotal + titheTotal;

  const handleStartMonthClick = () => {}; // No longer used — auto transition

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

  // ============================================
  // READ-ONLY VIEW for current & past months
  // ============================================
  function renderReadOnlyMonth() {
    let cats: { id: string; name: string; budgeted: number; group: string }[] = [];
    let fixed: { id: string; name: string; amount: number; group: string }[] = [];
    let spent: Record<string, number> = {};
    let transfers: Record<string, number> = {};
    let summary: { totalSpent?: number; totalTransactions?: number } = {};

    if (isCurrentMonth) {
      cats = monthFilteredCats.map(c => ({ id: c.id, name: c.name, budgeted: c.budgeted, group: c.group }));
      fixed = monthFilteredFixed.map(e => ({ id: e.id, name: e.name, amount: e.amount, group: e.group }));
      spent = spentByCategory;
      transfers = transferAdjustments;
      const totalSpentVal = Object.entries(spent).reduce((s, [, v]) => s + Math.max(0, v), 0);
      summary = { totalSpent: totalSpentVal, totalTransactions: monthTransactions.length };
    } else if (isPastMonth && currentSnapshot) {
      cats = (currentSnapshot.categories || []).map((c: any) => ({
        id: c.id, name: c.name, budgeted: c.budgeted || 0, group: c.group || 'shared',
      }));
      fixed = (currentSnapshot.fixed_expenses || []).map((e: any) => ({
        id: e.id, name: e.name, amount: e.amount || 0, group: e.group || 'bills',
      }));
      // Prefer live recompute (matches current-month rules + reflects edits/refunds);
      // fall back to snapshot summary fields when no live transactions exist.
      if (pastMonthLive) {
        summary = pastMonthLive.summary;
        spent = pastMonthLive.spentByCategory;
      } else {
        summary = currentSnapshot.transactions_summary || {};
        spent = (summary as any).spentByCategory || {};
      }
      // Build transfer adjustments from the snapshotted transfers list.
      const snapTransfers: Array<{ fromCategoryId: string; toCategoryId: string; amount: number }> =
        ((currentSnapshot as any).transfers as any[]) || [];
      const tMap: Record<string, number> = {};
      snapTransfers.forEach(t => {
        tMap[t.fromCategoryId] = (tMap[t.fromCategoryId] || 0) - t.amount;
        tMap[t.toCategoryId] = (tMap[t.toCategoryId] || 0) + t.amount;
      });
      transfers = tMap;
    } else if (isPastMonth && !currentSnapshot) {
      return (
        <div className="px-6 mt-6">
          <div className="bg-card rounded-lg shadow-sm px-4 py-10 flex flex-col items-center justify-center">
            <p className="text-sm text-muted-foreground font-medium">No data for this month</p>
            <p className="text-[11px] text-muted-foreground/60 mt-1">This month has no snapshot data</p>
          </div>
        </div>
      );
    }

    // Separate categories
    const varCats = cats.filter(c => c.group !== 'giving' && c.group !== 'savings' && c.id !== GIVING_VARIABLE_CATEGORY);
    const savingsVarCatsRO = cats.filter(c => c.group === 'savings');
    const givingCats = cats.filter(c => c.group === 'giving' || c.id === GIVING_VARIABLE_CATEGORY);
    const fixedBillsRO = fixed.filter(e => e.group === 'bills');
    const savingsRO = fixed.filter(e => e.group === 'savings');
    const titheRO = fixed.filter(e => e.group === 'tithe');

    const varTotal = varCats.reduce((s, c) => s + c.budgeted, 0);
    const fixedBillsTotal = fixedBillsRO.reduce((s, e) => s + e.amount, 0);
    const savingsFixedROTotal = savingsRO.reduce((s, e) => s + e.amount, 0);
    const savingsVarROTotal = savingsVarCatsRO.reduce((s, c) => s + c.budgeted, 0);
    const savingsROTotal = savingsFixedROTotal + savingsVarROTotal;
    const givingCatsTotal = givingCats.reduce((s, c) => s + c.budgeted, 0);
    const titheROTotal = titheRO.reduce((s, e) => s + e.amount, 0);
    const givingTotal = givingCatsTotal + titheROTotal;
    const totalBudgetRO = varTotal + fixedBillsTotal + savingsROTotal + givingTotal;

    const varSpent = varCats.reduce((s, c) => s + (spent[c.id] || 0), 0);
    const fixedSpentVal = fixedBillsRO.reduce((s, e) => s + (spent[e.id] || 0), 0);
    const savingsSpent = [...savingsRO, ...savingsVarCatsRO].reduce((s, e) => s + (spent[e.id] || 0), 0);
    const givingSpent = [...givingCats, ...titheRO].reduce((s, e) => s + (spent['id' in e ? e.id : (e as any).id] || 0), 0);

    const shared = varCats.filter(c => c.group === 'shared');
    const joe = varCats.filter(c => c.group === 'joe');
    const katie = varCats.filter(c => c.group === 'katie');

    function renderCatRow(item: { id: string; name: string; budgeted: number }, isFixedItem = false) {
      const amount = isFixedItem ? (item as any).amount ?? item.budgeted : item.budgeted;
      const s = spent[item.id] || 0;
      const adj = transfers[item.id] || 0;
      const adjustedBudget = amount + adj;
      const remaining = adjustedBudget - s;
      const hasSpending = isCurrentMonth || isPastMonth;

      return (
        <div key={item.id} className="px-4 py-3 lg:bg-card lg:rounded-lg lg:border lg:border-border/60 lg:shadow-sm lg:p-4">
          <div className="flex justify-between items-baseline mb-1 lg:mb-2">
            <span className="text-sm lg:text-base font-medium lg:font-semibold text-foreground">{item.name}</span>
            <span className="text-sm font-medium tabular-nums text-foreground">{formatCurrency(amount)}</span>
          </div>
          {hasSpending && (
            <>
              <ProgressBar value={Math.max(0, s)} max={adjustedBudget} className="mb-1" />
              <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
                <span>{formatCurrency(s)} spent</span>
                <span className={remaining < 0 ? 'text-destructive' : ''}>
                  {remaining < 0 ? `-${formatCurrency(Math.abs(remaining))} over` : `${formatCurrency(remaining)} left`}
                </span>
              </div>
            </>
          )}
        </div>
      );
    }

    return (
      <>
        {/* Toggle */}
        <div className="px-6 mb-4">
          <div className="flex bg-card rounded-lg p-1 shadow-sm">
            {(['variable', 'fixed', 'savings', 'giving'] as ViewTab[]).map(m => (
              <button
                key={m}
                onClick={() => setViewTab(m)}
                className={`flex-1 py-2 rounded-md text-xs font-semibold transition-colors active:scale-[0.98] ${
                  viewTab === m ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground'
                }`}
              >
                {m === 'variable' ? 'Variable' : m === 'fixed' ? 'Fixed' : m === 'savings' ? 'Savings' : 'Giving'}
              </button>
            ))}
          </div>
        </div>

        {viewTab === 'variable' && (
          <div className="px-6 pb-4">
            {([
              { label: 'Shared', items: shared },
              { label: `${primaryLabel}'s`, items: joe },
              { label: `${partnerLabel}'s`, items: katie },
            ] as const).map(({ label, items }) => items.length > 0 && (
              <div key={label} className="mb-3">
                <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{label}</h4>
                <div className="bg-card rounded-lg shadow-sm divide-y divide-border overflow-hidden lg:bg-transparent lg:shadow-none lg:divide-y-0 lg:overflow-visible lg:rounded-none lg:grid lg:grid-cols-2 xl:grid-cols-2 lg:gap-4">
                  {items.map(c => renderCatRow(c))}
                </div>
              </div>
            ))}
            {isCurrentMonth && (
              <div className="bg-card rounded-lg shadow-sm px-4 py-3 mt-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Variable Budget</span>
                  <span className="font-medium tabular-nums">{formatCurrency(varTotal)}</span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span className="text-muted-foreground">Spent</span>
                  <span className="font-medium tabular-nums">{formatCurrency(varSpent)}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {viewTab === 'fixed' && (
          <div className="px-6 pb-4">
            {fixedBillsRO.length > 0 && (
              <div className="mb-3">
                <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Fixed</h4>
                <div className="bg-card rounded-lg shadow-sm divide-y divide-border overflow-hidden lg:bg-transparent lg:shadow-none lg:divide-y-0 lg:overflow-visible lg:rounded-none lg:grid lg:grid-cols-2 xl:grid-cols-2 lg:gap-4">
                  {fixedBillsRO.map(e => renderCatRow({ id: e.id, name: e.name, budgeted: e.amount }, true))}
                </div>
              </div>
            )}
            {isCurrentMonth && (
              <div className="bg-card rounded-lg shadow-sm px-4 py-3 mt-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Fixed Budget</span>
                  <span className="font-medium tabular-nums">{formatCurrency(fixedBillsTotal)}</span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span className="text-muted-foreground">Spent</span>
                  <span className="font-medium tabular-nums">{formatCurrency(fixedSpentVal)}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {viewTab === 'savings' && (
          <div className="px-6 pb-4">
            {savingsRO.length > 0 && (
              <div className="mb-3">
                <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Fixed Savings</h4>
                <div className="bg-card rounded-lg shadow-sm divide-y divide-border overflow-hidden lg:bg-transparent lg:shadow-none lg:divide-y-0 lg:overflow-visible lg:rounded-none lg:grid lg:grid-cols-2 xl:grid-cols-2 lg:gap-4">
                  {savingsRO.map(e => renderCatRow({ id: e.id, name: e.name, budgeted: e.amount }, true))}
                </div>
              </div>
            )}
            {savingsVarCatsRO.length > 0 && (
              <div className="mb-3">
                <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Variable Savings</h4>
                <div className="bg-card rounded-lg shadow-sm divide-y divide-border overflow-hidden lg:bg-transparent lg:shadow-none lg:divide-y-0 lg:overflow-visible lg:rounded-none lg:grid lg:grid-cols-2 xl:grid-cols-2 lg:gap-4">
                  {savingsVarCatsRO.map(c => renderCatRow(c))}
                </div>
              </div>
            )}
            {isCurrentMonth && (
              <div className="bg-card rounded-lg shadow-sm px-4 py-3 mt-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Savings Budget</span>
                  <span className="font-medium tabular-nums">{formatCurrency(savingsROTotal)}</span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span className="text-muted-foreground">Spent</span>
                  <span className="font-medium tabular-nums">{formatCurrency(savingsSpent)}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {viewTab === 'giving' && (
          <div className="px-6 pb-4">
            {titheRO.length > 0 && (
              <div className="mb-3">
                <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Fixed Tithe</h4>
                <div className="bg-card rounded-lg shadow-sm divide-y divide-border overflow-hidden lg:bg-transparent lg:shadow-none lg:divide-y-0 lg:overflow-visible lg:rounded-none lg:grid lg:grid-cols-2 xl:grid-cols-2 lg:gap-4">
                  {titheRO.map(e => renderCatRow({ id: e.id, name: e.name, budgeted: e.amount }, true))}
                </div>
              </div>
            )}
            {givingCats.length > 0 && (
              <div className="mb-3">
                <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Variable Giving</h4>
                <div className="bg-card rounded-lg shadow-sm divide-y divide-border overflow-hidden lg:bg-transparent lg:shadow-none lg:divide-y-0 lg:overflow-visible lg:rounded-none lg:grid lg:grid-cols-2 xl:grid-cols-2 lg:gap-4">
                  {givingCats.map(c => renderCatRow(c))}
                </div>
              </div>
            )}
            {isCurrentMonth && (
              <div className="bg-card rounded-lg shadow-sm px-4 py-3 mt-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Giving Budget</span>
                  <span className="font-medium tabular-nums">{formatCurrency(givingTotal)}</span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span className="text-muted-foreground">Spent</span>
                  <span className="font-medium tabular-nums">{formatCurrency(givingSpent)}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Budget Summary */}
        <div className="px-6 pb-6">
          <div className="bg-card rounded-lg shadow-sm border border-border/60 px-4 py-3">
            <div className="flex items-baseline justify-between">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Monthly Budget</p>
              <p className="text-lg font-semibold tabular-nums text-foreground">{formatCurrency(totalBudgetRO)}</p>
            </div>
            {isCurrentMonth && (
              <div className="mt-2.5">
                {(() => {
                  const totalSpentAll = varSpent + fixedSpentVal + savingsSpent + givingSpent;
                  const remaining = totalBudgetRO - totalSpentAll;
                  const pct = totalBudgetRO > 0 ? Math.min((totalSpentAll / totalBudgetRO) * 100, 100) : 0;
                  return (
                    <>
                      <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                        <span>{formatCurrency(totalSpentAll)} spent</span>
                        <span className={remaining >= 0 ? '' : 'text-destructive font-medium'}>
                          {remaining >= 0 ? `${formatCurrency(remaining)} remaining` : `-${formatCurrency(Math.abs(remaining))} over`}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${remaining >= 0 ? 'bg-accent' : 'bg-destructive'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </>
                  );
                })()}
              </div>
            )}
            {isPastMonth && (
              <div className="mt-2.5 space-y-1">
                {(() => {
                  const s: any = summary || {};
                  // Derive gross/net consistently. If snapshot lacks gross/net
                  // fields (older snapshots), fall back to spentByCategory which
                  // already excludes ignore-* rows — and use that SAME source for
                  // both gross and net so the math reconciles. The legacy
                  // totalSpent field can be inconsistent with spentByCategory
                  // (different inclusion rules), so we don't mix them.
                  const spentSum = Object.values(spent).reduce((acc: number, v: any) => acc + Math.max(0, Number(v) || 0), 0);
                  const gross = typeof s.grossSpent === 'number' ? s.grossSpent : spentSum;
                  const refunds = typeof s.refundsTotal === 'number' ? s.refundsTotal : 0;
                  const net = typeof s.netSpent === 'number' ? s.netSpent : gross + refunds;
                  const remaining = totalBudgetRO - net;
                  const pct = totalBudgetRO > 0 ? Math.min((Math.max(0, net) / totalBudgetRO) * 100, 100) : 0;
                  return (
                    <>
                      <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
                        <span>Spent</span>
                        <span className="font-medium text-foreground">{formatCurrency(gross)}</span>
                      </div>
                      {refunds < 0 && (
                        <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
                          <span>Refunds</span>
                          <span>-{formatCurrency(Math.abs(refunds))}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-[11px] tabular-nums pt-0.5 border-t border-border/50">
                        <span className="text-muted-foreground">Net</span>
                        <span className="font-semibold text-foreground">{formatCurrency(net)}</span>
                      </div>
                      <div className="flex justify-between text-[11px] tabular-nums">
                        <span className="text-muted-foreground">{summary.totalTransactions || 0} transactions</span>
                        <span className={remaining >= 0 ? 'text-muted-foreground' : 'text-destructive font-medium'}>
                          {remaining >= 0 ? `${formatCurrency(remaining)} under` : `-${formatCurrency(Math.abs(remaining))} over`}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden mt-1">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${remaining >= 0 ? 'bg-accent' : 'bg-destructive'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </>
                  );
                })()}
              </div>
            )}
          </div>

          <div className="bg-card rounded-lg shadow-sm px-4 py-3 mt-3">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-muted-foreground">Variable</span>
              <span className="font-medium tabular-nums">{formatCurrency(varTotal)}</span>
            </div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-muted-foreground">Fixed</span>
              <span className="font-medium tabular-nums">{formatCurrency(fixedBillsTotal)}</span>
            </div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-muted-foreground">Savings</span>
              <span className="font-medium tabular-nums">{formatCurrency(savingsROTotal)}</span>
            </div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-muted-foreground">Tithe/Giving</span>
              <span className="font-medium tabular-nums">{formatCurrency(givingTotal)}</span>
            </div>
            <div className="border-t border-border mt-2 pt-2 flex justify-between text-sm">
              <span className="font-semibold text-foreground">Total</span>
              <span className="font-semibold tabular-nums text-foreground">{formatCurrency(totalBudgetRO)}</span>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ============================================
  // FUTURE MONTH (editable) — existing behavior
  // ============================================
  function renderFutureMonth() {
    const nextMonthShort = format(viewMonthDate, 'MMMM');

    return (
      <>
        {/* Toggle */}
        <div className="px-6 mb-4">
          <div className="flex bg-card rounded-lg p-1 shadow-sm">
            {(['variable', 'fixed', 'savings', 'giving'] as ViewTab[]).map(m => (
              <button
                key={m}
                onClick={() => setViewTab(m)}
                className={`flex-1 py-2 rounded-md text-xs font-semibold transition-colors active:scale-[0.98] ${
                  viewTab === m ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground'
                }`}
              >
                {m === 'variable' ? 'Variable' : m === 'fixed' ? 'Fixed' : m === 'savings' ? 'Savings' : 'Giving'}
              </button>
            ))}
          </div>
        </div>

        {viewTab === 'variable' && (
          <div className="px-6 pb-4">
            {showAddCategory ? (
              <div className="bg-accent/5 border border-accent/20 rounded-lg p-3 mb-4 space-y-2">
                <input value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="Category name"
                  className="w-full px-3 py-2 rounded-lg bg-card border border-border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent/30" autoFocus />
                <div className="flex gap-2">
                  <select value={newCatGroup} onChange={e => setNewCatGroup(e.target.value as GroupType)}
                    className="flex-1 px-3 py-2 rounded-lg bg-card border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30">
                    <option value="shared">Shared</option>
                    <option value="joe">{primaryLabel}'s</option>
                    {partnerDisplayName && <option value="katie">{partnerLabel}'s</option>}
                  </select>
                  <input type="number" value={newCatBudget} onChange={e => setNewCatBudget(e.target.value)} placeholder="$0"
                    className="w-24 px-3 py-2 rounded-lg bg-card border border-border text-sm tabular-nums text-foreground text-right focus:outline-none focus:ring-1 focus:ring-accent/30" />
                </div>
                <div className="flex gap-2">
                  <button onClick={addCategory} className="flex-1 py-2 rounded-lg bg-accent text-accent-foreground text-xs font-semibold active:scale-[0.98] transition-transform">Add</button>
                  <button onClick={() => setShowAddCategory(false)} className="px-4 py-2 rounded-lg bg-card border border-border text-xs font-medium text-muted-foreground active:scale-[0.98] transition-transform">Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowAddCategory(true)}
                className="flex items-center gap-1.5 text-accent text-xs font-medium mb-4 active:scale-95 transition-transform">
                <Plus size={14} /> Add Variable Category
              </button>
            )}

            {(['shared', 'joe', 'katie'] as GroupType[]).map(group => {
              const cats = nonGivingCats.filter(c => c.group === group);
              return (
                <div key={group} className="mb-4">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                    {groupLabels[group]}
                    {group === 'shared' && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button type="button" aria-label="What does Notes required mean?" className="text-muted-foreground/70 hover:text-foreground"><Info className="w-3 h-3" /></button>
                        </PopoverTrigger>
                        <PopoverContent side="bottom" align="start" className="w-72 text-xs text-muted-foreground leading-snug">
                          <span className="font-medium text-foreground">Notes required:</span> when on, you must add a short note every time you log a transaction in this category. Useful for catch-all lines like "Misc" so you remember what was spent.
                        </PopoverContent>
                      </Popover>
                    )}
                  </p>
                  <div className="bg-card rounded-lg shadow-sm divide-y divide-border overflow-hidden lg:bg-transparent lg:shadow-none lg:divide-y-0 lg:overflow-visible lg:rounded-none lg:grid lg:grid-cols-2 xl:grid-cols-2 lg:gap-4">
                    {cats.map((c, idx) => (
                      <div key={c.id} className="px-3 py-2.5 lg:bg-card lg:rounded-lg lg:border lg:border-border/60 lg:shadow-sm lg:p-4">
                        <div className="flex items-center gap-2">
                          <div className="flex flex-col gap-0.5 shrink-0">
                            <button onClick={() => moveNextCat(c.id, 'up', group)} disabled={idx === 0}
                              className="text-muted-foreground/40 disabled:opacity-20 active:scale-90 transition-all text-[10px] leading-none">▲</button>
                            <button onClick={() => moveNextCat(c.id, 'down', group)} disabled={idx === cats.length - 1}
                              className="text-muted-foreground/40 disabled:opacity-20 active:scale-90 transition-all text-[10px] leading-none">▼</button>
                          </div>
                          <div className="flex-1 min-w-0">
                            {renamingId === c.id ? (
                              <div className="flex gap-1.5">
                                <input value={renameValue} onChange={e => setRenameValue(e.target.value)}
                                  className="flex-1 px-2 py-1 text-sm rounded bg-background border border-border focus:outline-none focus:ring-2 focus:ring-accent/30"
                                  autoFocus onKeyDown={e => e.key === 'Enter' && saveRename(c.id, false)} />
                                <button onClick={() => saveRename(c.id, false)} className="text-xs text-accent font-medium">Save</button>
                              </div>
                            ) : (
                              <button onClick={() => startRename(c.id, c.name)} className="text-sm text-foreground text-left truncate block w-full">
                                {c.name}
                              </button>
                            )}
                          </div>
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
                          <button onClick={() => handleDeleteCategory(c.id, c.name)}
                            className="p-1 text-muted-foreground/30 hover:text-destructive active:scale-95 transition-all shrink-0">
                            <Trash2 size={12} />
                          </button>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1 ml-6">
                          <button
                            onClick={() => toggleNotesRequired(c.id)}
                            className={`flex items-center gap-1 text-[10px] font-medium rounded-full px-2 py-0.5 transition-colors ${
                              c.notesRequired ? 'bg-accent/15 text-accent' : 'bg-muted/50 text-muted-foreground/60'
                            }`}
                          >
                            <MessageSquare size={9} />
                            {c.notesRequired ? 'Notes required' : 'No notes required'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {viewTab === 'fixed' && (
          <div className="px-6 pb-4">
            <div className="mb-4">
              {renderAddFixedForm('bills')}
              {showAddFixed !== 'bills' && (
                <button onClick={() => setShowAddFixed('bills')}
                  className="flex items-center gap-1.5 text-accent text-xs font-medium mb-3 active:scale-95 transition-transform">
                  <Plus size={14} /> Add Fixed Item
                </button>
              )}
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                Fixed
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" aria-label="What does Notes required mean?" className="text-muted-foreground/70 hover:text-foreground"><Info className="w-3 h-3" /></button>
                  </PopoverTrigger>
                  <PopoverContent side="bottom" align="start" className="w-72 text-xs text-muted-foreground leading-snug">
                    <span className="font-medium text-foreground">Notes required:</span> when on, you must add a short note every time you log a transaction in this category. Useful for catch-all lines like "Misc" so you remember what was spent.
                  </PopoverContent>
                </Popover>
              </h3>
              <div className="bg-card rounded-lg shadow-sm divide-y divide-border overflow-hidden lg:bg-transparent lg:shadow-none lg:divide-y-0 lg:overflow-visible lg:rounded-none lg:grid lg:grid-cols-2 xl:grid-cols-2 lg:gap-4">
                {fixedBills.map((e, idx) => (
                  <div key={e.id} className="px-3 py-2.5 lg:bg-card lg:rounded-lg lg:border lg:border-border/60 lg:shadow-sm lg:p-4">
                    <div className="flex items-center gap-2">
                      <div className="flex flex-col gap-0.5 shrink-0">
                        <button onClick={() => moveNextFixed(e.id, 'up', 'bills')} disabled={idx === 0}
                          className="text-muted-foreground/40 disabled:opacity-20 active:scale-90 transition-all text-[10px] leading-none">▲</button>
                        <button onClick={() => moveNextFixed(e.id, 'down', 'bills')} disabled={idx === fixedBills.length - 1}
                          className="text-muted-foreground/40 disabled:opacity-20 active:scale-90 transition-all text-[10px] leading-none">▼</button>
                      </div>
                      <div className="flex-1 min-w-0">
                        {renamingId === e.id ? (
                          <div className="flex gap-1.5">
                            <input value={renameValue} onChange={ev => setRenameValue(ev.target.value)}
                              className="flex-1 px-2 py-1 text-sm rounded bg-background border border-border focus:outline-none focus:ring-2 focus:ring-accent/30"
                              autoFocus onKeyDown={ev => ev.key === 'Enter' && saveRename(e.id, true)} />
                            <button onClick={() => saveRename(e.id, true)} className="text-xs text-accent font-medium">Save</button>
                          </div>
                        ) : (
                          <button onClick={() => startRename(e.id, e.name)} className="text-sm text-foreground text-left truncate block w-full">
                            {e.name}
                          </button>
                        )}
                      </div>
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
                      <button onClick={() => handleDeleteFixedExpense(e.id, e.name)}
                        className="p-1 text-muted-foreground/30 hover:text-destructive active:scale-95 transition-all shrink-0">
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 ml-6">
                      <button
                        onClick={() => toggleFixedNotesRequired(e.id)}
                        className={`flex items-center gap-1 text-[10px] font-medium rounded-full px-2 py-0.5 transition-colors ${
                          e.notesRequired ? 'bg-accent/15 text-accent' : 'bg-muted/50 text-muted-foreground/60'
                        }`}
                      >
                        <MessageSquare size={9} />
                        {e.notesRequired ? 'Notes required' : 'No notes required'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {viewTab === 'savings' && (
          <div className="px-6 pb-4">
            <div className="mb-4">
              {renderAddFixedForm('savings')}
              {showAddFixed !== 'savings' && (
                <button onClick={() => setShowAddFixed('savings')}
                  className="flex items-center gap-1.5 text-accent text-xs font-medium mb-3 active:scale-95 transition-transform">
                  <Plus size={14} /> Add Savings Item
                </button>
              )}
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                Savings
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" aria-label="Fixed vs Variable explanation" className="text-muted-foreground/70 hover:text-foreground"><Info className="w-3 h-3" /></button>
                  </PopoverTrigger>
                  <PopoverContent side="bottom" align="start" className="w-72 text-xs text-muted-foreground leading-snug space-y-1.5">
                    <div><span className="font-medium text-foreground">Fixed vs Variable:</span> choose Fixed for set monthly contributions (retirement transfer, emergency fund top-up). Choose Variable for amounts that change month to month.</div>
                    <div><span className="font-medium text-foreground">Notes required:</span> when on, you must add a short note when logging a transaction here.</div>
                  </PopoverContent>
                </Popover>
              </h3>
              <div className="bg-card rounded-lg shadow-sm divide-y divide-border overflow-hidden lg:bg-transparent lg:shadow-none lg:divide-y-0 lg:overflow-visible lg:rounded-none lg:grid lg:grid-cols-2 xl:grid-cols-2 lg:gap-4">
                {savingsBuckets.map((e) => (
                  <div key={e.id} className="px-3 py-2.5 lg:bg-card lg:rounded-lg lg:border lg:border-border/60 lg:shadow-sm lg:p-4">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        {renamingId === e.id ? (
                          <div className="flex gap-1.5">
                            <input value={renameValue} onChange={ev => setRenameValue(ev.target.value)}
                              className="flex-1 px-2 py-1 text-sm rounded bg-background border border-border focus:outline-none focus:ring-2 focus:ring-accent/30"
                              autoFocus onKeyDown={ev => ev.key === 'Enter' && saveRename(e.id, true)} />
                            <button onClick={() => saveRename(e.id, true)} className="text-xs text-accent font-medium">Save</button>
                          </div>
                        ) : (
                          <button onClick={() => startRename(e.id, e.name)} className="text-sm text-foreground text-left truncate block w-full">
                            {e.name}
                          </button>
                        )}
                      </div>
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
                      <button onClick={() => handleDeleteFixedExpense(e.id, e.name)}
                        className="p-1 text-muted-foreground/30 hover:text-destructive active:scale-95 transition-all shrink-0">
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 ml-0">
                      <div className="flex items-center gap-1.5">
                        <Switch checked={false} onCheckedChange={() => toggleSavingsType(e.id, true)} className="scale-75 origin-left" />
                        <span className="text-[10px] font-medium text-muted-foreground">Fixed</span>
                      </div>
                      <button
                        onClick={() => toggleFixedNotesRequired(e.id)}
                        className={`flex items-center gap-1 text-[10px] font-medium rounded-full px-2 py-0.5 transition-colors ${
                          e.notesRequired ? 'bg-accent/15 text-accent' : 'bg-muted/50 text-muted-foreground/60'
                        }`}
                      >
                        <MessageSquare size={9} />
                        {e.notesRequired ? 'Notes required' : 'No notes required'}
                      </button>
                    </div>
                  </div>
                ))}
                {savingsVarCats.map((c) => (
                  <div key={c.id} className="px-3 py-2.5 lg:bg-card lg:rounded-lg lg:border lg:border-border/60 lg:shadow-sm lg:p-4">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        {renamingId === c.id ? (
                          <div className="flex gap-1.5">
                            <input value={renameValue} onChange={ev => setRenameValue(ev.target.value)}
                              className="flex-1 px-2 py-1 text-sm rounded bg-background border border-border focus:outline-none focus:ring-2 focus:ring-accent/30"
                              autoFocus onKeyDown={ev => ev.key === 'Enter' && saveRename(c.id, false)} />
                            <button onClick={() => saveRename(c.id, false)} className="text-xs text-accent font-medium">Save</button>
                          </div>
                        ) : (
                          <button onClick={() => startRename(c.id, c.name)} className="text-sm text-foreground text-left truncate block w-full">
                            {c.name}
                          </button>
                        )}
                      </div>
                      {editingId === `next-cat-${c.id}` ? (
                        <div className="flex gap-1.5">
                          <input type="number" step="1" value={editValue} onChange={ev => setEditValue(ev.target.value)}
                            className="w-20 px-2 py-1 text-right text-sm rounded bg-background border border-border tabular-nums focus:outline-none focus:ring-2 focus:ring-accent/30"
                            autoFocus onKeyDown={ev => ev.key === 'Enter' && saveNextCatEdit(c.id)} />
                          <button onClick={() => saveNextCatEdit(c.id)} className="text-xs text-accent font-medium">Save</button>
                        </div>
                      ) : (
                        <button onClick={() => startEdit(`next-cat-${c.id}`, c.budgeted)}
                          className="text-sm font-medium tabular-nums text-foreground active:scale-95 transition-transform">
                          {fmtWhole(c.budgeted)}
                        </button>
                      )}
                      <button onClick={() => handleDeleteCategory(c.id, c.name)}
                        className="p-1 text-muted-foreground/30 hover:text-destructive active:scale-95 transition-all shrink-0">
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 ml-0">
                      <div className="flex items-center gap-1.5">
                        <Switch checked={true} onCheckedChange={() => toggleSavingsType(c.id, false)} className="scale-75 origin-left" />
                        <span className="text-[10px] font-medium text-accent">Variable</span>
                      </div>
                      <button
                        onClick={() => toggleNotesRequired(c.id)}
                        className={`flex items-center gap-1 text-[10px] font-medium rounded-full px-2 py-0.5 transition-colors ${
                          c.notesRequired ? 'bg-accent/15 text-accent' : 'bg-muted/50 text-muted-foreground/60'
                        }`}
                      >
                        <MessageSquare size={9} />
                        {c.notesRequired ? 'Notes required' : 'No notes required'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {viewTab === 'giving' && (
          <div className="px-6 pb-4">
            <div className="mb-4">
              {renderAddFixedForm('tithe')}
              {showAddFixed !== 'tithe' && (
                <button onClick={() => setShowAddFixed('tithe')}
                  className="flex items-center gap-1.5 text-accent text-xs font-medium mb-3 active:scale-95 transition-transform">
                  <Plus size={14} /> Add Tithe/Giving Item
                </button>
              )}
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                Tithe/Giving
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" aria-label="Fixed vs Variable explanation" className="text-muted-foreground/70 hover:text-foreground"><Info className="w-3 h-3" /></button>
                  </PopoverTrigger>
                  <PopoverContent side="bottom" align="start" className="w-72 text-xs text-muted-foreground leading-snug space-y-1.5">
                    <div><span className="font-medium text-foreground">Fixed vs Variable:</span> choose Fixed for set recurring giving (regular tithe, monthly missions support). Choose Variable for one-off or fluctuating gifts.</div>
                    <div><span className="font-medium text-foreground">Notes required:</span> when on, you must add a short note when logging a transaction here.</div>
                  </PopoverContent>
                </Popover>
              </h3>
              <div className="bg-card rounded-lg shadow-sm divide-y divide-border overflow-hidden lg:bg-transparent lg:shadow-none lg:divide-y-0 lg:overflow-visible lg:rounded-none lg:grid lg:grid-cols-2 xl:grid-cols-2 lg:gap-4">
                {titheItems.map((e) => (
                  <div key={e.id} className="px-3 py-2.5 lg:bg-card lg:rounded-lg lg:border lg:border-border/60 lg:shadow-sm lg:p-4">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        {renamingId === e.id ? (
                          <div className="flex gap-1.5">
                            <input value={renameValue} onChange={ev => setRenameValue(ev.target.value)}
                              className="flex-1 px-2 py-1 text-sm rounded bg-background border border-border focus:outline-none focus:ring-2 focus:ring-accent/30"
                              autoFocus onKeyDown={ev => ev.key === 'Enter' && saveRename(e.id, true)} />
                            <button onClick={() => saveRename(e.id, true)} className="text-xs text-accent font-medium">Save</button>
                          </div>
                        ) : (
                          <button onClick={() => startRename(e.id, e.name)} className="text-sm text-foreground text-left truncate block w-full">
                            {e.name}
                          </button>
                        )}
                      </div>
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
                      <button onClick={() => handleDeleteFixedExpense(e.id, e.name)}
                        className="p-1 text-muted-foreground/30 hover:text-destructive active:scale-95 transition-all shrink-0">
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 ml-0">
                      <div className="flex items-center gap-1.5">
                        <Switch checked={false} onCheckedChange={() => toggleTitheType(e.id, true)} className="scale-75 origin-left" />
                        <span className="text-[10px] font-medium text-muted-foreground">Fixed</span>
                      </div>
                      <button
                        onClick={() => toggleFixedNotesRequired(e.id)}
                        className={`flex items-center gap-1 text-[10px] font-medium rounded-full px-2 py-0.5 transition-colors ${
                          e.notesRequired ? 'bg-accent/15 text-accent' : 'bg-muted/50 text-muted-foreground/60'
                        }`}
                      >
                        <MessageSquare size={9} />
                        {e.notesRequired ? 'Notes required' : 'No notes required'}
                      </button>
                    </div>
                  </div>
                ))}
                {givingVarCats.map((c) => (
                  <div key={c.id} className="px-3 py-2.5 lg:bg-card lg:rounded-lg lg:border lg:border-border/60 lg:shadow-sm lg:p-4">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        {renamingId === c.id ? (
                          <div className="flex gap-1.5">
                            <input value={renameValue} onChange={ev => setRenameValue(ev.target.value)}
                              className="flex-1 px-2 py-1 text-sm rounded bg-background border border-border focus:outline-none focus:ring-2 focus:ring-accent/30"
                              autoFocus onKeyDown={ev => ev.key === 'Enter' && saveRename(c.id, false)} />
                            <button onClick={() => saveRename(c.id, false)} className="text-xs text-accent font-medium">Save</button>
                          </div>
                        ) : (
                          <button onClick={() => startRename(c.id, c.name)} className="text-sm text-foreground text-left truncate block w-full">
                            {c.name}
                          </button>
                        )}
                      </div>
                      {editingId === `next-cat-${c.id}` ? (
                        <div className="flex gap-1.5">
                          <input type="number" step="1" value={editValue} onChange={ev => setEditValue(ev.target.value)}
                            className="w-20 px-2 py-1 text-right text-sm rounded bg-background border border-border tabular-nums focus:outline-none focus:ring-2 focus:ring-accent/30"
                            autoFocus onKeyDown={ev => ev.key === 'Enter' && saveNextCatEdit(c.id)} />
                          <button onClick={() => saveNextCatEdit(c.id)} className="text-xs text-accent font-medium">Save</button>
                        </div>
                      ) : (
                        <button onClick={() => startEdit(`next-cat-${c.id}`, c.budgeted)}
                          className="text-sm font-medium tabular-nums text-foreground active:scale-95 transition-transform">
                          {fmtWhole(c.budgeted)}
                        </button>
                      )}
                      <button onClick={() => handleDeleteCategory(c.id, c.name)}
                        className="p-1 text-muted-foreground/30 hover:text-destructive active:scale-95 transition-all shrink-0">
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 ml-0">
                      <div className="flex items-center gap-1.5">
                        <Switch checked={true} onCheckedChange={() => toggleTitheType(c.id, false)} className="scale-75 origin-left" />
                        <span className="text-[10px] font-medium text-accent">Variable</span>
                      </div>
                      <button
                        onClick={() => toggleNotesRequired(c.id)}
                        className={`flex items-center gap-1 text-[10px] font-medium rounded-full px-2 py-0.5 transition-colors ${
                          c.notesRequired ? 'bg-accent/15 text-accent' : 'bg-muted/50 text-muted-foreground/60'
                        }`}
                      >
                        <MessageSquare size={9} />
                        {c.notesRequired ? 'Notes required' : 'No notes required'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Budget Summary */}
        <div className="px-6">
          <div className="bg-card rounded-lg shadow-sm px-4 py-3 mb-4">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-muted-foreground">Variable Total</span>
              <span className="font-medium tabular-nums">{fmtWhole(variableTotal)}</span>
            </div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-muted-foreground">Fixed</span>
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

          {/* Month transitions happen automatically on the 1st */}
        </div>
      </>
    );
  }

  const viewMonthShortLabel = format(viewMonthDate, 'MMMM');

  const scopePromptDrawer = (
    <Drawer open={showScopePrompt} onOpenChange={setShowScopePrompt}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>
            {scopeAction === 'add' ? 'Apply to which months?' : `Remove "${pendingDelete?.name}"?`}
          </DrawerTitle>
          <DrawerDescription>
            {scopeAction === 'add'
              ? `Where should this ${pendingAdd?.type === 'category' ? 'category' : 'item'} be added?`
              : `From which months should this be removed?`}
          </DrawerDescription>
        </DrawerHeader>
        <div className="px-4 pb-6 space-y-2">
          <button
            onClick={() => handleScopeChoice('month-only')}
            className="w-full py-3 rounded-lg bg-card border border-border text-sm font-medium text-foreground active:scale-[0.98] transition-transform"
          >
            {isCurrentMonth ? 'This month only' : `${viewMonthShortLabel} only`}
          </button>
          <button
            onClick={() => handleScopeChoice('month-and-future')}
            className="w-full py-3 rounded-lg bg-primary text-primary-foreground text-sm font-semibold active:scale-[0.98] transition-transform"
          >
            {isCurrentMonth ? 'This month and all future months' : `${viewMonthShortLabel} and all future months`}
          </button>
          <button
            onClick={() => { setShowScopePrompt(false); setPendingAdd(null); setPendingDelete(null); }}
            className="w-full py-2 text-sm text-muted-foreground font-medium"
          >
            Cancel
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  );

  if (embedded) {
    return (
      <>
        <div className="px-6 pb-6">
          {/* Profiles */}
          <div className="mb-6 lg:hidden">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Household</h3>
            <div className="bg-card rounded-lg shadow-sm p-4 flex gap-4">
              <div className="flex-1 text-center">
                <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center mx-auto text-sm font-semibold">{(primaryLabel[0] || 'U').toUpperCase()}</div>
                <p className="text-sm font-medium text-foreground mt-1.5">{primaryLabel}</p>
              </div>
              {partnerDisplayName && (
                <div className="flex-1 text-center">
                  <div className="w-10 h-10 rounded-full bg-accent text-accent-foreground flex items-center justify-center mx-auto text-sm font-semibold">{(partnerLabel[0] || 'P').toUpperCase()}</div>
                  <p className="text-sm font-medium text-foreground mt-1.5">{partnerLabel}</p>
                </div>
              )}
            </div>
          </div>

          {/* Month Navigator */}
          <div className="flex items-center justify-between mb-6 bg-card rounded-lg shadow-sm px-4 py-3">
            <button onClick={() => navigateMonth('prev')} className="p-2 -ml-2 text-muted-foreground active:scale-95 transition-transform">
              <ChevronLeft size={20} />
            </button>
            <div className="text-center">
              <h2 className="font-display text-lg font-semibold text-foreground">{viewMonthLabel}</h2>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {isCurrentMonth ? 'Current Month' : isPastMonth ? 'Past Month' : isNextMonth ? 'Next Month' : 'Future Month'}
              </p>
            </div>
            <button onClick={() => navigateMonth('next')} className="p-2 -mr-2 text-muted-foreground active:scale-95 transition-transform">
              <ChevronRight size={20} />
            </button>
          </div>

          {/* Content based on month */}
          {isPastMonth && renderReadOnlyMonth()}
          {isEditableMonth && renderFutureMonth()}
        </div>
        {scopePromptDrawer}
      </>
    );
  }

  // Resolve the two household member display names so the "Joe's / Katie's"
  // labels and avatar bubbles use the actual users' names instead of
  // hardcoded copy.
  const primaryName = profile?.display_name || 'You';
  const partnerName = partnerDisplayName || 'Partner';
  const primaryInitial = (primaryName[0] || 'U').toUpperCase();
  const partnerInitial = (partnerName[0] || 'P').toUpperCase();

  return (
    <>
      <div className="max-w-lg mx-auto pb-28">
        <div className="px-6 pt-12 safe-top">
          <button onClick={onBack} className="flex items-center gap-1 text-accent text-sm font-medium mb-4 active:scale-95 transition-transform">
            <ArrowLeft size={16} /> Back
          </button>
          <h1 className="font-display text-2xl lg:text-3xl font-bold tracking-tight text-foreground">Budget Planning</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isEditableMonth ? 'Edit categories & budget amounts' : 'Past month overview'}
          </p>
        </div>

        <div className="px-6 mt-6 pb-6">
          {/* Profiles */}
          <div className="mb-6 lg:hidden">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Household</h3>
            <div className="bg-card rounded-lg shadow-sm p-4 flex gap-4">
              <div className="flex-1 text-center">
                <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center mx-auto text-sm font-semibold">{primaryInitial}</div>
                <p className="text-sm font-medium text-foreground mt-1.5">{primaryName}</p>
              </div>
              {partnerDisplayName && (
                <div className="flex-1 text-center">
                  <div className="w-10 h-10 rounded-full bg-accent text-accent-foreground flex items-center justify-center mx-auto text-sm font-semibold">{partnerInitial}</div>
                  <p className="text-sm font-medium text-foreground mt-1.5">{partnerName}</p>
                </div>
              )}
            </div>
          </div>

          {/* Month Navigator */}
          <div className="flex items-center justify-between mb-6 bg-card rounded-lg shadow-sm px-4 py-3">
            <button onClick={() => navigateMonth('prev')} className="p-2 -ml-2 text-muted-foreground active:scale-95 transition-transform">
              <ChevronLeft size={20} />
            </button>
            <div className="text-center">
              <h2 className="font-display text-lg font-semibold text-foreground">{viewMonthLabel}</h2>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {isCurrentMonth ? 'Current Month' : isPastMonth ? 'Past Month' : isNextMonth ? 'Next Month' : 'Future Month'}
              </p>
            </div>
            <button onClick={() => navigateMonth('next')} className="p-2 -mr-2 text-muted-foreground active:scale-95 transition-transform">
              <ChevronRight size={20} />
            </button>
          </div>

          {/* Content based on month */}
          {isPastMonth && renderReadOnlyMonth()}
          {isEditableMonth && renderFutureMonth()}

          {/* Log Out */}
          <div className="mt-12 mb-8">
            <button
              onClick={signOut}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-muted-foreground text-sm font-medium active:scale-[0.98] transition-transform"
            >
              <LogOut size={16} />
              <span>Log Out</span>
              <span className="text-xs text-muted-foreground/60 ml-1">({profile?.display_name})</span>
            </button>
          </div>
        </div>
      </div>
      {scopePromptDrawer}
    </>
  );
}
