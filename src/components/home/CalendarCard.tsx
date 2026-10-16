import { useEffect, useState } from 'react';
import { CalendarDays, CalendarRange, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { useHomeCalendars } from '@/hooks/useHomeCalendars';
import { calendarColor } from '@/lib/homeCalendars';
import { CalendarMonthDialog, addDays, ymd } from './CalendarMonthDialog';

const DEFAULT_DAYS = 7;

interface Ev { title: string; start: string; end: string | null; allDay: boolean; location: string | null; calendar: string; calendarId: string }

function dayLabel(dateStr: string, today: string) {
  if (dateStr === today) return 'Today';
  const t = new Date(today + 'T00:00:00'); t.setDate(t.getDate() + 1);
  const tomorrow = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  if (dateStr === tomorrow) return 'Tomorrow';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function timeLabel(e: Ev) {
  if (e.allDay) return 'All day';
  const [h, m] = e.start.slice(11, 16).split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am';
  const hh = h % 12 || 12;
  return m ? `${hh}:${String(m).padStart(2, '0')}${ap}` : `${hh}${ap}`;
}

export function CalendarCard({ onConnect }: { onConnect: () => void }) {
  const [state, setState] = useState<{ events: Ev[]; calendars: number; today: string; errors: string[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [monthOpen, setMonthOpen] = useState(false);
  const { calendars, loading, failed: preferencesFailed, saving, toggle, isVisible } = useHomeCalendars();

  const calendarSignature = JSON.stringify(calendars);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    const bump = () => setRefreshKey(k => k + 1);
    window.addEventListener('keeper-calendar-refresh', bump);
    return () => window.removeEventListener('keeper-calendar-refresh', bump);
  }, []);
  useEffect(() => {
    if (loading) return;
    let alive = true;
    setFailed(false);
    const from = ymd(new Date());
    supabase.functions.invoke('calendar-events', { body: { from, to: addDays(from, days - 1) } }).then(({ data, error }) => {
      if (!alive) return;
      if (error || !data) { setFailed(true); return; }
      setState(data);
    });
    return () => { alive = false; };
  }, [calendarSignature, loading, refreshKey, days]);

  const header = (
    <div className="mb-3 space-y-2">
      <div className="flex items-center gap-2">
      <CalendarDays size={18} className="text-accent" />
      <h2 className="font-display text-lg font-semibold text-foreground flex-1">Calendar</h2>
      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Open month view" onClick={() => setMonthOpen(true)}><CalendarRange size={18} /></Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {calendars.map(calendar => (
          <Button key={calendar.id} size="sm" variant={isVisible(calendar) ? "secondary" : "ghost"}
            aria-label={`${calendar.label} calendar`} aria-pressed={isVisible(calendar)}
            disabled={saving.includes(calendar.id)} onClick={() => toggle(calendar)}
            className={`h-7 gap-1.5 rounded-full px-2.5 text-xs border ${isVisible(calendar) ? "border-primary/20 text-foreground" : "border-border text-muted-foreground opacity-60"}`}>
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: calendarColor(calendar.id, calendars) }} />
            {calendar.label}
          </Button>
        ))}
      </div>
    </div>
  );

  const monthDialog = (
    <CalendarMonthDialog open={monthOpen} onOpenChange={setMonthOpen} today={state?.today ?? ymd(new Date())}
      calendars={calendars} isVisible={isVisible} toggle={toggle} saving={saving} />
  );

  if (failed || preferencesFailed) {
    return <section className="bg-card rounded-2xl border border-border p-4 shadow-sm">{header}{monthDialog}<p className="text-xs text-muted-foreground">Couldn't load the calendar right now.</p></section>;
  }
  if (!state || loading) {
    return <section className="bg-card rounded-2xl border border-border p-4 shadow-sm">{header}{monthDialog}<p className="text-xs text-muted-foreground">Loading…</p></section>;
  }
  if (state.calendars === 0) {
    return (
      <Button variant="ghost" onClick={onConnect} className="h-auto whitespace-normal w-full bg-card rounded-2xl border border-dashed border-border p-4 shadow-sm flex items-center gap-3 text-left active:scale-[0.99]">
        <CalendarDays size={20} className="text-accent" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">Connect calendar</p>
          <p className="text-xs text-muted-foreground">Paste your Google Calendar iCal link</p>
        </div>
        <ChevronRight size={16} className="text-muted-foreground" />
      </Button>
    );
  }

  const today = state.today;
  const visibleIds = new Set(calendars.filter(isVisible).map(c => c.id));
  const events = state.events.filter(e => visibleIds.has(e.calendarId));
  const todays = events.filter(e => e.start.slice(0, 10) <= today && (e.end ? (e.allDay ? e.end.slice(0, 10) > today : e.end.slice(0, 10) >= today) : e.start.slice(0, 10) === today));
  const lastDay = addDays(today, days - 1);
  const upcoming = events.filter(e => e.start.slice(0, 10) > today && e.start.slice(0, 10) <= lastDay);
  const groups: { day: string; events: Ev[] }[] = [];
  if (todays.length) groups.push({ day: today, events: todays });
  for (const e of upcoming) {
    const d = e.start.slice(0, 10);
    const g = groups.find(x => x.day === d);
    if (g) g.events.push(e); else groups.push({ day: d, events: [e] });
  }

  return (
    <section className="bg-card rounded-2xl border border-border p-4 shadow-sm">
      {header}
      {monthDialog}
      {!todays.length && <p className="text-xs text-muted-foreground mb-2">Nothing on the calendar today.</p>}
      <div className="space-y-3 md:max-h-80 md:overflow-y-auto md:pr-1">
        {groups.map(g => (
          <div key={g.day}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">{dayLabel(g.day, today)}</p>
            <ul className="space-y-1.5">
              {g.events.map((e, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="w-14 shrink-0 text-muted-foreground text-xs pt-0.5">{timeLabel(e)}</span>
                  <span className="flex-1 min-w-0">
                    <span className="inline-flex items-baseline gap-1.5">
                      <span title={e.calendar} aria-label={`${e.calendar} calendar`} className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: calendarColor(e.calendarId, calendars) }} />
                      <span className="text-foreground break-words">{e.title}</span>
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {!groups.length && <p className="text-xs text-muted-foreground">No upcoming events.</p>}
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="ghost" size="sm" className="h-8 flex-1 text-xs" onClick={() => setDays(d => d + 7)}>Show more</Button>
        {days > DEFAULT_DAYS && <Button variant="ghost" size="sm" className="h-8 flex-1 text-xs" onClick={() => setDays(DEFAULT_DAYS)}>Show less</Button>}
      </div>
      {state.errors?.length > 0 && <p className="text-[11px] text-destructive mt-3">Couldn't load: {state.errors.join(', ')}</p>}
    </section>
  );
}
