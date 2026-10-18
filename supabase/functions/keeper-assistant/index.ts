import { Recurrence, describeRecurrence } from '../_shared/recurrence.ts';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'npm:zod@3';
import { getGoogleAccessToken } from '../_shared/google-auth.ts';

const TZ = 'America/New_York';
const MODEL = 'gemini-2.5-flash';
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const Body = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) })).min(1).max(30),
  // Hidden context when the user tapped "Tell AI" on a specific event.
  event_context: z.object({ calendar_id: z.string().uuid(), event_id: z.string().max(1024), title: z.string().max(200) }).optional(),
});

// deno-lint-ignore no-explicit-any
function parseRule(r: any): Recurrence | null {
  if (!r || typeof r !== 'object' || !['day', 'weekday', 'week', 'month', 'year'].includes(r.unit)) return null;
  const days = Array.isArray(r.days) ? [...new Set(r.days.map(Number).filter((d: number) => d >= 0 && d <= 6))] as number[] : undefined;
  return { unit: r.unit, interval: Math.max(1, Math.min(365, Math.round(Number(r.interval) || 1))), days: r.unit === 'week' && days?.length ? days.sort() : undefined, from: r.from === 'completion' ? 'completion' : 'due' };
}

const tools = [{
  functionDeclarations: [
    {
      name: 'add_list_items',
      description: 'Add items immediately. list=todo adds to the shared To Do list with an owner; list=store adds to the shared Store List (anything to buy or pick up).',
      parameters: { type: 'OBJECT', properties: {
        list: { type: 'STRING', enum: ['todo', 'store'] },
        items: { type: 'ARRAY', items: { type: 'STRING' } },
        owner: { type: 'STRING', enum: ['joe', 'katie', 'family'], description: 'todo only' },
        due_date: { type: 'STRING', description: 'todo only, optional YYYY-MM-DD' },
        due_time: { type: 'STRING', description: 'todo only, optional HH:mm (24h)' },
        reminder: { type: 'STRING', enum: ['at', 'before15', 'before1h', 'morning_of', 'day_before'], description: 'todo only, optional push reminder for the asking user. at/before15/before1h need a due_time; morning_of = 8 AM on the due date; day_before = 8 AM the day before.' },
        recurrence: { type: 'OBJECT', description: 'Optional repeat rule (needs a due date). unit: day|weekday|week|month|year; interval: every N units; days: weekdays 0=Sun..6=Sat for weekly; from: due (fixed schedule, default) or completion (N units after it is done).', properties: {
          unit: { type: 'STRING', enum: ['day', 'weekday', 'week', 'month', 'year'] }, interval: { type: 'INTEGER' },
          days: { type: 'ARRAY', items: { type: 'INTEGER' } }, from: { type: 'STRING', enum: ['due', 'completion'] } } },
      }, required: ['list', 'items'] },
    },
    {
      name: 'find_todos',
      description: 'Search existing to dos by words in their text. Returns ids for update_todo.',
      parameters: { type: 'OBJECT', properties: {
        query: { type: 'STRING' },
        include_completed: { type: 'BOOLEAN' },
      }, required: ['query'] },
    },
    {
      name: 'update_todo',
      description: 'Change a to do found with find_todos immediately. Only include fields that change. Use clear_due_date to remove the date.',
      parameters: { type: 'OBJECT', properties: {
        id: { type: 'STRING' },
        text: { type: 'STRING' },
        owner: { type: 'STRING', enum: ['joe', 'katie', 'family'] },
        due_date: { type: 'STRING', description: 'YYYY-MM-DD' },
        due_time: { type: 'STRING', description: 'HH:mm 24h' },
        clear_due_date: { type: 'BOOLEAN' },
        recurrence: { type: 'OBJECT', description: 'Optional repeat rule (needs a due date). unit: day|weekday|week|month|year; interval: every N units; days: weekdays 0=Sun..6=Sat for weekly; from: due (fixed schedule, default) or completion (N units after it is done).', properties: {
          unit: { type: 'STRING', enum: ['day', 'weekday', 'week', 'month', 'year'] }, interval: { type: 'INTEGER' },
          days: { type: 'ARRAY', items: { type: 'INTEGER' } }, from: { type: 'STRING', enum: ['due', 'completion'] } } },
        stop_repeating: { type: 'BOOLEAN' },
        reminder: { type: 'STRING', enum: ['at', 'before15', 'before1h', 'morning_of', 'day_before'], description: 'Set a push reminder for the asking user. Needs a due date; at/before15/before1h need a due_time.' },
        clear_reminder: { type: 'BOOLEAN', description: 'Remove the asking user\'s reminder from this to do' },
        done: { type: 'BOOLEAN' },
        delete: { type: 'BOOLEAN' },
      }, required: ['id'] },
    },
    {
      name: 'propose_calendar_event',
      description: 'Propose a calendar event for the user to confirm. Does NOT create it. Times are local America/New_York.',
      parameters: { type: 'OBJECT', properties: {
        calendar_id: { type: 'STRING', description: 'id of a household calendar' },
        title: { type: 'STRING' },
        start: { type: 'STRING', description: 'YYYY-MM-DDTHH:mm, or YYYY-MM-DD when all_day' },
        end: { type: 'STRING', description: 'Optional. YYYY-MM-DDTHH:mm, or YYYY-MM-DD (inclusive last day) when all_day' },
        all_day: { type: 'BOOLEAN' },
        location: { type: 'STRING' },
        notes: { type: 'STRING' },
      }, required: ['calendar_id', 'title', 'start'] },
    },
    {
      name: 'find_events',
      description: 'Search existing events on the household Google calendars. Use before any move/reschedule/change/cancel/delete.',
      parameters: { type: 'OBJECT', properties: {
        query: { type: 'STRING', description: 'Words from the event title, e.g. "Winston groomer"' },
        from: { type: 'STRING', description: 'Optional YYYY-MM-DD. Default 14 days ago.' },
        to: { type: 'STRING', description: 'Optional YYYY-MM-DD. Default 60 days ahead.' },
      }, required: ['query'] },
    },
    {
      name: 'propose_update_event',
      description: 'Propose changes to an existing event found with find_events. Does NOT change it until the user confirms. Only include fields that change; if start moves and no end is given, the original duration is kept.',
      parameters: { type: 'OBJECT', properties: {
        calendar_id: { type: 'STRING' },
        event_id: { type: 'STRING', description: 'event_id from find_events (single occurrence), or recurring_event_id to change every occurrence' },
        title: { type: 'STRING' }, start: { type: 'STRING' }, end: { type: 'STRING' }, all_day: { type: 'BOOLEAN' },
        location: { type: 'STRING' }, notes: { type: 'STRING' },
      }, required: ['calendar_id', 'event_id'] },
    },
    {
      name: 'propose_delete_event',
      description: 'Propose deleting an existing event found with find_events. Does NOT delete until the user confirms.',
      parameters: { type: 'OBJECT', properties: {
        calendar_id: { type: 'STRING' },
        event_id: { type: 'STRING', description: 'event_id (single occurrence) or recurring_event_id (all occurrences)' },
      }, required: ['calendar_id', 'event_id'] },
    },
  ],
}];

function shiftDays(d: string, n: number) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
function addMinutes(local: string, m: number) { const x = new Date(local + ':00Z'); x.setUTCMinutes(x.getUTCMinutes() + m); return x.toISOString().slice(0, 16); }
function minutesBetween(a: string, b: string) { return Math.round((Date.parse(b + ':00Z') - Date.parse(a + ':00Z')) / 60000); }
interface Found { event_id: string; recurring_event_id: string | null; calendar_id: string; calendar: string; title: string; start: string; end: string | null; all_day: boolean }

function nowLocal() {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date());
}
function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
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
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) return json({ error: 'AI is not configured' }, 500);

    const { data: profile } = await supabase.from('profiles').select('household_id, display_name').eq('user_id', user.id).single();
    if (!profile) return json({ error: 'No household' }, 403);
    const [{ data: cals }, { data: members }] = await Promise.all([
      supabase.from('household_calendars').select('id, label, owner_user_id, google_calendar_id').eq('household_id', profile.household_id),
      supabase.from('profiles').select('user_id, display_name').eq('household_id', profile.household_id),
    ]);
    const nameOf = (id: string | null) => id ? (members?.find(m => m.user_id === id)?.display_name ?? 'someone') : 'Shared';
    const calList = (cals ?? []).map(c => `- id ${c.id}: "${c.label}" (owner: ${nameOf(c.owner_user_id)})`).join('\n');
    const own = cals?.find(c => c.owner_user_id === user.id);
    const shared = cals?.find(c => c.owner_user_id === null);

    const system = `You are the Perritt Assistant, a brief, friendly assistant for the Perritt family (Joe and Katie) in their family app, Perritt. Today is ${nowLocal()} (America/New_York; ISO date ${todayISO()}). You are talking to ${profile.display_name}. Thomas is their child.
Household calendars:
${calList || '(none)'}
Rules:
- Any shopping request ("we need milk", "pick up batteries", "buy a new hose") -> add_list_items list=store, one item per thing, short names.
- To dos ("remind me to...", "I need to...") -> add_list_items list=todo. owner defaults to ${profile.display_name.split(' ')[0].toLowerCase()}; use family for household tasks or when it mentions "we", "us" or Thomas; use the other person's name if it is for them. Add due_date/due_time only if a time frame is given.
- Resolve relative dates ("tomorrow", "next Friday", "end of the month") against today in America/New_York.
- "Remind me to..." asks for a push reminder: set a due date (and time if given) plus reminder. "at 2" / "when it's due" -> at; "15 minutes/an hour before" -> before15/before1h; "the morning of" -> morning_of; "the day before" -> day_before. If they say "remind me" with no timing, use at when a time is set, else morning_of. To remove a reminder, update_todo clear_reminder.
- Repeating to dos ("every Sunday", "every 3 months"): pass recurrence with a due_date for the first one. "every N months/after I do it" style chores (air filter) use from=completion when the user implies it; fixed schedules (trash every Sunday) use from=due with days. "stop repeating" -> find_todos then update_todo stop_repeating. Reply with the plain-words rule from the "repeats" field.
- To change, move, reschedule, complete or delete a to do: call find_todos, then update_todo (applies immediately). If several match, ask which one; if none, say so.
- For events, call propose_calendar_event; it only creates a confirmation card. Default calendar: the shared one (${shared?.id ?? 'n/a'}) if it mentions the family, Thomas, both of us or "we"; otherwise ${profile.display_name}'s own (${own?.id ?? shared?.id ?? 'n/a'}). Default duration 1 hour.
- When the user says an event was moved, rescheduled, changed, pushed, canceled or deleted, ALWAYS call find_events first, then propose_update_event or propose_delete_event on the existing event. NEVER create a new event in that case. If several events match, ask which one (list them briefly with day and time). If none match, say so and offer to create a new one.
- For recurring events change only the single occurrence mentioned (use event_id) unless the user says "every" or "all" (then use recurring_event_id).
- If a date or time is ambiguous or missing for a timed event, ask one quick follow-up question instead of guessing.
- After any action, reply with ONE short line (e.g. "Added milk and eggs to Grocery." or "Here's the event — tap Confirm to add it.").
- For anything outside lists and calendar, answer briefly and take no actions. Plain text, no markdown.${parsed.data.event_context ? `

The user is editing one specific event: "${parsed.data.event_context.title}" (calendar_id ${parsed.data.event_context.calendar_id}, event_id ${parsed.data.event_context.event_id}). Do NOT call find_events — target this exact event. Restate the change in one line, then call propose_update_event (or propose_delete_event if they ask to remove it) with this calendar_id and event_id so the confirmation card appears. Never create a new event.` : ''}`;

    // deno-lint-ignore no-explicit-any
    const contents: any[] = parsed.data.messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    const added: { list: string; items: string[] }[] = [];
    // deno-lint-ignore no-explicit-any
    const proposals: any[] = [];
    let reply = '';
    const listName: Record<string, string> = { todo: 'To Do', store: 'Store List' };
    const ownerId = (o: unknown): string | null | undefined => {
      if (o === undefined || o === null || o === '') return undefined;
      const k = String(o).toLowerCase();
      if (k === 'family') return null;
      return members?.find(m => m.display_name.split(' ')[0].toLowerCase() === k)?.user_id;
    };
    const ownerName = (id: string | null) => id ? (members?.find(m => m.user_id === id)?.display_name.split(' ')[0] ?? 'someone') : 'Family';
    const validDate = (d: unknown) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
    const validTime = (t: unknown) => typeof t === 'string' && /^\d{2}:\d{2}$/.test(t) ? t : null;
    const REMINDER_KINDS = ['at', 'before15', 'before1h', 'morning_of', 'day_before'];
    const REMINDER_WORDS: Record<string, string> = { at: 'at the due time', before15: '15 minutes before', before1h: 'an hour before', morning_of: 'the morning of', day_before: 'the day before' };
    // Save a push reminder for the asking user; returns a plain-words description or null on failure.
    const setReminder = async (todoId: string, kind: unknown, dueDate: string | null, dueTime: string | null): Promise<string | null> => {
      if (typeof kind !== 'string' || !REMINDER_KINDS.includes(kind) || !dueDate) return null;
      const rule = { kind };
      const { data: remindAt } = await supabase.rpc('compute_remind_at', { _rule: rule, _due_date: dueDate, _due_time: dueTime });
      if (!remindAt) return null;
      const { error } = await supabase.from('todo_reminders').upsert({ todo_id: todoId, user_id: user.id, rule, remind_at: remindAt, sent_at: null }, { onConflict: 'todo_id,user_id' });
      return error ? null : REMINDER_WORDS[kind];
    };

    const found = new Map<string, Found>();
    for (let step = 0; step < 6; step++) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, tools }),
      });
      if (!res.ok) {
        const t = await res.text();
        console.error(`Gemini failed [${res.status}]: ${t}`);
        return json({ error: res.status === 429 ? 'The assistant is busy. Try again in a moment.' : 'The assistant failed', status: res.status }, res.status === 429 ? 429 : 502);
      }
      const data = await res.json();
      const parts = data?.candidates?.[0]?.content?.parts ?? [];
      // deno-lint-ignore no-explicit-any
      const calls = parts.filter((p: any) => p.functionCall);
      if (!calls.length) {
        // deno-lint-ignore no-explicit-any
        reply = parts.map((p: any) => p.text || '').join('').replace(/\*\*/g, '').trim();
        break;
      }
      contents.push({ role: 'model', parts });
      // deno-lint-ignore no-explicit-any
      const responses: any[] = [];
      for (const { functionCall: fc } of calls) {
        const args = fc.args ?? {};
        let result: unknown;
        if (fc.name === 'add_list_items') {
          const list = args.list === 'todo' || args.list === 'store' ? args.list : null;
          const items = (Array.isArray(args.items) ? args.items : []).map((x: unknown) => String(x).trim().slice(0, 300)).filter(Boolean).slice(0, 25);
          if (!list || !items.length) result = { error: 'invalid list or items' };
          else {
            const owner = list === 'todo' ? (ownerId(args.owner) === undefined ? user.id : ownerId(args.owner)!) : null;
            const rule = list === 'todo' ? parseRule(args.recurrence) : null;
            const dueDate = list === 'todo' ? (validDate(args.due_date) ?? (rule ? todayISO() : null)) : null;
            const { data: inserted, error } = await supabase.from('home_list_items').insert(items.map((text: string) => ({
              household_id: profile.household_id, list_type: list, user_id: owner, text, created_by: user.id,
              due_date: dueDate, due_time: dueDate ? validTime(args.due_time) : null, recurrence: rule,
            }))).select('id');
            if (error) { console.error(error); result = { error: 'could not save' }; }
            else {
              let reminderNote: string | null = null;
              if (list === 'todo' && args.reminder) for (const row of inserted ?? []) reminderNote = await setReminder(row.id, args.reminder, dueDate, validTime(args.due_time));
              added.push({ list, items });
              result = { ok: true, added: items, list: listName[list], owner: list === 'todo' ? ownerName(owner) : undefined, due_date: dueDate, repeats: rule ? describeRecurrence(rule, dueDate) : undefined, reminder: reminderNote ?? undefined };
            }
          }
        } else if (fc.name === 'find_todos') {
          const words = String(args.query ?? '').toLowerCase().split(/\s+/).filter(w => w.length > 2);
          let q = supabase.from('home_list_items').select('id, text, user_id, due_date, due_time, completed, recurrence').eq('household_id', profile.household_id).eq('list_type', 'todo').limit(200);
          if (!args.include_completed) q = q.eq('completed', false);
          const { data, error } = await q;
          if (error) result = { error: 'could not search' };
          else {
            const matches = (data ?? []).filter(t => !words.length || words.some(w => t.text.toLowerCase().includes(w)))
              .map(t => ({ id: t.id, text: t.text, owner: ownerName(t.user_id), due_date: t.due_date, due_time: t.due_time?.slice(0, 5) ?? null, done: t.completed, repeats: t.recurrence ? describeRecurrence(t.recurrence as Recurrence, t.due_date) : null }));
            result = { matches: matches.slice(0, 15) };
          }
        } else if (fc.name === 'update_todo') {
          const id = String(args.id ?? '');
          const { data: cur } = await supabase.from('home_list_items').select('id, text, due_date, due_time').eq('id', id).eq('list_type', 'todo').maybeSingle();
          if (!cur) result = { error: 'to do not found; call find_todos first' };
          else if (args.delete) {
            const { error } = await supabase.from('home_list_items').delete().eq('id', id);
            result = error ? { error: 'could not delete' } : { ok: true, deleted: cur.text };
          } else {
            // deno-lint-ignore no-explicit-any
            const patch: any = {};
            if (args.text) patch.text = String(args.text).trim().slice(0, 300);
            const o = ownerId(args.owner); if (o !== undefined) patch.user_id = o;
            if (args.clear_due_date) { patch.due_date = null; patch.due_time = null; }
            else if (validDate(args.due_date)) { patch.due_date = validDate(args.due_date); patch.due_time = validTime(args.due_time); }
            else if (validTime(args.due_time)) patch.due_time = validTime(args.due_time);
            if (args.stop_repeating) patch.recurrence = null;
            else if (parseRule(args.recurrence)) { patch.recurrence = parseRule(args.recurrence); if (!patch.due_date && !cur.due_date) patch.due_date = todayISO(); }
            if (typeof args.done === 'boolean') { patch.completed = args.done; patch.completed_at = args.done ? new Date().toISOString() : null; }
            if (!Object.keys(patch).length && !args.reminder && !args.clear_reminder) result = { error: 'no changes given' };
            else {
              const { error } = Object.keys(patch).length ? await supabase.from('home_list_items').update(patch).eq('id', id) : { error: null };
              let reminderNote: string | null = null;
              if (!error && args.clear_reminder) { await supabase.from('todo_reminders').delete().eq('todo_id', id).eq('user_id', user.id); reminderNote = 'reminder removed'; }
              if (!error && args.reminder) reminderNote = (await setReminder(id, args.reminder, patch.due_date ?? cur.due_date, patch.due_time ?? cur.due_time?.slice(0, 5) ?? null)) ?? 'could not set the reminder (needs a due date)';
              result = error ? { error: 'could not update' } : { ok: true, updated: cur.text, changes: patch, reminder: reminderNote ?? undefined, repeats: patch.recurrence ? describeRecurrence(patch.recurrence, patch.due_date ?? cur.due_date) : patch.recurrence === null ? 'no longer repeats' : undefined };
              if (!error) added.push({ list: 'todo', items: [] });
            }
          }
        } else if (fc.name === 'propose_calendar_event') {
          const cal = cals?.find(c => c.id === args.calendar_id) ?? own ?? shared;
          const allDay = Boolean(args.all_day);
          const start = String(args.start ?? '');
          const valid = allDay ? /^\d{4}-\d{2}-\d{2}/.test(start) : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(start);
          if (!cal || !valid || !args.title) result = { error: 'need a calendar, title and a valid start' };
          else {
            const s = allDay ? start.slice(0, 10) : start.slice(0, 16);
            const end = args.end ? String(args.end).slice(0, allDay ? 10 : 16) : (allDay ? s : addHour(s));
            proposals.push({ kind: 'create', calendar_id: cal.id, title: String(args.title).slice(0, 200), start: s, end, all_day: allDay, location: args.location ?? null, notes: args.notes ?? null });
            result = { ok: true, status: 'shown to user for confirmation; not created yet' };
          }
        } else if (fc.name === 'find_events') {
          const q = String(args.query ?? '').slice(0, 100);
          const today = todayISO();
          const from = /^\d{4}-\d{2}-\d{2}$/.test(args.from ?? '') ? args.from : shiftDays(today, -14);
          const to = /^\d{4}-\d{2}-\d{2}$/.test(args.to ?? '') ? args.to : shiftDays(today, 60);
          try {
            const token = await getGoogleAccessToken();
            const matches: Found[] = [];
            await Promise.all((cals ?? []).filter(c => c.google_calendar_id).map(async c => {
              const params = new URLSearchParams({ q, singleEvents: 'true', orderBy: 'startTime', timeZone: TZ, maxResults: '20',
                timeMin: new Date(from + 'T00:00:00-05:00').toISOString(), timeMax: new Date(to + 'T23:59:59-05:00').toISOString() });
              const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.google_calendar_id!)}/events?${params}`, { headers: { Authorization: `Bearer ${token}` } });
              if (!r.ok) { console.error(`find_events ${c.id} [${r.status}]: ${await r.text()}`); return; }
              for (const it of (await r.json()).items ?? []) {
                if (it.status === 'cancelled') continue;
                const allDay = Boolean(it.start?.date);
                const st = allDay ? it.start.date : String(it.start?.dateTime ?? '').slice(0, 16);
                const en = allDay ? (it.end?.date ? shiftDays(it.end.date, -1) : st) : (it.end?.dateTime ? String(it.end.dateTime).slice(0, 16) : null);
                matches.push({ event_id: it.id, recurring_event_id: it.recurringEventId ?? null, calendar_id: c.id, calendar: c.label, title: it.summary || '(No title)', start: st, end: en, all_day: allDay });
              }
            }));
            matches.sort((a, b) => a.start.localeCompare(b.start));
            for (const m of matches) { found.set(`${m.calendar_id}|${m.event_id}`, m); if (m.recurring_event_id && !found.has(`${m.calendar_id}|${m.recurring_event_id}`)) found.set(`${m.calendar_id}|${m.recurring_event_id}`, { ...m, event_id: m.recurring_event_id }); }
            result = { matches: matches.slice(0, 15) };
          } catch (e) { console.error(e); result = { error: 'calendar search unavailable' }; }
        } else if (fc.name === 'propose_update_event' || fc.name === 'propose_delete_event') {
          const ev = found.get(`${args.calendar_id}|${args.event_id}`);
          if (!ev) result = { error: 'unknown event; call find_events first and use its ids' };
          else {
            const series = ev.event_id === ev.recurring_event_id;
            const before = { title: ev.title, start: ev.start, end: ev.end, all_day: ev.all_day };
            if (fc.name === 'propose_delete_event') {
              proposals.push({ kind: 'delete', calendar_id: ev.calendar_id, event_id: ev.event_id, series, before, title: ev.title, start: ev.start, end: ev.end, all_day: ev.all_day });
              result = { ok: true, status: 'delete shown to user for confirmation' };
            } else {
              // deno-lint-ignore no-explicit-any
              const changes: any = {};
              if (args.title) changes.title = String(args.title).slice(0, 200);
              if (args.location !== undefined) changes.location = args.location;
              if (args.notes !== undefined) changes.notes = args.notes;
              if (args.start) {
                const allDay = args.all_day ?? ev.all_day;
                const s = String(args.start).slice(0, allDay ? 10 : 16);
                let e = args.end ? String(args.end).slice(0, allDay ? 10 : 16) : null;
                if (!e) e = allDay ? s : (!ev.all_day && ev.end ? addMinutes(s, minutesBetween(ev.start, ev.end)) : addMinutes(s, 60));
                Object.assign(changes, { start: s, end: e, all_day: Boolean(allDay) });
              }
              if (!Object.keys(changes).length) result = { error: 'no changes given' };
              else {
                proposals.push({ kind: 'update', calendar_id: ev.calendar_id, event_id: ev.event_id, series, before, changes,
                  title: changes.title ?? ev.title, start: changes.start ?? ev.start, end: changes.end ?? ev.end, all_day: changes.all_day ?? ev.all_day });
                result = { ok: true, status: 'update shown to user for confirmation' };
              }
            }
          }
        } else result = { error: 'unknown tool' };
        responses.push({ functionResponse: { name: fc.name, response: { result } } });
      }
      contents.push({ role: 'user', parts: responses });
    }
    if (!reply) reply = proposals.length ? 'Tap Confirm to add it.' : added.length ? `Added ${added.map(a => `${a.items.join(', ')} to ${listName[a.list]}`).join('; ')}.` : 'Sorry, I didn\'t catch that.';
    return json({ reply, added, proposals });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
