import { createContext, useContext, ReactNode } from 'react';
import { useHomeList } from '@/hooks/useHomeList';
import { useTodoOwners } from '@/hooks/useTodoOwners';
import { useTodoReminders } from '@/hooks/useTodoReminders';

type HomeData = {
  todo: ReturnType<typeof useHomeList>;
  store: ReturnType<typeof useHomeList>;
  owners: ReturnType<typeof useTodoOwners>;
  reminders: ReturnType<typeof useTodoReminders>;
};

const Ctx = createContext<HomeData | null>(null);

/** Shared household list + owner state for the Home widgets, so counts stay live even when a widget is hidden. */
export function HomeDataProvider({ children }: { children: ReactNode }) {
  const todo = useHomeList('todo');
  const store = useHomeList('store');
  const owners = useTodoOwners();
  const reminders = useTodoReminders();
  return <Ctx.Provider value={{ todo, store, owners, reminders }}>{children}</Ctx.Provider>;
}

export function useHomeData() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useHomeData must be used inside HomeDataProvider');
  return v;
}
