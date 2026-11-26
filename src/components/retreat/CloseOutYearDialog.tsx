import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type Result = 'hit' | 'faded' | 'short';
export interface CloseOutRow { id: string; text: string; category: string; result: Result; note: string }
const OPTS: { v: Result; label: string; cls: string }[] = [
  { v: 'hit', label: 'Hit', cls: 'bg-success text-primary-foreground border-success' },
  { v: 'faded', label: 'Faded', cls: 'bg-warning text-primary-foreground border-warning' },
  { v: 'short', label: 'Short', cls: 'bg-destructive text-destructive-foreground border-destructive' },
];

export function CloseOutYearDialog({ year, rows, open, onClose, onSave }: {
  year: number; rows: CloseOutRow[]; open: boolean; onClose: () => void; onSave: (rows: CloseOutRow[], summary: string) => Promise<void>;
}) {
  const [list, setList] = useState<CloseOutRow[]>([]);
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setList(rows); setSummary(''); } }, [open, rows]);
  const set = (i: number, p: Partial<CloseOutRow>) => setList(l => l.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display">Close out {year}</DialogTitle></DialogHeader>
        <ul className="divide-y divide-border">
          {list.map((r, i) => (
            <li key={r.id} className="py-3 space-y-2">
              <p className="text-sm text-foreground"><span className="text-[11px] uppercase tracking-wider text-muted-foreground">{r.category} · </span>{r.text}</p>
              <div className="flex gap-1.5">
                {OPTS.map(o => (
                  <button key={o.v} aria-pressed={r.result === o.v} onClick={() => set(i, { result: o.v })}
                    className={cn('h-7 rounded-full border px-3 text-xs font-medium', r.result === o.v ? o.cls : 'border-border text-muted-foreground')}>{o.label}</button>
                ))}
              </div>
              <Input aria-label="Note" placeholder="Note (optional)" value={r.note} onChange={e => set(i, { note: e.target.value })} maxLength={300} />
            </li>
          ))}
        </ul>
        <Input aria-label="Summary" placeholder="One line summary (optional)" value={summary} onChange={e => setSummary(e.target.value)} maxLength={300} />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !list.length} onClick={async () => { setBusy(true); await onSave(list, summary.trim()); setBusy(false); }}>Save results</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
