import { LogOut, Building2, ShieldCheck, ChevronRight, CalendarDays, BarChart3 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

export type ProfileTabSelection =
  | 'bank-connections'
  | 'security'
  | 'budget-setup'
  | 'trends';

interface ProfileTabProps {
  onSelect: (target: ProfileTabSelection, profileTabHint?: string) => void;
  householdId: string | null;
}

export function ProfileTab({ onSelect }: ProfileTabProps) {
  const { signOut, profile } = useAuth();
  return (
    <div className="max-w-lg mx-auto pb-12">
      <div className="px-6 pt-12 safe-top">
        <h1 className="font-display text-2xl lg:text-3xl font-bold tracking-tight text-foreground">More</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Budget setup, bank accounts, and settings</p>
      </div>

      <div className="px-6 mt-6 space-y-3">
        <Tile
          accent="yellow"
          icon={CalendarDays}
          title="Budget Setup"
          subtitle="Take-home, categories, fixed bills, savings, giving"
          onClick={() => onSelect('budget-setup')}
        />

        <Tile
          accent="neutral"
          icon={Building2}
          title="Bank Accounts"
          subtitle="Linked banks, sync, and cardholder mapping"
          onClick={() => onSelect('bank-connections')}
        />

        <Tile
          accent="neutral"
          icon={ShieldCheck}
          title="Security"
          subtitle="Change password"
          onClick={() => onSelect('security')}
        />

        <Tile
          accent="neutral"
          icon={BarChart3}
          title="Trends"
          subtitle="Month over month spending comparison"
          onClick={() => onSelect('trends')}
        />
      </div>

      {/* Log Out */}
      <div className="px-6 mt-10 pb-6">
        <button
          onClick={signOut}
          className="w-full flex items-center gap-4 bg-card rounded-lg p-4 shadow-sm text-left active:scale-[0.98] transition-transform border border-border"
        >
          <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
            <LogOut size={20} className="text-destructive" />
          </div>
          <div>
            <p className="text-sm font-semibold text-destructive">Log Out</p>
            <p className="text-xs text-muted-foreground">Signed in as {profile?.display_name || 'User'}</p>
          </div>
        </button>
      </div>
    </div>
  );
}

function Tile({
  accent, icon: Icon, title, subtitle, onClick,
}: {
  accent: 'neutral' | 'yellow' | 'primary';
  icon: typeof LogOut;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  const styles = {
    neutral: { border: 'border-border', chip: 'bg-primary/10 text-primary' },
    yellow: { border: 'border-amber-400', chip: 'bg-amber-400/15 text-amber-600' },
    primary: { border: 'border-primary', chip: 'bg-primary/10 text-primary' },
  }[accent];

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 bg-card rounded-xl p-4 shadow-sm text-left active:scale-[0.98] transition-transform border-l-4 ${styles.border}`}
    >
      <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${styles.chip}`}>
        <Icon size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
      </div>
      <ChevronRight size={16} className="text-muted-foreground shrink-0" />
    </button>
  );
}
