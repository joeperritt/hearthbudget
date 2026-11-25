import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { SubHeader, YearSelect } from './SubHeader';
import { ValueDialog } from './ValueDialog';
import { useTable, db, run } from '@/hooks/useRetreatData';
import { fmtCents } from '@/lib/netWorth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

interface Source { id: string; year: number; name: string; sort_order: number }
interface Entry { id: string; source_id: string; month: number; amount: number }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function IncomeView({ onBack }: { onBack: () => void }) {
  const sources = useTable<Source>('income_sources', 'sort_order');
  const entries = useTable<Entry>('income_entries', 'month');
  const thisYear = new Date().getFullYear();
  const years = useMemo(() => [...new Set([...sources.rows.map(s => s.year), thisYear, thisYear + 1])].sort((a, b) => b - a), [sources.rows, thisYear]);
  const [year, setYear] = useState<number | null>(null);
  const y = year ?? (sources.rows.length ? Math.max(...sources.rows.map(s => s.year)) : thisYear);
  const cols = sources.rows.filter(s => s.year === y);
  const val = (sid: string, m: number) => entries.rows.find(e => e.source_id === sid && e.month === m);
  const [edit, setEdit] = useState<{ s: Source; m: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [remove, setRemove] = useState<Source | null>(null);

  const rowTotal = (m: number) => cols.reduce((t, s) => t + Number(val(s.id, m)?.amount ?? 0), 0);
  const colTotal = (s: Source) => entries.rows.filter(e => e.source_id === s.id).reduce((t, e) => t + Number(e.amount), 0);
  const grand = cols.reduce((t, s) => t + colTotal(s), 0);
  const sticky = 'sticky left-0 z-10 bg-inherit';

  return (
    <div className="max-w-4xl mx-auto pb-12">
      <SubHeader title="Income" onBack={onBack} right={<YearSelect years={years} value={y} onChange={setYear} />} />
      <div className="px-6 mt-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{y} total <span className="font-semibold text-foreground tabular-nums">${fmtCents(grand)}</span></p>
        <Button variant="ghost" size="sm" onClick={() => setAdding(true)}><Plus size={14} className="mr-1" />Source</Button>
      </div>
      <div className="mt-3 overflow-x-auto border-y border-border">
        <table className="w-full text-sm text-foreground">
          <thead><tr className="bg-background border-b-2 border-foreground/70">
            <th className={`${sticky} px-3 py-2 text-left font-display`}>Month</th>
            {cols.map(s => (
              <th key={s.id} className="px-3 py-2 text-right font-semibold min-w-[120px]">
                <span className="inline-flex items-start gap-1">{s.name}<button aria-label={`Remove ${s.name}`} onClick={() => setRemove(s)} className="text-muted-foreground hover:text-destructive"><X size={12} /></button></span>
              </th>
            ))}
            <th className="px-3 py-2 text-right font-semibold">Total</th>
          </tr></thead>
          <tbody>
            {MONTHS.map((label, i) => (
              <tr key={label} className={i % 2 ? 'bg-secondary/40' : 'bg-background'}>
                <td className={`${sticky} px-3 py-1.5 font-medium`}>{label}</td>
                {cols.map(s => { const e = val(s.id, i + 1); return (
                  <td key={s.id} className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                    <button onClick={() => setEdit({ s, m: i + 1 })} className="tabular-nums hover:underline">{e ? fmtCents(Number(e.amount)) : '–'}</button>
                  </td>); })}
                <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap font-medium">{cols.some(s => val(s.id, i + 1)) ? fmtCents(rowTotal(i + 1)) : '–'}</td>
              </tr>
            ))}
            <tr className="bg-background border-t-2 border-foreground/70">
              <td className={`${sticky} px-3 py-2 font-bold font-display`}>Total</td>
              {cols.map(s => <td key={s.id} className="px-3 py-2 text-right tabular-nums whitespace-nowrap font-semibold">{fmtCents(colTotal(s))}</td>)}
              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap font-bold">{fmtCents(grand)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {cols.length === 0 && !sources.loading && <p className="px-6 mt-3 text-sm text-muted-foreground">No income sources for {y} yet. Add one to start.</p>}

      <ValueDialog open={!!edit} title={edit ? `${edit.s.name} · ${MONTHS[edit.m - 1]} ${y}` : ''} initial={edit ? (val(edit.s.id, edit.m)?.amount ?? null) : null}
        onClose={() => setEdit(null)} onSave={async v => {
          if (!edit) return; const e = val(edit.s.id, edit.m);
          if (v == null) { if (e) await run(db('income_entries').delete().eq('id', e.id)); }
          else if (e) await run(db('income_entries').update({ amount: v }).eq('id', e.id));
          else await run(db('income_entries').insert({ source_id: edit.s.id, month: edit.m, amount: v }));
          await entries.reload();
        }} />

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-display">Add income source for {y}</DialogTitle></DialogHeader>
          <Input placeholder="Name (e.g. Joe Bonus)" value={name} onChange={e => setName(e.target.value)} maxLength={60} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            <Button disabled={!name.trim()} onClick={async () => {
              if (await run(db('income_sources').insert({ year: y, name: name.trim(), sort_order: cols.length }))) { setName(''); setAdding(false); sources.reload(); }
            }}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!remove} onOpenChange={o => !o && setRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {remove?.name}?</AlertDialogTitle>
            <AlertDialogDescription>This removes the source and its {y} amounts.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={async () => {
              if (remove) await run(db('income_sources').delete().eq('id', remove.id));
              setRemove(null); sources.reload(); entries.reload();
            }}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
