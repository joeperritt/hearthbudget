import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { readSnapshot, trackRefresh, writeSnapshot } from '@/lib/snapshot';
import { CalendarVisibility, HomeCalendar, isCalendarVisible, parseCalendarVisibility } from '@/lib/homeCalendars';

export function useHomeCalendars() {
  const { user, profile } = useAuth();
  const [seed] = useState(() => {
    const s = readSnapshot<{ calendars: HomeCalendar[]; choices: CalendarVisibility }>(user?.id, 'home-calendars');
    return s && Array.isArray(s.calendars) && s.choices && typeof s.choices === 'object' ? s : null;
  });
  const [calendars, setCalendars] = useState<HomeCalendar[]>(seed?.calendars ?? []);
  const [choices, setChoices] = useState<CalendarVisibility>(seed?.choices ?? {});
  const [loading, setLoading] = useState(!seed);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState<string[]>([]);
  const pending = useRef(new Map<string, boolean>());
  const seededRef = useRef(Boolean(seed));

  const load = useCallback(async () => {
    if (!user || !profile?.household_id) return;
    const [calendarResult, layoutResult] = await Promise.all([
      supabase.from('household_calendars').select('id, label, owner_user_id, color, read_only, google_calendar_id').eq('household_id', profile.household_id).order('created_at'),
      supabase.from('user_home_layouts').select('calendar_visibility').eq('user_id', user.id).maybeSingle(),
    ]);
    if (calendarResult.error || layoutResult.error) {
      // With a snapshot on screen, keep it instead of showing an error.
      if (!seededRef.current) setFailed(true);
      setLoading(false);
      return;
    }
    const saved = parseCalendarVisibility(layoutResult.data?.calendar_visibility);
    setCalendars(calendarResult.data ?? []);
    setChoices({ ...saved, ...Object.fromEntries(pending.current) });
    writeSnapshot(user.id, 'home-calendars', { calendars: calendarResult.data ?? [], choices: saved });
    setFailed(false);
    setLoading(false);
  }, [user?.id, profile?.household_id]);

  useEffect(() => {
    if (!seededRef.current) setLoading(true);
    pending.current.clear();
    if (seededRef.current) trackRefresh(load()); else load();
    if (!user || !profile?.household_id) return;
    const channel = supabase.channel(`home-calendars-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'household_calendars', filter: `household_id=eq.${profile.household_id}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_home_layouts', filter: `user_id=eq.${user.id}` }, load)
      .subscribe();
    const onResume = () => { trackRefresh(load()); };
    window.addEventListener('perritt-resume', onResume);
    return () => { supabase.removeChannel(channel); window.removeEventListener('perritt-resume', onResume); };
  }, [load]);

  const toggle = async (calendar: HomeCalendar) => {
    if (!user || pending.current.has(calendar.id)) return;
    const previous = isCalendarVisible(calendar, user.id, choices);
    pending.current.set(calendar.id, !previous);
    setChoices(current => ({ ...current, [calendar.id]: !previous }));
    setSaving(current => [...current, calendar.id]);
    const { error } = await supabase.rpc('set_home_calendar_visibility', { calendar_id: calendar.id, visible: !previous });
    pending.current.delete(calendar.id);
    setSaving(current => current.filter(id => id !== calendar.id));
    if (error) {
      setChoices(current => ({ ...current, [calendar.id]: previous }));
      toast.error("Couldn't save your calendar choice. Please try again.");
    }
    await load();
  };

  return { calendars, loading, failed, saving, toggle, isVisible: (calendar: HomeCalendar) => Boolean(user && isCalendarVisible(calendar, user.id, choices)) };
}