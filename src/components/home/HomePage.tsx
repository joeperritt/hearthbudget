import { onReminderLink, peekReminderLink } from '@/lib/reminderLink';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { WeatherStrip } from './WeatherStrip';
import { CalendarCard } from './CalendarCard';
import { DailyGoalsCard } from './DailyGoalsCard';
import { TodoCard } from './TodoCard';
import { Check, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HomeDataProvider, useHomeData } from './HomeDataContext';
import { readSnapshot, useRefreshing, writeSnapshot } from '@/lib/snapshot';

export type HomeCardId = 'calendar' | 'todo' | 'goals';

/** Default layout. A per-user override can be stored in user_home_layouts.cards. */
export const DEFAULT_HOME_CARDS: HomeCardId[] = ['calendar', 'todo', 'goals'];
const KNOWN = new Set<string>(DEFAULT_HOME_CARDS);

/** Saved layouts may still name the removed store card: it becomes Daily Goals, and Goals is always present. */
export function normalizeHomeCards(saved: unknown): HomeCardId[] {
  if (!Array.isArray(saved)) return DEFAULT_HOME_CARDS;
  const out: HomeCardId[] = [];
  for (const c of saved) {
    const id = c === 'store' ? 'goals' : c;
    if (typeof id === 'string' && KNOWN.has(id) && !out.includes(id as HomeCardId)) out.push(id as HomeCardId);
  }
  if (!out.length) return DEFAULT_HOME_CARDS;
  if (!out.includes('goals')) out.push('goals');
  return out;
}

interface HomePageProps {
  onOpenCalendarSettings: () => void;
  unassignedCount: number;
  onOpenUnassigned: () => void;
  /** True on app open: start on the last-selected mobile tab instead of Calendar. */
  restoreLastTab?: boolean;
}

export function HomePage(props: HomePageProps) {
  return (
    <HomeDataProvider>
      <HomePageInner {...props} />
    </HomeDataProvider>
  );
}

function HomePageInner({ onOpenCalendarSettings, unassignedCount, onOpenUnassigned, restoreLastTab }: HomePageProps) {
  const { user } = useAuth();
  const { todo, owners: { isVisible, keyOf } } = useHomeData();
  // Live open counts for the mobile toggle; chip choices come from user_home_layouts.todo_visibility.
  const nyToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const todoCount = todo.items.filter(i => !i.completed && i.due_date && i.due_date <= nyToday && isVisible(keyOf(i.user_id))).length;
  const refreshing = useRefreshing();
  const [cards, setCards] = useState<HomeCardId[]>(() => {
    return normalizeHomeCards(readSnapshot<string[]>(user?.id, 'home-cards'));
  });
  // Mobile: one widget at a time behind a segmented toggle; starts on Calendar
  // (the component remounts whenever Home is opened, so it always resets here).
  const [mobileTab, setMobileTab] = useState<HomeCardId>(() => {
    if (peekReminderLink()) return 'todo';
    if (restoreLastTab) {
      const raw = readSnapshot<string>(user?.id, 'home-tab');
      const last = raw === 'store' ? 'goals' : raw;
      if (last && KNOWN.has(last)) return last as HomeCardId;
    }
    return 'calendar';
  });
  useEffect(() => { writeSnapshot(user?.id, 'home-tab', mobileTab); }, [mobileTab, user?.id]);

  // A tapped reminder notification (captured at startup or via service worker message): jump to To Do.
  useEffect(() => onReminderLink(() => setMobileTab('todo')), []);

  useEffect(() => {
    if (!user) return;
    try { window.localStorage.removeItem(`perritt-snap:${user.id}:home-list-store`); } catch { /* ignore */ }
    supabase.from('user_home_layouts').select('cards').eq('user_id', user.id).maybeSingle().then(({ data, error }) => {
      if (error) return;
      const list = normalizeHomeCards(data?.cards);
      setCards(list);
      writeSnapshot(user.id, 'home-cards', list);
    });
  }, [user]);

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const render = (id: HomeCardId) => {
    switch (id) {
      case 'calendar': return <CalendarCard onConnect={onOpenCalendarSettings} />;
      case 'todo': return <TodoCard />;
      case 'goals': return <DailyGoalsCard />;
    }
  };

  return (
    <div className="max-w-lg lg:max-w-none mx-auto pb-12 lg:pb-0 lg:h-[calc(100dvh-5rem)] lg:flex lg:flex-col">
      <div className="px-6 pt-6 safe-top flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <p className="text-xs text-muted-foreground shrink-0 inline-flex items-center gap-1.5">
          {today}
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full bg-accent transition-opacity duration-300 ${refreshing ? 'opacity-70 animate-pulse' : 'opacity-0'}`} />
          {refreshing && <span className="sr-only">Refreshing</span>}
        </p>
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
              {id === 'calendar' ? 'Calendar' : id === 'todo' ? `To Do${todoCount ? ` (${todoCount})` : ''}` : 'Goals'}
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
