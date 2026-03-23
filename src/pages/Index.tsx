import { useState, useMemo, useCallback } from 'react';
import { format, addMonths, subMonths } from 'date-fns';
import { Transaction, BudgetCategory, FixedExpense, BudgetTransfer, TabId } from '@/types/budget';
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

  // Transfer adjustments per category
  const transferAdjustments = useMemo(() => {
    const map: Record<string, number> = {};
    monthTransfers.forEach(t => {
      map[t.fromCategoryId] = (map[t.fromCategoryId] || 0) - t.amount;
      map[t.toCategoryId] = (map[t.toCategoryId] || 0) + t.amount;
    });
    return map;
  }, [monthTransfers]);

  const totalVariableBudget = categories.reduce((s, c) => s + c.budgeted, 0);
  const totalVariableSpent = Object.values(spentByCategory).reduce((s, v) => s + v, 0);
  const totalFixed = fixedExpenses.filter(e => e.group === 'bills').reduce((s, e) => s + e.amount, 0);
  const totalSavings = fixedExpenses.filter(e => e.group === 'savings').reduce((s, e) => s + e.amount, 0);
  const totalTithe = fixedExpenses.filter(e => e.group === 'tithe').reduce((s, e) => s + e.amount, 0);
  const totalBudget = totalVariableBudget + totalFixed + totalSavings + totalTithe;

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
        {activeTab === 'planning' && (
          <PlanningView
            currentMonth={currentMonth}
            categories={categories}
            fixedExpenses={fixedExpenses}
            onStartMonth={handleStartMonth}
          />
        )}
      </div>

      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />

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
