import { useState, useEffect, useCallback } from 'react';
import { Transaction, BudgetCategory, FixedExpense, AccountSource, INCOME_CATEGORY, DEPOSIT_CATEGORY, TRANSFER_CATEGORY, CC_PAYMENT_CATEGORY, PRIOR_MONTH_CATEGORY, categoryRequiresNotes } from '@/types/budget';
import { AISuggestionCard } from './AISuggestionCard';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { format, subMonths, addMonths } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { SplitEditor, SplitLine } from './SplitEditor';
import { CategoryBudgetMini } from './CategoryBudgetMini';
import { AppAccount } from '@/hooks/useAccounts';

type TxMode = 'variable' | 'fixed' | 'deposit' | 'ignore' | 'cc-payment';
type IgnoreType = 'income' | 'transfer' | 'prior-month';

const CC_PAYMENT_PATTERNS = ['MOBILE PAYMENT', 'AMERICAN EXPRESS ACH PMT', 'AMEX ACH PMT'];

function generateMonthOptions(current: string): { value: string; label: string }[] {
  if (!current) return [];
  const base = new Date(current + '-01T00:00:00');
  const options: { value: string; label: string }[] = [];
  for (let i = -3; i <= 1; i++) {
    const d = i < 0 ? subMonths(base, Math.abs(i)) : i > 0 ? addMonths(base, i) : base;
    options.push({ value: format(d, 'yyyy-MM'), label: format(d, 'MMM yyyy') });
  }
  return options;
}

interface EditTransactionSheetProps {
  transaction: Transaction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: BudgetCategory[];
  fixedExpenses: FixedExpense[];
  activeMonth: string;
  monthTransactions?: Transaction[];
  splitSiblings?: Transaction[];
  accounts?: AppAccount[];
  allTransactions?: Transaction[];
}

function deriveMode(categoryId: string, transactionType: string, description: string, fixedExpenses: FixedExpense[]): TxMode {
  if (transactionType === 'cc-payment' || categoryId === CC_PAYMENT_CATEGORY) return 'cc-payment';
  if (categoryId === PRIOR_MONTH_CATEGORY) return 'ignore';
  if (transactionType === 'income' || categoryId === INCOME_CATEGORY) {
    const upperDesc = description.toUpperCase();
    if (CC_PAYMENT_PATTERNS.some(p => upperDesc.includes(p))) return 'cc-payment';
    return 'ignore';
  }
  if (categoryId === TRANSFER_CATEGORY) return 'ignore';
  if (transactionType === 'deposit') return 'deposit';
  if (fixedExpenses.some(e => e.id === categoryId)) return 'fixed';
  return 'variable';
}

function deriveIgnoreType(categoryId: string): IgnoreType {
  if (categoryId === PRIOR_MONTH_CATEGORY) return 'prior-month';
  if (categoryId === TRANSFER_CATEGORY) return 'transfer';
  return 'income';
}

export function EditTransactionSheet({ transaction, open, onOpenChange, categories, fixedExpenses, activeMonth, monthTransactions = [], splitSiblings = [], accounts = [], allTransactions = [] }: EditTransactionSheetProps) {
  const [mode, setMode] = useState<TxMode>('variable');
  const [variableCategoryId, setVariableCategoryId] = useState('unassigned');
  const [fixedCategoryId, setFixedCategoryId] = useState('');
  const [depositCategoryId, setDepositCategoryId] = useState('');
  const [ccPaymentCategoryId, setCcPaymentCategoryId] = useState('');
  const [ccPaymentCategoryType, setCcPaymentCategoryType] = useState<'none' | 'variable' | 'fixed'>('none');
  const [ignoreType, setIgnoreType] = useState<IgnoreType>('income');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [isSplit, setIsSplit] = useState(false);
  const [splitLines, setSplitLines] = useState<SplitLine[]>([]);
  const [budgetMonth, setBudgetMonth] = useState('');

  // Sync local state when transaction changes
  useEffect(() => {
    if (!transaction?.id) return;
    setNotes(transaction.notes);
    setBudgetMonth(transaction.budgetMonth || activeMonth);

    // Auto-enter split mode if opening a split group
    if (splitSiblings.length > 1) {
      setIsSplit(true);
      setSplitLines(splitSiblings.map(s => ({ categoryId: s.categoryId, amount: s.amount.toString(), notes: s.notes || '' })));
    } else {
      setIsSplit(false);
      setSplitLines([]);
    }

    const m = deriveMode(transaction.categoryId, transaction.transactionType, transaction.description, fixedExpenses);
    setMode(m);

    if (m === 'variable') {
      setVariableCategoryId(transaction.categoryId || 'unassigned');
    } else if (m === 'fixed') {
      setFixedCategoryId(transaction.categoryId);
    } else if (m === 'deposit') {
      setDepositCategoryId(transaction.categoryId !== DEPOSIT_CATEGORY ? transaction.categoryId : '');
    } else if (m === 'cc-payment') {
      const catId = transaction.categoryId;
      if (catId && catId !== CC_PAYMENT_CATEGORY && catId !== INCOME_CATEGORY) {
        if (fixedExpenses.some(e => e.id === catId)) {
          setCcPaymentCategoryType('fixed');
          setCcPaymentCategoryId(catId);
        } else {
          setCcPaymentCategoryType('variable');
          setCcPaymentCategoryId(catId);
        }
      } else {
        setCcPaymentCategoryType('none');
        setCcPaymentCategoryId('');
      }
    } else if (m === 'ignore') {
      setIgnoreType(deriveIgnoreType(transaction.categoryId));
    }
  }, [transaction?.id]);

  if (!transaction) return null;

  const effectiveCategoryId = mode === 'variable' ? variableCategoryId : mode === 'fixed' ? fixedCategoryId : '';
  const notesRequired = !isSplit && categoryRequiresNotes(effectiveCategoryId, categories, fixedExpenses);

  const handleModeChange = (newMode: TxMode) => {
    setMode(newMode);
    setIsSplit(false);
    setSplitLines([]);
    if (newMode === 'fixed' && !fixedCategoryId) {
      const first = fixedExpenses[0];
      if (first) setFixedCategoryId(first.id);
    }
  };

  const handleStartSplit = () => {
    const txAmount = Math.abs(transaction.amount);
    const defaultCat = mode === 'variable' ? (variableCategoryId || 'unassigned') : (fixedCategoryId || fixedExpenses[0]?.id || '');
    const secondCat = mode === 'variable' ? 'unassigned' : (fixedExpenses[0]?.id || '');
    setSplitLines([
      { categoryId: defaultCat, amount: '' },
      { categoryId: secondCat, amount: txAmount > 0 ? txAmount.toFixed(2) : '' },
    ]);
    setIsSplit(true);
  };

  const handleSave = async () => {
    if (notesRequired && !notes.trim()) return;

    if (isSplit && (mode === 'variable' || mode === 'fixed')) {
      // Use total of all siblings if editing an existing split, otherwise use single tx amount
      const totalAmount = splitSiblings.length > 1
        ? splitSiblings.reduce((s, t) => s + t.amount, 0)
        : Math.abs(transaction.amount);
      const allocated = splitLines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
      if (Math.abs(totalAmount - allocated) >= 0.01) return;

      // Check per-line notes requirements
      const missingNotes = splitLines.some(l => parseFloat(l.amount) > 0 && categoryRequiresNotes(l.categoryId, categories, fixedExpenses) && !l.notes?.trim());
      if (missingNotes) return;

      setSaving(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setSaving(false); return; }
      const { data: profile } = await supabase.from('profiles').select('household_id').eq('user_id', user.id).single();
      if (!profile) { setSaving(false); return; }

      const splitRows = splitLines
        .filter(l => parseFloat(l.amount) > 0)
        .map(l => ({
          household_id: profile.household_id,
          date: transaction.date,
          description: transaction.description,
          notes: l.notes?.trim() || notes || '',
          amount: parseFloat(l.amount),
          category_slug: l.categoryId,
          account: transaction.account,
          is_transfer_to_savings: false,
          transaction_type: 'expense',
          entered_by: user.id,
          budget_month: budgetMonth,
        }));

      const { error: insertError } = await supabase.from('transactions').insert(splitRows as any);
      if (insertError) {
        toast.error('Failed to create split transactions');
        setSaving(false);
        return;
      }

      // Delete all sibling transactions (or just the one if not from a split group)
      const idsToDelete = splitSiblings.length > 1
        ? splitSiblings.map(s => s.id)
        : [transaction.id];
      const { error: deleteError } = await supabase.from('transactions').delete().in('id', idsToDelete);
      setSaving(false);
      if (deleteError) {
        toast.error('Split created but failed to remove originals');
      } else {
        toast.success(`Split into ${splitRows.length} transactions`);
        onOpenChange(false);
      }
      return;
    }

    setSaving(true);

    let slugToSave: string;
    let txType: string;

    switch (mode) {
      case 'variable':
        slugToSave = variableCategoryId;
        txType = 'expense';
        break;
      case 'fixed':
        slugToSave = fixedCategoryId;
        txType = 'expense';
        break;
      case 'deposit':
        slugToSave = depositCategoryId || DEPOSIT_CATEGORY;
        txType = 'deposit';
        break;
      case 'cc-payment':
        slugToSave = ccPaymentCategoryType !== 'none' && ccPaymentCategoryId ? ccPaymentCategoryId : CC_PAYMENT_CATEGORY;
        txType = 'cc-payment';
        break;
      case 'ignore':
        slugToSave = ignoreType === 'transfer' ? TRANSFER_CATEGORY : ignoreType === 'prior-month' ? PRIOR_MONTH_CATEGORY : INCOME_CATEGORY;
        txType = ignoreType === 'transfer' ? 'transfer' : ignoreType === 'prior-month' ? 'prior-month' : 'income';
        break;
    }

    const updateData: Record<string, unknown> = {
      category_slug: slugToSave,
      notes,
      transaction_type: txType,
    };
    if (budgetMonth && budgetMonth !== transaction.budgetMonth) {
      updateData.budget_month = budgetMonth;
    }

    const { error } = await supabase
      .from('transactions')
      .update(updateData as any)
      .eq('id', transaction.id);
    setSaving(false);
    if (error) {
      toast.error('Failed to update transaction');
    } else {
      toast.success('Transaction updated');
      onOpenChange(false);
    }
  };

  const MODE_BUTTONS: { id: TxMode; label: string }[] = [
    { id: 'variable', label: 'Variable' },
    { id: 'fixed', label: 'Fixed' },
    { id: 'deposit', label: 'Deposit' },
    { id: 'cc-payment', label: 'CC Pmt' },
    { id: 'ignore', label: 'Ignore' },
  ];

  const txAmount = splitSiblings.length > 1
    ? splitSiblings.reduce((s, t) => s + t.amount, 0)
    : Math.abs(transaction.amount);
  const splitMissingNotes = isSplit && splitLines.some(l => parseFloat(l.amount) > 0 && categoryRequiresNotes(l.categoryId, categories, fixedExpenses) && !l.notes?.trim());
  const splitBalanced = isSplit && Math.abs(txAmount - splitLines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)) < 0.01;
  const canSave = (!notesRequired || !!notes.trim()) && (!isSplit || (splitBalanced && !splitMissingNotes)) && !saving;

  const monthOptions = generateMonthOptions(activeMonth);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-w-lg mx-auto bg-background max-h-[90vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-display text-lg">Edit Transaction</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 mt-4 pb-8">
          {/* Read-only details */}
          <div className="bg-card rounded-lg p-4 space-y-2">
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground uppercase">Merchant</span>
              <span className="text-sm font-medium text-foreground">{transaction.description || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground uppercase">Amount</span>
              <span className="text-sm font-medium tabular-nums text-foreground">
                {transaction.amount < 0 ? '-' : ''}${Math.abs(transaction.amount).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground uppercase">Date</span>
              <span className="text-sm text-foreground">{format(new Date(transaction.date), 'MMM d, yyyy')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground uppercase">Account</span>
              <span className="text-sm text-foreground">
                {accounts.find(a => a.id === transaction.account)?.label || transaction.account}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground uppercase">Budget Month</span>
              <select
                value={budgetMonth}
                onChange={e => setBudgetMonth(e.target.value)}
                className="text-sm text-foreground bg-transparent text-right border-none focus:outline-none focus:ring-0 cursor-pointer"
              >
                {monthOptions.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Mode toggle pills */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Type</label>
            <div className="flex gap-1.5 mt-1.5">
              {MODE_BUTTONS.map(b => (
                <button
                  key={b.id}
                  onClick={() => handleModeChange(b.id)}
                  className={`flex-1 px-2 py-2 rounded-full text-[11px] font-semibold transition-all active:scale-95 ${
                    mode === b.id
                      ? 'bg-accent text-accent-foreground shadow-sm'
                      : 'bg-card text-muted-foreground border border-border'
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          {/* Category selection or Split editor */}
          {mode === 'variable' && !isSplit && (
            <div className="animate-fade-up">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Category</label>
                <button
                  type="button"
                  onClick={handleStartSplit}
                  className="text-[11px] font-medium text-accent active:scale-95 transition-transform"
                >
                  Split →
                </button>
              </div>
              <select
                value={variableCategoryId}
                onChange={e => setVariableCategoryId(e.target.value)}
                className="w-full mt-1 px-3 py-2.5 rounded-lg bg-card border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
              >
                <option value="unassigned">Unassigned</option>
                {[...categories].sort((a, b) => a.name.localeCompare(b.name)).map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <CategoryBudgetMini categoryId={variableCategoryId} categories={categories} fixedExpenses={fixedExpenses} transactions={monthTransactions} pendingAmount={Math.abs(transaction.amount)} excludeTransactionIds={splitSiblings.length > 1 ? splitSiblings.map(s => s.id) : [transaction.id]} />
            </div>
          )}

          {mode === 'fixed' && !isSplit && (
            <div className="animate-fade-up">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Fixed Category</label>
                <button
                  type="button"
                  onClick={handleStartSplit}
                  className="text-[11px] font-medium text-accent active:scale-95 transition-transform"
                >
                  Split →
                </button>
              </div>
              <select
                value={fixedCategoryId}
                onChange={e => setFixedCategoryId(e.target.value)}
                className="w-full mt-1 px-3 py-2.5 rounded-lg bg-card border border-accent/40 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
              >
                {fixedExpenses.filter(e => e.group === 'bills').length > 0 && (
                  <optgroup label="Bills">
                    {fixedExpenses.filter(e => e.group === 'bills').sort((a, b) => a.name.localeCompare(b.name)).map(e => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </optgroup>
                )}
                {fixedExpenses.filter(e => e.group === 'savings').length > 0 && (
                  <optgroup label="Savings">
                    {fixedExpenses.filter(e => e.group === 'savings').sort((a, b) => a.name.localeCompare(b.name)).map(e => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </optgroup>
                )}
                {fixedExpenses.filter(e => e.group === 'tithe').length > 0 && (
                  <optgroup label="Tithe / Giving">
                    {fixedExpenses.filter(e => e.group === 'tithe').sort((a, b) => a.name.localeCompare(b.name)).map(e => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              <CategoryBudgetMini categoryId={fixedCategoryId} categories={categories} fixedExpenses={fixedExpenses} transactions={monthTransactions} pendingAmount={Math.abs(transaction.amount)} excludeTransactionIds={splitSiblings.length > 1 ? splitSiblings.map(s => s.id) : [transaction.id]} />
            </div>
          )}

          {isSplit && (mode === 'variable' || mode === 'fixed') && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Split Mode</span>
                <button
                  type="button"
                  onClick={() => { setIsSplit(false); setSplitLines([]); }}
                  className="text-[11px] font-medium text-destructive active:scale-95 transition-transform"
                >
                  Cancel Split
                </button>
              </div>
              <SplitEditor
                totalAmount={txAmount}
                mode={mode}
                categories={categories}
                fixedExpenses={fixedExpenses}
                lines={splitLines}
                onChange={setSplitLines}
                transactions={monthTransactions}
                excludeTransactionIds={splitSiblings.length > 1 ? splitSiblings.map(s => s.id) : [transaction.id]}
              />
            </div>
          )}

          {mode === 'deposit' && (
            <div className="animate-fade-up">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Apply to Category <span className="text-muted-foreground/60 normal-case">(optional)</span>
              </label>
              <p className="text-[11px] text-muted-foreground/70 mt-0.5 mb-1.5">
                Offsets spending in the selected category as a reimbursement
              </p>
              <select
                value={depositCategoryId}
                onChange={e => setDepositCategoryId(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg bg-card border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
              >
                <option value="">None — general deposit</option>
                <optgroup label="Variable">
                  {[...categories].sort((a, b) => a.name.localeCompare(b.name)).map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </optgroup>
                <optgroup label="Fixed">
                  {[...fixedExpenses].sort((a, b) => a.name.localeCompare(b.name)).map(e => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </optgroup>
              </select>
            </div>
          )}

          {mode === 'cc-payment' && (
            <div className="animate-fade-up space-y-3">
              <p className="text-[11px] text-muted-foreground/70">
                Reduces credit card balance. Optionally assign to a category to offset that budget.
              </p>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Apply to Budget <span className="text-muted-foreground/60 normal-case">(optional)</span>
                </label>
                <div className="flex gap-1.5 mt-1.5 mb-2">
                  {([
                    { id: 'none' as const, label: 'None' },
                    { id: 'variable' as const, label: 'Variable' },
                    { id: 'fixed' as const, label: 'Fixed' },
                  ]).map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => {
                        setCcPaymentCategoryType(opt.id);
                        if (opt.id === 'none') setCcPaymentCategoryId('');
                        if (opt.id === 'fixed' && !ccPaymentCategoryId) {
                          const first = fixedExpenses[0];
                          if (first) setCcPaymentCategoryId(first.id);
                        }
                      }}
                      className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all active:scale-95 ${
                        ccPaymentCategoryType === opt.id
                          ? 'bg-muted text-foreground border border-accent/50'
                          : 'bg-card text-muted-foreground border border-border'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {ccPaymentCategoryType === 'variable' && (
                  <select
                    value={ccPaymentCategoryId}
                    onChange={e => setCcPaymentCategoryId(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg bg-card border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
                  >
                    <option value="">Select category…</option>
                    {[...categories].sort((a, b) => a.name.localeCompare(b.name)).map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                )}
                {ccPaymentCategoryType === 'fixed' && (
                  <select
                    value={ccPaymentCategoryId}
                    onChange={e => setCcPaymentCategoryId(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg bg-card border border-accent/40 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
                  >
                    {fixedExpenses.filter(e => e.group === 'bills').length > 0 && (
                      <optgroup label="Bills">
                        {fixedExpenses.filter(e => e.group === 'bills').sort((a, b) => a.name.localeCompare(b.name)).map(e => (
                          <option key={e.id} value={e.id}>{e.name}</option>
                        ))}
                      </optgroup>
                    )}
                    {fixedExpenses.filter(e => e.group === 'savings').length > 0 && (
                      <optgroup label="Savings">
                        {fixedExpenses.filter(e => e.group === 'savings').sort((a, b) => a.name.localeCompare(b.name)).map(e => (
                          <option key={e.id} value={e.id}>{e.name}</option>
                        ))}
                      </optgroup>
                    )}
                    {fixedExpenses.filter(e => e.group === 'tithe').length > 0 && (
                      <optgroup label="Tithe / Giving">
                        {fixedExpenses.filter(e => e.group === 'tithe').sort((a, b) => a.name.localeCompare(b.name)).map(e => (
                          <option key={e.id} value={e.id}>{e.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                )}
              </div>
            </div>
          )}

          {mode === 'ignore' && (
            <div className="animate-fade-up">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Reason</label>
              <div className="flex gap-2 mt-1.5">
                {([
                  { id: 'income' as const, label: 'Income' },
                  { id: 'transfer' as const, label: 'Transfer' },
                  { id: 'prior-month' as const, label: 'Prior Month' },
                ] as const).map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => setIgnoreType(opt.id)}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all active:scale-95 ${
                      ignoreType === opt.id
                        ? 'bg-muted text-foreground border border-accent/50'
                        : 'bg-card text-muted-foreground border border-border'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground/70 mt-1.5">
                {ignoreType === 'income' ? 'Paycheck, interest, or other income' : ignoreType === 'transfer' ? 'Inter-account transfer or credit card payment' : 'Transaction from a previous budget month'}
              </p>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Notes {notesRequired && <span className="text-destructive">*</span>}
            </label>
            <input
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Add a note…"
              className={`w-full mt-1 px-3 py-2.5 rounded-lg bg-card border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent/30 ${
                notesRequired && !notes.trim() ? 'border-accent/60' : 'border-border'
              }`}
            />
          </div>

          <button
            onClick={handleSave}
            disabled={!canSave}
            className="w-full py-3 rounded-xl bg-accent text-accent-foreground font-semibold text-sm active:scale-[0.98] transition-transform shadow-sm disabled:opacity-50"
          >
            {saving ? 'Saving…' : isSplit ? `Split into ${splitLines.filter(l => parseFloat(l.amount) > 0).length} Transactions` : 'Save Changes'}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
