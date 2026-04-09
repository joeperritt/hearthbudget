import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export function useToolState<T extends Record<string, any>>(
  householdId: string | null,
  toolName: string,
  defaultState: T,
): {
  state: T;
  setState: (updates: Partial<T>) => void;
  loaded: boolean;
} {
  const [state, setStateRaw] = useState<T>(defaultState);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestState = useRef<T>(defaultState);

  // Load saved state on mount
  useEffect(() => {
    if (!householdId) { setLoaded(true); return; }
    supabase
      .from('tool_states' as any)
      .select('state_json')
      .eq('household_id', householdId)
      .eq('tool_name', toolName)
      .maybeSingle()
      .then(({ data }: any) => {
        if (data?.state_json && typeof data.state_json === 'object') {
          const merged = { ...defaultState, ...data.state_json } as T;
          setStateRaw(merged);
          latestState.current = merged;
        }
        setLoaded(true);
      });
  }, [householdId, toolName]);

  // Save to Supabase (debounced)
  const save = useCallback((newState: T) => {
    if (!householdId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      supabase
        .from('tool_states' as any)
        .upsert(
          { household_id: householdId, tool_name: toolName, state_json: newState, updated_at: new Date().toISOString() } as any,
          { onConflict: 'household_id,tool_name' }
        )
        .then(() => {});
    }, 1000);
  }, [householdId, toolName]);

  const setState = useCallback((updates: Partial<T>) => {
    setStateRaw(prev => {
      const next = { ...prev, ...updates };
      latestState.current = next;
      save(next);
      return next;
    });
  }, [save]);

  return { state, setState, loaded };
}
