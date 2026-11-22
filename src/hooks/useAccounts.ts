import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { readSnapshot, writeSnapshot } from '@/lib/snapshot';

export interface AppAccount {
  id: string;   // slug used on transactions.account
  label: string; // display name
  type: 'checking' | 'savings' | 'credit_card';
}

export function useAccounts() {
  const { user } = useAuth();
  const [seed] = useState(() => { const s = readSnapshot<AppAccount[]>(user?.id, 'accounts'); return Array.isArray(s) && s.length ? s : null; });
  const [accounts, setAccounts] = useState<AppAccount[]>(seed ?? []);
  const [loading, setLoading] = useState(!seed);

  const fetchAccounts = useCallback(async () => {
    // Get plaid accounts with their cardholders
    const { data: plaidAccounts, error: accountsError } = await supabase
      .from('plaid_accounts')
      .select('id, nickname, account_category, app_account');

    const { data: cardholders, error: holdersError } = await (supabase as any)
      .from('plaid_cardholders')
      .select('id, plaid_account_id, name, slug') as { data: any[] | null; error: unknown };
    // A failed load keeps the accounts already on screen (card refunds depend on knowing which accounts are cards).
    if (accountsError || holdersError) { setLoading(false); return false; }

    const result: AppAccount[] = [];
    const seen = new Set<string>();

    for (const pa of plaidAccounts || []) {
      const cat = pa.account_category as string;
      if (cat === 'credit_card') {
        // Add each cardholder as a separate account
        const holders = (cardholders || []).filter((c: any) => c.plaid_account_id === pa.id);
        for (const h of holders) {
          if (!seen.has(h.slug)) {
            seen.add(h.slug);
            result.push({ id: h.slug, label: h.name, type: 'credit_card' });
          }
        }
      } else {
        // Checking or savings — use nickname or app_account
        const slug = pa.app_account || pa.nickname?.toLowerCase().replace(/[^a-z0-9]+/g, '-') || pa.id;
        const label = pa.nickname || slug;
        if (!seen.has(slug)) {
          seen.add(slug);
          result.push({ id: slug, label, type: cat as 'checking' | 'savings' });
        }
      }
    }

    setAccounts(result);
    setLoading(false);
    writeSnapshot(user?.id, 'accounts', result);
    return true;
  }, [user?.id]);

  useEffect(() => {
    let alive = true;
    (async () => {
      for (const wait of [0, 2000, 5000, 15000]) {
        if (wait) await new Promise(r => setTimeout(r, wait));
        if (!alive) return;
        try { if (await fetchAccounts()) return; } catch { /* retry */ }
      }
    })();
    const onResume = () => { fetchAccounts().catch(() => {}); };
    window.addEventListener('perritt-resume', onResume);
    return () => { alive = false; window.removeEventListener('perritt-resume', onResume); };
  }, [fetchAccounts]);

  return { accounts, loading, refetch: fetchAccounts };
}
