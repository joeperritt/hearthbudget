import { useEffect, useState } from 'react';
import { ArrowLeft, Heart, Baby, PawPrint, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useHouseholdFlags } from '@/hooks/useHouseholdFlags';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { AccountManagement } from '@/components/keeper/AccountManagement';
import { InvitesManagement } from '@/components/auth/InvitesManagement';

interface Props {
  householdId: string | null;
  onBack: () => void;
}

export function ManageUsersView({ householdId, onBack }: Props) {
  const { profile } = useAuth();
  const { flags, loading: flagsLoading, updateFlag } = useHouseholdFlags(householdId);

  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [savingName, setSavingName] = useState(false);
  useEffect(() => { setDisplayName(profile?.display_name ?? ''); }, [profile?.display_name]);

  const saveDisplayName = async () => {
    const trimmed = displayName.trim();
    if (!profile?.id || !trimmed || trimmed === profile.display_name) return;
    setSavingName(true);
    const { error } = await supabase.from('profiles').update({ display_name: trimmed }).eq('id', profile.id);
    setSavingName(false);
    if (error) {
      toast.error('Could not update name');
      setDisplayName(profile.display_name ?? '');
    } else {
      toast.success('Name updated');
    }
  };

  const handleToggle = async (key: 'stewardship_mode' | 'has_kids' | 'has_pets', value: boolean) => {
    try { await updateFlag(key, value); } catch { toast.error('Could not save change'); }
  };

  return (
    <div className="max-w-lg mx-auto pb-12">
      <div className="px-6 pt-12 safe-top flex items-center gap-3">
        <button onClick={onBack} className="p-2 -ml-2 rounded-full active:bg-muted transition-colors">
          <ArrowLeft size={20} className="text-foreground" />
        </button>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Manage Users</h1>
          <p className="text-xs text-muted-foreground">Household members, settings, and invites</p>
        </div>
      </div>

      <div className="px-6 mt-6 space-y-6">
        {/* Your display name (inline edit) */}
        <div className="bg-card rounded-xl shadow-sm p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center shrink-0">
            <span className="text-primary-foreground font-display text-sm font-bold">
              {profile?.avatar_initial || 'U'}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Your display name</p>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              onBlur={saveDisplayName}
              placeholder="Your name"
              className="w-full text-sm font-semibold text-foreground bg-transparent outline-none border-b border-transparent focus:border-amber-400 transition-colors py-0.5"
            />
          </div>
          {savingName && <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />}
        </div>

        {/* Household members + Add User + Invites — managed inside AccountManagement */}
        <AccountManagement />

        {/* Household-shared toggles */}
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Household Settings</h3>
          <div className="bg-card rounded-xl shadow-sm divide-y divide-border">
            <FlagRow icon={Heart} label="Stewardship Mode"
              help="Christian faith-informed framing — biblical stewardship principles, gentle tone, giving as a baseline."
              checked={flags.stewardship_mode} disabled={flagsLoading}
              onChange={v => handleToggle('stewardship_mode', v)} />
            <FlagRow icon={Baby} label="We have kids"
              help="Keeps the Kids bucket relevant in the analyzer."
              checked={flags.has_kids} disabled={flagsLoading}
              onChange={v => handleToggle('has_kids', v)} />
            <FlagRow icon={PawPrint} label="We have pets"
              help="Keeps the Pets bucket relevant in the analyzer."
              checked={flags.has_pets} disabled={flagsLoading}
              onChange={v => handleToggle('has_pets', v)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function FlagRow({
  icon: Icon, label, help, checked, disabled, onChange,
}: {
  icon: typeof Heart;
  label: string;
  help: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 p-4">
      <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
        <Icon size={18} className="text-foreground/80" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">{help}</p>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} className="mt-1 shrink-0" />
    </div>
  );
}
