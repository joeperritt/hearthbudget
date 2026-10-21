import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'npm:zod@3';
import { getGoogleAccessToken } from '../_shared/google-auth.ts';
import { writeBlockReason } from '../_shared/calendar-access.ts';

const TZ = 'America/New_York';
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const Body = z.object({
  calendar_id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/).nullable().optional(),
  all_day: z.boolean().default(false),
  location: z.string().max(300).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
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
    const blocked = writeBlockReason(cal);
    if (blocked || !cal.google_calendar_id) return json({ error: blocked, code: 'read_only' }, 403);

    let start, end;
    if (b.all_day) {
      const s = b.start.slice(0, 10);
      const e = b.end ? b.end.slice(0, 10) : s;
      start = { date: s }; end = { date: addDays(e < s ? s : e, 1) }; // Google end date is exclusive
    } else {
      if (b.start.length < 16) return json({ error: 'A start time is required' }, 400);
      const e = b.end && b.end.length >= 16 && b.end > b.start ? b.end : addHour(b.start);
      start = { dateTime: `${b.start}:00`, timeZone: TZ }; end = { dateTime: `${e}:00`, timeZone: TZ };
    }
    const token = await getGoogleAccessToken();
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.google_calendar_id)}/events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: b.title, start, end, location: b.location || undefined, description: b.notes || undefined }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error(`Calendar insert failed [${res.status}]: ${t}`);
      return json({ error: 'Google Calendar rejected the event', status: res.status, details: t }, 502);
    }
    const ev = await res.json();
    return json({ ok: true, id: ev.id, calendar: cal.label });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
