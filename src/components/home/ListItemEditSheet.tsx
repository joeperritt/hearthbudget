import { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { HomeListItem, HomeListPatch } from '@/hooks/useHomeList';
import { TodoOwner } from '@/hooks/useTodoOwners';

interface Props {
  item: HomeListItem | null;
  kind: 'todo' | 'store';
  owners?: TodoOwner[];
  onClose: () => void;
  onSave: (id: string, patch: HomeListPatch) => void;
  onDelete: (id: string) => void;
  /** When set and item.id === 'new', the sheet creates instead of edits. */
  onCreate?: (text: string, opts: { owner: string | null; due_date: string | null; due_time: string | null; notes: string | null }) => void;
}

export function ListItemEditSheet({ item, kind, owners = [], onClose, onSave, onDelete, onCreate }: Props) {
  const [text, setText] = useState('');
  const [owner, setOwner] = useState('family');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [notes, setNotes] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!item) return;
    setText(item.text); setOwner(item.user_id ?? 'family');
    setDate(item.due_date ?? ''); setTime(item.due_time?.slice(0, 5) ?? '');
    setNotes(item.notes ?? ''); setDone(item.completed);
  }, [item]);

  const isNew = item?.id === 'new';
  const save = () => {
    if (!item || !text.trim()) return;
    if (isNew) {
      onCreate?.(text, { owner: owner === 'family' ? null : owner, due_date: date || null, due_time: date && time ? time : null, notes: notes.trim() || null });
      onClose();
      return;
    }
    const patch: HomeListPatch = { text };
    if (kind === 'todo') Object.assign(patch, {
      user_id: owner === 'family' ? null : owner,
      due_date: date || null, due_time: date && time ? time : null,
      notes: notes.trim().slice(0, 2000) || null, completed: done,
    });
    onSave(item.id, patch);
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
                <input aria-label="Due time" type="time" value={time} disabled={!date} onChange={e => setTime(e.target.value)} className="auth-input w-32" />
                {(date || time) && <Button type="button" variant="ghost" size="sm" onClick={() => { setDate(''); setTime(''); }}>Clear</Button>}
              </div>
              <textarea aria-label="Notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes" maxLength={2000} rows={3} className="auth-input min-h-[80px]" />
              {!isNew && <label className="flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" checked={done} onChange={e => setDone(e.target.checked)} className="h-4 w-4 accent-[hsl(var(--accent))]" /> Done
              </label>}
            </>
          )}
          <Button onClick={save} disabled={!text.trim()} className="w-full bg-accent text-accent-foreground hover:bg-accent/90">Save</Button>
          {isNew
            ? <Button variant="ghost" onClick={onClose} className="w-full">Cancel</Button>
            : <Button variant="ghost" onClick={() => { if (item) onDelete(item.id); onClose(); }} className="w-full text-destructive hover:text-destructive">Delete</Button>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
