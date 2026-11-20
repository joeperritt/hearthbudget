import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Recurrence } from '@/lib/recurrence';
import { readSnapshot, trackRefresh, writeSnapshot } from '@/lib/snapshot';

export type HomeListType = 'todo' | 'store';

export interface HomeListItem {
  id: string;
  text: string;
  completed: boolean;
  created_at: string;
  completed_at: string | null;
  /** To do owner; null = Family. */
  user_id: string | null;
  due_date: string | null;
  due_time: string | null;
  notes: string | null;
  recurrence: Recurrence | null;
  series_id: string | null;
}

export type HomeListPatch = Partial<Pick<HomeListItem, 'text' | 'user_id' | 'due_date' | 'due_time' | 'notes' | 'completed' | 'recurrence'>>;

/** Household list with realtime sync. RLS scopes rows to the household. */
export function useHomeList(listType: HomeListType) {
  const { user, profile } = useAuth();
  const householdId = profile?.household_id;
  const snapKey = `home-list-${listType}`;
  const [seed] = useState(() => { const s = readSnapshot<HomeListItem[]>(user?.id, snapKey); return Array.isArray(s) ? s : null; });
  const [items, setItems] = useState<HomeListItem[]>(seed ?? []);
  const [loading, setLoading] = useState(!seed);

  const load = useCallback(async () => {
    if (!householdId) return;
    const { data, error } = await supabase
      .from('home_list_items')
      .select('id, text, completed, created_at, completed_at, user_id, due_date, due_time, notes, recurrence, series_id')
      .eq('household_id', householdId)
      .eq('list_type', listType)
      .order('created_at', { ascending: false });
    if (error) { setLoading(false); return; } // keep what's on screen
    const rows = (data as unknown as HomeListItem[]) || [];
    setItems(rows);
    setLoading(false);
    writeSnapshot(user?.id, snapKey, rows);
  }, [householdId, listType, user?.id, snapKey]);

  useEffect(() => {
    if (!householdId) return;
    if (seed) trackRefresh(load()); else load();
    const ch = supabase
      .channel(`home-list-${listType}-${householdId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'home_list_items', filter: `household_id=eq.${householdId}` }, () => load())
      .subscribe();
    const onResume = () => { trackRefresh(load()); };
    window.addEventListener('perritt-resume', onResume);
    return () => { supabase.removeChannel(ch); window.removeEventListener('perritt-resume', onResume); };
  }, [householdId, listType, load]);

  const add = async (text: string, opts: { owner?: string | null; due_date?: string | null; due_time?: string | null; notes?: string | null; recurrence?: Recurrence | null } = {}) => {
    const t = text.trim().slice(0, 300);
    if (!t || !householdId || !user) return null;
    const owner = listType === 'todo' ? (opts.owner === undefined ? user.id : opts.owner) : null;
    const tempId = `temp-${Date.now()}`;
    setItems(prev => [{ id: tempId, text: t, completed: false, created_at: new Date().toISOString(), completed_at: null, user_id: owner, due_date: opts.due_date ?? null, due_time: opts.due_time ?? null, notes: opts.notes ?? null, recurrence: opts.recurrence ?? null, series_id: null }, ...prev]);
    const { data, error } = await supabase.from('home_list_items').insert({
      household_id: householdId, list_type: listType, user_id: owner, text: t, created_by: user.id,
      due_date: opts.due_date ?? null, due_time: opts.due_date ? opts.due_time ?? null : null,
      notes: opts.notes?.trim().slice(0, 2000) || null,
      recurrence: (opts.due_date && opts.recurrence) ? (opts.recurrence as never) : null,
    }).select('id').single();
    if (error) { toast.error("Couldn't add that. Please try again."); load(); return null; }
    load();
    return (data as { id: string } | null)?.id ?? null;
  };

  const update = async (id: string, patch: HomeListPatch) => {
    const full: HomeListPatch & { completed_at?: string | null } = { ...patch };
    if ('completed' in patch) full.completed_at = patch.completed ? new Date().toISOString() : null;
    if (patch.due_date === null) { full.due_time = null; full.recurrence = null; }
    if (typeof patch.text === 'string') full.text = patch.text.trim().slice(0, 300);
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...full } as HomeListItem : i));
    const { data: saved, error } = await supabase.from('home_list_items').update(full as never).eq('id', id).select('id');
    if (error) { toast.error("Couldn't save that change."); load(); return false; }
    // The item was already gone (e.g. changed on the other phone): refresh quietly.
    if (!saved || saved.length === 0) { load(); return false; }
    return true;
  };

  const toggle = (item: HomeListItem) => update(item.id, { completed: !item.completed });

  const remove = async (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
    await supabase.from('home_list_items').delete().eq('id', id);
  };

  /** Recurring: "delete this one" completes it (the database creates the next) and then removes it. */
  const skipOccurrence = async (item: HomeListItem) => {
    setItems(prev => prev.filter(i => i.id !== item.id));
    if (!item.completed) await supabase.from('home_list_items').update({ completed: true, completed_at: new Date().toISOString() }).eq('id', item.id);
    await supabase.from('home_list_items').delete().eq('id', item.id);
    load();
  };

  const clearCompleted = async () => {
    const ids = items.filter(i => i.completed).map(i => i.id);
    if (!ids.length) return;
    setItems(prev => prev.filter(i => !i.completed));
    await supabase.from('home_list_items').delete().in('id', ids);
  };

  return { items, loading, add, update, toggle, remove, skipOccurrence, clearCompleted };
}
