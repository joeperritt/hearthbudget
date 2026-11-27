import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useTable, db, run } from '@/hooks/useRetreatData';
import { GIVING_TYPES, GivingEntry, RecurringItem, activeIn, recurringTotal, splitError } from '@/lib/giving';
import { fmtCents } from '@/lib/netWorth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';

const $ = (n: number) => `$${fmtCents(n)}`;
const num = (s: string) => Number(s.replace(/[$,\s]/g, ''));
const sel = 'h-10 rounded-md border border-border bg-card px-2 text-sm';

/** Creates any missing recurring gifts from start month through this month (never future months, never twice). */
export async function generateRecurring(): Promise<number> {
  const { data, error } = await (supabase as any).rpc('generate_recurring_giving');
  return error ? 0 : Number(data ?? 0);
}

type Draft = { id?: string; recipient: string; type: string; amount: string; kind: 'fixed' | 'bucket'; month: string; notes: string };

export function RecurringGivingSection({ today, onChanged }: { today: string; onChanged: () => void }) {
  const items = useTable<RecurringItem>('giving_recurring', 'sort_order');
  const month = today.slice(0, 7);
  const active = items.rows.filter(r => activeIn(r, month) || r.start_month.slice(0, 7) > month);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [stop, setStop] = useState<RecurringItem | null>(null);
  const done = () => { setEdit(null); setStop(null); items.reload(); onChanged(); };
  const nextMonth = format(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1), 'yyyy-MM');

  const save = async (d: Draft) => {
    const amount = Math.round(num(d.amount) * 100) / 100;
    const start = `${d.month}-01`;
    if (d.id) {
      const { error } = await (supabase as any).rpc('change_recurring_amount', { _id: d.id, _amount: amount, _effective: start });
      if (error) toast.error('Could not save. Please try again.'); else done();
    } else {
      const sort = Math.max(0, ...items.rows.map(r => r.sort_order)) + 1;
      if (await run(db('giving_recurring').insert({ recipient: d.recipient.trim(), type: d.type, amount, kind: d.kind, start_month: start, sort_order: sort, notes: d.notes.trim() || null }))) done();
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-base font-semibold text-foreground">Recurring giving</h2>
        <span className="text-sm font-semibold tabular-nums text-foreground">{$(recurringTotal(items.rows, month))}/mo</span>
      </div>
      <ul className="mt-2 divide-y divide-border">
        {active.map(r => (
          <li key={r.id} className="flex items-center gap-2 py-2">
            <button className="flex-1 min-w-0 text-left" onClick={() => setEdit({ id: r.id, recipient: r.recipient, type: r.type, amount: String(r.amount), kind: r.kind, month: r.start_month.slice(0, 7) > month ? r.start_month.slice(0, 7) : nextMonth, notes: r.notes ?? '' })}>
              <p className="text-sm text-foreground truncate">{r.recipient}{r.kind === 'bucket' && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">Bucket</span>}</p>
              <p className="text-[11px] text-muted-foreground truncate">{r.type} · from {format(parseISO(r.start_month), 'MMM yyyy')}{r.end_month ? ` to ${format(parseISO(r.end_month), 'MMM yyyy')}` : ''}</p>
            </button>
            <span className="text-sm tabular-nums text-foreground">{$(Number(r.amount))}</span>
            {!r.end_month && <button aria-label={`Stop ${r.recipient}`} onClick={() => setStop(r)} className="p-1 text-muted-foreground"><Trash2 className="h-4 w-4" /></button>}
          </li>
        ))}
      </ul>
      <Button size="sm" variant="outline" className="mt-2" onClick={() => setEdit({ recipient: '', type: 'Church', amount: '', kind: 'fixed', month, notes: '' })}><Plus /> Add recurring</Button>

      <Dialog open={!!edit} onOpenChange={o => !o && setEdit(null)}>
        {edit && (
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle className="font-display">{edit.id ? `Change ${edit.recipient}` : 'Add recurring gift'}</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-2">
              {!edit.id && <>
                <Input className="col-span-2" aria-label="Recipient" placeholder="Recipient or bucket name" value={edit.recipient} onChange={e => setEdit({ ...edit, recipient: e.target.value })} maxLength={200} />
                <select aria-label="Type" className={`${sel} col-span-2`} value={edit.type} onChange={e => setEdit({ ...edit, type: e.target.value })}>{GIVING_TYPES.map(t => <option key={t}>{t}</option>)}</select>
                <select aria-label="Kind" className={`${sel} col-span-2`} value={edit.kind} onChange={e => setEdit({ ...edit, kind: e.target.value as Draft['kind'] })}>
                  <option value="fixed">Fixed (same recipient every month)</option><option value="bucket">Bucket (assign each month)</option>
                </select>
              </>}
              <Input inputMode="decimal" aria-label="Monthly amount" placeholder="Monthly amount" value={edit.amount} onChange={e => setEdit({ ...edit, amount: e.target.value })} />
              <label className="text-xs text-muted-foreground flex flex-col">{edit.id ? 'Effective from' : 'Starts'}
                <Input type="month" aria-label="Month" value={edit.month} onChange={e => setEdit({ ...edit, month: e.target.value })} /></label>
            </div>
            {edit.id && <p className="text-[11px] text-muted-foreground">Months before this keep their old amount.</p>}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
              <Button disabled={!(num(edit.amount) > 0) || !/^\d{4}-\d{2}$/.test(edit.month) || (!edit.id && !edit.recipient.trim())} onClick={() => save(edit)}>Save</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={!!stop} onOpenChange={o => !o && setStop(null)}>
        {stop && (
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle className="font-display">Stop {stop.recipient}?</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">{format(parseISO(`${month}-01`), 'MMMM')} stays as the last month. Past gifts are kept.</p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setStop(null)}>Cancel</Button>
              <Button onClick={async () => {
                const end = stop.start_month.slice(0, 7) > month ? null : `${month}-01`;
                if (await run(end ? db('giving_recurring').update({ end_month: end }).eq('id', stop.id) : db('giving_recurring').delete().eq('id', stop.id), 'Stopped')) done();
              }}>Stop</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </section>
  );
}

type Gift = { recipient: string; type: string; amount: string };

export function AssignBucketDialog({ entry, recipients, onClose, onDone }: { entry: GivingEntry | null; recipients: string[]; onClose: () => void; onDone: () => void }) {
  const [gifts, setGifts] = useState<Gift[]>([]);
  useEffect(() => { if (entry) setGifts([{ recipient: '', type: entry.type, amount: String(entry.amount) }]); }, [entry]);
  if (!entry) return null;
  const parsed = gifts.map(g => ({ recipient: g.recipient, type: g.type, amount: Math.round(num(g.amount) * 100) / 100 }));
  const err = splitError(Number(entry.amount), parsed);
  const left = Number(entry.amount) - parsed.reduce((a, g) => a + (g.amount || 0), 0);
  const set = (i: number, p: Partial<Gift>) => setGifts(gifts.map((g, j) => (j === i ? { ...g, ...p } : g)));
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="font-display">Assign {entry.recipient}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">{format(parseISO(entry.gift_date), 'MMMM yyyy')} · {$(Number(entry.amount))} bucket</p>
        <div className="space-y-3">
          {gifts.map((g, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-border p-2">
              <Input className="col-span-2" list="giving-recipients" aria-label="Recipient" placeholder="Recipient" value={g.recipient} onChange={e => set(i, { recipient: e.target.value })} maxLength={200} />
              <select aria-label="Type" className={sel} value={g.type} onChange={e => set(i, { type: e.target.value })}>{GIVING_TYPES.map(t => <option key={t}>{t}</option>)}</select>
              <div className="flex gap-1">
                <Input inputMode="decimal" aria-label="Amount" value={g.amount} onChange={e => set(i, { amount: e.target.value })} />
                {gifts.length > 1 && <button aria-label="Remove gift" className="px-1 text-muted-foreground" onClick={() => setGifts(gifts.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>}
              </div>
            </div>
          ))}
          <datalist id="giving-recipients">{recipients.map(r => <option key={r} value={r} />)}</datalist>
          <Button size="sm" variant="outline" onClick={() => setGifts([...gifts, { recipient: '', type: entry.type, amount: left > 0 ? left.toFixed(2) : '' }])}><Plus /> Split</Button>
          <p className="text-[11px] text-muted-foreground">{err ?? (left > 0.004 ? `${$(left)} left over will be dropped.` : 'Adds up to the bucket.')}</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!!err} onClick={async () => {
            const { error } = await (supabase as any).rpc('assign_giving_bucket', { _entry_id: entry.id, _gifts: parsed });
            if (error) { toast.error(error.message?.includes('no longer') ? 'That bucket was already assigned.' : 'Could not save. Please try again.'); onDone(); } else { toast.success('Assigned'); onDone(); }
          }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
