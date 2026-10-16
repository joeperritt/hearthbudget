export type RecurUnit = 'day' | 'weekday' | 'week' | 'month' | 'year';
export interface Recurrence { unit: RecurUnit; interval: number; days?: number[]; from: 'due' | 'completion' }

export type RepeatPreset = 'never' | 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'semiannual' | 'yearly' | 'custom';
export const PRESETS: { id: RepeatPreset; label: string }[] = [
  { id: 'never', label: 'Never' }, { id: 'daily', label: 'Daily' }, { id: 'weekdays', label: 'Weekdays' },
  { id: 'weekly', label: 'Weekly' }, { id: 'biweekly', label: 'Every 2 weeks' }, { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Every 3 months' }, { id: 'semiannual', label: 'Every 6 months' }, { id: 'yearly', label: 'Yearly' },
  { id: 'custom', label: 'Custom' },
];
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function presetOf(r: Recurrence | null): RepeatPreset {
  if (!r) return 'never';
  const n = r.interval;
  if (r.unit === 'weekday') return 'weekdays';
  if (r.unit === 'day' && n === 1) return 'daily';
  if (r.unit === 'week' && n === 1) return 'weekly';
  if (r.unit === 'week' && n === 2 && !(r.days && r.days.length > 1)) return 'biweekly';
  if (r.unit === 'month' && [1, 3, 6].includes(n)) return n === 1 ? 'monthly' : n === 3 ? 'quarterly' : 'semiannual';
  if (r.unit === 'year' && n === 1) return 'yearly';
  return 'custom';
}

export function fromPreset(p: RepeatPreset, from: Recurrence['from'], days: number[], custom: { n: number; unit: 'day' | 'week' | 'month' }): Recurrence | null {
  switch (p) {
    case 'never': return null;
    case 'daily': return { unit: 'day', interval: 1, from };
    case 'weekdays': return { unit: 'weekday', interval: 1, from };
    case 'weekly': return { unit: 'week', interval: 1, days: days.length ? [...days].sort() : undefined, from };
    case 'biweekly': return { unit: 'week', interval: 2, from };
    case 'monthly': return { unit: 'month', interval: 1, from };
    case 'quarterly': return { unit: 'month', interval: 3, from };
    case 'semiannual': return { unit: 'month', interval: 6, from };
    case 'yearly': return { unit: 'year', interval: 1, from };
    case 'custom': return { unit: custom.unit, interval: Math.max(1, Math.min(365, Math.round(custom.n) || 1)), from };
  }
}

export function parseRecurrence(v: unknown): Recurrence | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const r = v as Recurrence;
  return ['day', 'weekday', 'week', 'month', 'year'].includes(r.unit) ? r : null;
}

export function describeRecurrence(r: Recurrence | null, dueDate?: string | null): string {
  if (!r) return '';
  const n = r.interval || 1;
  const plural = (u: string) => (n === 1 ? u : `${n} ${u}s`);
  let s: string;
  if (r.unit === 'weekday') s = 'Every weekday';
  else if (r.unit === 'day') s = n === 1 ? 'Every day' : `Every ${n} days`;
  else if (r.unit === 'week') {
    const days = r.days?.length ? r.days : dueDate ? [new Date(dueDate + 'T00:00:00').getDay()] : [];
    const names = days.map(d => DAY_NAMES[d]).join(', ');
    s = n === 1 ? (names && r.from === 'due' ? `Every ${names}` : 'Every week') : `Every ${n} weeks${names && r.from === 'due' ? ` on ${names}` : ''}`;
  } else if (r.unit === 'month') s = n === 1 ? 'Every month' : `Every ${plural('month')}`;
  else s = n === 1 ? 'Every year' : `Every ${plural('year')}`;
  return r.from === 'completion' ? `${s} after completion` : s;
}
