import { RecurringItem, recurringTotal } from './giving';
import { HabitDef, HabitLog, monthsLogged, ytdWeeklyAvg } from './habits';

export type TrackingType = 'habit' | 'monthly' | 'linked' | 'count' | 'checklist' | 'quarterly';
export type LinkedMetric = 'giving_month' | 'giving_recurring_month' | 'production_month' | 'nw_line_item' | 'net_worth' | 'net_worth_ex_business' | 'advisor_aum' | 'advisor_nna_ytd';
export type GoalStatus = 'on_track' | 'behind' | 'hit';

export interface TrackedGoal {
  horizon: string; tracking_type: TrackingType | null; target: number | null;
  linked_metric: LinkedMetric | null; linked_line_item_id: string | null; habit_id: string | null;
  progress: { count?: number; done?: boolean; done_at?: string; q?: boolean[]; extra_habit_id?: string } | null;
}

export interface TrackingContext {
  today: string;                       // NY date
  habits: HabitDef[]; logs: HabitLog[];
  givingByMonth: Record<string, number>; // 'YYYY-MM' -> total
  recurring?: RecurringItem[];
  advisor: { month: string; aum: number | null; nna: number | null; production: number | null }[];
  latestLineItem: (id: string) => number | null;
  latestNetWorth: number | null; latestNetWorthEx: number | null;
}

export interface GoalProgress { status: GoalStatus; pct: number; label: string; detail?: string; months?: Set<number>; year: number }

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const short = (n: number) => (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : money(n));

export function goalYear(horizon: string, today: string) {
  const n = Number(horizon);
  return Number.isFinite(n) && n > 1900 ? n : Number(today.slice(0, 4));
}

export function goalProgress(g: TrackedGoal, ctx: TrackingContext): GoalProgress | null {
  if (!g.tracking_type) return null;
  const year = goalYear(g.horizon, ctx.today);
  const curYear = Number(ctx.today.slice(0, 4));
  const curMonth = Number(ctx.today.slice(5, 7));
  const target = Number(g.target ?? 0);
  const p = g.progress ?? {};
  const ratio = (v: number, t: number) => (t > 0 ? Math.max(0, Math.min(1, v / t)) : 0);
  const reached = (v: number, t: number, label: string, detail?: string): GoalProgress =>
    ({ status: v >= t && t > 0 ? 'hit' : 'behind', pct: ratio(v, t), label, detail, year });

  switch (g.tracking_type) {
    case 'habit': {
      const ids = [g.habit_id, p.extra_habit_id].filter(Boolean) as string[];
      const parts = ids.map(id => {
        const h = ctx.habits.find(x => x.id === id);
        const avg = h ? ytdWeeklyAvg(ctx.logs, h, ctx.today, ctx.today) : 0;
        const t = h?.target ?? target;
        return { name: h?.name ?? 'Habit', avg, t };
      });
      if (!parts.length) return null;
      const ok = parts.every(x => x.avg >= x.t);
      const pct = Math.min(...parts.map(x => ratio(x.avg, x.t)));
      const label = parts.map(x => `${parts.length > 1 ? `${x.name} ` : ''}${x.avg.toFixed(1)} of ${x.t}/wk`).join(' · ');
      return { status: ok ? 'on_track' : 'behind', pct, label: `${label} (avg ${curYear})`, year };
    }
    case 'monthly': {
      const months = g.habit_id ? monthsLogged(ctx.logs, g.habit_id, year) : new Set<number>();
      const finished = year < curYear ? 12 : year === curYear ? curMonth - 1 : 0;
      let missed = false;
      for (let m = 1; m <= finished; m++) if (!months.has(m)) missed = true;
      const status: GoalStatus = finished === 12 && !missed ? 'hit' : missed ? 'behind' : 'on_track';
      return { status, pct: months.size / 12, label: `${months.size} of 12 months`, months, year };
    }
    case 'count': {
      const v = Number(p.count ?? 0);
      return reached(v, target, `${v} of ${target}`);
    }
    case 'checklist':
      return { status: p.done ? 'hit' : 'behind', pct: p.done ? 1 : 0, label: p.done ? `Done${p.done_at ? ` ${p.done_at}` : ''}` : 'Not done', year };
    case 'quarterly': {
      const q = [0, 1, 2, 3].map(i => !!p.q?.[i]);
      const pastQ = year < curYear ? 4 : year === curYear ? Math.floor((curMonth - 1) / 3) : 0;
      const n = q.filter(Boolean).length;
      const status: GoalStatus = n === 4 ? 'hit' : q.slice(0, pastQ).some(x => !x) ? 'behind' : 'on_track';
      return { status, pct: n / 4, label: `${n} of 4 quarters`, year };
    }
    case 'linked': {
      switch (g.linked_metric) {
        case 'giving_month':
        case 'production_month': {
          const vals: number[] = [];
          if (g.linked_metric === 'giving_month') {
            for (const [m, v] of Object.entries(ctx.givingByMonth)) if (m.startsWith(`${year}-`)) vals.push(v);
          } else {
            for (const r of ctx.advisor) if (r.month.startsWith(`${year}-`) && r.production != null) vals.push(Number(r.production));
          }
          const best = vals.length ? Math.max(...vals) : 0;
          const total = vals.reduce((a, b) => a + b, 0);
          const detail = g.linked_metric === 'giving_month' ? `${year} total ${money(total)}` : undefined;
          return reached(best, target, `Best ${year} month ${money(best)} of ${money(target)}`, detail);
        }
        case 'giving_recurring_month': {
          const items = ctx.recurring ?? [];
          const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
          const best = Math.max(0, ...months.filter(m => m <= ctx.today.slice(0, 7)).map(m => recurringTotal(items, m)));
          const nowTotal = recurringTotal(items, ctx.today.slice(0, 7));
          const total = Object.entries(ctx.givingByMonth).filter(([m]) => m.startsWith(`${year}-`)).reduce((a, [, v]) => a + v, 0);
          const r = reached(nowTotal, target, `Recurring ${money(nowTotal)}/mo of ${money(target)}`, `${year} total given ${money(total)}`);
          return best >= target && target > 0 && year <= curYear ? { ...r, status: 'hit' } : r;
        }
        case 'nw_line_item': {
          const v = g.linked_line_item_id ? ctx.latestLineItem(g.linked_line_item_id) ?? 0 : 0;
          const r = reached(v, target, `${money(v)} of ${money(target)}`);
          return p.done ? { ...r, status: 'hit', detail: 'Marked done' } : r;
        }
        case 'net_worth': return reached(ctx.latestNetWorth ?? 0, target, `${short(ctx.latestNetWorth ?? 0)} of ${short(target)}`);
        case 'net_worth_ex_business': return reached(ctx.latestNetWorthEx ?? 0, target, `${short(ctx.latestNetWorthEx ?? 0)} of ${short(target)}`);
        case 'advisor_aum': {
          const r = [...ctx.advisor].sort((a, b) => a.month.localeCompare(b.month)).reverse().find(x => x.aum != null);
          const v = Number(r?.aum ?? 0);
          return reached(v, target, `${short(v)} of ${short(target)}`);
        }
        case 'advisor_nna_ytd': {
          const v = ctx.advisor.filter(r => r.month.startsWith(`${year}-`)).reduce((t, r) => t + Number(r.nna ?? 0), 0);
          return reached(v, target, `${year} YTD ${short(v)} of ${short(target)}`);
        }
      }
      return null;
    }
  }
  return null;
}

/** Close out prefill: hit or still on track at year end counts as Hit; behind becomes Short. */
export const closeOutDefault = (s: GoalStatus | undefined): 'hit' | 'faded' | 'short' => (s === 'hit' || s === 'on_track' ? 'hit' : 'short');
