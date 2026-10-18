import { useEffect, useRef, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { HomeListItem, HomeListPatch } from '@/hooks/useHomeList';
import { TodoOwner } from '@/hooks/useTodoOwners';
import { Bell, Repeat } from 'lucide-react';
import { DAY_NAMES, PRESETS, Recurrence, RepeatPreset, describeRecurrence, fromPreset, presetOf } from '@/lib/recurrence';
import { ReminderRule } from '@/hooks/useTodoReminders';

interface Props {
  item: HomeListItem | null;
  kind: 'todo' | 'store';
  owners?: TodoOwner[];
  onClose: () => void;
  onSave: (id: string, patch: HomeListPatch) => void;
  onDelete: (id: string) => void;
  /** The current user's reminder on this to do, if any. */
  reminder?: ReminderRule | null;
  /** Save or clear the current user's reminder. */
  onSaveReminder?: (rule: ReminderRule | null, due: { date: string; time: string | null }, customAt?: string) => void;
  /** When set and item.id === 'new', the sheet creates instead of edits. */
  onCreate?: (text: string, opts: { owner: string | null; due_date: string | null; due_time: string | null; notes: string | null; recurrence: Recurrence | null; reminder?: ReminderRule | null; reminderCustomAt?: string }) => void;
}

export function ListItemEditSheet({ item, kind, owners = [], onClose, onSave, onDelete, reminder = null, onSaveReminder, onCreate }: Props) {
  const [text, setText] = useState('');
  const [owner, setOwner] = useState('family');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [notes, setNotes] = useState('');
  const [done, setDone] = useState(false);
  const [preset, setPreset] = useState<RepeatPreset>('never');
  const [from, setFrom] = useState<Recurrence['from']>('due');
  const [days, setDays] = useState<number[]>([]);
  const [customN, setCustomN] = useState(1);
  const [customUnit, setCustomUnit] = useState<'day' | 'week' | 'month'>('week');
  const [remind, setRemind] = useState(false);
  const [needsTime, setNeedsTime] = useState(false);
  const timeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!item) return;
    setText(item.text); setOwner(item.user_id ?? 'family');
    setDate(item.due_date ?? ''); setTime(item.due_time?.slice(0, 5) ?? '');
    setNotes(item.notes ?? ''); setDone(item.completed);
    const r = item.recurrence ?? null;
    setPreset(presetOf(r)); setFrom(r?.from ?? 'due'); setDays(r?.days ?? []);
    setCustomN(r?.interval ?? 1); setCustomUnit(r && (r.unit === 'day' || r.unit === 'week' || r.unit === 'month') ? r.unit : 'week');
    setRemind(!!reminder && !!item.due_time);
    setNeedsTime(false);
  }, [item, reminder]);

  const isNew = item?.id === 'new';
  const dueDow = date ? new Date(date + 'T00:00:00').getDay() : 0;
  const rule = date ? fromPreset(preset, from, preset === 'weekly' ? (days.length ? days : [dueDow]) : [], { n: customN, unit: customUnit }) : null;
  const toggleDay = (d: number) => setDays(cur => { const base = cur.length ? cur : [dueDow]; const nx = base.includes(d) ? base.filter(x => x !== d) : [...base, d]; return nx.length ? nx : base; });
  const reminderRule: ReminderRule | null = date && time && remind ? { kind: 'at' } : null;
  const save = () => {
    if (!item || !text.trim()) return;
    if (isNew) {
      onCreate?.(text, { owner: owner === 'family' ? null : owner, due_date: date || null, due_time: date && time ? time : null, notes: notes.trim() || null, recurrence: rule, reminder: reminderRule });
      onClose();
      return;
    }
    const patch: HomeListPatch = { text };
    if (kind === 'todo') Object.assign(patch, {
      user_id: owner === 'family' ? null : owner,
      due_date: date || null, due_time: date && time ? time : null,
      notes: notes.trim().slice(0, 2000) || null, completed: done, recurrence: rule,
    });
    onSave(item.id, patch);
    if (date) onSaveReminder?.(reminderRule, { date, time: time || null });
    else if (reminder) onSaveReminder?.(null, { date: '', time: null });
    onClose();
  };

  return (
    <Sheet open={!!item} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] overflow-y-auto lg:max-w-lg lg:mx-auto">
        <SheetHeader><SheetTitle className="font-display">{isNew ? 'New to do' : kind === 'todo' ? 'Edit to do' : 'Edit item'}</SheetTitle></SheetHeader>
        <div className="mt-4 space-y-3">
          <input aria-label="Text" placeholder={isNew ? "To do" : undefined} autoFocus={isNew} value={text} onChange={e => setText(e.target.value)} maxLength={300} className="auth-input" />
          {kind === 'todo' && (
            <>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Owner">
                {owners.map(o => (
                  <Button key={o.key} type="button" size="sm" variant={owner === o.key ? 'secondary' : 'ghost'} role="radio" aria-checked={owner === o.key}
                    onClick={() => setOwner(o.key)} className={`h-8 gap-1.5 rounded-full px-3 text-xs border ${owner === o.key ? 'border-primary/30' : 'border-border text-muted-foreground'}`}>
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: o.color }} />{o.label}
                  </Button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input aria-label="Due date" type="date" value={date} onChange={e => setDate(e.target.value)} className="auth-input flex-1" />
                <input ref={timeInput} aria-label="Due time" aria-invalid={needsTime} type="time" value={time} disabled={!date} onChange={e => { setTime(e.target.value); if (!e.target.value) setRemind(false); else setNeedsTime(false); }} className={`auth-input w-32 ${needsTime ? 'ring-2 ring-destructive' : ''}`} />
                {(date || time) && <Button type="button" variant="ghost" size="sm" onClick={() => { setDate(''); setTime(''); setRemind(false); setNeedsTime(false); }}>Clear</Button>}
              </div>
              {date && (
                <div className="space-y-2 rounded-xl border border-border p-3">
                  <div className="flex items-center gap-2">
                    <Repeat className="h-4 w-4 text-muted-foreground" />
                    <select aria-label="Repeat" value={preset} onChange={e => setPreset(e.target.value as RepeatPreset)} className="auth-input flex-1">
                      {PRESETS.map(p => <option key={p.id} value={p.id}>{p.id === 'never' ? 'Does not repeat' : p.label}</option>)}
                    </select>
                  </div>
                  {preset === 'weekly' && (
                    <div className="flex gap-1" aria-label="Repeat on days">
                      {DAY_NAMES.map((n, d) => {
                        const on = (days.length ? days : [dueDow]).includes(d);
                        return <button key={d} type="button" aria-pressed={on} onClick={() => toggleDay(d)}
                          className={`h-8 w-8 rounded-full text-xs font-medium border ${on ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground'}`}>{n[0]}</button>;
                      })}
                    </div>
                  )}
                  {preset === 'custom' && (
                    <div className="flex items-center gap-2 text-sm">
                      <span>Every</span>
                      <input aria-label="Repeat every" type="number" min={1} max={365} value={customN} onChange={e => setCustomN(Number(e.target.value))} className="auth-input w-20" />
                      <select aria-label="Repeat unit" value={customUnit} onChange={e => setCustomUnit(e.target.value as 'day' | 'week' | 'month')} className="auth-input flex-1">
                        <option value="day">days</option><option value="week">weeks</option><option value="month">months</option>
                      </select>
                    </div>
                  )}
                  {preset !== 'never' && (
                    <>
                      <div className="flex gap-1.5" role="radiogroup" aria-label="Repeat from">
                        {(['due', 'completion'] as const).map(f => (
                          <Button key={f} type="button" size="sm" role="radio" aria-checked={from === f} variant={from === f ? 'secondary' : 'ghost'} onClick={() => setFrom(f)}
                            className={`h-8 rounded-full px-3 text-xs border ${from === f ? 'border-primary/30' : 'border-border text-muted-foreground'}`}>
                            From {f === 'due' ? 'due date' : 'completion date'}
                          </Button>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">{describeRecurrence(rule, date)}</p>
                    </>
                  )}
                </div>
              )}
              {date && (
                <div className="space-y-2 rounded-xl border border-border p-3">
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4 text-muted-foreground" />
                    <label htmlFor="remind-me" className="flex-1 text-sm">Remind me</label>
                    <Switch id="remind-me" checked={remind} onCheckedChange={on => { if (on && !time) { setNeedsTime(true); timeInput.current?.focus(); return; } setRemind(on); setNeedsTime(false); }} />
                  </div>
                  {needsTime && <p role="alert" className="text-xs text-destructive">Set a time to get a reminder</p>}
                  {remind && typeof Notification !== 'undefined' && Notification.permission !== 'granted' && (
                    <p className="text-xs text-muted-foreground">Reminders arrive as notifications — turn them on in More → Notifications.</p>
                  )}
                </div>
              )}
              <textarea aria-label="Notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes" maxLength={2000} rows={3} className="auth-input min-h-[80px]" />
              {!isNew && <label className="flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" checked={done} onChange={e => setDone(e.target.checked)} className="h-4 w-4 accent-[hsl(var(--accent))]" /> Done
              </label>}
            </>
          )}
          <Button onClick={save} disabled={!text.trim()} className="w-full bg-accent text-accent-foreground hover:bg-accent/90">Save</Button>
          {isNew
            ? <Button variant="ghost" onClick={onClose} className="w-full">Cancel</Button>
            : <Button variant="ghost" onClick={() => { if (item) onDelete(item.id); }} className="w-full text-destructive hover:text-destructive">Delete</Button>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
