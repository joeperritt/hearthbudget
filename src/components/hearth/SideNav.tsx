import { TabId } from '@/types/budget';
import { Home, Wallet, List, CalendarDays, Compass, MoreHorizontal, Sparkles, Calculator, BarChart3, Building2 } from 'lucide-react';

const tabs: { id: TabId; label: string; icon: typeof Home }[] = [
  { id: 'dashboard', label: 'Home', icon: Home },
  { id: 'variable', label: 'Spending', icon: Wallet },
  { id: 'transactions', label: 'Activity', icon: List },
  { id: 'budget', label: 'Budget', icon: CalendarDays },
  { id: 'plan', label: 'Plan', icon: Compass },
];

export type MoreSidebarItem = 'ai-advisor' | 'calculators' | 'trends' | 'bank-connections';

const moreItems: { id: MoreSidebarItem; label: string; icon: typeof Home }[] = [
  { id: 'ai-advisor', label: 'AI Advisor', icon: Sparkles },
  { id: 'calculators', label: 'Calculators', icon: Calculator },
  { id: 'trends', label: 'Trends', icon: BarChart3 },
  { id: 'bank-connections', label: 'Accounts', icon: Building2 },
];

interface SideNavProps {
  activeTab: TabId;
  onTabChange: (t: TabId) => void;
  activeMoreItem?: MoreSidebarItem | null;
  onSelectMoreItem?: (item: MoreSidebarItem) => void;
}

export function SideNav({ activeTab, onTabChange, activeMoreItem, onSelectMoreItem }: SideNavProps) {
  return (
    <aside className="hidden lg:flex fixed top-0 left-0 bottom-0 w-[220px] bg-card/60 border-r border-border flex-col z-40 safe-top overflow-y-auto">
      <div className="px-6 pt-8 pb-6 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
          <span className="text-primary-foreground font-display text-lg font-bold">H</span>
        </div>
        <span className="font-display text-2xl lg:text-3xl font-bold tracking-tight text-foreground">Hearth</span>
      </div>

      <nav className="flex-1 px-3 py-2">
        <p className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider px-3 mb-1">Main</p>
        <div className="space-y-1">
          {tabs.map(({ id, label, icon: Icon }) => {
            const active = activeTab === id && !activeMoreItem;
            return (
              <button
                key={id}
                onClick={() => onTabChange(id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-left font-body text-sm ${
                  active
                    ? 'bg-accent/15 text-accent font-semibold'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                }`}
              >
                <Icon size={18} strokeWidth={active ? 2.2 : 1.8} />
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        <p className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider px-3 mt-5 mb-1">More</p>
        <div className="space-y-1">
          {moreItems.map(({ id, label, icon: Icon }) => {
            const active = activeMoreItem === id;
            return (
              <button
                key={id}
                onClick={() => onSelectMoreItem?.(id)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-left font-body text-sm ${
                  active
                    ? 'bg-accent/15 text-accent font-semibold'
                    : 'text-muted-foreground/80 hover:bg-muted/50 hover:text-foreground'
                }`}
              >
                <Icon size={16} strokeWidth={active ? 2.2 : 1.6} />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </aside>
  );
}
