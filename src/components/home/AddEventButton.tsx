import { useEffect, useState, type ReactNode } from 'react';
import { Plus, PenLine, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { calendarColor, type HomeCalendar } from '@/lib/homeCalendars';

export interface AssistantEventContext { calendar_id: string; event_id: string; title: string }

/** Open the Keeper assistant from anywhere, optionally prefilled with hidden event context. */
export function openAssistant(prefill?: string, eventContext?: AssistantEventContext) {
  window.dispatchEvent(new CustomEvent('keeper-open-assistant', { detail: { prefill, eventContext } }));
}

const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const plusHour = (t: string) => { const [h, m] = t.split(':').map(Number); const n = Math.min(h + 1, 23); return `${String(n).padStart(2, '0')}:${String(h + 1 > 23 ? 59 : m).padStart(2, '0')}`; };

export function dayPrefix(date: string) {
  return `On ${new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}: `;
}

export function AddEventMenu({ calendars, date, onManual, trigger, aiPrefill, label = 'Add event' }: { calendars?: HomeCalendar[]; date?: string | null; onManual: () => void; trigger?: ReactNode; aiPrefill?: string; label?: string }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        {trigger ?? <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={label}><Plus size={18} /></Button>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onManual}><PenLine size={14} className="mr-2" /> Add manually</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openAssistant(aiPrefill ?? (date ? dayPrefix(date) : undefined))}>
          <Sparkles size={14} className="mr-2" /> Describe to AI
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface EditableEvent {
  eventId: string;
  calendarId: string;
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  location: string | null;
  description?: string | null;
}

export function AddEventDialog({ open, onOpenChange, calendars, date, event }: { open: boolean; onOpenChange: (o: boolean) => void; calendars: HomeCalendar[]; date?: string | null; event?: EditableEvent | null }) {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [calendarId, setCalendarId] = useState('');
  const [day, setDay] = useState(localDate());
  const [allDay, setAllDay] = useState(false);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('10:00');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (event) {
      setTitle(event.title); setLocation(event.location ?? ''); setNotes(event.description ?? '');
      setAllDay(event.allDay); setDay(event.start.slice(0, 10));
      setStart(event.allDay ? '09:00' : event.start.slice(11, 16));
      setEnd(event.allDay ? '10:00' : (event.end && !event.end.slice(0, 10) > event.start.slice(0, 10) ? event.end.slice(11, 16) : plusHour(event.start.slice(11, 16) || '09:00')));
      setCalendarId(event.calendarId);
      return;
    }
    setTitle(''); setLocation(''); setNotes(''); setAllDay(false); setStart('09:00'); setEnd('10:00');
    setDay(date ?? localDate());
    setCalendarId((calendars.find(c => c.owner_user_id === user?.id) ?? calendars.find(c => !c.owner_user_id) ?? calendars[0])?.id ?? '');
  }, [open, date, calendars, user?.id, event]);

  const fail = async (error: unknown, data: { error?: string } | null, verb: string) => {
    let msg = 'Something went wrong.';
    if (error instanceof FunctionsHttpError) { try { msg = (await error.context.json()).error ?? msg; } catch { /* keep */ } }
    else if (data?.error) msg = data.error;
    toast.error(`Couldn't ${verb} the event: ${msg}`);
  };

  const save = async () => {
    if (!title.trim() || !calendarId || !day) return;
    if (!allDay && end <= start) { toast.error('End time must be after the start time.'); return; }
    setSaving(true);
    const payload = { title: title.trim(), start: allDay ? day : `${day}T${start}`, end: allDay ? day : `${day}T${end}`, all_day: allDay, location: location.trim() || null, notes: notes.trim() || null };
    if (event) {
      if (calendarId !== event.calendarId) {
        // Move: create on the new calendar, then delete from the old one.
        const { data: cData, error: cErr } = await supabase.functions.invoke('create-calendar-event', { body: { calendar_id: calendarId, ...payload } });
        if (cErr || !cData?.ok) { setSaving(false); await fail(cErr, cData, 'move'); return; }
        await supabase.functions.invoke('modify-calendar-event', { body: { action: 'delete', calendar_id: event.calendarId, event_id: event.eventId } });
        toast.success(`Moved "${payload.title}" to ${cData.calendar}.`);
      } else {
        const { data, error } = await supabase.functions.invoke('modify-calendar-event', {
          body: { action: 'update', calendar_id: calendarId, event_id: event.eventId, changes: payload },
        });
        if (error || !data?.ok) { setSaving(false); await fail(error, data, 'save'); return; }
        toast.success(`Updated "${payload.title}".`);
      }
    } else {
      const { data, error } = await supabase.functions.invoke('create-calendar-event', { body: { calendar_id: calendarId, ...payload } });
      if (error || !data?.ok) { setSaving(false); await fail(error, data, 'add'); return; }
      toast.success(`Added "${payload.title}" to ${data.calendar}.`);
    }
    setSaving(false);
    window.dispatchEvent(new Event('keeper-calendar-refresh'));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display">{event ? 'Edit event' : 'New event'}</DialogTitle></DialogHeader>
        <form className="space-y-3" onSubmit={e => { e.preventDefault(); save(); }}>
          <input aria-label="Title" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} className="auth-input text-base sm:text-sm" maxLength={200} autoFocus />
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Calendar">
            {calendars.map(c => (
              <Button key={c.id} type="button" size="sm" role="radio" aria-checked={calendarId === c.id} variant={calendarId === c.id ? 'secondary' : 'ghost'}
                onClick={() => setCalendarId(c.id)} className={`h-7 gap-1.5 rounded-full px-2.5 text-xs border ${calendarId === c.id ? 'border-primary/30' : 'border-border text-muted-foreground'}`}>
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: calendarColor(c.id, calendars) }} />{c.label}
              </Button>
            ))}
          </div>
          <input type="date" aria-label="Date" value={day} onChange={e => setDay(e.target.value)} className="auth-input text-base sm:text-sm" />
          <label className="flex items-center justify-between text-sm text-foreground">All day <Switch checked={allDay} onCheckedChange={setAllDay} /></label>
          {!allDay && (
            <div className="flex gap-2">
              <label className="flex-1 text-xs text-muted-foreground">Start
                <input type="time" value={start} onChange={e => { setStart(e.target.value); if (e.target.value) setEnd(plusHour(e.target.value)); }} className="auth-input mt-1 text-base sm:text-sm" />
              </label>
              <label className="flex-1 text-xs text-muted-foreground">End
                <input type="time" value={end} onChange={e => setEnd(e.target.value)} className="auth-input mt-1 text-base sm:text-sm" />
              </label>
            </div>
          )}
          <input aria-label="Location" placeholder="Location (optional)" value={location} onChange={e => setLocation(e.target.value)} className="auth-input text-base sm:text-sm" maxLength={300} />
          <textarea aria-label="Notes" placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} className="auth-input text-base sm:text-sm min-h-[70px]" maxLength={2000} />
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving || !title.trim() || !calendarId} className="bg-accent text-accent-foreground hover:bg-accent/90">{saving ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
