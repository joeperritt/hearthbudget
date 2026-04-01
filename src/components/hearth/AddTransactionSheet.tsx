import { useState, useEffect, useRef } from 'react';
import { BudgetCategory, FixedExpense, Transaction, AccountSource, categoryRequiresNotes, INCOME_CATEGORY, DEPOSIT_CATEGORY, TRANSFER_CATEGORY, CC_PAYMENT_CATEGORY, PRIOR_MONTH_CATEGORY } from '@/types/budget';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { format } from 'date-fns';
import { SplitEditor, SplitLine } from './SplitEditor';
import { CategoryBudgetMini } from './CategoryBudgetMini';

const ACCOUNTS: { id: AccountSource; label: string }[] = [
  { id: 'joe-amex', label: "Joe's Amex" },
  { id: 'katie-amex', label: "Katie's Amex" },
  { id: 'checking', label: 'Checking' },
];

type TxMode = 'variable' | 'fixed' | 'deposit' | 'ignore' | 'cc-payment';

const MODE_BUTTONS: { id: TxMode; label: string }[] = [
  { id: 'variable', label: 'Variable' },
  { id: 'fixed', label: 'Fixed' },
  { id: 'deposit', label: 'Deposit' },
  { id: 'cc-payment', label: 'CC Pmt' },
  { id: 'ignore', label: 'Ignore' },
];

interface AddTransactionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: BudgetCategory[];
  fixedExpenses: FixedExpense[];
  onAdd: (transactions: Omit<Transaction, 'id'>[]) => void;
  monthTransactions?: Transaction[];
}

export function AddTransactionSheet({ open, onOpenChange, categories, fixedExpenses, onAdd, monthTransactions = [] }: AddTransactionSheetProps) {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [account, setAccount] = useState<AccountSource | ''>('');
  const [mode, setMode] = useState<TxMode>('variable');
  const [variableCategoryId, setVariableCategoryId] = useState('unassigned');
  const [fixedCategoryId, setFixedCategoryId] = useState('');
  const [depositCategoryId, setDepositCategoryId] = useState('');
  const [ccPaymentCategoryId, setCcPaymentCategoryId] = useState('');
  const [ccPaymentCategoryType, setCcPaymentCategoryType] = useState<'none' | 'variable' | 'fixed'>('none');
  const [ignoreType, setIgnoreType] = useState<'income' | 'transfer' | 'prior-month'>('income');
  const [notes, setNotes] = useState('');
  const [isSplit, setIsSplit] = useState(false);
  const [splitLines, setSplitLines] = useState<SplitLine[]>([]);
  const notesRef = useRef<HTMLInputElement>(null);

  const effectiveCategoryId = mode === 'variable' ? variableCategoryId : mode === 'fixed' ? fixedCategoryId : '';
  const notesRequired = !isSplit && categoryRequiresNotes(effectiveCategoryId, categories);

  useEffect(() => {
    if (notesRequired && notesRef.current) {
      notesRef.current.focus();
    }
  }, [notesRequired]);

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
    const parsedAmount = parseFloat(amount) || 0;
    const defaultCat = mode === 'variable' ? (variableCategoryId || 'unassigned') : (fixedCategoryId || fixedExpenses[0]?.id || '');
    const secondCat = mode === 'variable' ? 'unassigned' : (fixedExpenses[0]?.id || '');
    setSplitLines([
      { categoryId: defaultCat, amount: '' },
      { categoryId: secondCat, amount: parsedAmount > 0 ? parsedAmount.toFixed(2) : '' },
    ]);
    setIsSplit(true);
  };

  const resetForm = () => {
    setDescription('');
    setAmount('');
    setDate(format(new Date(), 'yyyy-MM-dd'));
    setAccount('');
    setMode('variable');
    setVariableCategoryId('unassigned');
    setFixedCategoryId('');
    setDepositCategoryId('');
    setCcPaymentCategoryId('');
    setCcPaymentCategoryType('none');
    setIgnoreType('income');
    setNotes('');
    setIsSplit(false);
    setSplitLines([]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || !account) return;
    if (notesRequired && !notes.trim()) {
      notesRef.current?.focus();
      return;
    }

    if (isSplit && (mode === 'variable' || mode === 'fixed')) {
      const allocated = splitLines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
      const remaining = Math.round((parsedAmount - allocated) * 100) / 100;
      if (Math.abs(remaining) >= 0.01) return; // Not balanced

      // Check per-line notes requirements
      const missingNotes = splitLines.some(l => parseFloat(l.amount) > 0 && categoryRequiresNotes(l.categoryId, categories) && !l.notes?.trim());
      if (missingNotes) return;

      const txns: Omit<Transaction, 'id'>[] = splitLines
        .filter(l => parseFloat(l.amount) > 0)
        .map(l => ({
          description: description || '',
          notes: l.notes?.trim() || notes || '',
          amount: parseFloat(l.amount),
          categoryId: l.categoryId,
          account: account as AccountSource,
          date,
          isTransferToSavings: false,
          transactionType: 'expense' as Transaction['transactionType'],
          budgetMonth: '',
        }));
      onAdd(txns);
      resetForm();
      return;
    }

    let categorySlug: string;
    let txType: string;

    switch (mode) {
      case 'variable':
        categorySlug = variableCategoryId;
        txType = 'expense';
        break;
      case 'fixed':
        categorySlug = fixedCategoryId;
        txType = 'expense';
        break;
      case 'deposit':
        categorySlug = depositCategoryId || DEPOSIT_CATEGORY;
        txType = 'deposit';
        break;
      case 'cc-payment':
        categorySlug = ccPaymentCategoryType !== 'none' && ccPaymentCategoryId ? ccPaymentCategoryId : CC_PAYMENT_CATEGORY;
        txType = 'cc-payment';
        break;
      case 'ignore':
        categorySlug = ignoreType === 'transfer' ? TRANSFER_CATEGORY : ignoreType === 'prior-month' ? PRIOR_MONTH_CATEGORY : INCOME_CATEGORY;
        txType = 'income';
        break;
    }

    onAdd([{
      description: description || '',
      notes: notes || '',
      amount: parsedAmount,
      categoryId: categorySlug,
      account: account as AccountSource,
      date,
      isTransferToSavings: false,
      transactionType: txType as Transaction['transactionType'],
      budgetMonth: '',
    }]);

    resetForm();
  };

  const parsedAmount = parseFloat(amount) || 0;
  const splitMissingNotes = isSplit && splitLines.some(l => parseFloat(l.amount) > 0 && NOTES_REQUIRED_CATEGORIES.includes(l.categoryId) && !l.notes?.trim());
  const splitBalanced = isSplit && Math.abs(parsedAmount - splitLines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)) < 0.01;
  const canSubmit = !!amount && !!account && (!notesRequired || !!notes.trim()) && (!isSplit || (splitBalanced && !splitMissingNotes));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-w-lg mx-auto bg-background max-h-[90vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-display text-lg">Add Transaction</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4 pb-8">
          {/* Merchant / Description */}
          <div className="bg-card rounded-lg p-4 space-y-3">
            <div>
              <label className="text-xs text-muted-foreground uppercase">Merchant</label>
              <input
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="e.g. Whole Foods, Shell Gas Station"
                className="w-full mt-1 px-3 py-2.5 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground uppercase">Amount</label>
                <input
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="$0.00"
                  className="w-full mt-1 px-3 py-2.5 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent/30 tabular-nums"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground uppercase">Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="w-full mt-1 px-3 py-2.5 rounded-lg bg-background border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground uppercase">Account</label>
              <div className="flex gap-2 mt-1">
                {ACCOUNTS.map(a => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setAccount(a.id)}
                    className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors active:scale-95 ${
                      account === a.id
                        ? 'bg-accent text-accent-foreground shadow-sm'
                        : 'bg-background text-muted-foreground border border-border'
                    }`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Mode toggle pills */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Type</label>
            <div className="flex gap-1.5 mt-1.5">
              {MODE_BUTTONS.map(b => (
                <button
                  key={b.id}
                  type="button"
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
              <CategoryBudgetMini categoryId={variableCategoryId} categories={categories} fixedExpenses={fixedExpenses} transactions={monthTransactions} />
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
              <CategoryBudgetMini categoryId={fixedCategoryId} categories={categories} fixedExpenses={fixedExpenses} transactions={monthTransactions} />
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
                totalAmount={parsedAmount}
                mode={mode}
                categories={categories}
                fixedExpenses={fixedExpenses}
                lines={splitLines}
                onChange={setSplitLines}
                transactions={monthTransactions}
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
                {[...categories].sort((a, b) => a.name.localeCompare(b.name)).map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
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
                      type="button"
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
                    type="button"
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

          {/* Notes */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Notes {notesRequired && <span className="text-destructive">*</span>}
            </label>
            <input
              ref={notesRef}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Add a note…"
              className={`w-full mt-1 px-3 py-2.5 rounded-lg bg-card border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent/30 ${
                notesRequired && !notes.trim() ? 'border-accent/60' : 'border-border'
              }`}
            />
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full py-3 rounded-xl bg-accent text-accent-foreground font-semibold text-sm active:scale-[0.98] transition-transform shadow-sm disabled:opacity-50"
          >
            Add Transaction
          </button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
