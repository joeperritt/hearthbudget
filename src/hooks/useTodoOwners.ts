import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { readSnapshot, trackRefresh, writeSnapshot } from '@/lib/snapshot';

export interface TodoOwner { key: string; userId: string | null; label: string; color: string }

const FAMILY_FALLBACK = '#33B679';
const PERSON_FALLBACK = ['#4285F4', '#E67C73', '#F6BF26'];

/** Owners (members + Family) with colors taken from each person's calendar, plus saved chip choices. */
export function useTodoOwners() {
  const { user, profile } = useAuth();
  const [seed] = useState(() => {
    const s = readSnapshot<{ owners: TodoOwner[]; choices: Record<string, boolean> }>(user?.id, 'todo-owners');
    return s && Array.isArray(s.owners) && s.choices && typeof s.choices === 'object' ? s : null;
  });
  const [owners, setOwners] = useState<TodoOwner[]>(seed?.owners ?? []);
  const [choices, setChoices] = useState<Record<string, boolean>>(seed?.choices ?? {});
  const pending = useRef(new Set<string>());

  const load = useCallback(async () => {
    if (!user || !profile?.household_id) return;
    const [m, c, l] = await Promise.all([
      supabase.from('profiles').select('user_id, display_name').eq('household_id', profile.household_id).order('display_name'),
      supabase.from('household_calendars').select('owner_user_id, color').eq('household_id', profile.household_id).order('created_at'),
      supabase.from('user_home_layouts').select('todo_visibility').eq('user_id', user.id).maybeSingle(),
    ]);
    if (m.error || c.error || l.error) return; // keep what's on screen
    const cals = c.data ?? [];
    const colorFor = (id: string | null, i: number) => cals.find(x => x.owner_user_id === id && x.color)?.color ?? (id ? PERSON_FALLBACK[i % 3] : FAMILY_FALLBACK);
    const people = (m.data ?? []).map((p, i) => ({ key: p.user_id, userId: p.user_id, label: p.display_name.split(' ')[0], color: colorFor(p.user_id, i) }));
    // Order chips Joe, Family, Katie: first person, Family, others.
    const family = { key: 'family', userId: null, label: 'Family', color: colorFor(null, 0) };
    const nextOwners = people.length ? [people[0], family, ...people.slice(1)] : [family];
    setOwners(nextOwners);
    const saved = l.data?.todo_visibility;
    let savedChoices: Record<string, boolean> = {};
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      savedChoices = Object.fromEntries(Object.entries(saved).filter(([, v]) => typeof v === 'boolean')) as Record<string, boolean>;
      setChoices(Object.fromEntries(Object.entries(savedChoices).filter(([k]) => !pending.current.has(k))) as Record<string, boolean>);
    }
    writeSnapshot(user.id, 'todo-owners', { owners: nextOwners, choices: savedChoices });
  }, [user?.id, profile?.household_id]);

  useEffect(() => {
    if (seed) trackRefresh(load()); else load();
    if (!user) return;
    const ch = supabase.channel(`todo-owners-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_home_layouts', filter: `user_id=eq.${user.id}` }, load)
      .subscribe();
    const onResume = () => { trackRefresh(load()); };
    window.addEventListener('perritt-resume', onResume);
    return () => { supabase.removeChannel(ch); window.removeEventListener('perritt-resume', onResume); };
  }, [load]);

  const isVisible = (key: string) => choices[key] ?? (key === 'family' || key === user?.id);
  const keyOf = (userId: string | null) => userId ?? 'family';
  const ownerOf = (userId: string | null) => owners.find(o => o.key === keyOf(userId));

  const toggle = async (key: string) => {
    if (pending.current.has(key)) return;
    const next = !isVisible(key);
    pending.current.add(key);
    setChoices(c => ({ ...c, [key]: next }));
    const { error } = await supabase.rpc('set_home_todo_visibility', { owner_key: key, visible: next });
    pending.current.delete(key);
    if (error) { setChoices(c => ({ ...c, [key]: !next })); toast.error("Couldn't save your choice."); }
  };

  return { owners, isVisible, toggle, ownerOf, keyOf };
}
