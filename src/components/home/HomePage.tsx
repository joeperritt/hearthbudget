import { onReminderLink, peekReminderLink } from '@/lib/reminderLink';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { WeatherStrip } from './WeatherStrip';
import { CalendarCard } from './CalendarCard';
import { HomeListCard } from './HomeListCard';
import { TodoCard } from './TodoCard';
import { Check, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HomeDataProvider, useHomeData } from './HomeDataContext';

export type HomeCardId = 'calendar' | 'todo' | 'store';

/** Default layout. A per-user override can be stored in user_home_layouts.cards. */
export const DEFAULT_HOME_CARDS: HomeCardId[] = ['calendar', 'todo', 'store'];
const KNOWN = new Set<string>(DEFAULT_HOME_CARDS);

interface HomePageProps {
  onOpenCalendarSettings: () => void;
  unassignedCount: number;
  onOpenUnassigned: () => void;
}

export function HomePage(props: HomePageProps) {
  return (
    <HomeDataProvider>
      <HomePageInner {...props} />
    </HomeDataProvider>
  );
}

function HomePageInner({ onOpenCalendarSettings, unassignedCount, onOpenUnassigned }: HomePageProps) {
  const { user } = useAuth();
  const { todo, store, owners: { isVisible, keyOf } } = useHomeData();
  // Live open counts for the mobile toggle; chip choices come from user_home_layouts.todo_visibility.
  const nyToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const todoCount = todo.items.filter(i => !i.completed && i.due_date && i.due_date <= nyToday && isVisible(keyOf(i.user_id))).length;
  const storeCount = store.items.filter(i => !i.completed).length;
  const [cards, setCards] = useState<HomeCardId[]>(DEFAULT_HOME_CARDS);
  // Mobile: one widget at a time behind a segmented toggle; starts on Calendar
  // (the component remounts whenever Home is opened, so it always resets here).
  const [mobileTab, setMobileTab] = useState<HomeCardId>(() => peekReminderLink() ? 'todo' : 'calendar');

  // A tapped reminder notification (captured at startup or via service worker message): jump to To Do.
  useEffect(() => onReminderLink(() => setMobileTab('todo')), []);

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
    <div className="max-w-lg lg:max-w-none mx-auto pb-12 lg:pb-0 lg:h-[calc(100dvh-5rem)] lg:flex lg:flex-col">
      <div className="px-6 pt-6 safe-top flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <p className="text-xs text-muted-foreground shrink-0">{today}</p>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <div className="rounded-full border border-border bg-card px-3 h-8 flex items-center"><WeatherStrip /></div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-full bg-card text-xs px-3"
            aria-label={`Budget: ${unassignedCount > 0 ? `${unassignedCount} to assign` : 'All caught up'}, show unassigned transactions`}
            onClick={onOpenUnassigned}
          >
            {unassignedCount > 0 ? <Wallet /> : <Check className="text-success" />}
            {`Budget: ${unassignedCount > 0 ? `${unassignedCount} to assign` : 'All caught up'}`}
          </Button>
        </div>
      </div>
      <div className="px-6 mt-3 lg:hidden">
        <div role="tablist" aria-label="Home widget" className="grid grid-cols-3 gap-1 rounded-full bg-muted p-1">
          {cards.map(id => (
            <button key={id} role="tab" aria-selected={mobileTab === id} onClick={() => setMobileTab(id)}
              className={`h-8 rounded-full text-sm font-medium transition-colors ${mobileTab === id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}>
              {id === 'calendar' ? 'Calendar' : id === 'todo' ? `To Do${todoCount ? ` (${todoCount})` : ''}` : `Store${storeCount ? ` (${storeCount})` : ''}`}
            </button>
          ))}
        </div>
      </div>
      <div className="px-6 mt-3 lg:mt-4 space-y-4 lg:space-y-0 lg:grid lg:gap-4 lg:grid-cols-3 lg:items-stretch lg:flex-1 lg:min-h-0">
        {cards.map(id => (
          <div key={id} className={`min-w-0 lg:min-h-0 ${mobileTab === id ? '' : 'hidden'} lg:block`}>{render(id)}</div>
        ))}
      </div>
    </div>
  );
}
