import { TabId } from '@/types/budget';
import { Home, Wallet, List, CalendarDays, Compass, MoreHorizontal } from 'lucide-react';

const tabs: { id: TabId; label: string; icon: typeof Home }[] = [
  { id: 'dashboard', label: 'Home', icon: Home },
  { id: 'variable', label: 'Spending', icon: Wallet },
  { id: 'transactions', label: 'Activity', icon: List },
  { id: 'budget', label: 'Budget', icon: CalendarDays },
  { id: 'plan', label: 'Plan', icon: Compass },
  { id: 'profile', label: 'More', icon: MoreHorizontal },
];

export function BottomNav({ activeTab, onTabChange }: { activeTab: TabId; onTabChange: (t: TabId) => void }) {
  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-md border-t border-border safe-bottom z-50">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-1">
        {tabs.map(({ id, label, icon: Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 py-1 transition-colors duration-200 active:scale-95 ${
                active ? 'text-accent' : 'text-muted-foreground'
              }`}
            >
              <Icon size={18} strokeWidth={active ? 2.2 : 1.6} />
              <span className="text-[9px] font-medium font-body">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
