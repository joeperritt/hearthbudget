import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export type ReminderKind = 'at' | 'before15' | 'before1h' | 'morning_of' | 'day_before' | 'custom';
export interface ReminderRule { kind: ReminderKind; custom_at?: string }

export const REMINDER_OPTIONS: { id: ReminderKind; label: string; needsTime?: boolean }[] = [
  { id: 'at', label: 'At due time', needsTime: true },
  { id: 'before15', label: '15 minutes before', needsTime: true },
  { id: 'before1h', label: '1 hour before', needsTime: true },
  { id: 'morning_of', label: 'Morning of (8:00 AM)' },
  { id: 'day_before', label: 'Day before (8:00 AM)' },
  { id: 'custom', label: 'Custom…' },
];

/** The current user's to do reminders (per user; the other person's are invisible). */
export function useTodoReminders() {
  const { user } = useAuth();
  const [mine, setMine] = useState<Record<string, ReminderRule>>({});

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from('todo_reminders').select('todo_id, rule').eq('user_id', user.id);
    const map: Record<string, ReminderRule> = {};
    for (const r of data ?? []) map[r.todo_id] = r.rule as unknown as ReminderRule;
    setMine(map);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    load();
    const ch = supabase
      .channel(`todo-reminders-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'todo_reminders', filter: `user_id=eq.${user.id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, load]);

  const save = async (todoId: string, rule: ReminderRule | null, due: { date: string; time: string | null }, customAt?: string) => {
    if (!user) return;
    if (!rule) {
      setMine(prev => { const n = { ...prev }; delete n[todoId]; return n; });
      await supabase.from('todo_reminders').delete().eq('todo_id', todoId).eq('user_id', user.id);
      return;
    }
    // Compute the fire time the same way the database does (America/New_York).
    const ruleJson: Record<string, string> = { kind: rule.kind };
    if (rule.kind === 'custom' && customAt) ruleJson.custom_at = customAt;
    const { data: remindAt, error: calcErr } = await supabase.rpc('compute_remind_at' as never, {
      _rule: ruleJson, _due_date: due.date, _due_time: due.time,
    } as never) as { data: string | null; error: unknown };
    if (calcErr || !remindAt) { toast.error("Couldn't set that reminder."); return; }
    setMine(prev => ({ ...prev, [todoId]: rule }));
    const { error } = await supabase.from('todo_reminders').upsert(
      { todo_id: todoId, user_id: user.id, rule: ruleJson, remind_at: remindAt, sent_at: null } as never,
      { onConflict: 'todo_id,user_id' },
    );
    if (error) { toast.error("Couldn't save that reminder."); load(); }
  };

  return { reminders: mine, hasReminder: (todoId: string) => todoId in mine, save };
}
