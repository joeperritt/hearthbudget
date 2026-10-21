import { assertEquals } from 'jsr:@std/assert@1';
import { writeBlockReason } from './calendar-access.ts';
Deno.test('rejects calendars with no Google Calendar ID', () => {
  assertEquals(writeBlockReason({ label: 'Work', google_calendar_id: null, read_only: false }), 'Work is view only in Perritt');
  assertEquals(writeBlockReason({ label: 'Work', google_calendar_id: '  ' }), 'Work is view only in Perritt');
});
Deno.test('rejects calendars marked view only even with a Google ID', () => {
  assertEquals(writeBlockReason({ label: 'Joe', google_calendar_id: 'a@b.com', read_only: true }), 'Joe is view only in Perritt');
});
Deno.test('allows writable calendars', () => {
  assertEquals(writeBlockReason({ label: 'Joe', google_calendar_id: 'a@b.com', read_only: false }), null);
});
