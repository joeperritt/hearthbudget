import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { createECDH, createHash } from 'node:crypto';
import { getGoogleAccessToken, hasServiceAccount } from '../_shared/google-auth.ts';

const TZ = 'America/New_York';
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const b64u = (buf: Uint8Array) => btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// VAPID key pair derived deterministically from the VAPID_SEED secret.
function vapid() {
  const seed = Deno.env.get('VAPID_SEED');
  if (!seed) throw new Error('VAPID_SEED is not set');
  const priv = createHash('sha256').update(seed).digest();
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(priv);
  return { publicKey: b64u(new Uint8Array(ecdh.getPublicKey())), privateKey: b64u(new Uint8Array(priv)) };
}

function nyParts(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const g = (t: string) => p.find(x => x.type === t)?.value ?? '';
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}`, month: `${g('year')}-${g('month')}` };
}

function fmtTime(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  const s = h >= 12 ? 'pm' : 'am'; const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, '0')}${s}` : `${h12}${s}`;
}

async function buildSummary(db: SupabaseClient, userId: string) {
  const { date: today } = nyParts();
  const { data: prof } = await db.from('profiles').select('display_name, household_id').eq('user_id', userId).maybeSingle();
  if (!prof) return null;
  const { data: layout } = await db.from('user_home_layouts').select('calendar_visibility, todo_visibility').eq('user_id', userId).maybeSingle();
  const calVis = (layout?.calendar_visibility ?? {}) as Record<string, boolean>;
  const todoVis = (layout?.todo_visibility ?? {}) as Record<string, boolean>;

  // Calendar
  const { data: cals } = await db.from('household_calendars').select('id, owner_user_id, google_calendar_id').eq('household_id', prof.household_id);
  const visible = (cals ?? []).filter(c => (calVis[c.id] ?? (c.owner_user_id === null || c.owner_user_id === userId)) && c.google_calendar_id);
  const events: { allDay: boolean; start: string; title: string }[] = [];
  if (visible.length && hasServiceAccount()) {
    const token = await getGoogleAccessToken();
    const dayStart = new Date(`${today}T00:00:00Z`); dayStart.setUTCHours(dayStart.getUTCHours() - 2);
    const dayEnd = new Date(`${today}T23:59:59Z`); dayEnd.setUTCHours(dayEnd.getUTCHours() + 6);
    await Promise.all(visible.map(async c => {
      try {
        const params = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', timeZone: TZ, maxResults: '100', timeMin: dayStart.toISOString(), timeMax: dayEnd.toISOString() });
        if (!c.google_calendar_id) return;
        const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.google_calendar_id)}/events?${params}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) return;
        const data = await r.json();
        for (const it of data.items ?? []) {
          if (it.status === 'cancelled') continue;
          if (it.start?.date) {
            if (it.start.date <= today && (it.end?.date ?? it.start.date) > today) events.push({ allDay: true, start: '', title: it.summary || '(No title)' });
          } else if (it.start?.dateTime) {
            const p = nyParts(new Date(it.start.dateTime));
            if (p.date === today) events.push({ allDay: false, start: p.time, title: it.summary || '(No title)' });
          }
        }
      } catch { /* skip calendar */ }
    }));
  }
  events.sort((a, b) => (a.allDay === b.allDay ? a.start.localeCompare(b.start) : a.allDay ? -1 : 1));
  const shown = events.slice(0, 4).map(e => e.allDay ? e.title : `${e.title} ${fmtTime(e.start)}`);
  const calLine = events.length ? `Today: ${shown.join(', ')}${events.length > 4 ? ` +${events.length - 4} more` : ''}` : 'Today: nothing on the calendar';

  // To dos
  const { data: todos } = await db.from('home_list_items').select('user_id, due_date').eq('household_id', prof.household_id).eq('list_type', 'todo').eq('completed', false).lte('due_date', today);
  let past = 0, due = 0;
  for (const t of todos ?? []) {
    const key = t.user_id ?? 'family';
    if (!(todoVis[key] ?? (key === 'family' || key === userId))) continue;
    if (t.due_date && t.due_date < today) past++; else due++;
  }
  const todoLine = past || due ? `To dos: ${[past && `${past} past due`, due && `${due} due today`].filter(Boolean).join(', ')}` : 'To dos: none due';

  // Budget (same exclusions as the app's unassigned count)
  const { data: hh } = await db.from('households').select('active_month').eq('id', prof.household_id).maybeSingle();
  const { count } = await db.from('transactions').select('id', { count: 'exact', head: true })
    .eq('household_id', prof.household_id).eq('budget_month', hh?.active_month ?? nyParts().month)
    .eq('category_slug', 'unassigned').eq('is_transfer_to_savings', false)
    .not('transaction_type', 'in', '(income,deposit,cc-payment,transfer)');
  const budgetLine = count ? `Budget: ${count} to assign` : 'Budget: all caught up';

  return { title: `Good morning, ${prof.display_name.split(' ')[0]}`, body: [calLine, todoLine, budgetLine].join('\n') };
}

async function sendToUser(db: SupabaseClient, userId: string, payload: { title: string; body: string }) {
  const { data: subs } = await db.from('push_subscriptions').select('id, endpoint, keys').eq('user_id', userId);
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys as { p256dh: string; auth: string } }, JSON.stringify({ ...payload, url: '/' }), { TTL: 3600 });
      sent++;
      await db.from('push_subscriptions').update({ last_success_at: new Date().toISOString() }).eq('id', s.id);
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('id', s.id);
      else console.error('push failed', code, (e as Error).message);
    }
  }
  return { sent, devices: subs?.length ?? 0 };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const keys = vapid();
    if (body?.mode === 'public_key') return json({ publicKey: keys.publicKey });
    webpush.setVapidDetails('mailto:joeperritt31@gmail.com', keys.publicKey, keys.privateKey);
    const backendUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!backendUrl || !serviceKey || !anonKey) throw new Error('Service configuration missing');
    const admin = createClient(backendUrl, serviceKey);

    if (body?.mode === 'test') {
      const auth = req.headers.get('Authorization');
      if (!auth) return json({ error: 'Unauthorized' }, 401);
      const userClient = createClient(backendUrl, anonKey, { global: { headers: { Authorization: auth } } });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const summary = await buildSummary(admin, user.id);
      if (!summary) return json({ error: 'No profile' }, 400);
      return json({ ok: true, sent: (await sendToUser(admin, user.id, summary)).sent });
    }

    // Scheduled run: idempotent — only sends summaries that are due and not yet sent today.
    const now = nyParts();
    const { data: prefs } = await admin.from('notification_prefs').select('user_id, morning_time, last_sent_date').eq('morning_enabled', true);
    let sent = 0;
    for (const p of prefs ?? []) {
      if (String(p.morning_time).slice(0, 5) > now.time) continue;
      if (p.last_sent_date === now.date) continue;
      // A missed summary is never sent after noon.
      if (now.time >= '12:00') continue;
      // Claim today's send first so overlapping runs can't double send.
      const { data: claimed } = await admin.from('notification_prefs').update({ last_sent_date: now.date })
        .eq('user_id', p.user_id).or(`last_sent_date.is.null,last_sent_date.neq.${now.date}`).select('user_id');
      if (!claimed?.length) continue;
      const summary = await buildSummary(admin, p.user_id);
      if (summary) sent += (await sendToUser(admin, p.user_id, summary)).sent;
    }
    return json({ ok: true, sent });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
