import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
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
  };
}

function dbToFixed(row: Record<string, unknown>): FixedExpense {
  return {
    id: row.slug as string,
    name: row.name as string,
    amount: Number(row.amount),
    group: row.group as FixedExpense['group'],
  };
}

function dbToTx(row: Record<string, unknown>): Transaction {
  return {
    id: row.id as string,
    date: row.date as string,
    description: row.description as string,
    amount: Number(row.amount),
    categoryId: row.category_slug as string,
    account: row.account as AccountSource,
    isTransferToSavings: row.is_transfer_to_savings as boolean,
    transactionType: row.transaction_type as TransactionType,
    enteredBy: row.entered_by as string | null,
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
  const [loading, setLoading] = useState(true);
  const initialLoad = useRef(true);

  // Fetch all data
  const fetchAll = useCallback(async () => {
    if (!householdId) return;

    const [catRes, fixRes, txRes, trRes] = await Promise.all([
      supabase.from('budget_categories').select('*').eq('household_id', householdId).order('sort_order'),
      supabase.from('fixed_expenses').select('*').eq('household_id', householdId).order('sort_order'),
      supabase.from('transactions').select('*').eq('household_id', householdId).order('created_at', { ascending: false }),
      supabase.from('budget_transfers').select('*').eq('household_id', householdId),
    ]);

    if (catRes.data) setCategories(catRes.data.map(r => dbToCat(r as unknown as Record<string, unknown>)));
    if (fixRes.data) setFixedExpenses(fixRes.data.map(r => dbToFixed(r as unknown as Record<string, unknown>)));
    if (txRes.data) setTransactions(txRes.data.map(r => dbToTx(r as unknown as Record<string, unknown>)));
    if (trRes.data) setTransfers(trRes.data.map(r => dbToTransfer(r as unknown as Record<string, unknown>)));

    if (initialLoad.current) {
      initialLoad.current = false;
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Real-time subscriptions
  useEffect(() => {
    if (!householdId) return;

    const channel = supabase
      .channel('budget-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: `household_id=eq.${householdId}` }, () => {
        // Refetch transactions on any change
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
    if (!householdId || !user) return;
    const rows = txns.map(t => ({
      household_id: householdId,
      category_slug: t.categoryId,
      date: t.date,
      description: t.description,
      amount: t.amount,
      account: t.account,
      is_transfer_to_savings: t.isTransferToSavings,
      transaction_type: t.transactionType,
      entered_by: user.id,
    }));
    await supabase.from('transactions').insert(rows);
  }, [householdId, user]);

  const deleteTransaction = useCallback(async (id: string) => {
    await supabase.from('transactions').delete().eq('id', id);
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

  const updateCategories = useCallback(async (cats: BudgetCategory[]) => {
    if (!householdId) return;
    // Upsert each category
    const ops = cats.map((c, i) =>
      supabase.from('budget_categories').upsert({
        household_id: householdId,
        slug: c.id,
        name: c.name,
        budgeted: c.budgeted,
        group: c.group,
        sort_order: i,
      }, { onConflict: 'household_id,slug' })
    );
    await Promise.all(ops);

    // Delete categories that no longer exist
    const existingSlugs = cats.map(c => c.id);
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

    // Optimistic update
    setCategories(cats);
  }, [householdId]);

  const updateFixedExpenses = useCallback(async (exps: FixedExpense[]) => {
    if (!householdId) return;
    const ops = exps.map((e, i) =>
      supabase.from('fixed_expenses').upsert({
        household_id: householdId,
        slug: e.id,
        name: e.name,
        amount: e.amount,
        group: e.group,
        sort_order: i,
      }, { onConflict: 'household_id,slug' })
    );
    await Promise.all(ops);

    // Delete expenses that no longer exist
    const existingSlugs = exps.map(e => e.id);
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

    // Optimistic update
    setFixedExpenses(exps);
  }, [householdId]);

  return {
    categories,
    fixedExpenses,
    transactions,
    transfers,
    loading,
    addTransactions,
    deleteTransaction,
    addTransfer,
    updateCategories,
    updateFixedExpenses,
  };
}
