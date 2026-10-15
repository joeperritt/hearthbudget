import { useEffect, useState } from 'react';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';

interface Cal { id: string; label: string; ics_url: string; owner_user_id: string | null }
interface Member { user_id: string; display_name: string }

export function CalendarSettingsView({ onBack }: { onBack: () => void }) {
  const { profile } = useAuth();
  const [cals, setCals] = useState<Cal[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [owner, setOwner] = useState('shared');
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!profile?.household_id) return;
    const [calResult, memberResult] = await Promise.all([
      supabase.from('household_calendars').select('id, label, ics_url, owner_user_id').eq('household_id', profile.household_id).order('created_at'),
      supabase.from('profiles').select('user_id, display_name').eq('household_id', profile.household_id).order('display_name'),
    ]);
    if (calResult.error || memberResult.error) { toast.error("Couldn't load calendars. Please try again."); return; }
    setCals(calResult.data ?? []);
    setMembers(memberResult.data ?? []);
  };
  useEffect(() => { load(); }, [profile?.household_id]);

  const reset = () => { setEditing(null); setLabel(''); setUrl(''); setOwner('shared'); };
  const save = async () => {
    const u = url.trim().replace(/^webcal:\/\//i, 'https://');
    if (!/^https:\/\/\S+$/.test(u)) { toast.error('Paste a link that starts with https://'); return; }
    if (!profile?.household_id) return;
    setSaving(true);
    const values = { label: label.trim().slice(0, 60) || 'Calendar', ics_url: u, owner_user_id: owner === 'shared' ? null : owner };
    const { error } = editing
      ? await supabase.from('household_calendars').update(values).eq('id', editing).eq('household_id', profile.household_id)
      : await supabase.from('household_calendars').insert({ ...values, household_id: profile.household_id });
    setSaving(false);
    if (error) { toast.error("Couldn't save the calendar. Please try again."); return; }
    toast.success(editing ? 'Calendar updated' : 'Calendar added'); reset(); await load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('household_calendars').delete().eq('id', id);
    if (error) { toast.error("Couldn't remove the calendar."); return; }
    if (editing === id) reset();
    await load();
  };

  return (
    <div className="max-w-lg mx-auto pb-12">
      <div className="px-6 pt-12 safe-top flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back" className="-ml-2 text-muted-foreground"><ArrowLeft size={20} /></Button>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Calendars</h1>
      </div>
      <div className="px-6 mt-6 space-y-4">
        <div className="bg-card rounded-2xl border border-border p-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            In Google Calendar on a computer: Settings → pick your calendar → "Integrate calendar" → copy the <span className="font-semibold text-foreground">Secret address in iCal format</span> and paste it here.
          </p>
          <input aria-label="Calendar name" value={label} onChange={e => setLabel(e.target.value)} placeholder="Name (e.g. Joe, Katie, Family)" className="auth-input" maxLength={60} />
          <input aria-label="iCal URL" type="password" autoComplete="off" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" className="auth-input" />
          <label className="block text-xs font-semibold text-muted-foreground">
            Owner
            <select aria-label="Calendar owner" value={owner} onChange={e => setOwner(e.target.value)} className="auth-input mt-1">
              <option value="shared">Shared</option>
              {members.map(member => <option key={member.user_id} value={member.user_id}>{member.display_name}</option>)}
            </select>
          </label>
          <Button onClick={save} disabled={saving || !url.trim()} className="w-full bg-accent text-accent-foreground hover:bg-accent/90">
            {saving ? 'Saving…' : editing ? 'Save calendar' : 'Add calendar'}
          </Button>
          {editing && <Button variant="ghost" onClick={reset} disabled={saving} className="w-full">Cancel</Button>}
        </div>
        {cals.length > 0 && (
          <ul className="bg-card rounded-2xl border border-border divide-y divide-border">
            {cals.map(c => (
              <li key={c.id} className="flex items-center gap-2 p-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{c.label}</p>
                  <p className="text-xs text-muted-foreground">{members.find(m => m.user_id === c.owner_user_id)?.display_name ?? 'Shared'}</p>
                </div>
                <Button variant="ghost" size="icon" disabled={saving} onClick={() => { setEditing(c.id); setLabel(c.label); setUrl(c.ics_url); setOwner(c.owner_user_id ?? 'shared'); }} aria-label={`Edit ${c.label} calendar`} title="Edit calendar" className="text-muted-foreground"><Pencil size={16} /></Button>
                <Button variant="ghost" size="icon" disabled={saving} onClick={() => remove(c.id)} aria-label={`Remove ${c.label} calendar`} title="Remove calendar" className="text-muted-foreground hover:text-destructive"><Trash2 size={16} /></Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
