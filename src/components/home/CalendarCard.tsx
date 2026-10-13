import { useEffect, useState } from 'react';
import { CalendarDays, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface Ev { title: string; start: string; end: string | null; allDay: boolean; location: string | null; calendar: string }

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

  useEffect(() => {
    supabase.functions.invoke('calendar-events').then(({ data, error }) => {
      if (error || !data) { setFailed(true); return; }
      setState(data);
    });
  }, []);

  const header = (
    <div className="flex items-center gap-2 mb-3">
      <CalendarDays size={18} className="text-accent" />
      <h2 className="font-display text-lg font-semibold text-foreground">Calendar</h2>
    </div>
  );

  if (failed) {
    return <section className="bg-card rounded-2xl border border-border p-4 shadow-sm">{header}<p className="text-xs text-muted-foreground">Couldn't load the calendar right now.</p></section>;
  }
  if (!state) {
    return <section className="bg-card rounded-2xl border border-border p-4 shadow-sm">{header}<p className="text-xs text-muted-foreground">Loading…</p></section>;
  }
  if (state.calendars === 0) {
    return (
      <button onClick={onConnect} className="w-full bg-card rounded-2xl border border-dashed border-border p-4 shadow-sm flex items-center gap-3 text-left active:scale-[0.99]">
        <CalendarDays size={20} className="text-accent" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">Connect calendar</p>
          <p className="text-xs text-muted-foreground">Paste your Google Calendar iCal link</p>
        </div>
        <ChevronRight size={16} className="text-muted-foreground" />
      </button>
    );
  }

  const today = state.today;
  const todays = state.events.filter(e => e.start.slice(0, 10) <= today && (e.end ? (e.allDay ? e.end.slice(0, 10) > today : e.end.slice(0, 10) >= today) : e.start.slice(0, 10) === today));
  const upcoming = state.events.filter(e => e.start.slice(0, 10) > today).slice(0, 6);
  const groups: { day: string; events: Ev[] }[] = [];
  if (todays.length) groups.push({ day: today, events: todays });
  for (const e of upcoming) {
    const d = e.start.slice(0, 10);
    const g = groups.find(x => x.day === d);
    if (g) g.events.push(e); else groups.push({ day: d, events: [e] });
  }
  const multi = state.calendars > 1;

  return (
    <section className="bg-card rounded-2xl border border-border p-4 shadow-sm">
      {header}
      {!todays.length && <p className="text-xs text-muted-foreground mb-2">Nothing on the calendar today.</p>}
      <div className="space-y-3">
        {groups.map(g => (
          <div key={g.day}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">{dayLabel(g.day, today)}</p>
            <ul className="space-y-1.5">
              {g.events.map((e, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="w-14 shrink-0 text-muted-foreground text-xs pt-0.5">{timeLabel(e)}</span>
                  <span className="flex-1 min-w-0">
                    <span className="text-foreground">{e.title}</span>
                    {multi && <span className="text-[11px] text-muted-foreground"> · {e.calendar}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {!groups.length && <p className="text-xs text-muted-foreground">No upcoming events.</p>}
      </div>
      {state.errors?.length > 0 && <p className="text-[11px] text-destructive mt-3">Couldn't load: {state.errors.join(', ')}</p>}
    </section>
  );
}
