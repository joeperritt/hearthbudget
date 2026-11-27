import { useEffect, useState } from 'react';
import { ChevronRight, Target, Landmark, Wallet, LineChart, HandHeart } from 'lucide-react';
import { SubHeader } from './SubHeader';
import { GoalsView } from './GoalsView';
import { NetWorthView } from './NetWorthView';
import { IncomeView } from './IncomeView';
import { AdvisorDataView } from './AdvisorDataView';
import { GivingView } from './GivingView';
import { generateRecurring } from './RecurringGiving';

type View = 'hub' | 'goals' | 'net-worth' | 'income' | 'giving' | 'advisor';

export function RetreatHub({ onBack }: { onBack: () => void }) {
  const [view, setView] = useState<View>('hub');
  const back = () => setView('hub');
  useEffect(() => { generateRecurring(); }, []);
  if (view === 'goals') return <GoalsView onBack={back} />;
  if (view === 'net-worth') return <NetWorthView onBack={back} />;
  if (view === 'income') return <IncomeView onBack={back} />;
  if (view === 'giving') return <GivingView onBack={back} />;
  if (view === 'advisor') return <AdvisorDataView onBack={back} />;
  const tiles: { v: View; icon: typeof Target; title: string; sub: string }[] = [
    { v: 'goals', icon: Target, title: 'Goals', sub: 'Vision, current goals, prior years' },
    { v: 'net-worth', icon: Landmark, title: 'Net Worth', sub: 'Balance sheet snapshots' },
    { v: 'income', icon: Wallet, title: 'Income', sub: 'Household income by month' },
    { v: 'giving', icon: HandHeart, title: 'Giving', sub: 'Gifts by month, type and recipient' },
    { v: 'advisor', icon: LineChart, title: 'JP Advisor Data', sub: 'AUM, net new assets, production' },
  ];
  return (
    <div className="max-w-lg mx-auto pb-12">
      <SubHeader title="2717" onBack={onBack} />
      <p className="px-6 mt-1 text-xs italic text-muted-foreground">"As iron sharpens iron, so one person sharpens another." Proverbs 27:17</p>
      <div className="px-6 mt-6 space-y-3">
        {tiles.map(t => (
          <button key={t.v} onClick={() => setView(t.v)} className="w-full flex items-center gap-3 bg-card rounded-xl p-4 shadow-sm text-left active:scale-[0.98] transition-transform border-l-4 border-border">
            <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-primary/10 text-primary"><t.icon size={20} /></div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">{t.title}</p>
              <p className="text-xs text-muted-foreground truncate">{t.sub}</p>
            </div>
            <ChevronRight size={16} className="text-muted-foreground shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}
