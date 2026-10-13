import { useEffect, useState } from 'react';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface Cal { id: string; label: string; ics_url: string }

export function CalendarSettingsView({ onBack }: { onBack: () => void }) {
  const { profile } = useAuth();
  const [cals, setCals] = useState<Cal[]>([]);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => supabase.from('household_calendars').select('id, label, ics_url').order('created_at').then(({ data }) => setCals(data || []));
  useEffect(() => { load(); }, []);

  const save = async () => {
    const u = url.trim().replace(/^webcal:\/\//i, 'https://');
    if (!/^https:\/\/\S+$/.test(u)) { toast.error('Paste a link that starts with https://'); return; }
    if (!profile?.household_id) return;
    setSaving(true);
    const { error } = await supabase.from('household_calendars').insert({ household_id: profile.household_id, label: label.trim().slice(0, 60) || 'Calendar', ics_url: u });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    setLabel(''); setUrl(''); toast.success('Calendar added'); load();
  };

  const remove = async (id: string) => {
    await supabase.from('household_calendars').delete().eq('id', id);
    load();
  };

  return (
    <div className="max-w-lg mx-auto pb-12">
      <div className="px-6 pt-12 safe-top flex items-center gap-3">
        <button onClick={onBack} aria-label="Back" className="p-1 -ml-1 text-muted-foreground"><ArrowLeft size={20} /></button>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Calendars</h1>
      </div>
      <div className="px-6 mt-6 space-y-4">
        <div className="bg-card rounded-2xl border border-border p-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            In Google Calendar on a computer: Settings → pick your calendar → "Integrate calendar" → copy the <span className="font-semibold text-foreground">Secret address in iCal format</span> and paste it here.
          </p>
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Name (e.g. Joe, Katie, Family)" className="auth-input" maxLength={60} />
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" className="auth-input" />
          <button onClick={save} disabled={saving || !url.trim()} className="w-full py-3 rounded-xl bg-accent text-accent-foreground font-semibold text-sm disabled:opacity-50">
            {saving ? 'Saving…' : 'Add calendar'}
          </button>
        </div>
        {cals.length > 0 && (
          <ul className="bg-card rounded-2xl border border-border divide-y divide-border">
            {cals.map(c => (
              <li key={c.id} className="flex items-center gap-3 p-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{c.label}</p>
                  <p className="text-xs text-muted-foreground truncate">{c.ics_url.replace(/(private-)[^/]+/, '$1••••')}</p>
                </div>
                <button onClick={() => remove(c.id)} aria-label="Remove" className="p-2 text-muted-foreground active:text-destructive"><Trash2 size={16} /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
