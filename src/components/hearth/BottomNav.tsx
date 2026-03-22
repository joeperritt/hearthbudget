import { TabId } from '@/types/budget';
import { Home, Wallet, FileText, List, Settings } from 'lucide-react';

const tabs: { id: TabId; label: string; icon: typeof Home }[] = [
  { id: 'dashboard', label: 'Home', icon: Home },
  { id: 'variable', label: 'Spending', icon: Wallet },
  { id: 'fixed', label: 'Fixed', icon: FileText },
  { id: 'transactions', label: 'Activity', icon: List },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function BottomNav({ activeTab, onTabChange }: { activeTab: TabId; onTabChange: (t: TabId) => void }) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-md border-t border-border safe-bottom z-50">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-2">
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
              <Icon size={20} strokeWidth={active ? 2.2 : 1.6} />
              <span className="text-[10px] font-medium font-body">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
