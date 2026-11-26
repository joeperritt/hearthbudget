import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/** Loads every row of a household-scoped 2717 table (RLS scopes to the household). */
export function useTable<T>(table: string, order: string) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    const { data, error } = await (supabase as any).from(table).select('*').order(order);
    if (error) toast.error('Could not load data'); else setRows(data as T[]);
    setLoading(false);
  }, [table, order]);
  useEffect(() => { reload(); }, [reload]);
  return { rows, loading, reload, setRows };
}

export async function run(p: PromiseLike<{ error: unknown }>, ok?: string) {
  const { error } = await p;
  if (error) { toast.error('Could not save. Please try again.'); return false; }
  if (ok) toast.success(ok);
  return true;
}

export const db = (table: string) => (supabase as any).from(table);
