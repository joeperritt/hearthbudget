import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Plus, Trash2 } from 'lucide-react';
import { SubHeader } from './SubHeader';
import { ValueDialog } from './ValueDialog';
import { useTable, db, run } from '@/hooks/useRetreatData';
import { ASSET_CATEGORIES, LIABILITY_CATEGORIES, NwLineItem, computeTotals, fmtWhole, yearAgoIndex, SnapshotValues } from '@/lib/netWorth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

interface Snap { id: string; snapshot_month: string }
interface Val { id: string; snapshot_id: string; line_item_id: string; amount: number }

const monthLabel = (m: string) => format(parseISO(m), 'MMM yyyy');
const pct = (a: number, b: number) => (b === 0 ? '—' : `${(((a - b) / Math.abs(b)) * 100).toFixed(1)}%`);

export function NetWorthView({ onBack }: { onBack: () => void }) {
  const items = useTable<NwLineItem>('nw_line_items', 'sort_order');
  const snaps = useTable<Snap>('nw_snapshots', 'snapshot_month');
  const vals = useTable<Val>('nw_values', 'created_at');
  const reloadAll = () => Promise.all([items.reload(), snaps.reload(), vals.reload()]);

  const [showAll, setShowAll] = useState(false);
  const [edit, setEdit] = useState<{ snap: Snap; item: NwLineItem } | null>(null);
  const [itemMenu, setItemMenu] = useState<NwLineItem | null>(null);
  const [delSnap, setDelSnap] = useState<Snap | null>(null);
  const [addItem, setAddItem] = useState(false);
  const [addUpdate, setAddUpdate] = useState(false);

  const bySnap = useMemo(() => {
    const m: Record<string, SnapshotValues> = {};
    for (const v of vals.rows) (m[v.snapshot_id] ??= {})[v.line_item_id] = Number(v.amount);
    return m;
  }, [vals.rows]);

  const sorted = snaps.rows;
  const latest = sorted[sorted.length - 1];
  const agoIdx = yearAgoIndex(sorted.map(s => s.snapshot_month));
  const cols: Snap[] = showAll ? sorted : [agoIdx != null ? sorted[agoIdx] : null, latest].filter(Boolean) as Snap[];
  const compare = !showAll && cols.length === 2;

  const visibleItems = items.rows.filter(li => li.active || cols.some(c => (bySnap[c.id]?.[li.id] ?? 0) !== 0));
  const totals = cols.map(c => computeTotals(items.rows, bySnap[c.id] ?? {}));

  const loading = items.loading || snaps.loading || vals.loading;

  const saveValue = async (v: number | null) => {
    if (!edit) return;
    const existing = vals.rows.find(x => x.snapshot_id === edit.snap.id && x.line_item_id === edit.item.id);
    if (v == null) { if (existing) await run(db('nw_values').delete().eq('id', existing.id)); }
    else if (existing) await run(db('nw_values').update({ amount: v }).eq('id', existing.id));
    else await run(db('nw_values').insert({ snapshot_id: edit.snap.id, line_item_id: edit.item.id, amount: v }));
    await vals.reload();
  };

  const rowCells = (get: (i: number) => number, bold = false) => (
    <>
      {cols.map((c, i) => <td key={c.id} className={cn('px-3 py-1.5 text-right tabular-nums whitespace-nowrap', bold && 'font-semibold')}>{fmtWhole(get(i))}</td>)}
      {compare && <>
        <td className={cn('px-3 py-1.5 text-right tabular-nums whitespace-nowrap', bold && 'font-semibold')}>{fmtWhole(get(1) - get(0))}</td>
        <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap text-muted-foreground">{pct(get(1), get(0))}</td>
      </>}
    </>
  );
  const nCols = cols.length + (compare ? 2 : 0) + 1;
  const stickyCls = 'sticky left-0 z-10 bg-inherit';

  const section = (sec: 'asset' | 'liability') => {
    const cats = sec === 'asset' ? ASSET_CATEGORIES : LIABILITY_CATEGORIES;
    const extra = [...new Set(items.rows.filter(i => i.section === sec).map(i => i.category))].filter(c => !(cats as readonly string[]).includes(c));
    return [...cats, ...extra].map(cat => {
      const list = visibleItems.filter(i => i.section === sec && i.category === cat);
      return (
        <tbody key={cat}>
          <tr className="bg-background"><td colSpan={nCols} className={cn(stickyCls, 'px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground')}>{cat}</td></tr>
          {list.map((li, r) => (
            <tr key={li.id} className={r % 2 ? 'bg-secondary/40' : 'bg-background'}>
              <td className={cn(stickyCls, 'px-3 py-1.5 min-w-[160px] max-w-[200px]')}>
                <button onClick={() => setItemMenu(li)} className={cn('text-left', !li.active && 'text-muted-foreground line-through')}>{li.name}</button>
              </td>
              {cols.map(c => (
                <td key={c.id} className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                  <button onClick={() => setEdit({ snap: c, item: li })} className="tabular-nums underline-offset-2 hover:underline">{bySnap[c.id]?.[li.id] != null ? fmtWhole(bySnap[c.id][li.id]) : '–'}</button>
                </td>
              ))}
              {compare && (() => { const a = bySnap[cols[0].id]?.[li.id] ?? 0, b = bySnap[cols[1].id]?.[li.id] ?? 0; return <>
                <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">{fmtWhole(b - a)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap text-muted-foreground">{pct(b, a)}</td></>; })()}
            </tr>
          ))}
          <tr className="bg-background border-t border-border">
            <td className={cn(stickyCls, 'px-3 py-1.5 italic text-muted-foreground')}>Total {cat}</td>
            {rowCells(i => totals[i].categories[cat] ?? 0)}
          </tr>
        </tbody>
      );
    });
  };

  const totalRow = (label: string, get: (i: number) => number, strong = false) => (
    <tbody><tr className={cn('bg-background border-t-2 border-foreground/70', strong && 'border-double border-t-4')}>
      <td className={cn(stickyCls, 'px-3 py-2 font-bold font-display')}>{label}</td>{rowCells(get, true)}
    </tr></tbody>
  );

  return (
    <div className="max-w-4xl mx-auto pb-12">
      <SubHeader title="Net Worth" onBack={onBack} right={<Button size="sm" onClick={() => setAddUpdate(true)} className="bg-accent text-accent-foreground hover:bg-accent/90"><Plus size={16} className="mr-1" />Add update</Button>} />
      {loading ? <p className="px-6 mt-6 text-sm text-muted-foreground">Loading…</p> : (
        <>
          {latest && (
            <div className="px-6 mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-primary p-3 text-primary-foreground"><p className="text-[11px] uppercase tracking-wider opacity-80">Net worth · {monthLabel(latest.snapshot_month)}</p><p className="font-display text-xl font-bold">${fmtWhole(totals[totals.length - 1].netWorth)}</p></div>
              <div className="rounded-xl border border-border bg-card p-3"><p className="text-[11px] uppercase tracking-wider text-muted-foreground">Without Blackbridge</p><p className="font-display text-xl font-bold text-foreground">${fmtWhole(totals[totals.length - 1].netWorthExBusiness)}</p></div>
            </div>
          )}
          <div className="px-6 mt-4 flex items-center justify-between">
            <div className="inline-flex rounded-lg bg-secondary p-1 text-xs">
              {[false, true].map(a => <button key={String(a)} onClick={() => setShowAll(a)} className={cn('px-3 py-1 rounded-md font-medium', showAll === a ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')}>{a ? 'All snapshots' : 'Year over year'}</button>)}
            </div>
            <Button variant="ghost" size="sm" onClick={() => setAddItem(true)}><Plus size={14} className="mr-1" />Line item</Button>
          </div>
          <div className="mt-3 overflow-x-auto border-y border-border">
            <table className="w-full text-sm text-foreground">
              <thead><tr className="bg-background border-b-2 border-foreground/70">
                <th className={cn(stickyCls, 'px-3 py-2 text-left font-display')}>Balance sheet</th>
                {cols.map(c => (
                  <th key={c.id} className="px-3 py-2 text-right whitespace-nowrap font-semibold">
                    <span className="inline-flex items-center gap-1">{monthLabel(c.snapshot_month)}
                      <button aria-label={`Delete ${monthLabel(c.snapshot_month)} snapshot`} onClick={() => setDelSnap(c)} className="text-muted-foreground hover:text-destructive"><Trash2 size={12} /></button></span>
                  </th>
                ))}
                {compare && <><th className="px-3 py-2 text-right font-semibold">Change</th><th className="px-3 py-2 text-right font-semibold">%</th></>}
              </tr></thead>
              <tbody><tr className="bg-background"><td colSpan={nCols} className={cn(stickyCls, 'px-3 pt-3 font-display font-bold')}>Assets</td></tr></tbody>
              {section('asset')}
              {totalRow('Total Assets', i => totals[i].assets)}
              <tbody><tr className="bg-background"><td colSpan={nCols} className={cn(stickyCls, 'px-3 pt-5 font-display font-bold')}>Liabilities</td></tr></tbody>
              {section('liability')}
              {totalRow('Total Liabilities', i => totals[i].liabilities)}
              {totalRow('Net Worth', i => totals[i].netWorth, true)}
              <tbody><tr className="bg-background">
                <td className={cn(stickyCls, 'px-3 py-2 italic')}>Net Worth without Blackbridge</td>{rowCells(i => totals[i].netWorthExBusiness)}
              </tr></tbody>
            </table>
          </div>
          <p className="px-6 mt-2 text-[11px] text-muted-foreground">Tap a number to edit it. Tap a line item to deactivate it.</p>
        </>
      )}

      <ValueDialog open={!!edit} title={edit ? `${edit.item.name} · ${monthLabel(edit.snap.snapshot_month)}` : ''}
        initial={edit ? bySnap[edit.snap.id]?.[edit.item.id] ?? null : null} onClose={() => setEdit(null)} onSave={saveValue} />

      <Dialog open={!!itemMenu} onOpenChange={o => !o && setItemMenu(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-display">{itemMenu?.name}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{itemMenu?.active ? 'Deactivating hides it from new updates. Past values are kept.' : 'This line item is inactive. Reactivate to include it in new updates.'}</p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setItemMenu(null)}>Cancel</Button>
            <Button variant={itemMenu?.active ? 'destructive' : 'default'} onClick={async () => {
              if (itemMenu) await run(db('nw_line_items').update({ active: !itemMenu.active }).eq('id', itemMenu.id));
              setItemMenu(null); items.reload();
            }}>{itemMenu?.active ? 'Deactivate' : 'Reactivate'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!delSnap} onOpenChange={o => !o && setDelSnap(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {delSnap && monthLabel(delSnap.snapshot_month)}?</AlertDialogTitle>
            <AlertDialogDescription>This removes the snapshot and all of its values. It can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={async () => {
              if (delSnap) await run(db('nw_snapshots').delete().eq('id', delSnap.id), 'Snapshot deleted');
              setDelSnap(null); reloadAll();
            }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AddItemDialog open={addItem} onClose={() => setAddItem(false)} nextOrder={items.rows.length} onDone={items.reload} />
      <AddUpdateDialog open={addUpdate} onClose={() => setAddUpdate(false)} existing={sorted.map(s => s.snapshot_month)}
        onCreate={async (month) => {
          const { data, error } = await db('nw_snapshots').insert({ snapshot_month: month }).select('id').single();
          if (error || !data) { await run(Promise.resolve({ error: error ?? 'x' })); return; }
          const src = latest ? bySnap[latest.id] ?? {} : {};
          const rows = items.rows.filter(i => i.active && src[i.id] != null).map(i => ({ snapshot_id: data.id, line_item_id: i.id, amount: src[i.id] }));
          if (rows.length) await run(db('nw_values').insert(rows));
          await reloadAll(); setShowAll(true);
        }} />
    </div>
  );
}

function AddItemDialog({ open, onClose, onDone, nextOrder }: { open: boolean; onClose: () => void; onDone: () => void; nextOrder: number }) {
  const [section, setSection] = useState<'asset' | 'liability'>('asset');
  const [category, setCategory] = useState<string>(ASSET_CATEGORIES[0]);
  const [name, setName] = useState('');
  const cats = section === 'asset' ? ASSET_CATEGORIES : LIABILITY_CATEGORIES;
  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="font-display">Add line item</DialogTitle></DialogHeader>
        <select aria-label="Section" value={section} onChange={e => { const s = e.target.value as 'asset' | 'liability'; setSection(s); setCategory((s === 'asset' ? ASSET_CATEGORIES : LIABILITY_CATEGORIES)[0]); }} className="auth-input">
          <option value="asset">Asset</option><option value="liability">Liability</option>
        </select>
        <select aria-label="Category" value={category} onChange={e => setCategory(e.target.value)} className="auth-input">
          {cats.map(c => <option key={c}>{c}</option>)}
        </select>
        <Input placeholder="Name" value={name} onChange={e => setName(e.target.value)} maxLength={80} />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!name.trim()} onClick={async () => {
            if (await run(db('nw_line_items').insert({ section, category, name: name.trim(), sort_order: nextOrder }), 'Line item added')) { setName(''); onDone(); onClose(); }
          }}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddUpdateDialog({ open, onClose, onCreate, existing }: { open: boolean; onClose: () => void; onCreate: (m: string) => Promise<void>; existing: string[] }) {
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [busy, setBusy] = useState(false);
  const iso = `${month}-01`;
  const dup = existing.includes(iso);
  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="font-display">Add update</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Starts with the latest snapshot's values, so you only change what's different.</p>
        <Input type="month" aria-label="Month" value={month} onChange={e => setMonth(e.target.value)} />
        {dup && <p className="text-xs text-destructive">There's already a snapshot for that month.</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!/^\d{4}-\d{2}$/.test(month) || dup || busy} onClick={async () => { setBusy(true); await onCreate(iso); setBusy(false); onClose(); }}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
