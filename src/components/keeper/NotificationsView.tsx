import { useEffect, useState } from 'react';
import { ArrowLeft, Bell, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const b64ToBytes = (b64: string) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, c => c.charCodeAt(0));
};

const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function deviceLabel() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows computer';
  return 'This device';
}

export function NotificationsView({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [todoEnabled, setTodoEnabled] = useState(true);
  const [time, setTime] = useState('07:00');
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<'sub' | 'test' | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase.from('notification_prefs').select('morning_enabled, morning_time, todo_reminders_enabled').eq('user_id', user.id).maybeSingle().then(({ data }) => {
      if (data) { setEnabled(data.morning_enabled); setTime(String(data.morning_time).slice(0, 5)); setTodoEnabled(data.todo_reminders_enabled); }
    });
    (async () => {
      if (!supported) return setSubscribed(false);
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = await reg?.pushManager.getSubscription();
      if (!sub) return setSubscribed(false);
      const { data } = await supabase.from('push_subscriptions').select('id').eq('endpoint', sub.endpoint).maybeSingle();
      setSubscribed(Boolean(data));
    })().catch(() => setSubscribed(false));
  }, [user]);

  const savePrefs = async (next: { morning_enabled?: boolean; morning_time?: string; todo_reminders_enabled?: boolean }) => {
    if (!user) return;
    const row = { user_id: user.id, morning_enabled: next.morning_enabled ?? enabled, morning_time: next.morning_time ?? time, todo_reminders_enabled: next.todo_reminders_enabled ?? todoEnabled, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('notification_prefs').upsert(row, { onConflict: 'user_id' });
    if (error) toast.error("Couldn't save that setting.");
  };

  const subscribe = async () => {
    if (!user) return;
    setBusy('sub');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { toast.error('Notifications are blocked for this device. Allow them in Settings, then try again.'); return; }
      const reg = (await navigator.serviceWorker.getRegistration('/')) ?? (await navigator.serviceWorker.register('/sw.js'));
      await navigator.serviceWorker.ready;
      const { data, error } = await supabase.functions.invoke('morning-summary', { body: { mode: 'public_key' } });
      if (error || !data?.publicKey) throw new Error('no key');
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(data.publicKey) }));
      const j = sub.toJSON();
      const { error: e2 } = await supabase.from('push_subscriptions').upsert({ user_id: user.id, endpoint: sub.endpoint, keys: j.keys as Record<string, string>, device_label: deviceLabel() }, { onConflict: 'endpoint' });
      if (e2) throw e2;
      setSubscribed(true);
      toast.success('Notifications are on for this device.');
    } catch {
      toast.error("Couldn't turn on notifications on this device.");
    } finally { setBusy(null); }
  };

  const sendTest = async () => {
    setBusy('test');
    const { data, error } = await supabase.functions.invoke('morning-summary', { body: { mode: 'test' } });
    setBusy(null);
    if (error) return toast.error("Couldn't send the test notification.");
    if (!data?.sent) return toast.error('No devices are set up yet. Turn on notifications on this device first.');
    toast.success(`Sent to ${data.sent} device${data.sent > 1 ? 's' : ''}.`);
  };

  const needsHomeScreen = isIOS && !standalone;

  return (
    <div className="max-w-lg mx-auto pb-12">
      <div className="px-6 pt-12 safe-top flex items-center gap-3">
        <button onClick={onBack} aria-label="Back" className="w-9 h-9 rounded-full bg-card border border-border flex items-center justify-center"><ArrowLeft size={18} /></button>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Notifications</h1>
      </div>

      <div className="px-6 mt-6 space-y-4">
        <div className="bg-card rounded-xl p-4 shadow-sm border border-border space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Morning summary</p>
              <p className="text-xs text-muted-foreground">Today's events, to dos due, and budget, once a day</p>
            </div>
            <Switch checked={enabled} onCheckedChange={v => { setEnabled(v); savePrefs({ morning_enabled: v }); }} aria-label="Morning summary" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="morning-time" className="text-sm text-foreground">Time (Eastern)</label>
            <Input id="morning-time" type="time" step={900} value={time} disabled={!enabled} className="w-32 text-base"
              onChange={e => setTime(e.target.value)} onBlur={e => e.target.value && savePrefs({ morning_time: e.target.value })} />
          </div>
        </div>

        <div className="bg-card rounded-xl p-4 shadow-sm border border-border">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">To do reminders</p>
              <p className="text-xs text-muted-foreground">Reminders you set on individual to dos</p>
            </div>
            <Switch checked={todoEnabled} onCheckedChange={v => { setTodoEnabled(v); savePrefs({ todo_reminders_enabled: v }); }} aria-label="To do reminders" />
          </div>
        </div>

        <div className="bg-card rounded-xl p-4 shadow-sm border border-border space-y-3">
          <div className="flex items-center gap-2">
            <Bell size={16} className="text-primary" />
            <p className="text-sm font-semibold text-foreground">This device</p>
            <span className={`ml-auto text-xs ${subscribed ? 'text-success' : 'text-muted-foreground'}`}>
              {subscribed === null ? 'Checking…' : subscribed ? 'Notifications on' : 'Not set up'}
            </span>
          </div>
          {needsHomeScreen ? (
            <p className="text-xs text-muted-foreground">On iPhone, notifications only work in the installed app. Tap Share → Add to Home Screen, then open Perritt from the home screen icon and come back here.</p>
          ) : !supported ? (
            <p className="text-xs text-muted-foreground">This browser doesn't support notifications.</p>
          ) : (
            <Button className="w-full" onClick={subscribe} disabled={busy !== null}>
              {busy === 'sub' && <Loader2 className="animate-spin" />}
              {subscribed ? 'Re-connect this device' : 'Turn on notifications on this device'}
            </Button>
          )}
          <Button variant="outline" className="w-full" onClick={sendTest} disabled={busy !== null}>
            {busy === 'test' && <Loader2 className="animate-spin" />}Send test notification
          </Button>
        </div>
      </div>
    </div>
  );
}
