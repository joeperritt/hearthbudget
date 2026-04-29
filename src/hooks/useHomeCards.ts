import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Lives in tool_states under tool_name='home-cards'. Tracks dismissible
 * post-onboarding cards on the Dashboard:
 *   - needs_budget_setup    → user took the "I'll set this up later" escape on Step 5
 *   - needs_plaid_setup     → user skipped Plaid on Step 4
 *   - welcome_toast_shown   → one-shot toast tracker
 *
 * The "_dismissed" flags persist the user's choice so the card stays gone
 * after a refresh.
 */

export interface HomeCardsState {
  needs_budget_setup: boolean;
  needs_plaid_setup: boolean;
  budget_setup_dismissed: boolean;
  plaid_setup_dismissed: boolean;
  welcome_toast_shown: boolean;
}

const DEFAULTS: HomeCardsState = {
  needs_budget_setup: false,
  needs_plaid_setup: false,
  budget_setup_dismissed: false,
  plaid_setup_dismissed: false,
  welcome_toast_shown: true, // default true so legacy users don't get a surprise toast
};

export function useHomeCards(householdId: string | null) {
  const [state, setState] = useState<HomeCardsState>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!householdId) { setLoaded(true); return; }
    supabase
      .from('tool_states')
      .select('state_json')
      .eq('household_id', householdId)
      .eq('tool_name', 'home-cards')
      .maybeSingle()
      .then(({ data }: any) => {
        if (cancelled) return;
        if (data?.state_json && typeof data.state_json === 'object') {
          setState({ ...DEFAULTS, ...(data.state_json as Partial<HomeCardsState>) });
        }
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [householdId]);

  const update = useCallback(async (patch: Partial<HomeCardsState>) => {
    if (!householdId) return;
    const next = { ...state, ...patch };
    setState(next);
    await supabase
      .from('tool_states')
      .upsert(
        {
          household_id: householdId,
          tool_name: 'home-cards',
          state_json: next as any,
          updated_at: new Date().toISOString(),
        } as any,
        { onConflict: 'household_id,tool_name' },
      );
  }, [householdId, state]);

  return { state, loaded, update };
}
