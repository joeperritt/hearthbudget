import { TabId } from '@/types/budget';
import { Home, Wallet, List, CalendarDays, Compass, MoreHorizontal } from 'lucide-react';

const tabs: { id: TabId; label: string; icon: typeof Home }[] = [
  { id: 'dashboard', label: 'Home', icon: Home },
  { id: 'variable', label: 'Spending', icon: Wallet },
  { id: 'transactions', label: 'Activity', icon: List },
  { id: 'budget', label: 'Budget', icon: CalendarDays },
  { id: 'plan', label: 'Plan', icon: Compass },
  { id: 'more', label: 'More', icon: MoreHorizontal },
];

export function SideNav({ activeTab, onTabChange }: { activeTab: TabId; onTabChange: (t: TabId) => void }) {
  return (
    <aside className="hidden md:flex fixed top-0 left-0 bottom-0 w-[220px] bg-card/60 border-r border-border flex-col z-40 safe-top">
      <div className="px-6 pt-8 pb-6 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
          <span className="text-primary-foreground font-display text-lg font-bold">H</span>
        </div>
        <span className="font-display text-xl font-bold text-foreground">Hearth</span>
      </div>
      <nav className="flex-1 px-3 py-2 space-y-1">
        {tabs.map(({ id, label, icon: Icon }) => {
          const active = activeTab === id;
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
      </nav>
    </aside>
  );
}
