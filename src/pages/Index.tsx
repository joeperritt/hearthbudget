import { useState, useMemo, useCallback } from 'react';
import { format, addMonths, subMonths } from 'date-fns';
import { Transaction, BudgetCategory, FixedExpense, BudgetTransfer, TabId, GIVING_VARIABLE_CATEGORY } from '@/types/budget';
import { DEFAULT_CATEGORIES, DEFAULT_FIXED_EXPENSES } from '@/data/defaults';
import { BottomNav } from '@/components/hearth/BottomNav';
import { Dashboard } from '@/components/hearth/Dashboard';
import { VariableSpending } from '@/components/hearth/VariableSpending';
import { FixedExpensesView } from '@/components/hearth/FixedExpensesView';
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
  const [moveFundsCategoryId, setMoveFundsCategoryId] = useState<string | null>(null);
  const [moreSubView, setMoreSubView] = useState<'menu' | 'planning' | 'settings'>('menu');
  const [checkingBalance, setCheckingBalance] = useState(0);

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
    () => monthTransactions.filter(t => !t.isTransferToSavings),
    [monthTransactions]
  );

  const spentByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    budgetTransactions.forEach(t => {
      map[t.categoryId] = (map[t.categoryId] || 0) + t.amount;
    });
    return map;
  }, [budgetTransactions]);

  const transferAdjustments = useMemo(() => {
    const map: Record<string, number> = {};
    monthTransfers.forEach(t => {
      map[t.fromCategoryId] = (map[t.fromCategoryId] || 0) - t.amount;
      map[t.toCategoryId] = (map[t.toCategoryId] || 0) + t.amount;
    });
    return map;
  }, [monthTransfers]);

  // Hosting/Gifts/Random budget rolls into giving totals
  const hostingGiftsBudget = categories.find(c => c.id === GIVING_VARIABLE_CATEGORY)?.budgeted || 0;
  const totalVariableBudget = categories.reduce((s, c) => s + c.budgeted, 0);
  const totalVariableSpent = Object.values(spentByCategory).reduce((s, v) => s + v, 0);
  const totalFixed = fixedExpenses.filter(e => e.group === 'bills').reduce((s, e) => s + e.amount, 0);
  const totalSavings = fixedExpenses.filter(e => e.group === 'savings').reduce((s, e) => s + e.amount, 0);
  const rawTithe = fixedExpenses.filter(e => e.group === 'tithe').reduce((s, e) => s + e.amount, 0);
  const totalTithe = rawTithe + hostingGiftsBudget;
  const totalBudget = totalVariableBudget + totalFixed + totalSavings + rawTithe;

  // Account totals for dashboard
  const joeAmexTotal = useMemo(
    () => monthTransactions.filter(t => t.account === 'joe-amex').reduce((s, t) => s + t.amount, 0),
    [monthTransactions]
  );
  const katieAmexTotal = useMemo(
    () => monthTransactions.filter(t => t.account === 'katie-amex').reduce((s, t) => s + t.amount, 0),
    [monthTransactions]
  );

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

  // Reset more sub-view when switching tabs
  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab);
    if (tab === 'more') setMoreSubView('menu');
  };

  if (selectedCategoryId) {
    const cat = categories.find(c => c.id === selectedCategoryId);
    if (cat) {
      return (
        <CategoryDetail
          category={cat}
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
            savingsTotal={totalSavings}
            titheTotal={totalTithe}
            onAddTransaction={() => setShowAddTransaction(true)}
            joeAmexTotal={joeAmexTotal}
            katieAmexTotal={katieAmexTotal}
            checkingBalance={checkingBalance}
            onCheckingBalanceChange={setCheckingBalance}
          />
        )}
        {activeTab === 'variable' && (
          <VariableSpending
            categories={categories}
            spentByCategory={spentByCategory}
            onSelectCategory={setSelectedCategoryId}
            onMoveFunds={id => setMoveFundsCategoryId(id)}
            monthLabel={monthLabel}
            onPrevMonth={prevMonth}
            onNextMonth={nextMonth}
          />
        )}
        {activeTab === 'fixed' && (
          <FixedExpensesView
            expenses={fixedExpenses}
            transactions={monthTransactions}
            monthLabel={monthLabel}
            onPrevMonth={prevMonth}
            onNextMonth={nextMonth}
          />
        )}
        {activeTab === 'transactions' && (
          <TransactionsView
            transactions={monthTransactions}
            categories={categories}
            monthLabel={monthLabel}
            onPrevMonth={prevMonth}
            onNextMonth={nextMonth}
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
            onStartMonth={handleStartMonth}
            onBack={() => setMoreSubView('menu')}
          />
        )}
        {activeTab === 'more' && moreSubView === 'settings' && (
          <SettingsView
            categories={categories}
            fixedExpenses={fixedExpenses}
            onUpdateCategories={setCategories}
            onUpdateFixedExpenses={setFixedExpenses}
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
          fromCategoryId={moveFundsCategoryId}
          onMove={addTransfer}
        />
      )}
    </div>
  );
};

export default Index;
