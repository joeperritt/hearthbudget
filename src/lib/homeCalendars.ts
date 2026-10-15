export interface HomeCalendar {
  id: string;
  label: string;
  owner_user_id: string | null;
}

export type CalendarVisibility = Record<string, boolean>;

export function parseCalendarVisibility(value: unknown): CalendarVisibility {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, visible]) => typeof visible === 'boolean'));
}

export function isCalendarVisible(calendar: HomeCalendar, userId: string, choices: CalendarVisibility) {
  return choices[calendar.id] ?? (calendar.owner_user_id === null || calendar.owner_user_id === userId);
}

export function calendarDotClass(calendarId: string, calendars: HomeCalendar[]) {
  // Known calendars keep their colors even when their names or owners change.
  if (calendarId === '998cbf6a-bde6-4bb3-8434-2f0cc501bb88') return 'bg-primary';
  if (calendarId === '6cbd2c52-0f44-4709-b254-48f3e0899caf') return 'bg-success';
  if (calendarId === '5a28d561-9c6d-4035-a801-2ce4a7e31dbd') return 'bg-accent';
  const colors = ['bg-primary', 'bg-success', 'bg-accent', 'bg-warning', 'bg-muted-foreground'];
  return colors[Math.max(0, calendars.findIndex(c => c.id === calendarId)) % colors.length];
}