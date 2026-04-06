import { CalendarDays, Settings, Clock, LogOut, Building2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

type MoreTab = 'planning' | 'settings' | 'past-months' | 'bank-connections';

interface MoreViewProps {
  onSelect: (tab: MoreTab) => void;
}

export function MoreView({ onSelect }: MoreViewProps) {
  const { signOut, profile } = useAuth();

  return (
    <div className="max-w-lg mx-auto">
      <div className="px-6 pt-12 safe-top">
        <h1 className="font-display text-xl font-bold text-foreground">More</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Planning & settings</p>
      </div>

      <div className="px-6 mt-6 space-y-3">
        <button
          onClick={() => onSelect('settings')}
          className="w-full flex items-center gap-4 bg-card rounded-lg p-4 shadow-sm text-left active:scale-[0.98] transition-transform"
        >
          <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
            <Settings size={20} className="text-accent" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Budget Planning</p>
            <p className="text-xs text-muted-foreground">Manage categories & budget amounts</p>
          </div>
        </button>

        <button
          onClick={() => onSelect('planning')}
          className="w-full flex items-center gap-4 bg-card rounded-lg p-4 shadow-sm text-left active:scale-[0.98] transition-transform"
        >
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <CalendarDays size={20} className="text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Income Planning</p>
            <p className="text-xs text-muted-foreground">Pay calculator & next month budget</p>
          </div>
        </button>


        <button
          onClick={() => onSelect('bank-connections')}
          className="w-full flex items-center gap-4 bg-card rounded-lg p-4 shadow-sm text-left active:scale-[0.98] transition-transform"
        >
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Building2 size={20} className="text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Bank Connections</p>
            <p className="text-xs text-muted-foreground">Link accounts & auto-import transactions</p>
          </div>
        </button>
      </div>
      {/* Log Out */}
      <div className="px-6 mt-10">
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
