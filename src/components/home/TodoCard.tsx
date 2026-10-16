import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useHomeList, HomeListItem } from '@/hooks/useHomeList';
import { useTodoOwners } from '@/hooks/useTodoOwners';
import { ListItemEditSheet } from './ListItemEditSheet';
import { ListRow } from './HomeListCard';
import { AddEventMenu } from './AddEventButton';

function nyToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function plusDays(d: string, n: number) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
function fmtDate(d: string) { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); }
function fmtTime(t: string | null) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h >= 12 ? 'pm' : 'am'}`;
}
const byDue = (a: HomeListItem, b: HomeListItem) => (a.due_date! + (a.due_time ?? '99')).localeCompare(b.due_date! + (b.due_time ?? '99'));

export function TodoCard() {
  const { user } = useAuth();
  const { items, loading, add, update, toggle, remove, clearCompleted } = useHomeList('todo');
  const { owners, isVisible, toggle: toggleOwner, ownerOf, keyOf } = useTodoOwners();
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<HomeListItem | null>(null);

  const startNew = () => setEditing({ id: 'new', text: '', completed: false, created_at: '', completed_at: null, user_id: user?.id ?? null, due_date: null, due_time: null, notes: null } as HomeListItem);

  const visible = items.filter(i => isVisible(keyOf(i.user_id)));
  const open = visible.filter(i => !i.completed);
  const done = visible.filter(i => i.completed);
  const today = nyToday();
  const tomorrow = plusDays(today, 1);
  const groups: { label: string; danger?: boolean; items: HomeListItem[] }[] = [];
  const overdue = open.filter(i => i.due_date && i.due_date < today).sort(byDue);
  if (overdue.length) groups.push({ label: 'Overdue', danger: true, items: overdue });
  const dated = open.filter(i => i.due_date && i.due_date >= today).sort(byDue);
  for (const i of dated) {
    const label = i.due_date === today ? 'Today' : i.due_date === tomorrow ? 'Tomorrow' : fmtDate(i.due_date!);
    const g = groups.find(x => x.label === label);
    if (g) g.items.push(i); else groups.push({ label, items: [i] });
  }
  const undated = open.filter(i => !i.due_date);
  if (undated.length) groups.push({ label: 'No date', items: undated });

  const row = (i: HomeListItem, showDate = false) => (
    <ListRow key={i.id} item={i} onToggle={() => toggle(i)} onDelete={() => remove(i.id)} onEdit={() => setEditing(i)}
      dot={ownerOf(i.user_id)?.color}
      meta={[showDate && i.due_date ? fmtDate(i.due_date) : '', fmtTime(i.due_time)].filter(Boolean).join(' · ') || undefined} />
  );

  return (
    <section className="bg-card rounded-2xl border border-border p-4 shadow-sm lg:h-full lg:flex lg:flex-col lg:min-h-0">
      <div className="mb-3 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-foreground flex-1">To Do</h2>
          {done.length > 0 && <button onClick={clearCompleted} className="text-xs text-muted-foreground active:text-foreground mr-1">Clear completed</button>}
          <AddEventMenu calendars={[]} onManual={startNew} aiPrefill="Add a to do: " label="Add to do" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {owners.map(o => (
            <Button key={o.key} size="sm" variant={isVisible(o.key) ? 'secondary' : 'ghost'} aria-pressed={isVisible(o.key)} aria-label={`${o.label} to dos`}
              onClick={() => toggleOwner(o.key)}
              className={`h-7 gap-1.5 rounded-full px-2.5 text-xs border ${isVisible(o.key) ? 'border-primary/20 text-foreground' : 'border-border text-muted-foreground opacity-60'}`}>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: o.color }} />{o.label}
            </Button>
          ))}
        </div>
      </div>
      {loading ? <p className="text-xs text-muted-foreground py-2">Loading…</p> : (
        <div className="space-y-3 lg:flex-1 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
          {groups.map(g => (
            <div key={g.label}>
              <p className={`text-[11px] font-semibold uppercase tracking-wide mb-0.5 ${g.danger ? 'text-destructive' : 'text-muted-foreground'}`}>{g.label}</p>
              <ul className="divide-y divide-border">{g.items.map(i => row(i, g.danger))}</ul>
            </div>
          ))}
          {!groups.length && <p className="text-xs text-muted-foreground py-2">Nothing to do. Nice.</p>}
          {done.length > 0 && (
            <div>
              <button onClick={() => setShowDone(s => !s)} className="text-xs text-muted-foreground">{showDone ? 'Hide' : 'Show'} completed ({done.length})</button>
              {showDone && <ul className="divide-y divide-border mt-1">{done.map(i => row(i, true))}</ul>}
            </div>
          )}
        </div>
      )}
      <ListItemEditSheet item={editing} kind="todo" owners={owners} onClose={() => setEditing(null)} onSave={update} onDelete={remove} onCreate={(text, o) => add(text, o)} />
    </section>
  );
}
