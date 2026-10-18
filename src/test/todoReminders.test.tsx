import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ListItemEditSheet } from '@/components/home/ListItemEditSheet';
import { ReminderSheet } from '@/components/home/ReminderSheet';
import { HomeListItem } from '@/hooks/useHomeList';
import { parseReminderLink } from '@/lib/todoReminderActions';

afterEach(cleanup);
const item: HomeListItem = { id: 'todo-1', text: 'Trash', user_id: null, due_date: '2026-10-19', due_time: null, completed: false, created_at: '', completed_at: null, notes: null, recurrence: null, series_id: null };

describe('personal due-time reminder', () => {
  it('refuses to enable without a time and focuses time, then saves the at rule once a time is given', () => {
    const saveReminder = vi.fn();
    render(<ListItemEditSheet item={item} kind="todo" onClose={vi.fn()} onSave={vi.fn()} onDelete={vi.fn()} onSaveReminder={saveReminder} />);
    const toggle = screen.getByRole('switch');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByLabelText('Due time')).toHaveFocus();
    fireEvent.change(screen.getByLabelText('Due time'), { target: { value: '18:00' } });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    expect(saveReminder).toHaveBeenCalledWith({ kind: 'at' }, { date: '2026-10-19', time: '18:00' });
  });
  it('turns off the current user reminder when the time is cleared', () => {
    const saveReminder = vi.fn();
    render(<ListItemEditSheet item={{ ...item, due_time: '18:00' }} kind="todo" reminder={{ kind: 'at' }} onClose={vi.fn()} onSave={vi.fn()} onDelete={vi.fn()} onSaveReminder={saveReminder} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    fireEvent.change(screen.getByLabelText('Due time'), { target: { value: '' } });
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    expect(saveReminder).toHaveBeenCalledWith(null, { date: '2026-10-19', time: null });
  });
});

describe('reminder actions', () => {
  it('marks the actual to do done and closes only after success', async () => {
    const onDone = vi.fn().mockResolvedValue(true), onClose = vi.fn();
    render(<ReminderSheet item={item} automaticAction={null} ready canSnooze onDone={onDone} onSnooze={vi.fn()} onClose={onClose} onOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Done$/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onDone).toHaveBeenCalledWith('todo-1');
  });
  it.each(['hour', 'tomorrow'] as const)('snoozes %s without changing the to do', async action => {
    const onDone = vi.fn(), onSnooze = vi.fn().mockResolvedValue('2026-10-19T23:45:00Z'), onClose = vi.fn();
    render(<ReminderSheet item={item} automaticAction={action} ready canSnooze onDone={onDone} onSnooze={onSnooze} onClose={onClose} onOpen={vi.fn()} />);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSnooze).toHaveBeenCalledExactlyOnceWith('todo-1', action);
    expect(onDone).not.toHaveBeenCalled();
  });
  it('does not treat unknown URL values as actions', () => {
    expect(parseReminderLink('?todo=abc&action=delete')).toEqual({ todoId: 'abc', action: null, userId: null });
    expect(parseReminderLink('?todo=abc&action=done&reminderUser=joe')).toEqual({ todoId: 'abc', action: 'done', userId: 'joe' });
  });
});