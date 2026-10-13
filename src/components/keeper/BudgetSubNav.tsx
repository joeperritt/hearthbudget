import { TabId } from '@/types/budget';

const SUB_TABS: { id: TabId; label: string }[] = [
  { id: 'dashboard', label: 'Overview' },
  { id: 'variable', label: 'Categories' },
  { id: 'transactions', label: 'Activity' },
];

/** Sub-tabs shown inside the Budget section. */
export function BudgetSubNav({ activeTab, onTabChange }: { activeTab: TabId; onTabChange: (t: TabId) => void }) {
  return (
    <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-md safe-top">
      <div className="max-w-lg lg:max-w-none mx-auto px-6 pt-3 pb-2">
        <div className="flex gap-1 p-1 rounded-xl bg-muted">
          {SUB_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => onTabChange(t.id)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === t.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
