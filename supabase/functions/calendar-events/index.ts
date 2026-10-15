import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getGoogleAccessToken, hasServiceAccount } from '../_shared/google-auth.ts';

// Household time zone (Lexington, SC). Event times are returned as local
// wall-clock strings "YYYY-MM-DDTHH:mm" in this zone.
const TZ = 'America/New_York';
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; text: string }>();

interface Ev { title: string; start: string; end: string | null; allDay: boolean; location: string | null; calendar: string; calendarId: string }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function utcToLocal(d: Date): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const g = (t: string) => p.find(x => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

// Parse an ICS date value to { local, allDay }.
function parseDate(value: string, params: string): { local: string; allDay: boolean } | null {
  const v = value.trim();
  if (/VALUE=DATE(?!-)/.test(params) || /^\d{8}$/.test(v)) {
    return { local: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, allDay: true };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  if (m[7] === 'Z') {
    return { local: utcToLocal(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]))), allDay: false };
  }
  const tzid = params.match(/TZID=([^;:]+)/)?.[1];
  if (tzid && tzid !== TZ) {
    // Convert from the given zone to TZ via offset estimation.
    const guess = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
    try {
      const inZone = new Date(guess.toLocaleString('en-US', { timeZone: tzid }));
      const asUtc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
      return { local: utcToLocal(new Date(guess.getTime() - (inZone.getTime() - asUtc.getTime()))), allDay: false };
    } catch { /* fall through */ }
  }
  return { local: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`, allDay: false };
}

function unescape(s: string) {
  return s.replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

// Shift a local string by n days/months/years, preserving the time part.
function shift(local: string, freq: string, n: number): string {
  const [datePart, timePart] = local.split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (freq === 'DAILY') dt.setUTCDate(dt.getUTCDate() + n);
  else if (freq === 'WEEKLY') dt.setUTCDate(dt.getUTCDate() + 7 * n);
  else if (freq === 'MONTHLY') dt.setUTCMonth(dt.getUTCMonth() + n);
  else if (freq === 'YEARLY') dt.setUTCFullYear(dt.getUTCFullYear() + n);
  const s = dt.toISOString().slice(0, 10);
  return timePart ? `${s}T${timePart}` : s;
}

function parseICS(text: string, calendar: string, calendarId: string, from: string, to: string): Ev[] {
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const out: Ev[] = [];
  let cur: Record<string, { params: string; value: string }[]> | null = null;
  const overridden = new Set<string>();
  const blocks: Record<string, { params: string; value: string }[]>[] = [];
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) blocks.push(cur); cur = null; continue; }
    if (!cur) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const head = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const [name, ...rest] = head.split(';');
    (cur[name] ||= []).push({ params: rest.join(';'), value });
  }
  for (const b of blocks) {
    if (b['RECURRENCE-ID'] && b['UID']) {
      const r = parseDate(b['RECURRENCE-ID'][0].value, b['RECURRENCE-ID'][0].params);
      if (r) overridden.add(`${b['UID'][0].value}|${r.local}`);
    }
  }
  for (const b of blocks) {
    if (b['STATUS']?.[0]?.value === 'CANCELLED') continue;
    const ds = b['DTSTART']?.[0];
    if (!ds) continue;
    const start = parseDate(ds.value, ds.params);
    if (!start) continue;
    const de = b['DTEND']?.[0];
    const end = de ? parseDate(de.value, de.params) : null;
    const title = unescape(b['SUMMARY']?.[0]?.value || '(No title)');
    const location = b['LOCATION']?.[0]?.value ? unescape(b['LOCATION'][0].value) : null;
    const uid = b['UID']?.[0]?.value || '';
    const durationDays = end && start.allDay
      ? Math.round((Date.parse(end.local) - Date.parse(start.local)) / 86400000) : 0;
    const exdates = new Set<string>();
    for (const ex of b['EXDATE'] || []) for (const v of ex.value.split(',')) {
      const p = parseDate(v, ex.params); if (p) exdates.add(p.local);
    }
    const push = (s: string, e: string | null) => {
      const endKey = (e && start.allDay) ? e : (e || s);
      if (endKey.slice(0, 10) < from && s.slice(0, 10) < from) return;
      if (s.slice(0, 10) > to) return;
      out.push({ title, start: s, end: e, allDay: start.allDay, location, calendar, calendarId });
    };
    const rrule = b['RRULE']?.[0]?.value;
    if (!rrule || b['RECURRENCE-ID']) {
      push(start.local, end?.local ?? null);
      continue;
    }
    const rr = Object.fromEntries(rrule.split(';').map(kv => kv.split('=')));
    const freq = rr.FREQ;
    if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) { push(start.local, end?.local ?? null); continue; }
    const interval = Number(rr.INTERVAL || 1);
    const count = rr.COUNT ? Number(rr.COUNT) : Infinity;
    const until = rr.UNTIL ? parseDate(rr.UNTIL, '')?.local.slice(0, 10) ?? null : null;
    const dayCodes = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
    const byday: string[] | null = freq === 'WEEKLY' && rr.BYDAY ? rr.BYDAY.split(',') : null;
    const spanMs = end ? Date.parse(end.local) - Date.parse(start.local) : 0;
    let n = 0;
    for (let i = 0; i < 2000 && n < count; i++) {
      const base = shift(start.local, freq, i * interval);
      const candidates: string[] = [];
      if (byday) {
        const baseDate = new Date(base.slice(0, 10) + 'T00:00:00Z');
        const weekStart = new Date(baseDate); weekStart.setUTCDate(baseDate.getUTCDate() - baseDate.getUTCDay());
        for (let k = 0; k < 7; k++) {
          const d = new Date(weekStart); d.setUTCDate(weekStart.getUTCDate() + k);
          if (!byday.some(c => c.endsWith(dayCodes[d.getUTCDay()]))) continue;
          const ds2 = d.toISOString().slice(0, 10);
          if (ds2 < start.local.slice(0, 10)) continue;
          candidates.push(base.includes('T') ? `${ds2}T${base.split('T')[1]}` : ds2);
        }
      } else candidates.push(base);
      let stop = false;
      for (const c of candidates) {
        if (n >= count) break;
        if (until && c.slice(0, 10) > until) { stop = true; break; }
        if (c.slice(0, 10) > to) { stop = true; break; }
        n++;
        if (exdates.has(c) || overridden.has(`${uid}|${c}`)) continue;
        let e: string | null = null;
        if (end) {
          if (start.allDay) e = shift(c, 'DAILY', durationDays);
          else {
            const dt = new Date(Date.parse(c + ':00Z') + spanMs).toISOString();
            e = dt.slice(0, 16);
          }
        }
        push(c, e);
      }
      if (stop) break;
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: uErr } = await supabase.auth.getUser();
    if (uErr || !user) return json({ error: 'Unauthorized' }, 401);

    // RLS scopes this to the caller's household.
    const { data: cals, error } = await supabase.from('household_calendars').select('id, label, ics_url, google_calendar_id');
    if (error) return json({ error: error.message }, 500);
    if (!cals?.length) return json({ events: [], calendars: 0 });

    const today = utcToLocal(new Date()).slice(0, 10);
    const toD = new Date(today + 'T00:00:00Z'); toD.setUTCDate(toD.getUTCDate() + 60);
    const to = toD.toISOString().slice(0, 10);

    const errors: string[] = [];
    const all: Ev[] = [];
    const fromGoogle = async (c: { id: string; label: string; google_calendar_id: string }) => {
      const token = await getGoogleAccessToken();
      const fromD = new Date(today + 'T00:00:00Z'); fromD.setUTCDate(fromD.getUTCDate() - 1);
      const params = new URLSearchParams({
        singleEvents: 'true', orderBy: 'startTime', timeZone: TZ, maxResults: '250',
        timeMin: fromD.toISOString(), timeMax: new Date(to + 'T23:59:59Z').toISOString(),
      });
      const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.google_calendar_id)}/events?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error(`Google HTTP ${r.status}: ${await r.text()}`);
      const data = await r.json();
      const local = (v: { date?: string; dateTime?: string } | undefined) => {
        if (!v) return null;
        if (v.date) return v.date;
        // Requested in TZ, so dateTime carries the household offset; keep wall clock.
        return v.dateTime ? utcToLocal(new Date(v.dateTime)) : null;
      };
      for (const it of data.items ?? []) {
        if (it.status === 'cancelled') continue;
        const s = local(it.start); if (!s) continue;
        const e = local(it.end);
        const allDay = Boolean(it.start?.date);
        const endKey = e ?? s;
        if ((allDay ? endKey <= today : endKey.slice(0, 10) < today) && s.slice(0, 10) < today) continue;
        if (s.slice(0, 10) > to) continue;
        all.push({ title: it.summary || '(No title)', start: s, end: e, allDay, location: it.location ?? null, calendar: c.label, calendarId: c.id });
      }
    };
    await Promise.all(cals.map(async (c) => {
      if (c.google_calendar_id && hasServiceAccount()) {
        try { await fromGoogle(c as { id: string; label: string; google_calendar_id: string }); return; }
        catch (e) { console.error(`Google read for ${c.id} failed, using iCal:`, e); }
      }
      try {
        const url = c.ics_url.replace(/^webcal:/i, 'https:');
        let hit = cache.get(url);
        if (!hit || Date.now() - hit.at > CACHE_MS) {
          const r = await fetch(url);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          hit = { at: Date.now(), text: await r.text() };
          cache.set(url, hit);
        }
        all.push(...parseICS(hit.text, c.label, c.id, today, to));
      } catch (e) {
        console.error(`Calendar ${c.id} failed:`, e);
        errors.push(c.label);
      }
    }));
    all.sort((a, b) => a.start.localeCompare(b.start));
    return json({ events: all, calendars: cals.length, errors, today });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
