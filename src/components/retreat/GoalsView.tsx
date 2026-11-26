import { useMemo, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { SubHeader, YearSelect } from './SubHeader';
import { useTable, db, run } from '@/hooks/useRetreatData';
import { NwLineItem, computeTotals, scorecard } from '@/lib/netWorth';
import { GoalProgress, TrackedGoal, closeOutDefault, goalProgress } from '@/lib/goalTracking';
import { HabitDef, HabitLog, nyToday } from '@/lib/habits';
import { GivingEntry, givingByMonth } from '@/lib/giving';
import { GoalTracker, StatusChip } from './GoalTrackers';
import { GoalDraft, GoalEditDialog } from './GoalEditDialog';
import { CloseOutRow, CloseOutYearDialog } from './CloseOutYearDialog';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

interface Goal extends TrackedGoal { id: string; retreat_year: number; horizon: string; category: string; text: string; sort_order: number; result: string | null; result_note: string | null }
interface Vision { id: string; retreat_year: number; label: string; text: string; sort_order: number }
interface Scorecard { year: number; summary_line: string | null }

const horizonKey = (h: string) => (h === 'Every Year' ? -1 : Number(h) || 9999);

function group<T>(list: T[], key: (t: T) => string) {
  const m = new Map<string, T[]>();
  for (const t of list) { const k = key(t); if (!m.has(k)) m.set(k, []); m.get(k)!.push(t); }
  return [...m.entries()];
}

const BADGE: Record<string, { label: string; cls: string }> = {
  hit: { label: 'Hit', cls: 'bg-success/15 text-success' },
  faded: { label: 'Faded', cls: 'bg-warning/20 text-warning' },
  short: { label: 'Short', cls: 'bg-destructive/10 text-destructive' },
};

export function GoalsView({ onBack }: { onBack: () => void }) {
  const goals = useTable<Goal>('retreat_goals', 'sort_order');
  const visions = useTable<Vision>('retreat_visions', 'sort_order');
  const cards = useTable<Scorecard>('retreat_scorecards', 'year');
  const habits = useTable<HabitDef>('habit_definitions', 'sort_order');
  const logs = useTable<HabitLog>('habit_logs', 'log_date');
  const giving = useTable<GivingEntry>('giving_entries', 'gift_date');
  const advisor = useTable<{ month: string; aum: number | null; nna: number | null; production: number | null }>('advisor_monthly', 'month');
  const items = useTable<NwLineItem>('nw_line_items', 'sort_order');
  const snaps = useTable<{ id: string; snapshot_month: string }>('nw_snapshots', 'snapshot_month');
  const vals = useTable<{ snapshot_id: string; line_item_id: string; amount: number }>('nw_values', 'created_at');
  const [tab, setTab] = useState<'all' | 'prior'>('all');
  const [editing, setEditing] = useState<GoalDraft | null>(null);
  const [closeAsk, setCloseAsk] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);

  // Closed-out results are copies with a result; All Goals shows only the current, unresulted set.
  const currentYear = Math.max(0, ...goals.rows.map(g => g.retreat_year));
  const current = goals.rows.filter(g => g.retreat_year === currentYear && !g.result);
  const prior = goals.rows.filter(g => !!g.result);
  const today = nyToday();

  const ctx = useMemo(() => {
    const latest = snaps.rows[snaps.rows.length - 1];
    const values: Record<string, number> = {};
    if (latest) for (const v of vals.rows) if (v.snapshot_id === latest.id) values[v.line_item_id] = Number(v.amount);
    const active = items.rows.filter(i => i.active || values[i.id] != null);
    const totals = latest ? computeTotals(active, values) : null;
    return {
      today, habits: habits.rows, logs: logs.rows, givingByMonth: givingByMonth(giving.rows), advisor: advisor.rows,
      latestLineItem: (id: string) => (latest ? values[id] ?? 0 : null),
      latestNetWorth: totals?.netWorth ?? null, latestNetWorthEx: totals?.netWorthExBusiness ?? null,
    };
  }, [today, habits.rows, logs.rows, giving.rows, advisor.rows, items.rows, snaps.rows, vals.rows]);
  const progressOf = (g: Goal): GoalProgress | null => goalProgress(g, ctx);

  const horizons = useMemo(() => [...new Set(current.map(g => g.horizon))].sort((a, b) => horizonKey(a) - horizonKey(b)), [current]);
  const closeYear = Math.min(...current.map(g => Number(g.horizon)).filter(n => Number.isFinite(n) && n > 1900));
  const closeRows: CloseOutRow[] = useMemo(() => !Number.isFinite(closeYear) ? [] : current
    .filter(g => g.horizon === String(closeYear) || g.horizon === 'Every Year')
    .sort((a, b) => horizonKey(a.horizon) - horizonKey(b.horizon) || a.sort_order - b.sort_order)
    .map(g => ({ id: g.id, text: g.text, category: g.category, result: closeOutDefault(progressOf(g)?.status), note: '' })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [current, closeYear, ctx]);

  const saveGoal = async (d: GoalDraft) => {
    const ok = d.id
      ? await run(db('retreat_goals').update({ text: d.text }).eq('id', d.id))
      : await run(db('retreat_goals').insert({ retreat_year: currentYear || Number(today.slice(0, 4)), horizon: d.horizon, category: d.category, text: d.text, sort_order: 1000 + current.length }));
    if (ok) { setEditing(null); goals.reload(); }
  };
  const deleteGoal = async (id: string) => { if (await run(db('retreat_goals').delete().eq('id', id), 'Goal deleted')) { setEditing(null); goals.reload(); } };
  const saveProgress = async (g: Goal, progress: NonNullable<TrackedGoal['progress']>) => {
    goals.setRows(rows => rows.map(r => (r.id === g.id ? { ...r, progress } : r)));
    await run(db('retreat_goals').update({ progress }).eq('id', g.id));
    goals.reload();
  };
  const saveCloseOut = async (rows: CloseOutRow[], summary: string) => {
    const y = closeYear;
    const byId = new Map(current.map(g => [g.id, g]));
    // Re-closing a year replaces its earlier results.
    if (!(await run(db('retreat_goals').delete().eq('retreat_year', currentYear).eq('horizon', String(y)).not('result', 'is', null)))) return;
    const copies = rows.map((r, i) => {
      const g = byId.get(r.id)!;
      return { retreat_year: currentYear, horizon: String(y), category: g.category, text: g.text, sort_order: i, result: r.result, result_note: r.note.trim() || null };
    });
    if (!(await run(db('retreat_goals').insert(copies)))) return;
    const existing = cards.rows.find(c => c.year === y);
    await run(existing
      ? db('retreat_scorecards').update({ summary_line: summary || existing.summary_line }).eq('year', y)
      : db('retreat_scorecards').insert({ year: y, summary_line: summary || null }), `${y} closed out`);
    setCloseOpen(false); goals.reload(); cards.reload(); setTab('prior');
  };
  const priorYears = useMemo(() => [...new Set(prior.map(g => Number(g.horizon)))].filter(Boolean).sort((a, b) => b - a), [prior]);
  const [year, setYear] = useState<number | null>(null);
  const shownYear = year ?? priorYears[0];

  return (
    <div className="max-w-2xl mx-auto pb-12">
      <SubHeader title="Goals" onBack={onBack} />
      <div className="px-6 mt-4">
        <div className="inline-flex rounded-lg bg-secondary p-1 text-sm">
          {(['all', 'prior'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className={cn('px-3 py-1.5 rounded-md font-medium', tab === t ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')}>
              {t === 'all' ? 'All Goals' : 'Prior Years'}
            </button>
          ))}
        </div>
      </div>

      {goals.loading ? <p className="px-6 mt-6 text-sm text-muted-foreground">Loading…</p> : tab === 'all' ? (
        <div className="px-6 mt-5 space-y-6">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing({ text: '', horizon: horizons.find(h => h !== 'Every Year') ?? '', category: '' })}><Plus /> Add goal</Button>
            {closeRows.length > 0 && <Button size="sm" variant="ghost" onClick={() => setCloseAsk(true)}>Close out {closeYear}</Button>}
          </div>
          {visions.rows.filter(v => v.retreat_year === currentYear).map(v => (
            <div key={v.id} className="rounded-2xl border-l-4 border-accent bg-card p-4 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">{v.label === 'Our family' ? 'Vision' : `${v.label} vision`}</p>
              <p className="mt-1 font-display text-[15px] leading-relaxed text-foreground">{v.text}</p>
            </div>
          ))}
          {group([...current].sort((a, b) => horizonKey(a.horizon) - horizonKey(b.horizon) || a.sort_order - b.sort_order), g => g.horizon).map(([h, list]) => (
            <section key={h}>
              <h2 className="font-display text-xl font-bold text-foreground">{h}</h2>
              <div className="mt-2 space-y-3">
                {group(list, g => g.category).map(([cat, items]) => (
                  <div key={cat} className="rounded-xl border border-border bg-card p-4">
                    {cat !== h && <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{cat}</p>}
                    <ul className={cn('space-y-1.5', cat !== h && 'mt-2')}>
                      {items.map(g => {
                        const prog = progressOf(g);
                        return (
                          <li key={g.id} className="text-sm text-foreground">
                            <div className="flex gap-2">
                              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                              <button onClick={() => setEditing({ id: g.id, text: g.text, horizon: g.horizon, category: g.category })} className="flex-1 min-w-0 text-left">{g.text}</button>
                              {prog && <StatusChip s={prog.status} />}
                            </div>
                            {prog && <div className="pl-3.5"><GoalTracker goal={g} prog={prog} onProgress={p => saveProgress(g, p)} /></div>}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="px-6 mt-5 space-y-5">
          {priorYears.length === 0 ? <p className="text-sm text-muted-foreground">No prior years yet.</p> : (() => {
            const list = prior.filter(g => Number(g.horizon) === shownYear);
            const sc = scorecard(list.map(g => g.result));
            const line = cards.rows.find(c => c.year === shownYear)?.summary_line;
            return (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-xl font-bold text-foreground">{shownYear} goals</h2>
                  <YearSelect years={priorYears} value={shownYear} onChange={setYear} />
                </div>
                <div className="rounded-2xl bg-primary p-4 text-primary-foreground">
                  <p className="font-display text-2xl font-bold">{sc.hit} of {sc.total} goals hit</p>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <Stat n={sc.hit} label="Hit" cls="text-success" />
                    <Stat n={sc.faded} label="Strong start then faded" cls="text-warning" />
                    <Stat n={sc.short} label="Fell short" cls="text-destructive" />
                  </div>
                  {line && <p className="mt-3 text-sm text-primary-foreground/85">{line}</p>}
                </div>
                {group(list, g => g.category).map(([cat, items]) => (
                  <div key={cat} className="rounded-xl border border-border bg-card p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{cat}</p>
                    <ul className="mt-2 divide-y divide-border">
                      {items.map(g => (
                        <li key={g.id} className="py-2 first:pt-0 last:pb-0">
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-sm text-foreground">{g.text}</p>
                            {g.result && <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', BADGE[g.result]?.cls)}>{BADGE[g.result]?.label}</span>}
                          </div>
                          {g.result_note && <p className="mt-0.5 text-xs text-muted-foreground">{g.result_note}</p>}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </>
            );
          })()}
        </div>
      )}
      <GoalEditDialog goal={editing} horizons={horizons} onClose={() => setEditing(null)} onSave={saveGoal} onDelete={deleteGoal} />
      <AlertDialog open={closeAsk} onOpenChange={setCloseAsk}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close out {closeYear}?</AlertDialogTitle>
            <AlertDialogDescription>You'll pick Hit, Faded or Short for each {closeYear} and Every Year goal. They're saved as {closeYear} results in Prior Years.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setCloseAsk(false); setCloseOpen(true); }}>Continue</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <CloseOutYearDialog year={closeYear} rows={closeRows} open={closeOpen} onClose={() => setCloseOpen(false)} onSave={saveCloseOut} />
    </div>
  );
}

function Stat({ n, label, cls }: { n: number; label: string; cls: string }) {
  return (
    <div className="rounded-lg bg-primary-foreground/10 p-2">
      <p className={cn('text-xl font-bold', cls)}>{n}</p>
      <p className="text-[10px] leading-tight text-primary-foreground/80">{label}</p>
    </div>
  );
}
