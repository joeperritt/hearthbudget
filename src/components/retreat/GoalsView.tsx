import { useMemo, useState } from 'react';
import { SubHeader, YearSelect } from './SubHeader';
import { useTable } from '@/hooks/useRetreatData';
import { scorecard } from '@/lib/netWorth';
import { cn } from '@/lib/utils';

interface Goal { id: string; retreat_year: number; horizon: string; category: string; text: string; sort_order: number; result: string | null; result_note: string | null }
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
  const [tab, setTab] = useState<'all' | 'prior'>('all');

  const currentYear = Math.max(0, ...goals.rows.map(g => g.retreat_year));
  const current = goals.rows.filter(g => g.retreat_year === currentYear);
  const prior = goals.rows.filter(g => g.retreat_year < currentYear);
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
                      {items.map(g => (
                        <li key={g.id} className="flex gap-2 text-sm text-foreground"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />{g.text}</li>
                      ))}
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
