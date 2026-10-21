import { useState } from 'react';
import { ArrowLeft, MapPin, PenLine, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { calendarColor, type HomeCalendar } from '@/lib/homeCalendars';
import { AddEventDialog, openAssistant, type EditableEvent } from './AddEventButton';
import type { CalEv } from './CalendarMonthDialog';

const isIPhone = /iPhone|iPad/.test(navigator.userAgent);

function mapsUrl(location: string) {
  const q = encodeURIComponent(location);
  return isIPhone ? `https://maps.apple.com/?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
}

const fmtDay = (d: string) => new Date(d.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const fmtTime = (s: string) => { const [h, m] = s.slice(11, 16).split(':').map(Number); return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h >= 12 ? 'pm' : 'am'}`; };

function whenText(e: CalEv) {
  const s = e.start.slice(0, 10);
  const endDay = e.end ? e.end.slice(0, 10) : s;
  if (e.allDay) {
    // All-day end dates are exclusive.
    const last = e.end ? new Date(new Date(endDay + 'T00:00:00').getTime() - 86400000).toISOString().slice(0, 10) : s;
    return last > s ? `${fmtDay(s)} – ${fmtDay(last)} · All day` : `${fmtDay(s)} · All day`;
  }
  const range = endDay > s ? ` – ${fmtDay(endDay)}, ${fmtTime(e.end!)}` : e.end ? ` – ${fmtTime(e.end)}` : '';
  return `${fmtDay(s)}, ${fmtTime(e.start)}${range}`;
}

/** Notes with line breaks preserved and URLs made clickable. */
function Notes({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <p className="text-sm text-foreground whitespace-pre-line break-words">
      {parts.map((p, i) => /^https?:\/\//.test(p)
        ? <a key={i} href={p} target="_blank" rel="noreferrer" className="text-accent underline break-all">{p}</a>
        : <span key={i}>{p}</span>)}
    </p>
  );
}

interface Props {
  event: CalEv | null;
  calendars: HomeCalendar[];
  onClose: () => void;
  /** Rendered inside the month dialog: back arrow returns to the day list. */
  onBack?: () => void;
}

export function EventDetailsView({ event, calendars, onClose, onBack }: Props) {
  const [editing, setEditing] = useState(false);
  const [editSeries, setEditSeries] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [recurringChoice, setRecurringChoice] = useState<'edit' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  if (!event) return null;

  const writable = isCalendarWritable(calendars.find(c => c.id === event.calendarId));
  const canEdit = Boolean(event.eventId) && writable;
  const recurring = Boolean(event.recurringEventId);
  const calName = event.calendar;

  const finish = () => {
    window.dispatchEvent(new Event('keeper-calendar-refresh'));
    setConfirmDelete(false); setRecurringChoice(null); setEditing(false);
    onClose(); // back to the day list (or closes the widget dialog)
  };

  const doDelete = async (series: boolean) => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('modify-calendar-event', {
      body: { action: 'delete', calendar_id: event.calendarId, event_id: series ? event.recurringEventId : event.eventId },
    });
    setBusy(false);
    if (error || !data?.ok) {
      let msg = 'Something went wrong.';
      if (error instanceof FunctionsHttpError) { try { msg = (await error.context.json()).error ?? msg; } catch { /* keep */ } }
      toast.error(`Couldn't delete the event: ${msg}`);
      return;
    }
    toast.success(`Deleted "${event.title}".`);
    finish();
  };

  const tellAi = () => {
    const prefill = `Change '${event.title}' (${whenText(event)}): `;
    openAssistant(prefill, { calendar_id: event.calendarId, event_id: event.eventId!, title: event.title });
  };

  const editable: EditableEvent = {
    eventId: (editSeries && event.recurringEventId) ? event.recurringEventId : event.eventId!,
    calendarId: event.calendarId, title: event.title,
    start: event.start, end: event.end, allDay: event.allDay, location: event.location, description: event.description,
  };

  return (
    <div className="space-y-3">
      {onBack && (
        <Button variant="ghost" size="sm" className="-ml-2 gap-1" onClick={onBack}><ArrowLeft size={16} /> Back</Button>
      )}
      <div>
        <h3 className="font-display text-lg font-semibold text-foreground break-words">{event.title}</h3>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: calendarColor(event.calendarId, calendars) }} />
          {calName}
        </p>
      </div>
      <p className="text-sm text-foreground">{whenText(event)}</p>
      {recurring && <p className="text-xs text-muted-foreground">Repeats — part of a recurring series</p>}
      {event.location && (
        <a href={mapsUrl(event.location)} target="_blank" rel="noreferrer" className="flex items-start gap-1.5 text-sm text-accent underline break-words">
          <MapPin size={14} className="mt-0.5 shrink-0" />{event.location}
        </a>
      )}
      {event.description && <Notes text={event.description} />}
      {canEdit ? (
        <div className="flex gap-2 pt-1">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5"><PenLine size={14} /> Edit</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => (recurring ? setRecurringChoice('edit') : setEditing(true))}>
                <PenLine size={14} className="mr-2" /> Edit manually
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={tellAi}><Sparkles size={14} className="mr-2" /> Tell AI</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/10"
            onClick={() => (recurring ? setRecurringChoice('delete') : setConfirmDelete(true))}>
            <Trash2 size={14} /> Delete
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground pt-1">This event comes from a calendar link, so it can't be edited here.</p>
      )}

      <AddEventDialog open={editing} onOpenChange={setEditing} calendars={calendars} event={editable} onSaved={finish} />

      {/* Recurring: this event or the whole series */}
      <AlertDialog open={recurringChoice !== null} onOpenChange={(o) => !o && setRecurringChoice(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Recurring event</AlertDialogTitle>
            <AlertDialogDescription>Apply to this event only, or all events in the series?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const c = recurringChoice; setRecurringChoice(null); if (c === 'edit') { setEditSeries(false); setEditing(true); } else setConfirmDelete(true); }}>
              This event
            </AlertDialogAction>
            <AlertDialogAction onClick={() => { const c = recurringChoice; setRecurringChoice(null); if (c === 'edit') { setEditSeries(true); setEditing(true); } else { doDelete(true); } }}>
              All events
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Delete "{event.title}" on {fmtDay(event.start)}?</AlertDialogTitle>
            <AlertDialogDescription>This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); doDelete(false); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {busy ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Details opened from the Calendar widget: a dialog (full-screen sheet on phones). */
export function EventDetailsDialog({ event, calendars, onClose }: { event: CalEv | null; calendars: HomeCalendar[]; onClose: () => void }) {
  return (
    <Dialog open={!!event} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[85dvh] overflow-y-auto">
        <DialogTitle className="sr-only">Event details</DialogTitle>
        <EventDetailsView event={event} calendars={calendars} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}
