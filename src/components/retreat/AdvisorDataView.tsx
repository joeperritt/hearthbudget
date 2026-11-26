import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Plus } from 'lucide-react';
import { SubHeader, YearSelect } from './SubHeader';
import { ValueDialog } from './ValueDialog';
import { useTable, db, run } from '@/hooks/useRetreatData';
import { fmtCents, fmtWhole } from '@/lib/netWorth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Row { id: string; month: string; aum: number | null; nna: number | null; production: number | null }
type Field = 'aum' | 'nna' | 'production';
const LABEL: Record<Field, string> = { aum: 'AUM', nna: 'NNA', production: 'Production' };

export function advisorSummary(rows: Row[]) {
  const prod = rows.filter(r => r.production != null);
  const total = prod.reduce((t, r) => t + Number(r.production), 0);
  const best = prod.reduce<Row | null>((b, r) => (!b || Number(r.production) > Number(b.production) ? r : b), null);
  const aum = [...rows].reverse().find(r => r.aum != null);
  const nna = rows.reduce((t, r) => t + Number(r.nna ?? 0), 0);
  return { total, avg: prod.length ? total / prod.length : 0, best, latestAum: aum, nna, hasNna: rows.some(r => r.nna != null) };
}

export function AdvisorDataView({ onBack }: { onBack: () => void }) {
  const data = useTable<Row>('advisor_monthly', 'month');
  const years = useMemo(() => [...new Set(data.rows.map(r => Number(r.month.slice(0, 4))))].sort((a, b) => b - a), [data.rows]);
  const [year, setYear] = useState<number | null>(null);
  const y = year ?? years[0] ?? new Date().getFullYear();
  const rows = data.rows.filter(r => r.month.startsWith(`${y}-`));
  const s = advisorSummary(rows);
  const [edit, setEdit] = useState<{ r: Row; f: Field } | null>(null);
  const [adding, setAdding] = useState(false);
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'));
  const sticky = 'sticky left-0 z-10 bg-inherit';
  const cell = (r: Row, f: Field) => (
    <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
      <button onClick={() => setEdit({ r, f })} className="tabular-nums hover:underline">{r[f] == null ? '–' : f === 'aum' ? fmtWhole(Number(r[f])) : fmtCents(Number(r[f]))}</button>
    </td>
  );
  const dupMonth = data.rows.some(r => r.month === `${month}-01`);

  return (
    <div className="max-w-3xl mx-auto pb-12">
      <SubHeader title="JP Advisor Data" onBack={onBack} right={years.length > 0 ? <YearSelect years={years} value={y} onChange={setYear} /> : undefined} />
      <div className="px-6 mt-4 grid grid-cols-2 gap-3">
        <Card label="Total production" value={`$${fmtCents(s.total)}`} />
        <Card label="Avg monthly production" value={`$${fmtCents(s.avg)}`} />
        <Card label="Best month" value={s.best ? `${format(parseISO(s.best.month), 'MMM')} · $${fmtCents(Number(s.best.production))}` : '–'} />
        <Card label="Latest AUM" value={s.latestAum ? `$${fmtWhole(Number(s.latestAum.aum))}` : '–'} sub={s.latestAum ? format(parseISO(s.latestAum.month), 'MMM yyyy') : undefined} />
        <Card label="YTD NNA" value={s.hasNna ? `$${fmtCents(s.nna)}` : '–'} />
      </div>
      <div className="px-6 mt-4 flex justify-end"><Button variant="ghost" size="sm" onClick={() => setAdding(true)}><Plus size={14} className="mr-1" />Month</Button></div>
      <div className="mt-1 overflow-x-auto border-y border-border">
        <table className="w-full text-sm text-foreground">
          <thead><tr className="bg-background border-b-2 border-foreground/70">
            <th className={`${sticky} px-3 py-2 text-left font-display`}>Month</th>
            <th className="px-3 py-2 text-right font-semibold">AUM (month end)</th>
            <th className="px-3 py-2 text-right font-semibold">NNA</th>
            <th className="px-3 py-2 text-right font-semibold">Production</th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={i % 2 ? 'bg-secondary/40' : 'bg-background'}>
                <td className={`${sticky} px-3 py-1.5 font-medium`}>{format(parseISO(r.month), 'MMM')}</td>
                {cell(r, 'aum')}{cell(r, 'nna')}{cell(r, 'production')}
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-muted-foreground">No months yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <ValueDialog open={!!edit} title={edit ? `${LABEL[edit.f]} · ${format(parseISO(edit.r.month), 'MMM yyyy')}` : ''} initial={edit ? edit.r[edit.f] : null}
        onClose={() => setEdit(null)} onSave={async v => { if (edit) await run(db('advisor_monthly').update({ [edit.f]: v }).eq('id', edit.r.id)); await data.reload(); }} />

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-display">Add month</DialogTitle></DialogHeader>
          <Input type="month" aria-label="Month" value={month} onChange={e => setMonth(e.target.value)} />
          {dupMonth && <p className="text-xs text-destructive">That month already exists. Tap its cells to edit.</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            <Button disabled={dupMonth || !/^\d{4}-\d{2}$/.test(month)} onClick={async () => {
              if (await run(db('advisor_monthly').insert({ month: `${month}-01` }))) { setAdding(false); setYear(Number(month.slice(0, 4))); data.reload(); }
            }}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-display text-base font-bold text-foreground tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
