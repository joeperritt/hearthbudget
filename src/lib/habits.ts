/** Daily Goals date math. All dates are 'YYYY-MM-DD' strings in America/New_York. */
export interface HabitDef {
  id: string; user_id: string; name: string; kind: 'yes_no' | 'counter'; target: number;
  period: 'week' | 'month'; section: 'daily' | 'occasional'; sort_order: number; active: boolean; start_date: string;
}
export interface HabitLog { habit_id: string; log_date: string; value: number }

export const TRACKING_START = '2026-11-26';

export function nyToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function addDays(d: string, n: number) {
  const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10);
}
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
/** Sunday that starts the week containing d. */
export function weekStart(d: string) { return addDays(d, -new Date(d + 'T00:00:00Z').getUTCDay()); }
const yearStart = (d: string) => `${d.slice(0, 4)}-01-01`;
const yearEnd = (d: string) => `${d.slice(0, 4)}-12-31`;
const maxD = (a: string, b: string) => (a > b ? a : b);
const minD = (a: string, b: string) => (a < b ? a : b);

function sum(logs: HabitLog[], habitId: string, from: string, to: string) {
  let t = 0;
  for (const l of logs) if (l.habit_id === habitId && l.log_date >= from && l.log_date <= to) t += Number(l.value) || 0;
  return t;
}

/** Sunday–Saturday total for the week of d, never crossing Jan 1. */
export function weekCount(logs: HabitLog[], habitId: string, d: string) {
  const s = weekStart(d);
  return sum(logs, habitId, maxD(s, yearStart(d)), minD(addDays(s, 6), yearEnd(d)));
}
export function monthCount(logs: HabitLog[], habitId: string, d: string) {
  const m = d.slice(0, 7);
  return sum(logs, habitId, `${m}-01`, `${m}-31`);
}

/** Year-to-date average per week, from max(Jan 1, habit start) through today (or year end for past years). */
export function ytdWeeklyAvg(logs: HabitLog[], habit: Pick<HabitDef, 'id' | 'start_date'>, d: string, today: string) {
  const from = maxD(yearStart(d), habit.start_date);
  const to = minD(yearEnd(d), today);
  if (to < from) return 0;
  const days = dayDiff(from, to) + 1;
  return (sum(logs, habit.id, from, to) * 7) / Math.max(days, 7);
}

/** Consecutive logged days ending at `today` (or the day before when today isn't logged yet), within the year. */
export function currentStreak(logs: HabitLog[], habitId: string, today: string) {
  const logged = new Set(logs.filter(l => l.habit_id === habitId && Number(l.value) > 0).map(l => l.log_date));
  let d = logged.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (logged.has(d) && d >= yearStart(today)) { n++; d = addDays(d, -1); }
  return n;
}

/** Which months (1–12) of a year have the habit logged at least once. */
export function monthsLogged(logs: HabitLog[], habitId: string, year: number) {
  const s = new Set<number>();
  for (const l of logs) if (l.habit_id === habitId && Number(l.value) > 0 && l.log_date.startsWith(`${year}-`)) s.add(Number(l.log_date.slice(5, 7)));
  return s;
}

export const canEditDay = (d: string, today: string, start = TRACKING_START) => d >= start && d <= today;
