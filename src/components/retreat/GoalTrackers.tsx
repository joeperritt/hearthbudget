import { Check, Minus, Plus } from 'lucide-react';
import { GoalProgress, GoalStatus, TrackedGoal } from '@/lib/goalTracking';
import { nyToday } from '@/lib/habits';
import { cn } from '@/lib/utils';

const CHIP: Record<GoalStatus, { label: string; cls: string }> = {
  hit: { label: 'Hit', cls: 'bg-success/15 text-success' },
  on_track: { label: 'On track', cls: 'bg-primary/10 text-primary' },
  behind: { label: 'Behind', cls: 'bg-warning/20 text-warning' },
};
const MONTHS = 'JFMAMJJASOND'.split('');

export function StatusChip({ s }: { s: GoalStatus }) {
  return <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', CHIP[s].cls)}>{CHIP[s].label}</span>;
}

export function GoalTracker({ goal, prog, onProgress }: { goal: TrackedGoal; prog: GoalProgress; onProgress: (p: NonNullable<TrackedGoal['progress']>) => void }) {
  const p = goal.progress ?? {};
  const t = goal.tracking_type;
  return (
    <div className="mt-1.5 space-y-1.5">
      {t === 'monthly' ? (
        <div className="flex gap-1" aria-label={prog.label}>
          {MONTHS.map((m, i) => (
            <span key={i} className={cn('flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold', prog.months?.has(i + 1) ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground')}>{m}</span>
          ))}
        </div>
      ) : t !== 'checklist' && t !== 'quarterly' && (
        <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className={cn('h-full rounded-full', prog.status === 'behind' ? 'bg-warning' : 'bg-success')} style={{ width: `${Math.round(prog.pct * 100)}%` }} /></div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>{prog.label}{prog.detail ? ` · ${prog.detail}` : ''}</span>
        {t === 'count' && (
          <span className="ml-auto flex items-center gap-1.5">
            <button aria-label="Minus one" disabled={!p.count} onClick={() => onProgress({ ...p, count: Math.max(0, (p.count ?? 0) - 1) })} className="w-7 h-7 rounded-full border border-border flex items-center justify-center disabled:opacity-30"><Minus size={12} /></button>
            <button aria-label="Plus one" onClick={() => onProgress({ ...p, count: (p.count ?? 0) + 1 })} className="w-7 h-7 rounded-full border border-border flex items-center justify-center"><Plus size={12} /></button>
          </span>
        )}
        {(t === 'checklist' || (t === 'linked' && goal.linked_metric === 'nw_line_item' && /land/i.test(String((goal as { text?: string }).text ?? '')))) && (
          <label className="ml-auto inline-flex items-center gap-1.5 text-foreground">
            <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--accent))]" checked={!!p.done}
              onChange={e => onProgress({ ...p, done: e.target.checked, done_at: e.target.checked ? nyToday() : undefined })} />
            {t === 'checklist' ? 'Done' : 'Bought land'}
          </label>
        )}
      </div>
      {t === 'quarterly' && (
        <div className="flex gap-2">
          {[0, 1, 2, 3].map(i => {
            const on = !!p.q?.[i];
            return (
              <button key={i} aria-pressed={on} onClick={() => { const q = [0, 1, 2, 3].map(j => !!p.q?.[j]); q[i] = !on; onProgress({ ...p, q }); }}
                className={cn('flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium', on ? 'border-accent bg-accent text-accent-foreground' : 'border-border text-muted-foreground')}>
                {on && <Check size={11} strokeWidth={3} />}Q{i + 1}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
