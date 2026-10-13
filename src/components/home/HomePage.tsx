import { useEffect, useState } from 'react';
import { ChevronRight, CheckCircle2, Inbox } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { WeatherStrip } from './WeatherStrip';
import { CalendarCard } from './CalendarCard';
import { HomeListCard } from './HomeListCard';

export type HomeCardId = 'weather' | 'calendar' | 'budget' | 'family_todo' | 'my_todo' | 'grocery';

/** Default layout. A per-user override can be stored in user_home_layouts.cards. */
export const DEFAULT_HOME_CARDS: HomeCardId[] = ['weather', 'calendar', 'budget', 'family_todo', 'my_todo', 'grocery'];
const KNOWN = new Set<string>(DEFAULT_HOME_CARDS);

interface HomePageProps {
  unassignedCount: number;
  onOpenUnassigned: () => void;
  onOpenCalendarSettings: () => void;
}

export function HomePage({ unassignedCount, onOpenUnassigned, onOpenCalendarSettings }: HomePageProps) {
  const { user, profile } = useAuth();
  const [cards, setCards] = useState<HomeCardId[]>(DEFAULT_HOME_CARDS);

  useEffect(() => {
    if (!user) return;
    supabase.from('user_home_layouts').select('cards').eq('user_id', user.id).maybeSingle().then(({ data }) => {
      const list = Array.isArray(data?.cards) ? (data!.cards as string[]).filter(c => KNOWN.has(c)) : null;
      if (list && list.length) setCards(list as HomeCardId[]);
    });
  }, [user]);

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const name = profile?.display_name?.split(' ')[0];
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const render = (id: HomeCardId) => {
    switch (id) {
      case 'weather': return <WeatherStrip key={id} />;
      case 'calendar': return <CalendarCard key={id} onConnect={onOpenCalendarSettings} />;
      case 'budget': return (
        <button key={id} onClick={onOpenUnassigned} className="w-full bg-card rounded-2xl border border-border p-4 shadow-sm flex items-center gap-3 text-left active:scale-[0.99]">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${unassignedCount ? 'bg-accent/15 text-accent' : 'bg-primary/10 text-primary'}`}>
            {unassignedCount ? <Inbox size={20} /> : <CheckCircle2 size={20} />}
          </div>
          <div className="flex-1">
            <p className="text-xs text-muted-foreground">Budget</p>
            <p className="text-sm font-semibold text-foreground">
              {unassignedCount ? `${unassignedCount} transaction${unassignedCount === 1 ? '' : 's'} to assign` : 'All caught up'}
            </p>
          </div>
          <ChevronRight size={16} className="text-muted-foreground" />
        </button>
      );
      case 'family_todo': return <HomeListCard key={id} title="Family To Do" listType="family" placeholder="Add a family to-do" />;
      case 'my_todo': return <HomeListCard key={id} title="My To Do" listType="personal" placeholder="Add a to-do just for you" />;
      case 'grocery': return <HomeListCard key={id} title="Grocery List" listType="grocery" placeholder="Add groceries" />;
    }
  };

  return (
    <div className="max-w-lg mx-auto pb-12">
      <div className="px-6 pt-12 safe-top">
        <p className="text-xs text-muted-foreground">{today}</p>
        <h1 className="font-display text-2xl lg:text-3xl font-bold tracking-tight text-foreground">
          {greet}{name ? `, ${name}` : ''}
        </h1>
      </div>
      <div className="px-6 mt-4 space-y-4">{cards.map(render)}</div>
    </div>
  );
}
