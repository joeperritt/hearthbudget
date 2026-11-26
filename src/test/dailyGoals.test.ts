import { describe, expect, it } from 'vitest';
import { addDays, canEditDay, currentStreak, monthCount, nyToday, weekCount, weekStart, ytdWeeklyAvg } from '@/lib/habits';
import { normalizeHomeCards } from '@/components/home/HomePage';

const H = { id: 'qt', start_date: '2026-11-26' };
const log = (d: string, v = 1, habit_id = 'qt') => ({ habit_id, log_date: d, value: v });

describe('Daily Goals dates', () => {
  it('weeks run Sunday to Saturday', () => {
    expect(weekStart('2026-11-26')).toBe('2026-11-22'); // Thursday -> Sunday
    expect(weekStart('2026-11-29')).toBe('2026-11-29'); // Sunday
    expect(weekCount([log('2026-11-28'), log('2026-11-29')], 'qt', '2026-11-28')).toBe(1);
  });
  it('uses the New York date', () => {
    expect(nyToday(new Date('2026-11-27T03:30:00Z'))).toBe('2026-11-26');
  });
  it('days before Nov 26, 2026 and future days cannot be edited', () => {
    expect(canEditDay('2026-11-25', '2026-11-26')).toBe(false);
    expect(canEditDay('2026-11-26', '2026-11-26')).toBe(true);
    expect(canEditDay('2026-11-27', '2026-11-26')).toBe(false);
  });
  it('counts reset on Jan 1', () => {
    const logs = [log('2026-12-30'), log('2026-12-31'), log('2027-01-01')];
    expect(weekCount(logs, 'qt', '2027-01-01')).toBe(1);
    expect(ytdWeeklyAvg(logs, H, '2027-01-01', '2027-01-01')).toBeCloseTo(1);
    expect(currentStreak(logs, 'qt', '2027-01-01')).toBe(1);
  });
  it('2026 average covers only Nov 26 onward', () => {
    const logs = Array.from({ length: 14 }, (_, i) => log(addDays('2026-11-26', i), 1)).filter((_, i) => i % 7 < 5);
    expect(ytdWeeklyAvg(logs, H, '2026-12-09', '2026-12-09')).toBeCloseTo(5);
  });
  it('workouts count 2 in a day as 2', () => {
    expect(weekCount([log('2026-11-27', 2, 'w'), log('2026-11-28', 1, 'w')], 'w', '2026-11-28')).toBe(3);
  });
  it('occasional habits count per month', () => {
    expect(monthCount([log('2026-11-27', 1, 'd'), log('2026-12-01', 1, 'd')], 'd', '2026-12-15')).toBe(1);
  });
  it('streak counts back from today or yesterday', () => {
    const logs = [log('2026-11-27'), log('2026-11-28'), log('2026-11-29')];
    expect(currentStreak(logs, 'qt', '2026-11-30')).toBe(3);
    expect(currentStreak(logs, 'qt', '2026-12-01')).toBe(0);
  });
});

describe('Home layout', () => {
  it('maps the removed store card to Daily Goals', () => {
    expect(normalizeHomeCards(['todo', 'store', 'calendar'])).toEqual(['todo', 'goals', 'calendar']);
    expect(normalizeHomeCards(['calendar', 'todo'])).toEqual(['calendar', 'todo', 'goals']);
    expect(normalizeHomeCards(null)).toEqual(['calendar', 'todo', 'goals']);
  });
});
