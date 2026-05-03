import { ArrowLeft, Heart, Baby, PawPrint } from 'lucide-react';
import { useHouseholdFlags } from '@/hooks/useHouseholdFlags';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { AccountManagement } from '@/components/keeper/AccountManagement';

interface Props {
  householdId: string | null;
  onBack: () => void;
}

export function ManageUsersView({ householdId, onBack }: Props) {
  const { flags, loading: flagsLoading, updateFlag } = useHouseholdFlags(householdId);

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
        {/* Household members + Add User + Invites — managed inside AccountManagement.
            Display-name editing happens INLINE on each user row (single source of truth). */}
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
