import { describe, expect, it } from 'vitest';
import { isCalendarVisible, parseCalendarVisibility, calendarDotClass } from '@/lib/homeCalendars';

const joe = { id: 'joe-calendar', label: 'Joe', owner_user_id: 'joe' };
const katie = { id: 'katie-calendar', label: 'Katie', owner_user_id: 'katie' };
const family = { id: 'family-calendar', label: 'Family', owner_user_id: null };

describe('personal calendar visibility', () => {
  it('defaults to own and shared calendars for both users', () => {
    expect([joe, katie, family].map(c => isCalendarVisible(c, 'joe', {}))).toEqual([true, false, true]);
    expect([joe, katie, family].map(c => isCalendarVisible(c, 'katie', {}))).toEqual([false, true, true]);
  });
  it('honors explicit on and off choices over ownership', () => {
    expect(isCalendarVisible(katie, 'joe', { 'katie-calendar': true })).toBe(true);
    expect(isCalendarVisible(family, 'joe', { 'family-calendar': false })).toBe(false);
  });
  it('keeps new calendars on their ownership default', () => {
    expect(isCalendarVisible(joe, 'joe', { 'removed-calendar': false })).toBe(true);
  });
  it('only reads boolean choices', () => {
    expect(parseCalendarVisibility({ a: true, b: false, c: 'false' })).toEqual({ a: true, b: false });
    expect(parseCalendarVisibility(null)).toEqual({});
  });
  it('keeps known calendar colors stable', () => {
    expect(calendarDotClass('998cbf6a-bde6-4bb3-8434-2f0cc501bb88', [])).toBe('bg-primary');
    expect(calendarDotClass('6cbd2c52-0f44-4709-b254-48f3e0899caf', [])).toBe('bg-success');
    expect(calendarDotClass('5a28d561-9c6d-4035-a801-2ce4a7e31dbd', [])).toBe('bg-accent');
  });
});
