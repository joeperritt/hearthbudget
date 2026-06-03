import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { format } from 'date-fns';
import {
  BudgetCategory,
  FixedExpense,
  Transaction,
  BudgetTransfer,
  AccountSource,
  TransactionType,
} from '@/types/budget';

// Map DB rows → app types
function dbToCat(row: Record<string, unknown>): BudgetCategory {
  return {
    id: row.slug as string,
    name: row.name as string,
    budgeted: Number(row.budgeted),
    group: row.group as BudgetCategory['group'],
    notesRequired: (row.notes_required as boolean) ?? false,
    startMonth: (row.start_month as string | null) ?? null,
    endMonth: (row.end_month as string | null) ?? null,
  };
}

function dbToFixed(row: Record<string, unknown>): FixedExpense {
  return {
    id: row.slug as string,
    name: row.name as string,
    amount: Number(row.amount),
    group: row.group as FixedExpense['group'],
    notesRequired: (row.notes_required as boolean) ?? false,
    startMonth: (row.start_month as string | null) ?? null,
    endMonth: (row.end_month as string | null) ?? null,
  };
}

/** Check if a category/expense is active for a given month */
export function isActiveForMonth(item: { startMonth?: string | null; endMonth?: string | null }, month: string): boolean {
  if (item.startMonth && item.startMonth > month) return false;
  if (item.endMonth && item.endMonth < month) return false;
  return true;
}

/** Filter categories/expenses to only those active for a given month */
export function filterForMonth<T extends { startMonth?: string | null; endMonth?: string | null }>(items: T[], month: string): T[] {
  return items.filter(item => isActiveForMonth(item, month));
}

/**
 * Per-month amount override map.
 * Keyed by `${kind}:${slug}:${month}` → amount.
 * Used to scope budget amount edits to a single month without overwriting
 * the base `budgeted` / `amount` value that other months rely on.
 */
export type MonthAmountOverrides = Record<string, number>;

function overrideKey(kind: 'category' | 'fixed', slug: string, month: string) {
  return `${kind}:${slug}:${month}`;
}

/** Look up the effective amount for a given item & month. Returns base if no override exists. */
export function resolveAmountForMonth(
  kind: 'category' | 'fixed',
  slug: string,
  month: string,
  baseAmount: number,
  overrides: MonthAmountOverrides,
): number {
  const k = overrideKey(kind, slug, month);
  return Object.prototype.hasOwnProperty.call(overrides, k) ? overrides[k] : baseAmount;
}

/** Apply per-month overrides to a list of categories so `.budgeted` reflects the month-scoped amount. */
export function applyOverridesToCategories(cats: BudgetCategory[], month: string, overrides: MonthAmountOverrides): BudgetCategory[] {
  return cats.map(c => ({ ...c, budgeted: resolveAmountForMonth('category', c.id, month, c.budgeted, overrides) }));
}

/** Apply per-month overrides to a list of fixed expenses so `.amount` reflects the month-scoped amount. */
export function applyOverridesToFixed(items: FixedExpense[], month: string, overrides: MonthAmountOverrides): FixedExpense[] {
  return items.map(e => ({ ...e, amount: resolveAmountForMonth('fixed', e.id, month, e.amount, overrides) }));
}

function dbToTx(row: Record<string, unknown>): Transaction {
  return {
    id: row.id as string,
    date: row.date as string,
    description: row.description as string,
    notes: (row.notes as string) || '',
    amount: Number(row.amount),
    categoryId: row.category_slug as string,
    account: row.account as AccountSource,
    isTransferToSavings: row.is_transfer_to_savings as boolean,
    transactionType: row.transaction_type as TransactionType,
    enteredBy: row.entered_by as string | null,
    budgetMonth: (row.budget_month as string) || '',
    source: row.plaid_transaction_id ? 'plaid' : 'manual',
    originalDescription: (row.original_description as string | null) ?? null,
  };
}

function dbToTransfer(row: Record<string, unknown>): BudgetTransfer {
  return {
    id: row.id as string,
    date: row.date as string,
    fromCategoryId: row.from_category_slug as string,
    toCategoryId: row.to_category_slug as string,
    amount: Number(row.amount),
  };
}

export function useBudgetData() {
  const { profile, user } = useAuth();
  const householdId = profile?.household_id;

  const [categories, setCategories] = useState<BudgetCategory[]>([]);
  const [fixedExpenses, setFixedExpenses] = useState<FixedExpense[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transfers, setTransfers] = useState<BudgetTransfer[]>([]);
  const [monthAmountOverrides, setMonthAmountOverrides] = useState<MonthAmountOverrides>({});
  const [activeMonth, setActiveMonth] = useState<string>('');
  const [planningData, setPlanningData] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const initialLoad = useRef(true);

  // Fetch all data
  const fetchAll = useCallback(async () => {
    if (!householdId) return;

    const [catRes, fixRes, txRes, trRes, hhRes, ovRes] = await Promise.all([
      supabase.from('budget_categories').select('*').eq('household_id', householdId).order('sort_order'),
      supabase.from('fixed_expenses').select('*').eq('household_id', householdId).order('sort_order'),
      supabase.from('transactions').select('*').eq('household_id', householdId).order('created_at', { ascending: false }),
      supabase.from('budget_transfers').select('*').eq('household_id', householdId),
      supabase.from('households').select('*').eq('id', householdId).single(),
      supabase.from('budget_amount_overrides' as any).select('*').eq('household_id', householdId),
    ]);

    if (catRes.data) setCategories(catRes.data.map(r => dbToCat(r as unknown as Record<string, unknown>)));
    if (fixRes.data) setFixedExpenses(fixRes.data.map(r => dbToFixed(r as unknown as Record<string, unknown>)));
    if (txRes.data) setTransactions(txRes.data.map(r => dbToTx(r as unknown as Record<string, unknown>)));
    if (trRes.data) setTransfers(trRes.data.map(r => dbToTransfer(r as unknown as Record<string, unknown>)));
    if (hhRes.data) {
      const hh = hhRes.data as unknown as Record<string, unknown>;
      setActiveMonth((hh.active_month as string) || format(new Date(), 'yyyy-MM'));
      if (hh.planning_data && typeof hh.planning_data === 'object') {
        setPlanningData(hh.planning_data as Record<string, string>);
      }
    }
    if (ovRes.data) {
      const map: MonthAmountOverrides = {};
      for (const row of ovRes.data as any[]) {
        map[`${row.kind}:${row.slug}:${row.month}`] = Number(row.amount);
      }
      setMonthAmountOverrides(map);
    }

    if (initialLoad.current) {
      initialLoad.current = false;
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Shared helper: build snapshot data for a given month
  const buildSnapshotData = useCallback((month: string, cats: BudgetCategory[], fixed: FixedExpense[]) => {
    // Apply per-month amount overrides so the closed snapshot reflects the
    // amounts that were actually budgeted for that month (not whatever the
    // base row currently says).
    const resolvedCats = applyOverridesToCategories(filterForMonth(cats, month), month, monthAmountOverrides);
    const resolvedFixed = applyOverridesToFixed(filterForMonth(fixed, month), month, monthAmountOverrides);
    const monthTxns = transactions.filter(t => t.budgetMonth === month);
    const expenseTxns = monthTxns.filter(t => t.transactionType === 'expense');

    const spentByCategory: Record<string, number> = {};
    monthTxns
      .filter(t => t.transactionType === 'expense' && !t.categoryId.startsWith('ignore-'))
      .forEach(t => {
        spentByCategory[t.categoryId] = (spentByCategory[t.categoryId] || 0) + t.amount;
      });

    const realExpenses = expenseTxns.filter(t => !t.categoryId.startsWith('ignore-'));
    const grossSpent = realExpenses.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const refundsTotal = realExpenses.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0);
    const netSpent = grossSpent + refundsTotal;

    const summary = {
      totalTransactions: monthTxns.length,
      totalExpenses: expenseTxns.length,
      totalSpent: netSpent,
      grossSpent,
      refundsTotal,
      netSpent,
      spentByCategory,
    };

    const monthTransfers = transfers.filter(t => t.date.startsWith(month));

    return {
      household_id: householdId!,
      month,
      categories: resolvedCats,
      fixed_expenses: resolvedFixed,
      transactions_summary: summary,
      transfers: monthTransfers,
    };
  }, [householdId, transactions, transfers, monthAmountOverrides]);

  /** Write a per-month amount override (used when editing a future month). */
  const setMonthAmountOverride = useCallback(async (
    kind: 'category' | 'fixed', slug: string, month: string, amount: number,
  ) => {
    if (!householdId) return;
    const key = `${kind}:${slug}:${month}`;
    // Optimistic local update so the UI reflects the change immediately
    setMonthAmountOverrides(prev => ({ ...prev, [key]: amount }));
    const { error } = await supabase
      .from('budget_amount_overrides' as any)
      .upsert({ household_id: householdId, kind, slug, month, amount } as any, {
        onConflict: 'household_id,kind,slug,month',
      });
    if (error) {
      // Revert on failure
      setMonthAmountOverrides(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      throw error;
    }
  }, [householdId]);

  /** Promote any overrides for `month` onto the base row, then delete them. */
  const promoteOverridesForMonth = useCallback(async (month: string) => {
    if (!householdId) return;
    const { data } = await supabase
      .from('budget_amount_overrides' as any)
      .select('*')
      .eq('household_id', householdId)
      .eq('month', month);
    const rows = (data as any[]) || [];
    if (!rows.length) return;

    const ops: Promise<unknown>[] = [];
    for (const r of rows) {
      if (r.kind === 'category') {
        ops.push(
          Promise.resolve(
            supabase.from('budget_categories').update({ budgeted: Number(r.amount) } as any)
              .eq('household_id', householdId).eq('slug', r.slug)
          )
        );
      } else if (r.kind === 'fixed') {
        ops.push(
          Promise.resolve(
            supabase.from('fixed_expenses').update({ amount: Number(r.amount) } as any)
              .eq('household_id', householdId).eq('slug', r.slug)
          )
        );
      }
    }
    await Promise.all(ops);
    await supabase
      .from('budget_amount_overrides' as any)
      .delete()
      .eq('household_id', householdId)
      .eq('month', month);

    setMonthAmountOverrides(prev => {
      const next = { ...prev };
      for (const r of rows) delete next[`${r.kind}:${r.slug}:${r.month}`];
      return next;
    });
    // Refetch so base amounts in memory match the new baseline
    const [cRes, fRes] = await Promise.all([
      supabase.from('budget_categories').select('*').eq('household_id', householdId).order('sort_order'),
      supabase.from('fixed_expenses').select('*').eq('household_id', householdId).order('sort_order'),
    ]);
    if (cRes.data) setCategories(cRes.data.map(r => dbToCat(r as unknown as Record<string, unknown>)));
    if (fRes.data) setFixedExpenses(fRes.data.map(r => dbToFixed(r as unknown as Record<string, unknown>)));
  }, [householdId]);

  // Auto month transition: on first load, if activeMonth is behind current calendar month,
  // automatically snapshot and advance to the current month
  const autoTransitionDone = useRef(false);
  useEffect(() => {
    if (!householdId || !activeMonth || loading || autoTransitionDone.current) return;
    const currentCalendarMonth = format(new Date(), 'yyyy-MM');
    if (activeMonth < currentCalendarMonth && categories.length > 0) {
      autoTransitionDone.current = true;
      (async () => {
        const snapshotData = buildSnapshotData(activeMonth, categories, fixedExpenses);
        await supabase.from('budget_month_snapshots' as any).upsert(snapshotData as any, { onConflict: 'household_id,month' });
        // Promote any overrides scheduled for the new active month onto the
        // base rows so editing them mid-month behaves as normal again.
        await promoteOverridesForMonth(currentCalendarMonth);
        await supabase.from('households').update({ active_month: currentCalendarMonth } as any).eq('id', householdId);
        setActiveMonth(currentCalendarMonth);
      })();
    }
  }, [householdId, activeMonth, loading, categories, fixedExpenses, buildSnapshotData, promoteOverridesForMonth]);

  // Real-time subscriptions
  useEffect(() => {
    if (!householdId) return;

    const channel = supabase
      .channel('budget-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: `household_id=eq.${householdId}` }, () => {
        supabase.from('transactions').select('*').eq('household_id', householdId).order('created_at', { ascending: false }).then(({ data }) => {
          if (data) setTransactions(data.map(r => dbToTx(r as unknown as Record<string, unknown>)));
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'budget_categories', filter: `household_id=eq.${householdId}` }, () => {
        supabase.from('budget_categories').select('*').eq('household_id', householdId).order('sort_order').then(({ data }) => {
          if (data) setCategories(data.map(r => dbToCat(r as unknown as Record<string, unknown>)));
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fixed_expenses', filter: `household_id=eq.${householdId}` }, () => {
        supabase.from('fixed_expenses').select('*').eq('household_id', householdId).order('sort_order').then(({ data }) => {
          if (data) setFixedExpenses(data.map(r => dbToFixed(r as unknown as Record<string, unknown>)));
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'budget_transfers', filter: `household_id=eq.${householdId}` }, () => {
        supabase.from('budget_transfers').select('*').eq('household_id', householdId).then(({ data }) => {
          if (data) setTransfers(data.map(r => dbToTransfer(r as unknown as Record<string, unknown>)));
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [householdId]);

  // --- Mutations ---

  const addTransactions = useCallback(async (txns: Omit<Transaction, 'id'>[]) => {
    if (!householdId || !user) {
      throw new Error('You must be signed in to add a transaction.');
    }
    const rows = txns.map(t => ({
      household_id: householdId,
      category_slug: t.categoryId,
      date: t.date,
      description: t.description,
      notes: t.notes || '',
      amount: t.amount,
      account: t.account,
      is_transfer_to_savings: t.isTransferToSavings,
      transaction_type: t.transactionType,
      entered_by: user.id,
      budget_month: activeMonth,
    }));
    const { data, error } = await supabase.from('transactions').insert(rows as any).select();
    if (error) throw error;
    // Optimistic local merge so new rows appear immediately even if realtime is delayed
    if (data && data.length) {
      const inserted = data.map(r => dbToTx(r as unknown as Record<string, unknown>));
      setTransactions(prev => {
        const existingIds = new Set(prev.map(t => t.id));
        const additions = inserted.filter(t => !existingIds.has(t.id));
        return [...additions, ...prev];
      });
    }
  }, [householdId, user, activeMonth]);

  const deleteTransaction = useCallback(async (id: string) => {
    // Optimistic removal so the UI reflects the deletion immediately,
    // independent of realtime delivery.
    let snapshot: Transaction[] = [];
    setTransactions(prev => {
      snapshot = prev;
      return prev.filter(t => t.id !== id);
    });
    const { error } = await supabase.from('transactions').delete().eq('id', id);
    if (error) {
      // Revert on failure
      setTransactions(snapshot);
      throw error;
    }
  }, []);

  const addTransfer = useCallback(async (t: Omit<BudgetTransfer, 'id'>) => {
    if (!householdId) return;
    await supabase.from('budget_transfers').insert({
      household_id: householdId,
      date: t.date,
      from_category_slug: t.fromCategoryId,
      to_category_slug: t.toCategoryId,
      amount: t.amount,
    });
  }, [householdId]);

  const deleteTransfer = useCallback(async (id: string) => {
    let snapshot: BudgetTransfer[] = [];
    setTransfers(prev => {
      snapshot = prev;
      return prev.filter(t => t.id !== id);
    });
    const { error } = await supabase.from('budget_transfers').delete().eq('id', id);
    if (error) {
      setTransfers(snapshot);
      throw error;
    }
  }, []);

  const updateCategories = useCallback(async (cats: BudgetCategory[]) => {
    if (!householdId) return;

    const existingById = new Map(categories.map(c => [c.id, c]));
    const normalizedCats = cats.map(c => ({
      ...c,
      startMonth: c.startMonth ?? existingById.get(c.id)?.startMonth ?? null,
      endMonth: c.endMonth ?? existingById.get(c.id)?.endMonth ?? null,
    }));

    const ops = normalizedCats.map((c, i) =>
      supabase.from('budget_categories').upsert({
        household_id: householdId,
        slug: c.id,
        name: c.name,
        budgeted: c.budgeted,
        group: c.group,
        sort_order: i,
        notes_required: c.notesRequired ?? false,
        start_month: c.startMonth,
        end_month: c.endMonth,
      } as any, { onConflict: 'household_id,slug' })
    );
    await Promise.all(ops);

    const existingSlugs = normalizedCats.map(c => c.id);
    const { data: dbCats } = await supabase
      .from('budget_categories')
      .select('slug')
      .eq('household_id', householdId);
    const toDelete = (dbCats || []).filter(d => !existingSlugs.includes(d.slug));
    if (toDelete.length > 0) {
      await Promise.all(
        toDelete.map(d =>
          supabase.from('budget_categories').delete().eq('household_id', householdId).eq('slug', d.slug)
        )
      );
    }

    setCategories(normalizedCats);
  }, [householdId, categories]);

  const updateFixedExpenses = useCallback(async (exps: FixedExpense[]) => {
    if (!householdId) return;

    const existingById = new Map(fixedExpenses.map(e => [e.id, e]));
    const normalizedExpenses = exps.map(e => ({
      ...e,
      startMonth: e.startMonth ?? existingById.get(e.id)?.startMonth ?? null,
      endMonth: e.endMonth ?? existingById.get(e.id)?.endMonth ?? null,
    }));

    const ops = normalizedExpenses.map((e, i) =>
      supabase.from('fixed_expenses').upsert({
        household_id: householdId,
        slug: e.id,
        name: e.name,
        amount: e.amount,
        group: e.group,
        sort_order: i,
        notes_required: e.notesRequired ?? false,
        start_month: e.startMonth,
        end_month: e.endMonth,
      } as any, { onConflict: 'household_id,slug' })
    );
    await Promise.all(ops);

    const existingSlugs = normalizedExpenses.map(e => e.id);
    const { data: dbExps } = await supabase
      .from('fixed_expenses')
      .select('slug')
      .eq('household_id', householdId);
    const toDelete = (dbExps || []).filter(d => !existingSlugs.includes(d.slug));
    if (toDelete.length > 0) {
      await Promise.all(
        toDelete.map(d =>
          supabase.from('fixed_expenses').delete().eq('household_id', householdId).eq('slug', d.slug)
        )
      );
    }

    setFixedExpenses(normalizedExpenses);
  }, [householdId, fixedExpenses]);

  // --- Targeted month-scoped add/remove ---

  /** Add a single category with optional month scoping */
  const addCategoryForMonth = useCallback(async (cat: BudgetCategory, scope: 'month-only' | 'month-and-future', month: string) => {
    if (!householdId) return;
    const startMonth = month;
    const endMonth = scope === 'month-only' ? month : null;
    const sortOrder = categories.length;
    await supabase.from('budget_categories').insert({
      household_id: householdId,
      slug: cat.id,
      name: cat.name,
      budgeted: cat.budgeted,
      group: cat.group,
      sort_order: sortOrder,
      notes_required: cat.notesRequired ?? false,
      start_month: startMonth,
      end_month: endMonth,
    } as any);
    const newCat = { ...cat, startMonth, endMonth };
    setCategories(prev => [...prev, newCat]);
  }, [householdId, categories.length]);

  /** Add a single fixed expense with optional month scoping */
  const addFixedExpenseForMonth = useCallback(async (exp: FixedExpense, scope: 'month-only' | 'month-and-future', month: string) => {
    if (!householdId) return;
    const startMonth = month;
    const endMonth = scope === 'month-only' ? month : null;
    const sortOrder = fixedExpenses.length;
    await supabase.from('fixed_expenses').insert({
      household_id: householdId,
      slug: exp.id,
      name: exp.name,
      amount: exp.amount,
      group: exp.group,
      sort_order: sortOrder,
      notes_required: exp.notesRequired ?? false,
      start_month: startMonth,
      end_month: endMonth,
    } as any);
    const newExp = { ...exp, startMonth, endMonth };
    setFixedExpenses(prev => [...prev, newExp]);
  }, [householdId, fixedExpenses.length]);

  /** Remove a category from a specific month scope */
  const removeCategoryFromMonth = useCallback(async (slug: string, month: string, scope: 'month-only' | 'month-and-future') => {
    if (!householdId) return;
    const cat = categories.find(c => c.id === slug);
    if (!cat) return;

    if (scope === 'month-and-future') {
      if (cat.startMonth && cat.startMonth >= month) {
        // Category was added starting at or after this month — just delete it
        await supabase.from('budget_categories').delete().eq('household_id', householdId).eq('slug', slug);
        setCategories(prev => prev.filter(c => c.id !== slug));
      } else {
        // Category existed before this month — set end_month to previous month
        const [y, m] = month.split('-').map(Number);
        const prevMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
        await supabase.from('budget_categories').update({ end_month: prevMonth } as any).eq('household_id', householdId).eq('slug', slug);
        setCategories(prev => prev.map(c => c.id === slug ? { ...c, endMonth: prevMonth } : c));
      }
    } else {
      // month-only removal
      if (cat.startMonth === month && cat.endMonth === month) {
        // Was added for this month only — just delete
        await supabase.from('budget_categories').delete().eq('household_id', householdId).eq('slug', slug);
        setCategories(prev => prev.filter(c => c.id !== slug));
      } else if (cat.startMonth === month) {
        // Started this month, push start to next month
        const [y, m] = month.split('-').map(Number);
        const nextMo = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
        await supabase.from('budget_categories').update({ start_month: nextMo } as any).eq('household_id', householdId).eq('slug', slug);
        setCategories(prev => prev.map(c => c.id === slug ? { ...c, startMonth: nextMo } : c));
      } else {
        // Global category — can't remove from single month without splitting. Fall back to month-and-future.
        const [y, m] = month.split('-').map(Number);
        const prevMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
        await supabase.from('budget_categories').update({ end_month: prevMonth } as any).eq('household_id', householdId).eq('slug', slug);
        setCategories(prev => prev.map(c => c.id === slug ? { ...c, endMonth: prevMonth } : c));
      }
    }
  }, [householdId, categories]);

  /** Remove a fixed expense from a specific month scope */
  const removeFixedExpenseFromMonth = useCallback(async (slug: string, month: string, scope: 'month-only' | 'month-and-future') => {
    if (!householdId) return;
    const exp = fixedExpenses.find(e => e.id === slug);
    if (!exp) return;

    if (scope === 'month-and-future') {
      if (exp.startMonth && exp.startMonth >= month) {
        await supabase.from('fixed_expenses').delete().eq('household_id', householdId).eq('slug', slug);
        setFixedExpenses(prev => prev.filter(e => e.id !== slug));
      } else {
        const [y, m] = month.split('-').map(Number);
        const prevMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
        await supabase.from('fixed_expenses').update({ end_month: prevMonth } as any).eq('household_id', householdId).eq('slug', slug);
        setFixedExpenses(prev => prev.map(e => e.id === slug ? { ...e, endMonth: prevMonth } : e));
      }
    } else {
      if (exp.startMonth === month && exp.endMonth === month) {
        await supabase.from('fixed_expenses').delete().eq('household_id', householdId).eq('slug', slug);
        setFixedExpenses(prev => prev.filter(e => e.id !== slug));
      } else if (exp.startMonth === month) {
        const [y, m] = month.split('-').map(Number);
        const nextMo = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
        await supabase.from('fixed_expenses').update({ start_month: nextMo } as any).eq('household_id', householdId).eq('slug', slug);
        setFixedExpenses(prev => prev.map(e => e.id === slug ? { ...e, startMonth: nextMo } : e));
      } else {
        const [y, m] = month.split('-').map(Number);
        const prevMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
        await supabase.from('fixed_expenses').update({ end_month: prevMonth } as any).eq('household_id', householdId).eq('slug', slug);
        setFixedExpenses(prev => prev.map(e => e.id === slug ? { ...e, endMonth: prevMonth } : e));
      }
    }
  }, [householdId, fixedExpenses]);

  const startNewMonth = useCallback(async (nextMonth: string, nextCats: BudgetCategory[], nextFixed: FixedExpense[]) => {
    if (!householdId) return;

    // Snapshot current month using shared helper
    const snapshotData = buildSnapshotData(activeMonth, categories, fixedExpenses);
    await supabase.from('budget_month_snapshots' as any).upsert(snapshotData as any, { onConflict: 'household_id,month' });

    // Update categories and fixed expenses to new amounts
    await updateCategories(nextCats);
    await updateFixedExpenses(nextFixed);

    // Promote any overrides that targeted the new active month onto the base.
    await promoteOverridesForMonth(nextMonth);

    // Update active_month on household
    await supabase.from('households').update({ active_month: nextMonth } as any).eq('id', householdId);
    setActiveMonth(nextMonth);
  }, [householdId, activeMonth, categories, fixedExpenses, buildSnapshotData, updateCategories, updateFixedExpenses, promoteOverridesForMonth]);

  /**
   * Targeted move: convert a variable category row into a fixed expense row
   * (or vice versa) using a single delete + insert pair on each table.
   * Avoids the "wipe and rewrite" race in updateCategories/updateFixedExpenses
   * that caused brand-new categories to disappear when toggled.
   */
  const moveCategoryToFixed = useCallback(async (
    slug: string, fixedGroup: FixedExpense['group'],
  ) => {
    if (!householdId) return;
    const cat = categories.find(c => c.id === slug);
    if (!cat) return;
    const sortOrder = fixedExpenses.length;
    const newFixed: FixedExpense = {
      id: cat.id,
      name: cat.name,
      amount: cat.budgeted,
      group: fixedGroup,
      notesRequired: cat.notesRequired,
      startMonth: cat.startMonth ?? null,
      endMonth: cat.endMonth ?? null,
    };
    // Optimistic local update
    setCategories(prev => prev.filter(c => c.id !== slug));
    setFixedExpenses(prev => [...prev, newFixed]);
    // DB ops: insert into fixed first so we never have zero rows for the slug
    await supabase.from('fixed_expenses').insert({
      household_id: householdId,
      slug: newFixed.id,
      name: newFixed.name,
      amount: newFixed.amount,
      group: newFixed.group,
      sort_order: sortOrder,
      notes_required: newFixed.notesRequired ?? false,
      start_month: newFixed.startMonth,
      end_month: newFixed.endMonth,
    } as any);
    await supabase.from('budget_categories').delete()
      .eq('household_id', householdId).eq('slug', slug);
  }, [householdId, categories, fixedExpenses]);

  const moveFixedToCategory = useCallback(async (
    slug: string, group: BudgetCategory['group'],
  ) => {
    if (!householdId) return;
    const exp = fixedExpenses.find(e => e.id === slug);
    if (!exp) return;
    const sortOrder = categories.length;
    const newCat: BudgetCategory = {
      id: exp.id,
      name: exp.name,
      budgeted: exp.amount,
      group,
      notesRequired: exp.notesRequired,
      startMonth: exp.startMonth ?? null,
      endMonth: exp.endMonth ?? null,
    };
    setFixedExpenses(prev => prev.filter(e => e.id !== slug));
    setCategories(prev => [...prev, newCat]);
    await supabase.from('budget_categories').insert({
      household_id: householdId,
      slug: newCat.id,
      name: newCat.name,
      budgeted: newCat.budgeted,
      group: newCat.group,
      sort_order: sortOrder,
      notes_required: newCat.notesRequired ?? false,
      start_month: newCat.startMonth,
      end_month: newCat.endMonth,
    } as any);
    await supabase.from('fixed_expenses').delete()
      .eq('household_id', householdId).eq('slug', slug);
  }, [householdId, categories, fixedExpenses]);

  // Targeted notes_required toggles — avoid the wipe-and-rewrite path in
  // updateCategories / updateFixedExpenses, which would delete any rows not
  // in the stale props list (e.g. a category that was just moved between
  // fixed and variable groups on the previous tick).
  const setCategoryNotesRequired = useCallback(async (slug: string, value: boolean) => {
    if (!householdId) return;
    setCategories(prev => prev.map(c => c.id === slug ? { ...c, notesRequired: value } : c));
    await supabase.from('budget_categories')
      .update({ notes_required: value } as any)
      .eq('household_id', householdId)
      .eq('slug', slug);
  }, [householdId]);

  const setFixedNotesRequired = useCallback(async (slug: string, value: boolean) => {
    if (!householdId) return;
    setFixedExpenses(prev => prev.map(e => e.id === slug ? { ...e, notesRequired: value } : e));
    await supabase.from('fixed_expenses')
      .update({ notes_required: value } as any)
      .eq('household_id', householdId)
      .eq('slug', slug);
  }, [householdId]);

  const updatePlanningData = useCallback(async (data: Record<string, string>) => {
    if (!householdId) return;
    setPlanningData(data);
    await supabase.from('households').update({ planning_data: data } as any).eq('id', householdId);
  }, [householdId]);

  return {
    categories,
    fixedExpenses,
    transactions,
    transfers,
    activeMonth,
    planningData,
    loading,
    householdId: householdId || '',
    addTransactions,
    deleteTransaction,
    addTransfer,
    deleteTransfer,
    updateCategories,
    updateFixedExpenses,
    addCategoryForMonth,
    addFixedExpenseForMonth,
    removeCategoryFromMonth,
    removeFixedExpenseFromMonth,
    startNewMonth,
    updatePlanningData,
    monthAmountOverrides,
    setMonthAmountOverride,
    moveCategoryToFixed,
    moveFixedToCategory,
    setCategoryNotesRequired,
    setFixedNotesRequired,
  };
}
