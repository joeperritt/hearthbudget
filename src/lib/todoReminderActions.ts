export type ReminderAction = 'done' | 'hour' | 'tomorrow';

export function parseReminderLink(search: string) {
  const query = new URLSearchParams(search);
  const todoId = query.get('todo');
  const value = query.get('action');
  const action: ReminderAction | null = value === 'done' || value === 'hour' || value === 'tomorrow' ? value : null;
  return { todoId, action, userId: query.get('reminderUser') };
}

export function reminderActionToast(action: ReminderAction, at?: string) {
  if (action === 'done') return 'Marked done';
  const time = new Date(at ?? '').toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  return action === 'hour' ? `I'll remind you at ${time}` : `I'll remind you tomorrow at ${time}`;
}