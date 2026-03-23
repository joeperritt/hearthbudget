import { useState, useEffect, useRef, useMemo } from 'react';
import { BudgetCategory, Transaction, AccountSource, TransactionType, DESCRIPTION_REQUIRED_CATEGORIES } from '@/types/budget';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { format } from 'date-fns';
import { Plus, Minus } from 'lucide-react';

interface AddTransactionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: BudgetCategory[];
  onAdd: (transactions: Omit<Transaction, 'id'>[]) => void;
}

const ACCOUNTS: { id: AccountSource; label: string }[] = [
  { id: 'joe-amex', label: "Joe's Amex" },
  { id: 'katie-amex', label: "Katie's Amex" },
  { id: 'checking', label: 'Checking' },
];

const TRANSACTION_TYPES: { id: TransactionType; label: string; helper: string }[] = [
  { id: 'expense', label: 'Expense', helper: 'Normal spending transaction' },
  { id: 'savings-paydown', label: 'Savings Paydown', helper: 'Paying down a credit card from savings. Adds funds back to category without affecting checking.' },
  { id: 'funds-transfer-in', label: 'Funds Transfer In', helper: 'Moving money from savings into checking. Increases checking balance and category budget.' },
];

interface SplitLine {
  categoryId: string;
  amount: string;
}

export function AddTransactionSheet({ open, onOpenChange, categories, onAdd }: AddTransactionSheetProps) {
  const [description, setDescription] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [account, setAccount] = useState<AccountSource>('joe-amex');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [isTransfer, setIsTransfer] = useState(false);
  const [transactionType, setTransactionType] = useState<TransactionType>('expense');
  const [isSplit, setIsSplit] = useState(false);
  const [splits, setSplits] = useState<SplitLine[]>([
    { categoryId: categories[0]?.id || '', amount: '' },
  ]);
  const descRef = useRef<HTMLInputElement>(null);
  const [singleCategoryId, setSingleCategoryId] = useState(categories[0]?.id || '');

  const total = parseFloat(totalAmount) || 0;
  const allocatedAmount = splits.reduce((s, sp) => s + (parseFloat(sp.amount) || 0), 0);
  const remainder = total - allocatedAmount;

  // Check if description is needed (only for Random, Gifts, Hosting/Gifts/Random)
  const needsDescription = useMemo(() => {
    if (isSplit) {
      return splits.some(sp => DESCRIPTION_REQUIRED_CATEGORIES.includes(sp.categoryId));
    }
    return DESCRIPTION_REQUIRED_CATEGORIES.includes(singleCategoryId);
  }, [isSplit, splits, singleCategoryId]);

  // Show description field only when needed
  const showDescription = needsDescription;

  const updateSplit = (idx: number, field: keyof SplitLine, value: string) => {
    setSplits(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };

  const addSplit = () => {
    if (splits.length < 3) {
      setSplits(prev => [...prev, { categoryId: categories[0]?.id || '', amount: '' }]);
    }
  };

  const removeSplit = (idx: number) => {
    if (splits.length > 1) {
      setSplits(prev => prev.filter((_, i) => i !== idx));
    }
  };

  // Auto-focus description when it becomes required
  useEffect(() => {
    if (needsDescription && descRef.current) {
      descRef.current.focus();
    }
  }, [needsDescription]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!totalAmount) return;
    if (needsDescription && !description.trim()) {
      descRef.current?.focus();
      return;
    }

    if (isSplit) {
      if (Math.abs(remainder) > 0.01) return;
      const txns = splits.map(sp => ({
        description: description || '',
        amount: parseFloat(sp.amount) || 0,
        categoryId: sp.categoryId,
        account,
        date,
        isTransferToSavings: isTransfer,
        transactionType,
      }));
      onAdd(txns);
    } else {
      if (!singleCategoryId) return;
      onAdd([{
        description: description || '',
        amount: total,
        categoryId: singleCategoryId,
        account,
        date,
        isTransferToSavings: isTransfer,
        transactionType,
      }]);
    }

    // Reset
    setDescription('');
    setTotalAmount('');
    setSingleCategoryId(categories[0]?.id || '');
    setAccount('joe-amex');
    setDate(format(new Date(), 'yyyy-MM-dd'));
    setIsTransfer(false);
    setTransactionType('expense');
    setIsSplit(false);
    setSplits([{ categoryId: categories[0]?.id || '', amount: '' }]);
  };

  const selectedType = TRANSACTION_TYPES.find(t => t.id === transactionType)!;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-w-lg mx-auto bg-background max-h-[90vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-display text-lg">Add Transaction</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4 pb-8">
          {/* Transaction Type */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Transaction Type</label>
            <div className="flex gap-2 mt-1">
              {TRANSACTION_TYPES.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTransactionType(t.id)}
                  className={`flex-1 py-2 rounded-lg text-[11px] font-medium transition-colors active:scale-95 ${
                    transactionType === t.id
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card text-muted-foreground border border-border'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground/70 mt-1">{selectedType.helper}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Amount</label>
              <input
                type="number"
                step="0.01"
                value={totalAmount}
                onChange={e => setTotalAmount(e.target.value)}
                placeholder="$0.00"
                className="w-full mt-1 px-3 py-2.5 rounded-lg bg-card border border-border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent/30 tabular-nums"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Date</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full mt-1 px-3 py-2.5 rounded-lg bg-card border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
            </div>
          </div>

          {/* Category or Splits */}
          {!isSplit ? (
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Category</label>
                <button type="button" onClick={() => { setIsSplit(true); setSplits([{ categoryId: singleCategoryId, amount: '' }]); }}
                  className="text-[11px] text-accent font-medium active:scale-95 transition-transform">
                  Split →
                </button>
              </div>
              <select
                value={singleCategoryId}
                onChange={e => setSingleCategoryId(e.target.value)}
                className="w-full mt-1 px-3 py-2.5 rounded-lg bg-card border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
              >
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Split Categories</label>
                <button type="button" onClick={() => setIsSplit(false)}
                  className="text-[11px] text-accent font-medium active:scale-95 transition-transform">
                  ← Single
                </button>
              </div>
              {splits.map((sp, idx) => (
                <div key={idx} className="flex gap-2 mb-2 items-center">
                  <select
                    value={sp.categoryId}
                    onChange={e => updateSplit(idx, 'categoryId', e.target.value)}
                    className="flex-1 px-2 py-2 rounded-lg bg-card border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent/30"
                  >
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    step="0.01"
                    value={sp.amount}
                    onChange={e => updateSplit(idx, 'amount', e.target.value)}
                    placeholder="$0"
                    className="w-20 px-2 py-2 rounded-lg bg-card border border-border text-sm tabular-nums text-foreground text-right focus:outline-none focus:ring-1 focus:ring-accent/30"
                  />
                  {splits.length > 1 && (
                    <button type="button" onClick={() => removeSplit(idx)}
                      className="p-1 text-muted-foreground hover:text-destructive active:scale-95 transition-all">
                      <Minus size={14} />
                    </button>
                  )}
                </div>
              ))}
              {splits.length < 3 && (
                <button type="button" onClick={addSplit}
                  className="flex items-center gap-1 text-xs text-accent font-medium mt-1 active:scale-95 transition-transform">
                  <Plus size={12} /> Add split
                </button>
              )}
              {total > 0 && (
                <p className={`text-xs tabular-nums mt-2 ${Math.abs(remainder) < 0.01 ? 'text-muted-foreground' : 'text-destructive'}`}>
                  {Math.abs(remainder) < 0.01 ? '✓ Fully allocated' : `${remainder > 0 ? '$' + remainder.toFixed(2) + ' remaining' : '-$' + Math.abs(remainder).toFixed(2) + ' over'}`}
                </p>
              )}
            </div>
          )}

          {/* Description — only for specific categories */}
          {showDescription && (
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Description <span className="text-destructive">*</span>
              </label>
              <input
                ref={descRef}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="What was this for?"
                className={`w-full mt-1 px-3 py-2.5 rounded-lg bg-card border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent/30 ${
                  !description.trim() ? 'border-accent/60' : 'border-border'
                }`}
              />
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Account</label>
            <div className="flex gap-2 mt-1">
              {ACCOUNTS.map(a => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAccount(a.id)}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors active:scale-95 ${
                    account === a.id
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card text-muted-foreground border border-border'
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          {transactionType === 'expense' && (
            <div className="flex items-center justify-between bg-card rounded-lg px-4 py-3 border border-border">
              <div>
                <p className="text-sm font-medium text-foreground">Transfer to Savings</p>
                <p className="text-[11px] text-muted-foreground">Exclude from budget tracking</p>
              </div>
              <button
                type="button"
                onClick={() => setIsTransfer(!isTransfer)}
                className={`relative w-11 h-6 rounded-full transition-colors ${isTransfer ? 'bg-accent' : 'bg-border'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-background shadow transition-transform ${isTransfer ? 'translate-x-5' : ''}`} />
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={isSplit && Math.abs(remainder) > 0.01}
            className="w-full py-3 rounded-xl bg-accent text-accent-foreground font-semibold text-sm active:scale-[0.98] transition-transform shadow-sm disabled:opacity-50"
          >
            Add Transaction
          </button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
