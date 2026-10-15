import { useRef, useState, KeyboardEvent, TouchEvent } from 'react';
import { Check, X, Plus } from 'lucide-react';
import { useHomeList, HomeListType, HomeListItem } from '@/hooks/useHomeList';

export function HomeListCard({ title, listType, placeholder }: { title: string; listType: HomeListType; placeholder: string }) {
  const { items, loading, add, toggle, remove, clearCompleted } = useHomeList(listType);
  const [draft, setDraft] = useState('');

  const open = items.filter(i => !i.completed);
  const done = items.filter(i => i.completed);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); add(draft); setDraft(''); }
  };

  return (
    <section className="bg-card rounded-2xl border border-border p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-lg font-semibold text-foreground">{title}</h2>
        {done.length > 0 && (
          <button onClick={clearCompleted} className="text-xs text-muted-foreground active:text-foreground">
            Clear completed
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 mb-2">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder={placeholder}
          maxLength={300}
          enterKeyHint="done"
          className="auth-input flex-1"
        />
        <button
          aria-label="Add"
          onClick={() => { add(draft); setDraft(''); }}
          className="w-10 h-10 rounded-lg bg-primary text-primary-foreground flex items-center justify-center active:scale-95 shrink-0"
        >
          <Plus size={18} />
        </button>
      </div>
      {loading ? (
        <p className="text-xs text-muted-foreground py-2">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">Nothing here yet.</p>
      ) : (
        <ul className="divide-y divide-border md:max-h-80 md:overflow-y-auto md:pr-1">
          {[...open, ...done].map(item => (
            <Row key={item.id} item={item} onToggle={() => toggle(item)} onDelete={() => remove(item.id)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Row({ item, onToggle, onDelete }: { item: HomeListItem; onToggle: () => void; onDelete: () => void }) {
  const startX = useRef<number | null>(null);
  const [dx, setDx] = useState(0);
  const onStart = (e: TouchEvent) => { startX.current = e.touches[0].clientX; };
  const onMove = (e: TouchEvent) => {
    if (startX.current == null) return;
    setDx(Math.min(0, e.touches[0].clientX - startX.current));
  };
  const onEnd = () => {
    if (dx < -80) onDelete();
    setDx(0); startX.current = null;
  };
  return (
    <li
      className="flex items-center gap-3 py-2.5 transition-transform"
      style={{ transform: `translateX(${dx}px)` }}
      onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd}
    >
      <button
        onClick={onToggle}
        aria-label={item.completed ? 'Uncheck' : 'Check off'}
        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
          item.completed ? 'bg-accent border-accent text-accent-foreground' : 'border-muted-foreground/40'
        }`}
      >
        {item.completed && <Check size={12} strokeWidth={3} />}
      </button>
      <button onClick={onToggle} className={`flex-1 text-left text-sm break-words ${item.completed ? 'line-through text-muted-foreground/60' : 'text-foreground'}`}>
        {item.text}
      </button>
      <button onClick={onDelete} aria-label="Delete" className="p-1 text-muted-foreground/60 active:text-destructive shrink-0">
        <X size={16} />
      </button>
    </li>
  );
}
