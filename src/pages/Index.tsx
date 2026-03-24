import { useState, useMemo, useCallback } from 'react';
import { format } from 'date-fns';
import { Transaction, BudgetCategory, FixedExpense, BudgetTransfer, TabId, GIVING_VARIABLE_CATEGORY, INCOME_CATEGORY } from '@/types/budget';
import { useBudgetData } from '@/hooks/useBudgetData';
import { BottomNav } from '@/components/hearth/BottomNav';
import { Dashboard } from '@/components/hearth/Dashboard';
import { SpendingView } from '@/components/hearth/SpendingView';
import { TransactionsView } from '@/components/hearth/TransactionsView';
import { AddTransactionSheet } from '@/components/hearth/AddTransactionSheet';
import { EditTransactionSheet } from '@/components/hearth/EditTransactionSheet';
import { CategoryDetail } from '@/components/hearth/CategoryDetail';
import { PlanningView } from '@/components/hearth/PlanningView';
import { MoveFundsSheet } from '@/components/hearth/MoveFundsSheet';
import { MoreView } from '@/components/hearth/MoreView';
import { SettingsView } from '@/components/hearth/SettingsView';
import { PastMonthsView } from '@/components/hearth/PastMonthsView';
import { BankConnectionView } from '@/components/hearth/BankConnectionView';

const Index = () => {
  const {
    categories,
    fixedExpenses,
    transactions,
    transfers,
    loading,
    addTransactions,
    deleteTransaction,
    addTransfer,
    updateCategories,
    updateFixedExpenses,
  } = useBudgetData();

  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [currentMonth] = useState(new Date());
  const [showAddTransaction, setShowAddTransaction] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedFixedExpenseId, setSelectedFixedExpenseId] = useState<string | null>(null);
  const [moveFundsCategoryId, setMoveFundsCategoryId] = useState<string | null>(null);
  const [moveFundsFixedId, setMoveFundsFixedId] = useState<string | null>(null);
  const [moreSubView, setMoreSubView] = useState<'menu' | 'planning' | 'settings' | 'past-months' | 'bank-connections'>('menu');

  const monthKey = format(currentMonth, 'yyyy-MM');
  const monthLabel = format(currentMonth, 'MMMM yyyy');

  const monthTransactions = useMemo(
    () => transactions.filter(t => t.date.startsWith(monthKey)),
    [transactions, monthKey]
  );

  const monthTransfers = useMemo(
    () => transfers.filter(t => t.date.startsWith(monthKey)),
    [transfers, monthKey]
  );

  const budgetTransactions = useMemo(
    () => monthTransactions.filter(t => !t.isTransferToSavings && t.transactionType === 'expense' && t.categoryId !== INCOME_CATEGORY),
    [monthTransactions]
  );

  const spentByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    budgetTransactions.forEach(t => {
      map[t.categoryId] = (map[t.categoryId] || 0) + t.amount;
    });
    // Budget adjustments: positive amount adds funds (subtract from spent), negative removes funds (add to spent)
    monthTransactions.filter(t => t.transactionType === 'budget-adjustment').forEach(t => {
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
  const totalVariableBudget = categories.filter(c => c.id !== GIVING_VARIABLE_CATEGORY).reduce((s, c) => s + c.budgeted, 0);
  const totalVariableSpent = Object.values(spentByCategory).reduce((s, v) => s + v, 0);
  const totalFixed = fixedExpenses.filter(e => e.group === 'bills').reduce((s, e) => s + e.amount, 0);
  const totalSavings = fixedExpenses.filter(e => e.group === 'savings').reduce((s, e) => s + e.amount, 0);
  const rawTithe = fixedExpenses.filter(e => e.group === 'tithe').reduce((s, e) => s + e.amount, 0);

  const fixedSpent = useMemo(() => {
    const ids = new Set(fixedExpenses.filter(e => e.group === 'bills').map(e => e.id));
    return monthTransactions.filter(t => ids.has(t.categoryId) && t.transactionType === 'expense' && t.categoryId !== INCOME_CATEGORY).reduce((s, t) => s + t.amount, 0);
  }, [monthTransactions, fixedExpenses]);
  const savingsSpent = useMemo(() => {
    const ids = new Set(fixedExpenses.filter(e => e.group === 'savings').map(e => e.id));
    return monthTransactions.filter(t => ids.has(t.categoryId) && t.transactionType === 'expense' && t.categoryId !== INCOME_CATEGORY).reduce((s, t) => s + t.amount, 0);
  }, [monthTransactions, fixedExpenses]);
  const titheSpent = useMemo(() => {
    const ids = new Set(fixedExpenses.filter(e => e.group === 'tithe').map(e => e.id));
    const fixedTitheSpent = monthTransactions.filter(t => ids.has(t.categoryId) && t.transactionType === 'expense' && t.categoryId !== INCOME_CATEGORY).reduce((s, t) => s + t.amount, 0);
    const givingCatSpent = spentByCategory[GIVING_VARIABLE_CATEGORY] || 0;
    return fixedTitheSpent + givingCatSpent;
  }, [monthTransactions, fixedExpenses, spentByCategory]);
  const totalTithe = rawTithe + hostingGiftsBudget;
  const totalBudget = totalVariableBudget + totalFixed + totalSavings + totalTithe;

  // Account totals — sum ALL amounts (including negative credits/payments) for net balance
  const joeAmexTotal = useMemo(
    () => monthTransactions.filter(t => t.account === 'joe-amex').reduce((s, t) => s + t.amount, 0),
    [monthTransactions]
  );
  const katieAmexTotal = useMemo(
    () => monthTransactions.filter(t => t.account === 'katie-amex').reduce((s, t) => s + t.amount, 0),
    [monthTransactions]
  );

  const checkingBalance = useMemo(() => {
    const checkingNet = monthTransactions
      .filter(t => t.account === 'checking')
      .reduce((s, t) => s + t.amount, 0);
    return Math.abs(totalBudget - checkingNet);
  }, [monthTransactions, totalBudget]);

  const unassignedTransactions = useMemo(
    () => monthTransactions.filter(t => t.categoryId === 'unassigned' && t.transactionType !== 'income'),
    [monthTransactions]
  );

  const handleAddTransactions = async (txns: Omit<Transaction, 'id'>[]) => {
    await addTransactions(txns);
    setShowAddTransaction(false);
  };

  const handleStartMonth = async (nextMonthDate: Date, nextCats: BudgetCategory[], nextFixed: FixedExpense[]) => {
    await updateCategories(nextCats);
    await updateFixedExpenses(nextFixed);
    setActiveTab('dashboard');
    setMoreSubView('menu');
  };

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab);
    if (tab === 'more') setMoreSubView('menu');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-10 h-10 rounded-2xl bg-primary flex items-center justify-center animate-pulse">
          <span className="text-primary-foreground font-display text-lg font-bold">H</span>
        </div>
      </div>
    );
  }

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
      const expFixedSpent = fixedTransactions.reduce((s, t) => s + t.amount, 0);
      return (
        <CategoryDetail
          category={{ id: exp.id, name: exp.name, budgeted: exp.amount }}
          categories={categories}
          transactions={fixedTransactions}
          transfers={monthTransfers}
          spent={expFixedSpent}
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
            unassignedTransactions={unassignedTransactions}
            onEditTransaction={setEditingTransaction}
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
        )}
        {activeTab === 'transactions' && (
          <TransactionsView
            transactions={monthTransactions}
            categories={categories}
            monthLabel={monthLabel}
            onAddTransaction={() => setShowAddTransaction(true)}
            onDeleteTransaction={deleteTransaction}
            onEditTransaction={setEditingTransaction}
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
            onUpdateCategories={updateCategories}
            onUpdateFixedExpenses={updateFixedExpenses}
            onStartMonth={handleStartMonth}
            onBack={() => setMoreSubView('menu')}
          />
        )}
        {activeTab === 'more' && moreSubView === 'past-months' && (
          <PastMonthsView onBack={() => setMoreSubView('menu')} />
        )}
        {activeTab === 'more' && moreSubView === 'bank-connections' && (
          <BankConnectionView onBack={() => setMoreSubView('menu')} />
        )}
      </div>

      <BottomNav activeTab={activeTab} onTabChange={handleTabChange} />

      <AddTransactionSheet
        open={showAddTransaction}
        onOpenChange={setShowAddTransaction}
        categories={categories}
        onAdd={handleAddTransactions}
      />

      <EditTransactionSheet
        transaction={editingTransaction}
        open={!!editingTransaction}
        onOpenChange={open => { if (!open) setEditingTransaction(null); }}
        categories={categories}
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
