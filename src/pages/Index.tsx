import { useState, useMemo, useCallback } from 'react';
import { format, addMonths, subMonths } from 'date-fns';
import { Transaction, BudgetCategory, FixedExpense, BudgetTransfer, TabId, GIVING_VARIABLE_CATEGORY } from '@/types/budget';
import { DEFAULT_CATEGORIES, DEFAULT_FIXED_EXPENSES } from '@/data/defaults';
import { BottomNav } from '@/components/hearth/BottomNav';
import { Dashboard } from '@/components/hearth/Dashboard';
import { SpendingView } from '@/components/hearth/SpendingView';
import { TransactionsView } from '@/components/hearth/TransactionsView';
import { AddTransactionSheet } from '@/components/hearth/AddTransactionSheet';
import { CategoryDetail } from '@/components/hearth/CategoryDetail';
import { PlanningView } from '@/components/hearth/PlanningView';
import { MoveFundsSheet } from '@/components/hearth/MoveFundsSheet';
import { MoreView } from '@/components/hearth/MoreView';
import { SettingsView } from '@/components/hearth/SettingsView';

const Index = () => {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [categories, setCategories] = useState<BudgetCategory[]>(DEFAULT_CATEGORIES);
  const [fixedExpenses, setFixedExpenses] = useState<FixedExpense[]>(DEFAULT_FIXED_EXPENSES);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transfers, setTransfers] = useState<BudgetTransfer[]>([]);
  const [showAddTransaction, setShowAddTransaction] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedFixedExpenseId, setSelectedFixedExpenseId] = useState<string | null>(null);
  const [moveFundsCategoryId, setMoveFundsCategoryId] = useState<string | null>(null);
  const [moveFundsFixedId, setMoveFundsFixedId] = useState<string | null>(null);
  const [moreSubView, setMoreSubView] = useState<'menu' | 'planning' | 'settings' | 'past-months'>('menu');

  const monthKey = format(currentMonth, 'yyyy-MM');
  const monthLabel = format(currentMonth, 'MMMM yyyy');

  const prevMonth = useCallback(() => setCurrentMonth(d => subMonths(d, 1)), []);
  const nextMonth = useCallback(() => setCurrentMonth(d => addMonths(d, 1)), []);

  const monthTransactions = useMemo(
    () => transactions.filter(t => t.date.startsWith(monthKey)),
    [transactions, monthKey]
  );

  const monthTransfers = useMemo(
    () => transfers.filter(t => t.date.startsWith(monthKey)),
    [transfers, monthKey]
  );

  const budgetTransactions = useMemo(
    () => monthTransactions.filter(t => !t.isTransferToSavings && t.transactionType === 'expense'),
    [monthTransactions]
  );

  const spentByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    budgetTransactions.forEach(t => {
      map[t.categoryId] = (map[t.categoryId] || 0) + t.amount;
    });
    // Subtract savings-paydown and funds-transfer-in amounts (they add funds back)
    monthTransactions.filter(t => t.transactionType === 'savings-paydown' || t.transactionType === 'funds-transfer-in').forEach(t => {
      map[t.categoryId] = (map[t.categoryId] || 0) - t.amount;
    });
    return map;
  }, [budgetTransactions, monthTransactions]);

  const transferAdjustments = useMemo(() => {
    const map: Record<string, number> = {};
    monthTransfers.forEach(t => {
      map[t.fromCategoryId] = (map[t.fromCategoryId] || 0) - t.amount;
      map[t.toCategoryId] = (map[t.toCategoryId] || 0) + t.amount;
    });
    return map;
  }, [monthTransfers]);

  const hostingGiftsBudget = categories.find(c => c.id === GIVING_VARIABLE_CATEGORY)?.budgeted || 0;
  const totalVariableBudget = categories.reduce((s, c) => s + c.budgeted, 0);
  const totalVariableSpent = Object.values(spentByCategory).reduce((s, v) => s + v, 0);
  const totalFixed = fixedExpenses.filter(e => e.group === 'bills').reduce((s, e) => s + e.amount, 0);
  const totalSavings = fixedExpenses.filter(e => e.group === 'savings').reduce((s, e) => s + e.amount, 0);
  const rawTithe = fixedExpenses.filter(e => e.group === 'tithe').reduce((s, e) => s + e.amount, 0);

  const fixedSpent = useMemo(() => {
    const ids = new Set(fixedExpenses.filter(e => e.group === 'bills').map(e => e.id));
    return monthTransactions.filter(t => ids.has(t.categoryId) && t.transactionType === 'expense').reduce((s, t) => s + t.amount, 0);
  }, [monthTransactions, fixedExpenses]);
  const savingsSpent = useMemo(() => {
    const ids = new Set(fixedExpenses.filter(e => e.group === 'savings').map(e => e.id));
    return monthTransactions.filter(t => ids.has(t.categoryId) && t.transactionType === 'expense').reduce((s, t) => s + t.amount, 0);
  }, [monthTransactions, fixedExpenses]);
  const titheSpent = useMemo(() => {
    const ids = new Set(fixedExpenses.filter(e => e.group === 'tithe').map(e => e.id));
    const fixedTitheSpent = monthTransactions.filter(t => ids.has(t.categoryId) && t.transactionType === 'expense').reduce((s, t) => s + t.amount, 0);
    const givingCatSpent = spentByCategory[GIVING_VARIABLE_CATEGORY] || 0;
    return fixedTitheSpent + givingCatSpent;
  }, [monthTransactions, fixedExpenses, spentByCategory]);
  const totalTithe = rawTithe + hostingGiftsBudget;
  const totalBudget = totalVariableBudget + totalFixed + totalSavings + rawTithe;

  // Account totals
  const joeAmexTotal = useMemo(
    () => monthTransactions.filter(t => t.account === 'joe-amex' && t.transactionType === 'expense').reduce((s, t) => s + t.amount, 0),
    [monthTransactions]
  );
  const katieAmexTotal = useMemo(
    () => monthTransactions.filter(t => t.account === 'katie-amex' && t.transactionType === 'expense').reduce((s, t) => s + t.amount, 0),
    [monthTransactions]
  );

  // Checking balance: totalBudget - checking account expenses + funds-transfer-in amounts
  const checkingBalance = useMemo(() => {
    const checkingExpenses = monthTransactions
      .filter(t => t.account === 'checking' && t.transactionType === 'expense' && !t.isTransferToSavings)
      .reduce((s, t) => s + t.amount, 0);
    const fundsIn = monthTransactions
      .filter(t => t.transactionType === 'funds-transfer-in')
      .reduce((s, t) => s + t.amount, 0);
    return totalBudget - checkingExpenses + fundsIn;
  }, [monthTransactions, totalBudget]);

  const addTransactions = (txns: Omit<Transaction, 'id'>[]) => {
    const newTxns = txns.map(t => ({ ...t, id: crypto.randomUUID() }));
    setTransactions(prev => [...newTxns, ...prev]);
    setShowAddTransaction(false);
  };

  const deleteTransaction = (id: string) => {
    setTransactions(prev => prev.filter(t => t.id !== id));
  };

  const addTransfer = (t: Omit<BudgetTransfer, 'id'>) => {
    setTransfers(prev => [...prev, { ...t, id: crypto.randomUUID() }]);
  };

  const handleStartMonth = (nextMonthDate: Date, nextCats: BudgetCategory[], nextFixed: FixedExpense[]) => {
    setCategories(nextCats);
    setFixedExpenses(nextFixed);
    setCurrentMonth(nextMonthDate);
    setActiveTab('dashboard');
    setMoreSubView('menu');
  };

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab);
    if (tab === 'more') setMoreSubView('menu');
  };

  if (selectedCategoryId) {
    const cat = categories.find(c => c.id === selectedCategoryId);
    if (cat) {
      return (
        <CategoryDetail
          category={{ id: cat.id, name: cat.name, budgeted: cat.budgeted }}
          categories={categories}
          transactions={budgetTransactions.filter(t => t.categoryId === cat.id)}
          transfers={monthTransfers}
          spent={spentByCategory[cat.id] || 0}
          transferAdjustment={transferAdjustments[cat.id] || 0}
          onBack={() => setSelectedCategoryId(null)}
          onDeleteTransaction={deleteTransaction}
        />
      );
    }
  }

  if (selectedFixedExpenseId) {
    const exp = fixedExpenses.find(e => e.id === selectedFixedExpenseId);
    if (exp) {
      const fixedTransactions = monthTransactions.filter(t => t.categoryId === exp.id && t.transactionType === 'expense');
      const fixedSpent = fixedTransactions.reduce((s, t) => s + t.amount, 0);
      return (
        <CategoryDetail
          category={{ id: exp.id, name: exp.name, budgeted: exp.amount }}
          categories={categories}
          transactions={fixedTransactions}
          transfers={monthTransfers}
          spent={fixedSpent}
          transferAdjustment={transferAdjustments[exp.id] || 0}
          onBack={() => setSelectedFixedExpenseId(null)}
          onDeleteTransaction={deleteTransaction}
        />
      );
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex-1 overflow-y-auto pb-24">
        {activeTab === 'dashboard' && (
          <Dashboard
            monthLabel={monthLabel}
            onPrevMonth={prevMonth}
            onNextMonth={nextMonth}
            totalBudget={totalBudget}
            variableBudget={totalVariableBudget}
            variableSpent={totalVariableSpent}
            fixedTotal={totalFixed}
            fixedSpent={fixedSpent}
            savingsTotal={totalSavings}
            savingsSpent={savingsSpent}
            titheTotal={totalTithe}
            titheSpent={titheSpent}
            onAddTransaction={() => setShowAddTransaction(true)}
            joeAmexTotal={joeAmexTotal}
            katieAmexTotal={katieAmexTotal}
            checkingBalance={checkingBalance}
          />
        )}
        {activeTab === 'variable' && (
          <SpendingView
            categories={categories}
            fixedExpenses={fixedExpenses}
            transactions={monthTransactions}
            spentByCategory={spentByCategory}
            onSelectCategory={setSelectedCategoryId}
            onSelectFixedExpense={setSelectedFixedExpenseId}
            onMoveFunds={id => setMoveFundsCategoryId(id)}
            onMoveFundsFixed={id => setMoveFundsFixedId(id)}
            monthLabel={monthLabel}
          />
        )
        )}
        {activeTab === 'transactions' && (
          <TransactionsView
            transactions={monthTransactions}
            categories={categories}
            monthLabel={monthLabel}
            onAddTransaction={() => setShowAddTransaction(true)}
            onDeleteTransaction={deleteTransaction}
          />
        )}
        {activeTab === 'more' && moreSubView === 'menu' && (
          <MoreView onSelect={tab => setMoreSubView(tab)} />
        )}
        {activeTab === 'more' && moreSubView === 'planning' && (
          <PlanningView
            currentMonth={currentMonth}
            categories={categories}
            fixedExpenses={fixedExpenses}
            onBack={() => setMoreSubView('menu')}
          />
        )}
        {activeTab === 'more' && moreSubView === 'settings' && (
          <SettingsView
            categories={categories}
            fixedExpenses={fixedExpenses}
            currentMonth={currentMonth}
            onUpdateCategories={setCategories}
            onUpdateFixedExpenses={setFixedExpenses}
            onStartMonth={handleStartMonth}
            onBack={() => setMoreSubView('menu')}
          />
        )}
      </div>

      <BottomNav activeTab={activeTab} onTabChange={handleTabChange} />

      <AddTransactionSheet
        open={showAddTransaction}
        onOpenChange={setShowAddTransaction}
        categories={categories}
        onAdd={addTransactions}
      />

      {moveFundsCategoryId && (
        <MoveFundsSheet
          open={!!moveFundsCategoryId}
          onOpenChange={open => { if (!open) setMoveFundsCategoryId(null); }}
          categories={categories}
          fixedExpenses={fixedExpenses}
          fromCategoryId={moveFundsCategoryId}
          onMove={addTransfer}
        />
      )}

      {moveFundsFixedId && (
        <MoveFundsSheet
          open={!!moveFundsFixedId}
          onOpenChange={open => { if (!open) setMoveFundsFixedId(null); }}
          categories={categories}
          fixedExpenses={fixedExpenses}
          fromCategoryId={moveFundsFixedId}
          onMove={addTransfer}
        />
      )}
    </div>
  );
};

export default Index;
