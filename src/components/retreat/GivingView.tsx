import { useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Plus } from 'lucide-react';
import { SubHeader, YearSelect } from './SubHeader';
import { useTable, db, run } from '@/hooks/useRetreatData';
import { GIVING_TYPES, GivingEntry, givingTotals } from '@/lib/giving';
import { RecurringGivingSection, AssignBucketDialog, generateRecurring } from './RecurringGiving';
import { fmtCents } from '@/lib/netWorth';
import { nyToday } from '@/lib/habits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

type Draft = { recurring?: boolean; id?: string; gift_date: string; type: string; recipient: string; amount: string; notes: string };
const $ = (n: number) => `$${fmtCents(n)}`;

export function GivingView({ onBack }: { onBack: () => void }) {
  const data = useTable<GivingEntry>('giving_entries', 'gift_date');
  const today = nyToday();
  const years = useMemo(() => [...new Set([Number(today.slice(0, 4)), ...data.rows.map(r => Number(r.gift_date.slice(0, 4)))])].sort((a, b) => b - a), [data.rows, today]);
  const [year, setYear] = useState<number | null>(null);
  const y = year ?? years[0];
  const t = givingTotals(data.rows, y);
  const months = Object.keys(t.byMonth).sort().reverse();
  const [edit, setEdit] = useState<Draft | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const [assign, setAssign] = useState<GivingEntry | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => { generateRecurring().then(n => { setReady(true); if (n) data.reload(); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const toAssign = data.rows.filter(r => r.unassigned && !r.skipped).length;
  const recipients = useMemo(() => [...new Set(data.rows.map(r => r.recipient).filter(Boolean))].sort(), [data.rows]);

  return (
    <div className="max-w-2xl mx-auto pb-12">
      <SubHeader title="Giving" onBack={onBack} right={<YearSelect years={years} value={y} onChange={setYear} />} />
      {data.loading ? <p className="px-6 mt-6 text-sm text-muted-foreground">Loading…</p> : (
        <div className="px-6 mt-4 space-y-4">
          <div className="rounded-2xl bg-primary p-4 text-primary-foreground">
            <p className="text-xs uppercase tracking-wider text-primary-foreground/75">{y} total</p>
            <p className="font-display text-3xl font-bold tabular-nums">{$(t.total)}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {GIVING_TYPES.filter(k => t.byType[k] || k !== 'Charity - Other').map(k => (
                <div key={k} className="rounded-lg bg-primary-foreground/10 p-2">
                  <p className="text-[10px] leading-tight text-primary-foreground/80">{k}</p>
                  <p className="text-sm font-semibold tabular-nums">{$(t.byType[k] ?? 0)}</p>
                </div>
              ))}
            </div>
          </div>
          {toAssign > 0 && <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{toAssign} giving {toAssign === 1 ? 'bucket' : 'buckets'} to assign</p>}
          <Button size="sm" variant="outline" onClick={() => setEdit({ gift_date: today.startsWith(`${y}-`) ? today : `${y}-01-01`, type: 'Church', recipient: '', amount: '', notes: '' })}><Plus /> Add gift</Button>

          {months.length === 0 && <p className="text-sm text-muted-foreground">No gifts recorded for {y}.</p>}
          {months.map(m => (
            <section key={m} className="rounded-xl border border-border bg-card">
              <div className="flex items-center justify-between px-4 pt-3 pb-1">
                <h2 className="font-display text-base font-semibold text-foreground">{format(parseISO(`${m}-01`), 'MMMM')}</h2>
                <span className="text-sm font-semibold tabular-nums text-foreground">{$(t.byMonth[m])}</span>
              </div>
              <ul className="divide-y divide-border">
                {t.list.filter(e => e.gift_date.startsWith(m)).sort((a, b) => b.gift_date.localeCompare(a.gift_date)).map(e => (
                  <li key={e.id}>
                    <button onClick={() => e.unassigned ? setAssign(e) : setEdit({ recurring: !!e.recurring_id, id: e.id, gift_date: e.gift_date, type: e.type, recipient: e.recipient, amount: String(e.amount), notes: e.notes ?? '' })} className="w-full flex items-start gap-3 px-4 py-2.5 text-left">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground truncate">{e.recipient || '(No recipient)'}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{format(parseISO(e.gift_date), 'MMM d')} · {e.type}{e.notes ? ` · ${e.notes}` : ''}</p>
                      </div>
                      {e.unassigned && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">Assign</span>}
                      <span className="text-sm tabular-nums text-foreground">{$(Number(e.amount))}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {ready && <RecurringGivingSection today={today} onChanged={() => generateRecurring().then(() => data.reload())} />}

          {t.recipients.length > 0 && (
            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="font-display text-base font-semibold text-foreground">By recipient</h2>
              <ul className="mt-2 divide-y divide-border">
                {t.recipients.map(([r, v]) => (
                  <li key={r} className="flex items-center gap-3 py-2">
                    <button onClick={() => setRename(r)} className="flex-1 min-w-0 text-left text-sm text-foreground truncate" aria-label={`Rename ${r}`}>{r}</button>
                    <span className="text-sm tabular-nums text-foreground">{$(v)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-muted-foreground">Tap a name to rename it everywhere, for example to merge duplicates.</p>
            </section>
          )}
        </div>
      )}
      <EntryDialog draft={edit} recipients={recipients} onClose={() => setEdit(null)} onDone={() => { setEdit(null); data.reload(); }} />
      <AssignBucketDialog entry={assign} recipients={recipients} onClose={() => setAssign(null)} onDone={() => { setAssign(null); data.reload(); }} />
      <RenameDialog name={rename} onClose={() => setRename(null)} onDone={() => { setRename(null); data.reload(); }} />
    </div>
  );
}

function EntryDialog({ draft, recipients, onClose, onDone }: { draft: Draft | null; recipients: string[]; onClose: () => void; onDone: () => void }) {
  const [d, setD] = useState<Draft | null>(draft);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setD(draft), [draft]);
  if (!d) return null;
  const amount = Number(d.amount.replace(/[$,\s]/g, ''));
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(d.gift_date) && Number.isFinite(amount) && d.amount.trim() !== '';
  const row = { gift_date: d.gift_date, type: d.type, recipient: d.recipient.trim(), amount: Math.round(amount * 100) / 100, notes: d.notes.trim() || null };
  const save = async () => { if (await run(d.id ? db('giving_entries').update(row).eq('id', d.id) : db('giving_entries').insert(row))) onDone(); };
  return (
    <>
      <Dialog open={!!draft} onOpenChange={o => !o && onClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-display">{d.id ? 'Edit gift' : 'Add gift'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            <Input type="date" aria-label="Date" value={d.gift_date} onChange={e => setD({ ...d, gift_date: e.target.value })} />
            <Input inputMode="decimal" aria-label="Amount" placeholder="Amount" value={d.amount} onChange={e => setD({ ...d, amount: e.target.value })} />
            <select aria-label="Type" value={d.type} onChange={e => setD({ ...d, type: e.target.value })} className="col-span-2 h-10 rounded-md border border-border bg-card px-2 text-sm">
              {GIVING_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <Input className="col-span-2" list="giving-recipients" aria-label="Recipient" placeholder="Recipient" value={d.recipient} onChange={e => setD({ ...d, recipient: e.target.value })} maxLength={200} />
            <datalist id="giving-recipients">{recipients.map(r => <option key={r} value={r} />)}</datalist>
            <Input className="col-span-2" aria-label="Notes" placeholder="Notes (optional)" value={d.notes} onChange={e => setD({ ...d, notes: e.target.value })} maxLength={500} />
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {d.id ? <Button variant="ghost" className="text-destructive" onClick={() => setConfirm(true)}>{d.recurring ? 'Skip this month' : 'Delete'}</Button> : <span />}
            <div className="flex gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={!ok} onClick={save}>Save</Button></div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{d.recurring ? 'Skip this month?' : 'Delete this gift?'}</AlertDialogTitle><AlertDialogDescription>{d.recipient} · ${fmtCents(amount || 0)}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={async () => { setConfirm(false); if (d.id && await run(d.recurring ? db('giving_entries').update({ skipped: true }).eq('id', d.id) : db('giving_entries').delete().eq('id', d.id), d.recurring ? 'Skipped for this month' : 'Gift deleted')) onDone(); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function RenameDialog({ name, onClose, onDone }: { name: string | null; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState('');
  useEffect(() => { if (name) setV(name); }, [name]);
  const from = name === '(No recipient)' ? '' : name ?? '';
  return (
    <Dialog open={name != null} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="font-display">Rename recipient</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">Every gift to "{name}" in every year will use the new name.</p>
        <Input autoFocus value={v} onChange={e => setV(e.target.value)} maxLength={200} />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!v.trim() || v.trim() === from} onClick={async () => { if (await run(db('giving_entries').update({ recipient: v.trim() }).eq('recipient', from), 'Recipient renamed')) onDone(); }}>Rename</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
