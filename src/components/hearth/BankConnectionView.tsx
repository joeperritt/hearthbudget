import { useState, useEffect, useCallback } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { supabase } from '@/integrations/supabase/client';
import { ArrowLeft, Building2, RefreshCw, Link2, Trash2, Check } from 'lucide-react';
import { toast } from 'sonner';

type AccountSource = 'joe-amex' | 'katie-amex' | 'checking';

interface PlaidAccount {
  id: string;
  plaid_account_id: string;
  name: string;
  official_name: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
  app_account: string | null;
}

interface PlaidItem {
  id: string;
  institution_name: string;
  last_synced_at: string | null;
  plaid_accounts: PlaidAccount[];
}

interface Balance {
  account_name: string;
  app_account: string | null;
  current: number;
  available: number | null;
  type: string;
  subtype: string | null;
  mask: string | null;
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}

const APP_ACCOUNT_OPTIONS: { value: AccountSource; label: string }[] = [
  { value: 'joe-amex', label: "Joe's Amex" },
  { value: 'katie-amex', label: "Katie's Amex" },
  { value: 'checking', label: 'Checking' },
];

interface BankConnectionViewProps {
  onBack: () => void;
}

export function BankConnectionView({ onBack }: BankConnectionViewProps) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [linkedItems, setLinkedItems] = useState<PlaidItem[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [loadingItems, setLoadingItems] = useState(true);
  const [loadingBalances, setLoadingBalances] = useState(false);

  // Fetch linked bank accounts
  const fetchLinkedItems = useCallback(async () => {
    const { data, error } = await supabase
      .from('plaid_items')
      .select('id, institution_name, last_synced_at, plaid_accounts(id, plaid_account_id, name, official_name, type, subtype, mask, app_account)');

    if (!error && data) {
      setLinkedItems(data as unknown as PlaidItem[]);
    }
    setLoadingItems(false);
  }, []);

  useEffect(() => {
    fetchLinkedItems();
  }, [fetchLinkedItems]);

  // Create link token
  const createLinkToken = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('plaid-create-link-token');
      if (error) throw error;
      setLinkToken(data.link_token);
    } catch (err) {
      console.error('Failed to create link token:', err);
      toast.error('Failed to initialize bank connection');
    }
  };

  // Plaid Link success handler
  const onPlaidSuccess = useCallback(
    async (publicToken: string, metadata: any) => {
      try {
        const institution = metadata.institution as Record<string, string> | undefined;
        const accounts = metadata.accounts as Array<Record<string, string>> | undefined;

        const { error } = await supabase.functions.invoke('plaid-exchange-token', {
          body: {
            public_token: publicToken,
            institution_name: institution?.name || '',
            accounts: accounts || [],
          },
        });

        if (error) throw error;

        toast.success('Bank account connected!');
        setLinkToken(null);
        fetchLinkedItems();
      } catch (err) {
        console.error('Exchange token error:', err);
        toast.error('Failed to connect bank account');
      }
    },
    [fetchLinkedItems]
  );

  const { open: openPlaid, ready: plaidReady } = usePlaidLink({
    token: linkToken,
    onSuccess: onPlaidSuccess,
    onExit: () => setLinkToken(null),
  });

  // Auto-open Plaid Link when token is ready
  useEffect(() => {
    if (linkToken && plaidReady) {
      openPlaid();
    }
  }, [linkToken, plaidReady, openPlaid]);

  // Sync transactions
  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('plaid-sync-transactions');
      if (error) throw error;
      toast.success(`Synced: ${data.added} new transactions`);
      fetchLinkedItems();
    } catch (err) {
      console.error('Sync error:', err);
      toast.error('Failed to sync transactions');
    } finally {
      setSyncing(false);
    }
  };

  // Remap cardholder assignments on existing transactions
  const handleRemapCardholders = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('plaid-remap-cardholders');
      if (error) throw error;
      toast.success(`Remapped ${data.updated} transactions by cardholder`);
    } catch (err) {
      console.error('Remap error:', err);
      toast.error('Failed to remap cardholders');
    } finally {
      setSyncing(false);
    }
  };

  // Get balances
  const handleGetBalances = async () => {
    setLoadingBalances(true);
    try {
      const { data, error } = await supabase.functions.invoke('plaid-get-balances');
      if (error) throw error;
      setBalances(data.balances || []);
    } catch (err) {
      console.error('Balance error:', err);
      toast.error('Failed to get balances');
    } finally {
      setLoadingBalances(false);
    }
  };

  // Map a plaid account to an app account
  const mapAccount = async (plaidAccountId: string, appAccount: AccountSource | null) => {
    const { error } = await supabase
      .from('plaid_accounts')
      .update({ app_account: appAccount })
      .eq('id', plaidAccountId);

    if (error) {
      toast.error('Failed to update account mapping');
    } else {
      toast.success('Account mapped');
      fetchLinkedItems();
    }
  };

  // Disconnect a bank
  const disconnectBank = async (itemId: string) => {
    const { error } = await supabase.from('plaid_items').delete().eq('id', itemId);
    if (error) {
      toast.error('Failed to disconnect bank');
    } else {
      toast.success('Bank disconnected');
      fetchLinkedItems();
      setBalances([]);
    }
  };

  return (
    <div className="max-w-lg mx-auto pb-28">
      <div className="px-6 pt-12 safe-top">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-accent text-sm font-medium mb-4 active:scale-95 transition-transform"
        >
          <ArrowLeft size={16} /> Back
        </button>
        <h1 className="font-display text-xl font-bold text-foreground">Bank Connections</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Link your bank accounts to auto-import transactions and view balances
        </p>
      </div>

      <div className="px-6 mt-6 space-y-6">
        {/* Connect New Bank */}
        <button
          onClick={createLinkToken}
          className="w-full flex items-center gap-4 bg-accent text-accent-foreground rounded-lg p-4 shadow-sm active:scale-[0.98] transition-transform"
        >
          <Link2 size={20} />
          <span className="text-sm font-semibold">Connect a Bank Account</span>
        </button>

        {/* Action Buttons */}
        {linkedItems.length > 0 && (
          <div className="flex gap-3">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex-1 flex items-center justify-center gap-2 bg-card rounded-lg p-3 shadow-sm border border-border active:scale-[0.98] transition-transform disabled:opacity-50"
            >
              <RefreshCw size={16} className={`text-accent ${syncing ? 'animate-spin' : ''}`} />
              <span className="text-xs font-medium text-foreground">
                {syncing ? 'Syncing...' : 'Sync Transactions'}
              </span>
            </button>
            <button
              onClick={handleGetBalances}
              disabled={loadingBalances}
              className="flex-1 flex items-center justify-center gap-2 bg-card rounded-lg p-3 shadow-sm border border-border active:scale-[0.98] transition-transform disabled:opacity-50"
            >
              <Building2 size={16} className="text-primary" />
              <span className="text-xs font-medium text-foreground">
                {loadingBalances ? 'Loading...' : 'Get Balances'}
              </span>
            </button>
          </div>
        )}

        {/* Balances */}
        {balances.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Live Balances
            </h3>
            <div className="bg-card rounded-lg shadow-sm divide-y divide-border overflow-hidden">
              {balances.map((b, i) => (
                <div key={i} className="flex justify-between items-center px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{b.account_name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {b.type} {b.subtype ? `· ${b.subtype}` : ''} {b.mask ? `····${b.mask}` : ''}
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-foreground">
                    {formatCurrency(b.current)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Linked Banks & Account Mapping */}
        {loadingItems ? (
          <div className="text-center text-sm text-muted-foreground py-8">Loading...</div>
        ) : linkedItems.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-8">
            No bank accounts connected yet.
            <br />
            Tap "Connect a Bank Account" above to get started.
          </div>
        ) : (
          linkedItems.map((item) => (
            <div key={item.id}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {item.institution_name || 'Bank'}
                </h3>
                <button
                  onClick={() => disconnectBank(item.id)}
                  className="text-destructive/60 hover:text-destructive active:scale-90 transition-all"
                  title="Disconnect bank"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              {item.last_synced_at && (
                <p className="text-[10px] text-muted-foreground mb-2">
                  Last synced: {new Date(item.last_synced_at).toLocaleString()}
                </p>
              )}
              <div className="bg-card rounded-lg shadow-sm divide-y divide-border overflow-hidden">
                {item.plaid_accounts.map((acc) => (
                  <div key={acc.id} className="px-4 py-3">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="text-sm font-medium text-foreground">{acc.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {acc.type} {acc.subtype ? `· ${acc.subtype}` : ''}{' '}
                          {acc.mask ? `····${acc.mask}` : ''}
                        </p>
                      </div>
                      {acc.app_account && (
                        <span className="text-[10px] font-medium text-accent bg-accent/10 px-2 py-0.5 rounded-full">
                          Mapped
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2 mt-2">
                      {APP_ACCOUNT_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() =>
                            mapAccount(acc.id, acc.app_account === opt.value ? null : opt.value)
                          }
                          className={`flex-1 text-[11px] font-medium py-1.5 rounded-md border transition-all active:scale-95 ${
                            acc.app_account === opt.value
                              ? 'bg-accent text-accent-foreground border-accent'
                              : 'bg-card text-muted-foreground border-border hover:border-accent/50'
                          }`}
                        >
                          {acc.app_account === opt.value && <Check size={10} className="inline mr-1" />}
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
