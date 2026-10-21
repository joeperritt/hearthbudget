import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'npm:zod@3';
import { getGoogleAccessToken } from '../_shared/google-auth.ts';

const TZ = 'America/New_York';
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const When = z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/);

const Body = z.object({
  action: z.enum(['update', 'delete']),
  calendar_id: z.string().uuid(),
  event_id: z.string().min(1).max(1024),
  changes: z.object({
    title: z.string().trim().min(1).max(200).optional(),
    start: When.optional(),
    end: When.nullable().optional(),
    all_day: z.boolean().optional(),
    location: z.string().max(300).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  }).optional(),
});

function addDays(d: string, n: number) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
function addHour(local: string) { const x = new Date(local + ':00Z'); x.setUTCHours(x.getUTCHours() + 1); return x.toISOString().slice(0, 16); }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const auth = req.headers.get('Authorization');
    if (!auth) return json({ error: 'Unauthorized' }, 401);
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: 'Unauthorized' }, 401);
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
    const b = parsed.data;
    // RLS limits this to the caller's household.
    const { data: cal } = await supabase.from('household_calendars').select('id, label, google_calendar_id, read_only').eq('id', b.calendar_id).maybeSingle();
    if (!cal) return json({ error: 'Calendar not found' }, 404);
    if (cal.read_only || !cal.google_calendar_id?.trim()) return json({ error: `${cal.label} is view only in Perritt`, code: 'read_only' }, 403);

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.google_calendar_id)}/events/${encodeURIComponent(b.event_id)}`;
    const token = await getGoogleAccessToken();
    let res: Response;
    if (b.action === 'delete') {
      res = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    } else {
      const c = b.changes ?? {};
      // deno-lint-ignore no-explicit-any
      const patch: any = {};
      if (c.title) patch.summary = c.title;
      if (c.location !== undefined) patch.location = c.location ?? '';
      if (c.notes !== undefined) patch.description = c.notes ?? '';
      if (c.start) {
        if (c.all_day) {
          const s = c.start.slice(0, 10);
          const e = c.end ? c.end.slice(0, 10) : s;
          patch.start = { date: s, dateTime: null }; patch.end = { date: addDays(e < s ? s : e, 1), dateTime: null };
        } else {
          if (c.start.length < 16) return json({ error: 'A start time is required' }, 400);
          const e = c.end && c.end.length >= 16 && c.end > c.start ? c.end : addHour(c.start);
          patch.start = { dateTime: `${c.start}:00`, timeZone: TZ, date: null }; patch.end = { dateTime: `${e}:00`, timeZone: TZ, date: null };
        }
      }
      if (!Object.keys(patch).length) return json({ error: 'Nothing to change' }, 400);
      res = await fetch(url, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    }
    if (!res.ok && !(b.action === 'delete' && res.status === 410)) {
      const t = await res.text();
      console.error(`Calendar ${b.action} failed [${res.status}]: ${t}`);
      return json({ error: `Google Calendar rejected the ${b.action}`, status: res.status, details: t }, 502);
    }
    return json({ ok: true, calendar: cal.label });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
