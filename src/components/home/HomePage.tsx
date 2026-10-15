import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { WeatherStrip } from './WeatherStrip';
import { CalendarCard } from './CalendarCard';
import { HomeListCard } from './HomeListCard';
import { TodoCard } from './TodoCard';

export type HomeCardId = 'calendar' | 'todo' | 'store';

/** Default layout. A per-user override can be stored in user_home_layouts.cards. */
export const DEFAULT_HOME_CARDS: HomeCardId[] = ['calendar', 'todo', 'store'];
const KNOWN = new Set<string>(DEFAULT_HOME_CARDS);

interface HomePageProps {
  onOpenCalendarSettings: () => void;
}

export function HomePage({ onOpenCalendarSettings }: HomePageProps) {
  const { user, profile } = useAuth();
  const [cards, setCards] = useState<HomeCardId[]>(DEFAULT_HOME_CARDS);

  useEffect(() => {
    if (!user) return;
    supabase.from('user_home_layouts').select('cards').eq('user_id', user.id).maybeSingle().then(({ data }) => {
      const list = Array.isArray(data?.cards) ? (data.cards as string[]).filter(c => KNOWN.has(c)) : null;
      if (list && list.length) setCards(list as HomeCardId[]);
    });
  }, [user]);

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const name = profile?.display_name?.split(' ')[0];
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
      <div className="px-6 pt-12 safe-top flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{today}</p>
          <h1 className="font-display text-2xl lg:text-3xl font-bold tracking-tight text-foreground">
            {greet}{name ? `, ${name}` : ''}
          </h1>
        </div>
        <div className="shrink-0"><WeatherStrip /></div>
      </div>
      <div className="px-6 mt-4 space-y-4 md:space-y-0 md:grid md:grid-cols-2 xl:grid-cols-3 md:gap-4 md:items-start">
        {cards.map(id => <div key={id} className="min-w-0">{render(id)}</div>)}
      </div>
    </div>
  );
}
