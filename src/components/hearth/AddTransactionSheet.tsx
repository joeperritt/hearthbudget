import { useState } from 'react';
import { BudgetCategory, Transaction, AccountSource } from '@/types/budget';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { format } from 'date-fns';

interface AddTransactionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: BudgetCategory[];
  onAdd: (t: Omit<Transaction, 'id'>) => void;
}

const ACCOUNTS: { id: AccountSource; label: string }[] = [
  { id: 'joe-amex', label: "Joe's Amex" },
  { id: 'katie-amex', label: "Katie's Amex" },
  { id: 'checking', label: 'Checking' },
];

export function AddTransactionSheet({ open, onOpenChange, categories, onAdd }: AddTransactionSheetProps) {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState(categories[0]?.id || '');
  const [account, setAccount] = useState<AccountSource>('joe-amex');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [isTransfer, setIsTransfer] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!description || !amount || !categoryId) return;
    onAdd({
      description,
      amount: parseFloat(amount),
      categoryId,
      account,
      date,
      isTransferToSavings: isTransfer,
    });
    setDescription('');
    setAmount('');
    setCategoryId(categories[0]?.id || '');
    setAccount('joe-amex');
    setDate(format(new Date(), 'yyyy-MM-dd'));
    setIsTransfer(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-w-lg mx-auto bg-background">
        <SheetHeader>
          <SheetTitle className="font-display text-lg">Add Transaction</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4 pb-8">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Description</label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What was it for?"
              className="w-full mt-1 px-3 py-2.5 rounded-lg bg-card border border-border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Amount</label>
              <input
                type="number"
                step="0.01"
                value={amount}
                onChange={e => setAmount(e.target.value)}
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
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Category</label>
            <select
              value={categoryId}
              onChange={e => setCategoryId(e.target.value)}
              className="w-full mt-1 px-3 py-2.5 rounded-lg bg-card border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
            >
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
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
          <button
            type="submit"
            className="w-full py-3 rounded-xl bg-accent text-accent-foreground font-semibold text-sm active:scale-[0.98] transition-transform shadow-sm"
          >
            Add Transaction
          </button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
