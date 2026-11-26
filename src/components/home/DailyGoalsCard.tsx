import { useState } from 'react';
import { ChevronLeft, ChevronRight, Check, Minus, Plus } from 'lucide-react';
import { useDailyGoals } from '@/hooks/useDailyGoals';
import { HabitDef, addDays, canEditDay, currentStreak, monthCount, nyToday, weekCount, ytdWeeklyAvg } from '@/lib/habits';
import { WidgetSkeleton } from './WidgetSkeleton';
import { cn } from '@/lib/utils';

const fmtDay = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

export function DailyGoalsCard() {
  const { habits, logs, loading, setValue } = useDailyGoals();
  const today = nyToday();
  const [day, setDay] = useState(today);
  const daily = habits.filter(h => h.section === 'daily');
  const occasional = habits.filter(h => h.section === 'occasional');
  const valueOf = (h: HabitDef) => Number(logs.find(l => l.habit_id === h.id && l.log_date === day)?.value ?? 0);

  return (
    <section className="bg-card rounded-2xl border border-border p-4 shadow-sm lg:h-full lg:flex lg:flex-col lg:min-h-0">
      <h2 className="font-display text-lg font-semibold text-foreground">Daily Goals</h2>
      {loading ? <WidgetSkeleton /> : habits.length === 0 ? <p className="text-xs text-muted-foreground py-2">No goals yet</p> : (
        <div className="lg:flex-1 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
          <div className="mt-2 flex items-center justify-between">
            <button aria-label="Previous day" onClick={() => setDay(addDays(day, -1))} className="p-2 -ml-2 text-muted-foreground active:text-foreground"><ChevronLeft size={18} /></button>
            <p className="text-sm font-medium text-foreground">{day === today ? `Today · ${fmtDay(day)}` : fmtDay(day)}</p>
            <button aria-label="Next day" disabled={day >= today} onClick={() => setDay(addDays(day, 1))} className="p-2 -mr-2 text-muted-foreground active:text-foreground disabled:opacity-30"><ChevronRight size={18} /></button>
          </div>
          <ul className="divide-y divide-border">
            {daily.map(h => <HabitRow key={h.id} h={h} day={day} today={today} value={valueOf(h)} logs={logs} onSet={v => setValue(h.id, day, v)} />)}
          </ul>
          {occasional.length > 0 && (
            <>
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Occasional</p>
              <ul className="divide-y divide-border">
                {occasional.map(h => <HabitRow key={h.id} small h={h} day={day} today={today} value={valueOf(h)} logs={logs} onSet={v => setValue(h.id, day, v)} />)}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function HabitRow({ h, day, today, value, logs, onSet, small }: { h: HabitDef; day: string; today: string; value: number; logs: { habit_id: string; log_date: string; value: number }[]; onSet: (v: number) => void; small?: boolean }) {
  const editable = canEditDay(day, today, h.start_date);
  const period = h.period === 'month' ? monthCount(logs, h.id, day) : weekCount(logs, h.id, day);
  const avg = ytdWeeklyAvg(logs, h, day, today);
  const streak = h.section === 'daily' && h.kind === 'yes_no' ? currentStreak(logs, h.id, today) : 0;
  return (
    <li className={cn('flex items-center gap-3', small ? 'py-2' : 'py-2.5')}>
      <div className="flex-1 min-w-0">
        <p className={cn('text-foreground', small ? 'text-[13px]' : 'text-sm font-medium')}>{h.name}</p>
        <p className="text-[11px] text-muted-foreground">
          {h.period === 'month' ? `This month ${period} of ${h.target}` : `This week ${period} of ${h.target}`}
          {h.period === 'week' && ` · Avg ${avg.toFixed(1)}/wk`}
          {streak > 1 && ` · ${streak} day streak`}
        </p>
      </div>
      {!editable ? <span className="text-xs text-muted-foreground">N/A</span> : h.kind === 'counter' ? (
        <div className="flex items-center gap-2">
          <button aria-label={`Fewer ${h.name}`} disabled={value <= 0} onClick={() => onSet(value - 1)} className="w-8 h-8 rounded-full border border-border flex items-center justify-center disabled:opacity-30"><Minus size={14} /></button>
          <span className="w-5 text-center text-sm font-semibold tabular-nums text-foreground">{value}</span>
          <button aria-label={`More ${h.name}`} onClick={() => onSet(value + 1)} className="w-8 h-8 rounded-full border border-border flex items-center justify-center"><Plus size={14} /></button>
        </div>
      ) : (
        <button aria-label={h.name} aria-pressed={value > 0} onClick={() => onSet(value > 0 ? 0 : 1)}
          className={cn('rounded-full border-2 flex items-center justify-center shrink-0 transition-colors', small ? 'w-7 h-7' : 'w-8 h-8', value > 0 ? 'bg-accent border-accent text-accent-foreground' : 'border-muted-foreground/40')}>
          {value > 0 && <Check size={small ? 13 : 15} strokeWidth={3} />}
        </button>
      )}
    </li>
  );
}
