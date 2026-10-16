import { createContext, useContext, ReactNode } from 'react';
import { useHomeList } from '@/hooks/useHomeList';
import { useTodoOwners } from '@/hooks/useTodoOwners';

type HomeData = {
  todo: ReturnType<typeof useHomeList>;
  store: ReturnType<typeof useHomeList>;
  owners: ReturnType<typeof useTodoOwners>;
};

const Ctx = createContext<HomeData | null>(null);

/** Shared household list + owner state for the Home widgets, so counts stay live even when a widget is hidden. */
export function HomeDataProvider({ children }: { children: ReactNode }) {
  const todo = useHomeList('todo');
  const store = useHomeList('store');
  const owners = useTodoOwners();
  return <Ctx.Provider value={{ todo, store, owners }}>{children}</Ctx.Provider>;
}

export function useHomeData() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useHomeData must be used inside HomeDataProvider');
  return v;
}
