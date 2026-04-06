import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface AppAccount {
  id: string;   // slug used on transactions.account
  label: string; // display name
  type: 'checking' | 'savings' | 'credit_card';
}

export function useAccounts() {
  const [accounts, setAccounts] = useState<AppAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAccounts = useCallback(async () => {
    // Get plaid accounts with their cardholders
    const { data: plaidAccounts } = await supabase
      .from('plaid_accounts')
      .select('id, nickname, account_category, app_account');

    const { data: cardholders } = await supabase
      .from('plaid_cardholders' as any)
      .select('id, plaid_account_id, name, slug');

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
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  return { accounts, loading, refetch: fetchAccounts };
}
