import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { WeatherStrip } from './WeatherStrip';
import { CalendarCard } from './CalendarCard';
import { HomeListCard } from './HomeListCard';
import { TodoCard } from './TodoCard';
import { Check, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type HomeCardId = 'calendar' | 'todo' | 'store';

/** Default layout. A per-user override can be stored in user_home_layouts.cards. */
export const DEFAULT_HOME_CARDS: HomeCardId[] = ['calendar', 'todo', 'store'];
const KNOWN = new Set<string>(DEFAULT_HOME_CARDS);

interface HomePageProps {
  onOpenCalendarSettings: () => void;
  unassignedCount: number;
  onOpenUnassigned: () => void;
}

export function HomePage({ onOpenCalendarSettings, unassignedCount, onOpenUnassigned }: HomePageProps) {
  const { user } = useAuth();
  const [cards, setCards] = useState<HomeCardId[]>(DEFAULT_HOME_CARDS);

  useEffect(() => {
    if (!user) return;
    supabase.from('user_home_layouts').select('cards').eq('user_id', user.id).maybeSingle().then(({ data }) => {
      const list = Array.isArray(data?.cards) ? (data.cards as string[]).filter(c => KNOWN.has(c)) : null;
      if (list && list.length) setCards(list as HomeCardId[]);
    });
  }, [user]);

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const render = (id: HomeCardId) => {
    switch (id) {
      case 'calendar': return <CalendarCard onConnect={onOpenCalendarSettings} />;
      case 'todo': return <TodoCard />;
      case 'store': return <HomeListCard />;
    }
  };

  return (
    <div className="max-w-lg md:max-w-6xl mx-auto pb-12">
      <div className="px-6 pt-6 safe-top flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <p className="text-xs text-muted-foreground shrink-0">{today}</p>
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          <div className="rounded-full border border-border bg-card px-3 h-8 flex items-center"><WeatherStrip /></div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-full bg-card text-xs px-3"
            aria-label={`Budget Activity: ${unassignedCount > 0 ? `${unassignedCount} to assign` : 'All caught up'}, show unassigned transactions`}
            onClick={onOpenUnassigned}
          >
            {unassignedCount > 0 ? <Wallet /> : <Check className="text-success" />}
            {unassignedCount > 0 ? `${unassignedCount} to assign` : 'All caught up'}
          </Button>
        </div>
      </div>
      <div className="px-6 mt-4 space-y-4 md:space-y-0 md:grid md:grid-cols-2 xl:grid-cols-3 md:gap-4 md:items-start">
        {cards.map(id => <div key={id} className="min-w-0">{render(id)}</div>)}
      </div>
    </div>
  );
}
