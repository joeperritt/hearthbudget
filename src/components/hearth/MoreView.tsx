import { LogOut, Building2, Sparkles, BarChart3, ChevronRight, Calculator } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

type MoreTab = 'settings' | 'bank-connections' | 'ai-advisor' | 'trends' | 'calculators';

interface MoreViewProps {
  onSelect: (tab: MoreTab) => void;
  householdId: string | null;
}

export function MoreView({ onSelect, householdId }: MoreViewProps) {
  const { signOut, profile } = useAuth();

  return (
    <div className="max-w-lg mx-auto">
      <div className="px-6 pt-12 safe-top">
        <h1 className="font-display text-2xl lg:text-3xl font-bold tracking-tight text-foreground">More</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Tools & settings</p>
      </div>

      <div className="px-6 mt-6 space-y-3">
        <button
          onClick={() => onSelect('ai-advisor')}
          className="w-full flex items-center gap-4 bg-card rounded-lg p-4 shadow-sm text-left active:scale-[0.98] transition-transform"
        >
          <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
            <Sparkles size={20} className="text-accent" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">AI Advisor</p>
            <p className="text-xs text-muted-foreground">Personalized budget insights & chat</p>
          </div>
        </button>

        <button
          onClick={() => onSelect('calculators')}
          className="w-full flex items-center gap-4 bg-card rounded-lg p-4 shadow-sm text-left active:scale-[0.98] transition-transform"
        >
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Calculator size={20} className="text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Calculators</p>
            <p className="text-xs text-muted-foreground">Generic financial calculators</p>
          </div>
        </button>

        <button
          onClick={() => onSelect('trends')}
          className="w-full flex items-center gap-4 bg-card rounded-lg p-4 shadow-sm text-left active:scale-[0.98] transition-transform"
        >
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <BarChart3 size={20} className="text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Trends</p>
            <p className="text-xs text-muted-foreground">Month over month spending comparison</p>
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
            <p className="text-sm font-semibold text-foreground">Accounts & Connections</p>
            <p className="text-xs text-muted-foreground">Manage users & linked bank accounts</p>
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
