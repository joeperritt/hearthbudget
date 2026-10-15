import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'npm:zod@3';

const TZ = 'America/New_York';
const MODEL = 'gemini-2.5-flash';
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const Body = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) })).min(1).max(30),
});

const tools = [{
  functionDeclarations: [
    {
      name: 'add_list_items',
      description: 'Add items to a household list immediately. family = shared Family To Do; personal = the current user\'s private My To Do; grocery = shared Grocery List.',
      parameters: { type: 'OBJECT', properties: {
        list: { type: 'STRING', enum: ['family', 'personal', 'grocery'] },
        items: { type: 'ARRAY', items: { type: 'STRING' } },
      }, required: ['list', 'items'] },
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
  ],
}];

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
      supabase.from('household_calendars').select('id, label, owner_user_id').eq('household_id', profile.household_id),
      supabase.from('profiles').select('user_id, display_name').eq('household_id', profile.household_id),
    ]);
    const nameOf = (id: string | null) => id ? (members?.find(m => m.user_id === id)?.display_name ?? 'someone') : 'Shared';
    const calList = (cals ?? []).map(c => `- id ${c.id}: "${c.label}" (owner: ${nameOf(c.owner_user_id)})`).join('\n');
    const own = cals?.find(c => c.owner_user_id === user.id);
    const shared = cals?.find(c => c.owner_user_id === null);

    const system = `You are Keeper, a brief, friendly assistant for Joe and Katie's family app. Today is ${nowLocal()} (America/New_York; ISO date ${todayISO()}). You are talking to ${profile.display_name}. Thomas is their child.
Household calendars:
${calList || '(none)'}
Rules:
- Grocery requests ("we need milk and eggs") -> add_list_items list=grocery, one item per thing, short names.
- "Remind me to..." -> list=personal unless clearly a shared household task -> family.
- For events, call propose_calendar_event; it only creates a confirmation card. Default calendar: the shared one (${shared?.id ?? 'n/a'}) if it mentions the family, Thomas, both of us or "we"; otherwise ${profile.display_name}'s own (${own?.id ?? shared?.id ?? 'n/a'}). Default duration 1 hour.
- If a date or time is ambiguous or missing for a timed event, ask one quick follow-up question instead of guessing.
- After any action, reply with ONE short line (e.g. "Added milk and eggs to Grocery." or "Here's the event — tap Confirm to add it.").
- For anything outside lists and calendar, answer briefly and take no actions. Plain text, no markdown.`;

    // deno-lint-ignore no-explicit-any
    const contents: any[] = parsed.data.messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    const added: { list: string; items: string[] }[] = [];
    // deno-lint-ignore no-explicit-any
    const proposals: any[] = [];
    let reply = '';
    const listName: Record<string, string> = { family: 'Family To Do', personal: 'My To Do', grocery: 'Grocery' };

    for (let step = 0; step < 4; step++) {
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
          const list = ['family', 'personal', 'grocery'].includes(args.list) ? args.list : null;
          const items = (Array.isArray(args.items) ? args.items : []).map((s: unknown) => String(s).trim().slice(0, 300)).filter(Boolean).slice(0, 25);
          if (!list || !items.length) result = { error: 'invalid list or items' };
          else {
            const { error } = await supabase.from('home_list_items').insert(items.map((text: string) => ({
              household_id: profile.household_id, list_type: list, user_id: list === 'personal' ? user.id : null, text, created_by: user.id,
            })));
            if (error) { console.error(error); result = { error: 'could not save' }; }
            else { added.push({ list, items }); result = { ok: true, added: items, list: listName[list] }; }
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
            proposals.push({ calendar_id: cal.id, title: String(args.title).slice(0, 200), start: s, end, all_day: allDay, location: args.location ?? null, notes: args.notes ?? null });
            result = { ok: true, status: 'shown to user for confirmation; not created yet' };
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
