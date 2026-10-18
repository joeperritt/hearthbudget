import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Check, Clock, CalendarClock } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { HomeListItem } from '@/hooks/useHomeList';
import { ReminderAction, reminderActionToast } from '@/lib/todoReminderActions';

interface Props {
  item: HomeListItem | null;
  automaticAction: ReminderAction | null;
  ready: boolean;
  canSnooze: boolean;
  onDone: (id: string) => Promise<boolean>;
  onSnooze: (id: string, action: 'hour' | 'tomorrow') => Promise<string | null>;
  onClose: () => void;
  onOpen: (item: HomeListItem) => void;
}

export function ReminderSheet({ item, automaticAction, ready, canSnooze, onDone, onSnooze, onClose, onOpen }: Props) {
  const [busy, setBusy] = useState(false);
  const handled = useRef(false);
  const run = useCallback(async (action: ReminderAction) => {
    if (!item || busy) return;
    setBusy(true);
    try {
      if (action === 'done') {
        if (!await onDone(item.id)) return;
        toast.success(reminderActionToast(action));
      } else {
        const at = await onSnooze(item.id, action);
        if (!at) return;
        toast.success(reminderActionToast(action, at));
      }
      onClose();
    } finally { setBusy(false); }
  }, [item, busy, onDone, onSnooze, onClose]);

  useEffect(() => {
    if (!item) { handled.current = false; return; }
    if (!ready || !automaticAction || handled.current) return;
    handled.current = true;
    if (automaticAction !== 'done' && !canSnooze) { toast.error('This reminder is no longer available.'); return; }
    void run(automaticAction);
  }, [item, ready, automaticAction, canSnooze, run]);

  const due = item?.due_date ? new Date(`${item.due_date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
  const time = item?.due_time ? new Date(`2000-01-01T${item.due_time}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
  return <Sheet open={!!item} onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <SheetContent side="bottom" className="rounded-t-2xl lg:max-w-md lg:mx-auto">
      <SheetHeader><SheetTitle className="font-display">Reminder</SheetTitle></SheetHeader>
      <div className="mt-4 space-y-3">
        <p className="text-lg font-medium break-words">{item?.text}</p>
        <p className="text-sm text-muted-foreground">{[due, time].filter(Boolean).join(' · ')} · Eastern</p>
        <Button className="w-full h-12 gap-2" disabled={busy || item?.completed} onClick={() => void run('done')}><Check className="h-5 w-5" />{item?.completed ? 'Already done' : 'Done'}</Button>
        <Button variant="outline" className="w-full h-12 gap-2" disabled={busy || !ready || !canSnooze || item?.completed} onClick={() => void run('hour')}><Clock className="h-5 w-5" />Remind me in 1 hour</Button>
        <Button variant="outline" className="w-full h-12 gap-2" disabled={busy || !ready || !canSnooze || item?.completed} onClick={() => void run('tomorrow')}><CalendarClock className="h-5 w-5" />Remind me tomorrow</Button>
        <Button variant="link" size="sm" className="w-full" disabled={busy} onClick={() => { if (item) onOpen(item); }}>Open to do</Button>
      </div>
    </SheetContent>
  </Sheet>;
}