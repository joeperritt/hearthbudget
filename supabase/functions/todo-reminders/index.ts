import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { createECDH, createHash } from 'node:crypto';

const TZ = 'America/New_York';
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const b64u = (buf: Uint8Array) => btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

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
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}` };
}

function fmtTime(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  const s = h >= 12 ? 'PM' : 'AM'; const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, '0')} ${s}` : `${h12} ${s}`;
}

function dueLabel(dueDate: string | null, dueTime: string | null) {
  if (!dueDate) return '';
  const today = nyParts().date;
  const t = dueTime ? ` ${fmtTime(dueTime.slice(0, 5))}` : '';
  if (dueDate === today) return `due today${t}`;
  const tm = new Date(today + 'T00:00:00Z'); tm.setUTCDate(tm.getUTCDate() + 1);
  if (dueDate === tm.toISOString().slice(0, 10)) return `due tomorrow${t}`;
  const label = new Date(dueDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return `due ${label}${t}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const keys = vapid();
    webpush.setVapidDetails('mailto:joeperritt31@gmail.com', keys.publicKey, keys.privateKey);
    const backendUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!backendUrl || !serviceKey) throw new Error('Service configuration missing');
    const admin = createClient(backendUrl, serviceKey);

    const { data: due } = await admin.from('todo_reminders')
      .select('id, todo_id, user_id')
      .is('sent_at', null)
      .lte('remind_at', new Date().toISOString())
      .limit(50);

    let sent = 0;
    for (const r of due ?? []) {
      // Claim it first so overlapping runs can't double send.
      const { data: claimed } = await admin.from('todo_reminders').update({ sent_at: new Date().toISOString() })
        .eq('id', r.id).is('sent_at', null).select('id');
      if (!claimed?.length) continue;

      const { data: item } = await admin.from('home_list_items').select('text, completed, due_date, due_time').eq('id', r.todo_id).maybeSingle();
      if (!item || item.completed) continue; // completed or deleted: cancel silently

      const { data: prefs } = await admin.from('notification_prefs').select('todo_reminders_enabled').eq('user_id', r.user_id).maybeSingle();
      if (prefs && prefs.todo_reminders_enabled === false) continue;

      const when = dueLabel(item.due_date, item.due_time);
      const body = when ? when.charAt(0).toUpperCase() + when.slice(1) : '';
      const payload = { title: item.text, body, url: `/?todo=${r.todo_id}&reminderUser=${r.user_id}&from=push` };
      const { data: subs } = await admin.from('push_subscriptions').select('id, endpoint, keys').eq('user_id', r.user_id);
      for (const s of subs ?? []) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys as { p256dh: string; auth: string } }, JSON.stringify(payload), { TTL: 3600 });
          sent++;
          await admin.from('push_subscriptions').update({ last_success_at: new Date().toISOString() }).eq('id', s.id);
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) await admin.from('push_subscriptions').delete().eq('id', s.id);
          else console.error('push failed', code, (e as Error).message);
        }
      }
    }
    return json({ ok: true, sent });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
