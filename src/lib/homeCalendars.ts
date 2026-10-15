export interface HomeCalendar {
  id: string;
  label: string;
  owner_user_id: string | null;
  color?: string | null;
}

export type CalendarVisibility = Record<string, boolean>;

export function parseCalendarVisibility(value: unknown): CalendarVisibility {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, visible]) => typeof visible === 'boolean'));
}

export function isCalendarVisible(calendar: HomeCalendar, userId: string, choices: CalendarVisibility) {
  return choices[calendar.id] ?? (calendar.owner_user_id === null || calendar.owner_user_id === userId);
}

const FALLBACK_COLORS = ['#4285F4', '#33B679', '#E67C73', '#F6BF26', '#8E24AA', '#616161'];

/** Hex color for a calendar: its saved color, else a stable fallback by position. */
export function calendarColor(calendarId: string, calendars: HomeCalendar[]) {
  const i = calendars.findIndex(c => c.id === calendarId);
  const saved = i >= 0 ? calendars[i].color : null;
  if (saved && /^#[0-9a-f]{6}$/i.test(saved)) return saved;
  return FALLBACK_COLORS[Math.max(0, i) % FALLBACK_COLORS.length];
}
