import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AddEventDialog, AddEventMenu } from './AddEventButton';
import { EventDetailsView } from './EventDetails';
import { calendarColor, type HomeCalendar } from '@/lib/homeCalendars';

export interface CalEv { title: string; start: string; end: string | null; allDay: boolean; location: string | null; calendar: string; calendarId: string; eventId?: string; recurringEventId?: string | null; description?: string | null }

export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (s: string, n: number) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return ymd(d); };

/** Does the event cover calendar day `day`? All-day end dates are exclusive. */
export function onDay(e: CalEv, day: string) {
  const s = e.start.slice(0, 10);
  if (s > day) return false;
  if (!e.end) return s === day;
  const end = e.end.slice(0, 10);
  return e.allDay ? end > day || s === day : end >= day;
}

export function timeText(e: CalEv) {
  if (e.allDay) return 'All day';
  const [h, m] = e.start.slice(11, 16).split(':').map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h >= 12 ? 'pm' : 'am'}`;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  today: string;
  calendars: HomeCalendar[];
  isVisible: (c: HomeCalendar) => boolean;
  toggle: (c: HomeCalendar) => void;
  saving: string[];
}

const MAX_PER_CELL = 3;

export function CalendarMonthDialog({ open, onOpenChange, today, calendars, isVisible, toggle, saving }: Props) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState<string | null>(null);
  const [events, setEvents] = useState<CalEv[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [detail, setDetail] = useState<CalEv | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    const bump = () => setRefreshKey(k => k + 1);
    window.addEventListener('keeper-calendar-refresh', bump);
    return () => window.removeEventListener('keeper-calendar-refresh', bump);
  }, []);

  useEffect(() => { if (open) { setMonth(today.slice(0, 7)); setSelected(null); setDetail(null); } }, [open, today]);

  const days = useMemo(() => {
    const first = new Date(month + '-01T00:00:00');
    const start = new Date(first); start.setDate(1 - first.getDay());
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    const end = new Date(last); end.setDate(last.getDate() + (6 - last.getDay()));
    const out: string[] = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) out.push(ymd(d));
    return out;
  }, [month]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setEvents(null); setFailed(false);
    supabase.functions.invoke('calendar-events', { body: { from: days[0], to: days[days.length - 1] } }).then(({ data, error }) => {
      if (!alive) return;
      if (error || !data) { setFailed(true); return; }
      setEvents(data.events ?? []);
    });
    return () => { alive = false; };
  }, [open, days, refreshKey]);

  const visibleIds = new Set(calendars.filter(isVisible).map(c => c.id));
  const shown = (events ?? []).filter(e => visibleIds.has(e.calendarId));
  const forDay = (d: string) => shown.filter(e => onDay(e, d)).sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start));

  const shiftMonth = (n: number) => {
    const d = new Date(month + '-01T00:00:00'); d.setMonth(d.getMonth() + n);
    setMonth(ymd(d).slice(0, 7)); setSelected(null);
  };
  const monthLabel = new Date(month + '-01T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const dot = (id: string) => calendarColor(id, calendars);

  const dayList = selected && (
    detail ? (
      <EventDetailsView event={detail} calendars={calendars} onBack={() => setDetail(null)} onClose={() => setDetail(null)} />
    ) : (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="font-display text-base font-semibold text-foreground">
          {new Date(selected + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        <AddEventMenu calendars={calendars} date={selected} onManual={() => setAdding(true)}
          trigger={<Button variant="link" size="sm" className="h-auto p-0 text-xs text-accent">+ Add</Button>} />
      </div>
      {forDay(selected).length ? (
        <ul className="space-y-2">
          {forDay(selected).map((e, i) => (
            <li key={i}>
              <button type="button" onClick={() => setDetail(e)} className="flex gap-3 text-sm w-full text-left rounded-lg px-1 -mx-1 py-0.5 hover:bg-muted/50">
                <span className="w-14 shrink-0 text-xs text-muted-foreground pt-0.5">{timeText(e)}</span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-baseline gap-1.5">
                    <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: dot(e.calendarId) }} />
                    <span className="text-foreground break-words">{e.title}</span>
                  </span>
                  {e.location && <span className="block text-xs text-muted-foreground truncate">{e.location}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-muted-foreground">No events.</p>}
    </div>
    )
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col gap-3 p-4 w-screen max-w-none h-[100dvh] rounded-none sm:rounded-2xl sm:w-[95vw] sm:max-w-5xl sm:h-[90dvh] overflow-hidden pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4">
        <DialogTitle className="sr-only">Calendar month view</DialogTitle>
        <div className="flex items-center gap-2 pr-8 pt-[env(safe-area-inset-top,0px)]">
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Previous month" onClick={() => shiftMonth(-1)}><ChevronLeft size={18} /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Next month" onClick={() => shiftMonth(1)}><ChevronRight size={18} /></Button>
          <h2 className="font-display text-lg font-semibold text-foreground flex-1">{monthLabel}</h2>
          <Button variant="outline" size="sm" className="h-8" onClick={() => { setMonth(today.slice(0, 7)); setSelected(today); }}>Today</Button>
          <AddEventMenu calendars={calendars} date={selected} onManual={() => setAdding(true)} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {calendars.map(c => (
            <Button key={c.id} size="sm" variant={isVisible(c) ? 'secondary' : 'ghost'} aria-pressed={isVisible(c)} disabled={saving.includes(c.id)} onClick={() => toggle(c)}
              className={`h-7 gap-1.5 rounded-full px-2.5 text-xs border ${isVisible(c) ? 'border-primary/20 text-foreground' : 'border-border text-muted-foreground opacity-60'}`}>
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: dot(c.id) }} />{c.label}
            </Button>
          ))}
          {!events && !failed && <span className="text-xs text-muted-foreground self-center ml-1">Loading…</span>}
          {failed && <span className="text-xs text-destructive self-center ml-1">Couldn't load this month.</span>}
        </div>

        {/* Mobile: selected day replaces the grid with a back arrow */}
        {selected && (
          <div className="sm:hidden flex-1 overflow-y-auto">
            <Button variant="ghost" size="sm" className="-ml-2 mb-2 gap-1" onClick={() => setSelected(null)}><ArrowLeft size={16} /> {monthLabel}</Button>
            {dayList}
          </div>
        )}

        <div className={`flex-1 min-h-0 gap-4 ${selected ? 'hidden sm:flex' : 'flex'}`}>
          <div className="flex-1 min-w-0 flex flex-col border border-border rounded-xl overflow-hidden">
            <div className="grid grid-cols-7 border-b border-border bg-muted/40">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d} className="py-1 text-center text-[11px] font-semibold uppercase text-muted-foreground">{d}</div>)}
            </div>
            <div className="grid grid-cols-7 flex-1" style={{ gridTemplateRows: `repeat(${days.length / 7}, minmax(0, 1fr))` }}>
              {days.map(d => {
                const list = forDay(d);
                const inMonth = d.slice(0, 7) === month;
                return (
                  <button key={d} type="button" onClick={() => setSelected(d)} aria-label={d}
                    className={`min-h-0 overflow-hidden border-b border-r border-border p-0.5 sm:p-1 text-left flex flex-col gap-0.5 hover:bg-muted/40 ${inMonth ? '' : 'bg-muted/20'} ${selected === d ? 'ring-2 ring-inset ring-accent' : ''}`}>
                    <span className={`self-center sm:self-start text-[11px] sm:text-xs w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center rounded-full ${d === today ? 'bg-primary text-primary-foreground font-semibold' : inMonth ? 'text-foreground' : 'text-muted-foreground/60'}`}>
                      {Number(d.slice(8))}
                    </span>
                    {list.slice(0, MAX_PER_CELL).map((e, i) => {
                      const bar = e.allDay || (e.end && e.end.slice(0, 10) > e.start.slice(0, 10));
                      return bar ? (
                        <span key={i} className="block truncate rounded-sm px-1 text-[10px] leading-4 text-primary-foreground" style={{ backgroundColor: dot(e.calendarId) }}>{e.title}</span>
                      ) : (
                        <span key={i} className="flex items-center gap-1 min-w-0 text-[10px] leading-4 text-foreground">
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: dot(e.calendarId) }} />
                          <span className="hidden sm:inline text-muted-foreground shrink-0">{timeText(e)}</span>
                          <span className="truncate">{e.title}</span>
                        </span>
                      );
                    })}
                    {list.length > MAX_PER_CELL && <span className="text-[10px] leading-4 text-muted-foreground px-1">+{list.length - MAX_PER_CELL} more</span>}
                  </button>
                );
              })}
            </div>
          </div>
          {selected && <aside className="hidden sm:block w-72 shrink-0 overflow-y-auto">{dayList}</aside>}
        </div>
        <AddEventDialog open={adding} onOpenChange={setAdding} calendars={calendars} date={selected} />
      </DialogContent>
    </Dialog>
  );
}
