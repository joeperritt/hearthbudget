import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface HouseholdFlags {
  stewardship_mode: boolean;
  has_kids: boolean;
  has_pets: boolean;
}

const DEFAULTS: HouseholdFlags = {
  stewardship_mode: true,
  has_kids: false,
  has_pets: false,
};

/**
 * Reads & writes the household-level flags that drive analyzer framing,
 * AI advisor tone, and bucket guideline relevance:
 *   - stewardship_mode  → biblical/stewardship framing
 *   - has_kids          → keep Kids bucket relevant
 *   - has_pets          → keep Pets bucket relevant
 *
 * Single source of truth lives on the `households` table. Defaults to the
 * sensible "stewardship ON, no kids, no pets" until loaded.
 */
export function useHouseholdFlags(householdId: string | null) {
  const [flags, setFlags] = useState<HouseholdFlags>(DEFAULTS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!householdId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    supabase
      .from('households')
      .select('stewardship_mode, has_kids, has_pets')
      .eq('id', householdId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (data) {
          setFlags({
            stewardship_mode: data.stewardship_mode ?? true,
            has_kids: data.has_kids ?? false,
            has_pets: data.has_pets ?? false,
          });
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [householdId]);

  const updateFlag = useCallback(
    async <K extends keyof HouseholdFlags>(key: K, value: HouseholdFlags[K]) => {
      if (!householdId) return;
      // Optimistic update — the UI is a single switch; rollback on error.
      const prev = flags[key];
      setFlags(f => ({ ...f, [key]: value }));
      const patch = { [key]: value } as Partial<HouseholdFlags>;
      const { error } = await supabase
        .from('households')
        .update(patch)
        .eq('id', householdId);
      if (error) {
        setFlags(f => ({ ...f, [key]: prev }));
        throw error;
      }
    },
    [householdId, flags],
  );

  return { flags, loading, updateFlag };
}
