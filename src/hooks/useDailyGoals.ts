import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { HabitDef, HabitLog } from '@/lib/habits';
import { readSnapshot, trackRefresh, writeSnapshot } from '@/lib/snapshot';

type Snap = { habits: HabitDef[]; logs: HabitLog[] };
const db = supabase as any;

/** The signed-in user's habits and logs. Taps save straight to the database. */
export function useDailyGoals() {
  const { user } = useAuth();
  const uid = user?.id;
  const seed = useRef(readSnapshot<Snap>(uid, 'daily-goals'));
  const [habits, setHabits] = useState<HabitDef[]>(seed.current?.habits ?? []);
  const [logs, setLogs] = useState<HabitLog[]>(seed.current?.logs ?? []);
  const [loading, setLoading] = useState(!seed.current);

  const load = useCallback(async () => {
    if (!uid) return;
    const [h, l] = await Promise.all([
      db.from('habit_definitions').select('id,user_id,name,kind,target,period,section,sort_order,active,start_date').eq('user_id', uid).eq('active', true).order('sort_order'),
      db.from('habit_logs').select('habit_id,log_date,value').eq('user_id', uid),
    ]);
    if (h.error || l.error) { setLoading(false); return; }
    setHabits(h.data); setLogs(l.data); setLoading(false);
    writeSnapshot(uid, 'daily-goals', { habits: h.data, logs: l.data });
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    if (seed.current) trackRefresh(load()); else load();
    const onResume = () => { trackRefresh(load()); };
    window.addEventListener('perritt-resume', onResume);
    return () => window.removeEventListener('perritt-resume', onResume);
  }, [uid, load]);

  const setValue = async (habitId: string, date: string, value: number) => {
    if (!uid) return;
    const v = Math.max(0, Math.round(value));
    setLogs(prev => [...prev.filter(x => !(x.habit_id === habitId && x.log_date === date)), ...(v > 0 ? [{ habit_id: habitId, log_date: date, value: v }] : [])]);
    const res = v > 0
      ? await db.from('habit_logs').upsert({ user_id: uid, habit_id: habitId, log_date: date, value: v }, { onConflict: 'user_id,habit_id,log_date' })
      : await db.from('habit_logs').delete().eq('user_id', uid).eq('habit_id', habitId).eq('log_date', date);
    if (res.error) toast.error("Couldn't save that. Please try again.");
    load();
  };

  return { habits, logs, loading, setValue };
}
