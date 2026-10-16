import { useRef, useState, KeyboardEvent, TouchEvent, ReactNode } from 'react';
import { Check, X, Plus, Repeat } from 'lucide-react';
import { HomeListItem } from '@/hooks/useHomeList';
import { ListItemEditSheet } from './ListItemEditSheet';
import { useHomeData } from './HomeDataContext';

/** Store List: shared household list. */
export function HomeListCard() {
  const { store: { items, loading, add, update, toggle, remove, clearCompleted } } = useHomeData();
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<HomeListItem | null>(null);
  const open = items.filter(i => !i.completed);
  const done = items.filter(i => i.completed);
  const submit = () => { add(draft); setDraft(''); };

  return (
    <section className="bg-card rounded-2xl border border-border p-4 shadow-sm lg:h-full lg:flex lg:flex-col lg:min-h-0">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-lg font-semibold text-foreground">Store List</h2>
        {done.length > 0 && <button onClick={clearCompleted} className="text-xs text-muted-foreground active:text-foreground">Clear completed</button>}
      </div>
      <QuickAdd value={draft} onChange={setDraft} onSubmit={submit} placeholder="Add something we need" />
      {loading ? <p className="text-xs text-muted-foreground py-2">Loading…</p>
        : items.length === 0 ? <p className="text-xs text-muted-foreground py-2">Nothing here yet.</p>
        : (
          <ul className="divide-y divide-border lg:flex-1 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
            {[...open, ...done].map(item => (
              <ListRow key={item.id} item={item} onToggle={() => toggle(item)} onDelete={() => remove(item.id)} onEdit={() => setEditing(item)} />
            ))}
          </ul>
        )}
      <ListItemEditSheet item={editing} kind="store" onClose={() => setEditing(null)} onSave={update} onDelete={id => { remove(id); setEditing(null); }} />
    </section>
  );
}

export function QuickAdd({ value, onChange, onSubmit, placeholder, children }: { value: string; onChange: (v: string) => void; onSubmit: () => void; placeholder: string; children?: ReactNode }) {
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); onSubmit(); } };
  return (
    <div className="flex items-center gap-2 mb-2">
      <input aria-label={placeholder} value={value} onChange={e => onChange(e.target.value)} onKeyDown={onKey} placeholder={placeholder} maxLength={300} enterKeyHint="done" className="auth-input flex-1 min-w-0" />
      {children}
      <button aria-label="Add" onClick={onSubmit} className="w-10 h-10 rounded-lg bg-primary text-primary-foreground flex items-center justify-center active:scale-95 shrink-0">
        <Plus size={18} />
      </button>
    </div>
  );
}

export function ListRow({ item, onToggle, onDelete, onEdit, dot, meta, repeat }: { item: HomeListItem; onToggle: () => void; onDelete: () => void; onEdit: () => void; dot?: string; meta?: string; repeat?: boolean }) {
  const startX = useRef<number | null>(null);
  const [dx, setDx] = useState(0);
  const onStart = (e: TouchEvent) => { startX.current = e.touches[0].clientX; };
  const onMove = (e: TouchEvent) => { if (startX.current != null) setDx(Math.min(0, e.touches[0].clientX - startX.current)); };
  const onEnd = () => { if (dx < -80) onDelete(); setDx(0); startX.current = null; };
  return (
    <li className="flex items-center gap-3 py-2.5 transition-transform" style={{ transform: `translateX(${dx}px)` }} onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd}>
      <button onClick={onToggle} aria-label={item.completed ? 'Uncheck' : 'Check off'}
        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${item.completed ? 'bg-accent border-accent text-accent-foreground' : 'border-muted-foreground/40'}`}>
        {item.completed && <Check size={12} strokeWidth={3} />}
      </button>
      <button onClick={onEdit} className={`flex-1 min-w-0 text-left text-sm break-words ${item.completed ? 'line-through text-muted-foreground/60' : 'text-foreground'}`}>
        <span className="inline-flex items-baseline gap-1.5">
          {dot && <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: dot }} />}
          <span>{item.text}</span>
          {repeat && <Repeat aria-label="Repeats" className="h-3 w-3 shrink-0 self-center text-muted-foreground" />}
        </span>
        {meta && <span className="block text-[11px] text-muted-foreground">{meta}</span>}
      </button>
      <button onClick={onDelete} aria-label="Delete" className="p-1 text-muted-foreground/60 active:text-destructive shrink-0"><X size={16} /></button>
    </li>
  );
}
