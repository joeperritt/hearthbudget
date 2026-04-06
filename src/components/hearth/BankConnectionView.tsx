import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ArrowLeft, RefreshCw, Link2, Trash2, Plus, X, CreditCard, Landmark, PiggyBank } from 'lucide-react';
import { toast } from 'sonner';
import { usePlaidLink } from 'react-plaid-link';
import { useAuth } from '@/hooks/useAuth';
import { AccountManagement } from './AccountManagement';

interface PlaidAccount {
  id: string;
  plaid_account_id: string;
  name: string;
  official_name: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
  nickname: string | null;
  account_category: string;
}

interface Cardholder {
  id: string;
  plaid_account_id: string;
  name: string;
  slug: string;
  match_patterns: string[];
}

interface PlaidItem {
  id: string;
  institution_name: string;
  last_synced_at: string | null;
  plaid_accounts: PlaidAccount[];
}


const ACCOUNT_CATEGORIES = [
  { value: 'checking', label: 'Checking', icon: Landmark },
  { value: 'savings', label: 'Savings', icon: PiggyBank },
  { value: 'credit_card', label: 'Credit Card', icon: CreditCard },
] as const;

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

interface BankConnectionViewProps {
  onBack: () => void;
}

export function BankConnectionView({ onBack }: BankConnectionViewProps) {
  const { isAdmin } = useAuth();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [linkedItems, setLinkedItems] = useState<PlaidItem[]>([]);
  const [cardholders, setCardholders] = useState<Cardholder[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [loadingItems, setLoadingItems] = useState(true);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [editingNickname, setEditingNickname] = useState<string | null>(null);
  const [nicknameValue, setNicknameValue] = useState('');
  const [addingCardholder, setAddingCardholder] = useState<string | null>(null);
  const [newCardholderName, setNewCardholderName] = useState('');
  const [newCardholderPatterns, setNewCardholderPatterns] = useState('');
  const [editingCardholder, setEditingCardholder] = useState<string | null>(null);
  const [editCardholderName, setEditCardholderName] = useState('');
  const [editCardholderPatterns, setEditCardholderPatterns] = useState('');

  const fetchLinkedItems = useCallback(async () => {
    const { data, error } = await supabase
      .from('plaid_items')
      .select('id, institution_name, last_synced_at, plaid_accounts(id, plaid_account_id, name, official_name, type, subtype, mask, nickname, account_category)');

    if (!error && data) {
      setLinkedItems(data as unknown as PlaidItem[]);
    }

    // Fetch cardholders
    const { data: ch } = await (supabase as any)
      .from('plaid_cardholders')
      .select('id, plaid_account_id, name, slug, match_patterns') as { data: Cardholder[] | null };
    setCardholders(ch || []);
    setLoadingItems(false);
  }, []);

  useEffect(() => {
    fetchLinkedItems();
  }, [fetchLinkedItems]);

  // Plaid Link
  const createLinkToken = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('plaid-create-link-token');
      if (error) throw error;
      setLinkToken(data.link_token);
    } catch {
      toast.error('Failed to initialize bank connection');
    }
  };

  const onPlaidSuccess = useCallback(
    async (publicToken: string, metadata: any) => {
      try {
        const institution = metadata.institution as Record<string, string> | undefined;
        const accounts = metadata.accounts as Array<Record<string, string>> | undefined;
        const { error } = await supabase.functions.invoke('plaid-exchange-token', {
          body: { public_token: publicToken, institution_name: institution?.name || '', accounts: accounts || [] },
        });
        if (error) throw error;
        toast.success('Bank account connected!');
        setLinkToken(null);
        fetchLinkedItems();
      } catch {
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

  useEffect(() => {
    if (linkToken && plaidReady) openPlaid();
  }, [linkToken, plaidReady, openPlaid]);

  // Sync
  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('plaid-sync-transactions');
      if (error) throw error;
      toast.success(`Synced: ${data.added} new transactions`);
      fetchLinkedItems();
    } catch {
      toast.error('Failed to sync transactions');
    } finally {
      setSyncing(false);
    }
  };


  // Account management
  const updateAccountCategory = async (accountId: string, category: string) => {
    const slug = category === 'credit_card' ? null : undefined;
    const update: Record<string, any> = { account_category: category };
    // For non-credit-card, set app_account from nickname
    const acc = linkedItems.flatMap(i => i.plaid_accounts).find(a => a.id === accountId);
    if (category !== 'credit_card' && acc?.nickname) {
      update.app_account = slugify(acc.nickname);
    }
    const { error } = await supabase.from('plaid_accounts').update(update as any).eq('id', accountId);
    if (error) toast.error('Failed to update');
    else fetchLinkedItems();
  };

  const saveNickname = async (accountId: string) => {
    if (!nicknameValue.trim()) return;
    const update: Record<string, any> = { nickname: nicknameValue.trim() };
    const { error } = await supabase.from('plaid_accounts').update(update as any).eq('id', accountId);
    if (error) toast.error('Failed to update nickname');
    else {
      setEditingNickname(null);
      fetchLinkedItems();
    }
  };

  const addCardholder = async (plaidAccountId: string) => {
    if (!newCardholderName.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase.from('profiles').select('household_id').eq('user_id', user.id).single();
    if (!profile) return;

    const slug = slugify(newCardholderName.trim());
    const patterns = newCardholderPatterns.split(',').map(p => p.trim().toLowerCase()).filter(Boolean);

    const { error } = await (supabase as any)
      .from('plaid_cardholders')
      .insert({
        plaid_account_id: plaidAccountId,
        household_id: profile.household_id,
        name: newCardholderName.trim(),
        slug,
        match_patterns: patterns,
      });

    if (error) toast.error('Failed to add cardholder');
    else {
      setAddingCardholder(null);
      setNewCardholderName('');
      setNewCardholderPatterns('');
      fetchLinkedItems();
    }
  };

  const updateCardholder = async (id: string) => {
    if (!editCardholderName.trim()) return;
    const patterns = editCardholderPatterns.split(',').map(p => p.trim().toLowerCase()).filter(Boolean);

    const { error } = await (supabase as any)
      .from('plaid_cardholders')
      .update({ name: editCardholderName.trim(), match_patterns: patterns })
      .eq('id', id);

    if (error) toast.error('Failed to update cardholder');
    else {
      setEditingCardholder(null);
      fetchLinkedItems();
    }
  };

  const removeCardholder = async (id: string) => {
    const { error } = await (supabase as any).from('plaid_cardholders').delete().eq('id', id);
    if (error) toast.error('Failed to remove cardholder');
    else fetchLinkedItems();
  };

  const disconnectBank = async (itemId: string) => {
    const { error } = await supabase.from('plaid_items').delete().eq('id', itemId);
    if (error) toast.error('Failed to disconnect bank');
    else {
      toast.success('Bank disconnected');
      fetchLinkedItems();
      setBalances([]);
    }
  };

  return (
    <div className="max-w-lg mx-auto pb-28">
      <div className="px-6 pt-12 safe-top">
        <button onClick={onBack} className="flex items-center gap-1 text-accent text-sm font-medium mb-4 active:scale-95 transition-transform">
          <ArrowLeft size={16} /> Back
        </button>
        <h1 className="font-display text-xl font-bold text-foreground">Accounts & Connections</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage users & linked bank accounts</p>
      </div>

      <div className="px-6 mt-6 space-y-6">
        {/* Admin Account Management */}
        {isAdmin && <AccountManagement />}
        {/* Connect */}
        <button onClick={createLinkToken} className="w-full flex items-center gap-4 bg-accent text-accent-foreground rounded-lg p-4 shadow-sm active:scale-[0.98] transition-transform">
          <Link2 size={20} />
          <span className="text-sm font-semibold">Connect a Bank Account</span>
        </button>

        {/* Actions */}
        {linkedItems.length > 0 && (
          <div className="flex gap-3">
            <button onClick={handleSync} disabled={syncing} className="flex-1 flex items-center justify-center gap-2 bg-card rounded-lg p-3 shadow-sm border border-border active:scale-[0.98] transition-transform disabled:opacity-50">
              <RefreshCw size={16} className={`text-accent ${syncing ? 'animate-spin' : ''}`} />
              <span className="text-xs font-medium text-foreground">{syncing ? 'Syncing...' : 'Sync Transactions'}</span>
            </button>
          </div>
        )}

        {/* Banks & Accounts */}
        {loadingItems ? (
          <div className="text-center text-sm text-muted-foreground py-8">Loading...</div>
        ) : linkedItems.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-8">
            No bank accounts connected yet.<br />Tap "Connect a Bank Account" above to get started.
          </div>
        ) : (
          linkedItems.map(item => (
            <div key={item.id}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{item.institution_name || 'Bank'}</h3>
                <button onClick={() => disconnectBank(item.id)} className="text-destructive/60 hover:text-destructive active:scale-90 transition-all" title="Disconnect bank">
                  <Trash2 size={14} />
                </button>
              </div>
              {item.last_synced_at && (
                <p className="text-[10px] text-muted-foreground mb-2">Last synced: {new Date(item.last_synced_at).toLocaleString()}</p>
              )}
              <div className="bg-card rounded-lg shadow-sm divide-y divide-border overflow-hidden">
                {item.plaid_accounts.map(acc => {
                  const accCardholders = cardholders.filter(c => c.plaid_account_id === acc.id);
                  const CategoryIcon = ACCOUNT_CATEGORIES.find(c => c.value === acc.account_category)?.icon || Landmark;

                  return (
                    <div key={acc.id} className="px-4 py-3 space-y-3">
                      {/* Account header */}
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-2">
                          <CategoryIcon size={16} className="text-accent shrink-0" />
                          <div>
                            {editingNickname === acc.id ? (
                              <div className="flex items-center gap-2">
                                <input
                                  value={nicknameValue}
                                  onChange={e => setNicknameValue(e.target.value)}
                                  onKeyDown={e => e.key === 'Enter' && saveNickname(acc.id)}
                                  className="text-sm font-medium text-foreground bg-background border border-border rounded px-2 py-1 w-36 focus:outline-none focus:ring-2 focus:ring-accent/30"
                                  autoFocus
                                />
                                <button onClick={() => saveNickname(acc.id)} className="text-accent text-xs font-medium">Save</button>
                                <button onClick={() => setEditingNickname(null)} className="text-muted-foreground text-xs">Cancel</button>
                              </div>
                            ) : (
                              <button
                                onClick={() => { setEditingNickname(acc.id); setNicknameValue(acc.nickname || acc.name); }}
                                className="text-sm font-medium text-foreground text-left hover:underline decoration-dotted underline-offset-4"
                              >
                                {acc.nickname || acc.name}
                              </button>
                            )}
                            <p className="text-[11px] text-muted-foreground">
                              {acc.type} {acc.subtype ? `· ${acc.subtype}` : ''} {acc.mask ? `····${acc.mask}` : ''}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Account category selector */}
                      <div className="flex gap-2">
                        {ACCOUNT_CATEGORIES.map(cat => (
                          <button
                            key={cat.value}
                            onClick={() => updateAccountCategory(acc.id, cat.value)}
                            className={`flex-1 text-[11px] font-medium py-1.5 rounded-md border transition-all active:scale-95 ${
                              acc.account_category === cat.value
                                ? 'bg-accent text-accent-foreground border-accent'
                                : 'bg-card text-muted-foreground border-border hover:border-accent/50'
                            }`}
                          >
                            {cat.label}
                          </button>
                        ))}
                      </div>

                      {/* Cardholders for credit cards */}
                      {acc.account_category === 'credit_card' && (
                        <div className="space-y-2">
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Cardholders</p>
                          {accCardholders.length === 0 && (
                            <p className="text-[11px] text-muted-foreground/60 italic">No cardholders added yet</p>
                          )}
                          {accCardholders.map(ch => (
                            <div key={ch.id} className="bg-muted/30 rounded-md px-3 py-2">
                              {editingCardholder === ch.id ? (
                                <div className="space-y-2">
                                  <input
                                    value={editCardholderName}
                                    onChange={e => setEditCardholderName(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && updateCardholder(ch.id)}
                                    placeholder="Name"
                                    className="w-full text-sm px-2 py-1.5 rounded bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
                                    autoFocus
                                  />
                                  <input
                                    value={editCardholderPatterns}
                                    onChange={e => setEditCardholderPatterns(e.target.value)}
                                    placeholder="Match patterns (comma-separated)"
                                    className="w-full text-sm px-2 py-1.5 rounded bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
                                  />
                                  <div className="flex gap-2">
                                    <button onClick={() => updateCardholder(ch.id)} className="text-xs font-medium text-accent active:scale-95">Save</button>
                                    <button onClick={() => setEditingCardholder(null)} className="text-xs text-muted-foreground">Cancel</button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-center justify-between">
                                  <button
                                    onClick={() => {
                                      setEditingCardholder(ch.id);
                                      setEditCardholderName(ch.name);
                                      setEditCardholderPatterns(ch.match_patterns.join(', '));
                                    }}
                                    className="text-left flex-1"
                                  >
                                    <p className="text-sm font-medium text-foreground hover:underline decoration-dotted underline-offset-4">{ch.name}</p>
                                    {ch.match_patterns.length > 0 && (
                                      <p className="text-[10px] text-muted-foreground">Matches: {ch.match_patterns.join(', ')}</p>
                                    )}
                                  </button>
                                  <button onClick={() => removeCardholder(ch.id)} className="text-destructive/50 hover:text-destructive active:scale-90 transition-all ml-2">
                                    <X size={14} />
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                          {addingCardholder === acc.id ? (
                            <div className="bg-muted/20 rounded-md p-3 space-y-2">
                              <input
                                value={newCardholderName}
                                onChange={e => setNewCardholderName(e.target.value)}
                                placeholder="Name (e.g. Joe's Amex)"
                                className="w-full text-sm px-2 py-1.5 rounded bg-background border border-border text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent/30"
                                autoFocus
                              />
                              <input
                                value={newCardholderPatterns}
                                onChange={e => setNewCardholderPatterns(e.target.value)}
                                placeholder="Match patterns (comma-separated, e.g. joe, joseph)"
                                className="w-full text-sm px-2 py-1.5 rounded bg-background border border-border text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent/30"
                              />
                              <div className="flex gap-2">
                                <button onClick={() => addCardholder(acc.id)} className="text-xs font-medium text-accent active:scale-95">Add</button>
                                <button onClick={() => { setAddingCardholder(null); setNewCardholderName(''); setNewCardholderPatterns(''); }} className="text-xs text-muted-foreground">Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={() => setAddingCardholder(acc.id)}
                              className="flex items-center gap-1.5 text-[11px] font-medium text-accent active:scale-95 transition-transform"
                            >
                              <Plus size={12} /> Add Cardholder
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
