import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export type HomeListType = 'family' | 'personal' | 'grocery';

export interface HomeListItem {
  id: string;
  text: string;
  completed: boolean;
  created_at: string;
  completed_at: string | null;
}

/** Shared/personal list with realtime sync. Personal rows are enforced by RLS. */
export function useHomeList(listType: HomeListType) {
  const { user, profile } = useAuth();
  const householdId = profile?.household_id;
  const [items, setItems] = useState<HomeListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!householdId) return;
    const { data } = await supabase
      .from('home_list_items')
      .select('id, text, completed, created_at, completed_at')
      .eq('household_id', householdId)
      .eq('list_type', listType)
      .order('created_at', { ascending: false });
    setItems((data as HomeListItem[]) || []);
    setLoading(false);
  }, [householdId, listType]);

  useEffect(() => {
    if (!householdId) return;
    load();
    const ch = supabase
      .channel(`home-list-${listType}-${householdId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'home_list_items', filter: `household_id=eq.${householdId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [householdId, listType, load]);

  const add = async (text: string) => {
    const t = text.trim().slice(0, 300);
    if (!t || !householdId || !user) return;
    const tempId = `temp-${Date.now()}`;
    setItems(prev => [{ id: tempId, text: t, completed: false, created_at: new Date().toISOString(), completed_at: null }, ...prev]);
    await supabase.from('home_list_items').insert({
      household_id: householdId,
      list_type: listType,
      user_id: listType === 'personal' ? user.id : null,
      text: t,
    });
    load();
  };

  const toggle = async (item: HomeListItem) => {
    const completed = !item.completed;
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, completed } : i));
    await supabase.from('home_list_items')
      .update({ completed, completed_at: completed ? new Date().toISOString() : null })
      .eq('id', item.id);
  };

  const remove = async (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
    await supabase.from('home_list_items').delete().eq('id', id);
  };

  const clearCompleted = async () => {
    const ids = items.filter(i => i.completed).map(i => i.id);
    if (!ids.length) return;
    setItems(prev => prev.filter(i => !i.completed));
    await supabase.from('home_list_items').delete().in('id', ids);
  };

  return { items, loading, add, toggle, remove, clearCompleted };
}
