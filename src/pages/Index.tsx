import { useState, useMemo, useCallback, useEffect } from 'react';
import { format, parse } from 'date-fns';
import { Transaction, BudgetCategory, FixedExpense, BudgetTransfer, TabId, GIVING_VARIABLE_CATEGORY, INCOME_CATEGORY, DEPOSIT_CATEGORY, TRANSFER_CATEGORY, CC_PAYMENT_CATEGORY, PRIOR_MONTH_CATEGORY } from '@/types/budget';
import { useAccounts } from '@/hooks/useAccounts';
import { useBudgetData } from '@/hooks/useBudgetData';
import { useBudgetInsights } from '@/hooks/useBudgetInsights';
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
import { InsightsSection } from '@/components/hearth/InsightsSection';
import { AIAdvisorView } from '@/components/hearth/AIAdvisorView';
import { BankConnectionView } from '@/components/hearth/BankConnectionView';
import { SpendingTrendsView } from '@/components/hearth/SpendingTrendsView';

const Index = () => {
  const {
    categories,
    fixedExpenses,
    transactions,
    transfers,
    activeMonth,
    loading,
    addTransactions,
    deleteTransaction,
    addTransfer,
    updateCategories,
    updateFixedExpenses,
    startNewMonth,
    planningData,
    updatePlanningData,
  } = useBudgetData();

  const { accounts } = useAccounts();

  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [showAddTransaction, setShowAddTransaction] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [editingSplitSiblings, setEditingSplitSiblings] = useState<Transaction[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedFixedExpenseId, setSelectedFixedExpenseId] = useState<string | null>(null);
  const [moveFundsCategoryId, setMoveFundsCategoryId] = useState<string | null>(null);
  const [moveFundsFixedId, setMoveFundsFixedId] = useState<string | null>(null);
  const [moreSubView, setMoreSubView] = useState<'menu' | 'planning' | 'settings' | 'bank-connections' | 'ai-advisor' | 'trends'>('menu');

  const monthKey = activeMonth;
  const monthLabel = useMemo(() => {
    if (!activeMonth) return '';
    try {
      const d = new Date(activeMonth + '-01T00:00:00');
      return format(d, 'MMMM yyyy');
    } catch {
      return activeMonth;
    }
  }, [activeMonth]);

  // Derive a Date object for components that need it
  const currentMonthDate = useMemo(() => {
    if (!activeMonth) return new Date();
    try {
      return new Date(activeMonth + '-01T00:00:00');
    } catch {
      return new Date();
    }
  }, [activeMonth]);

  const monthTransactions = useMemo(
    () => transactions.filter(t => t.budgetMonth === monthKey),
    [transactions, monthKey]
  );

  const monthTransfers = useMemo(
    () => transfers.filter(t => t.date.startsWith(monthKey)),
    [transfers, monthKey]
  );

  const isExcluded = (t: Transaction) => t.isTransferToSavings || t.transactionType === 'income' || t.transactionType === 'deposit' || t.transactionType === 'cc-payment' || t.categoryId === INCOME_CATEGORY || t.categoryId === DEPOSIT_CATEGORY || t.categoryId === TRANSFER_CATEGORY || t.categoryId === CC_PAYMENT_CATEGORY || t.categoryId === PRIOR_MONTH_CATEGORY;

  const budgetTransactions = useMemo(
    () => monthTransactions.filter(t => !isExcluded(t) && t.transactionType === 'expense'),
    [monthTransactions]
  );

  const spentByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    budgetTransactions.forEach(t => {
      map[t.categoryId] = (map[t.categoryId] || 0) + t.amount;
    });
    monthTransactions.filter(t => t.transactionType === 'budget-adjustment').forEach(t => {
      map[t.categoryId] = (map[t.categoryId] || 0) - t.amount;
    });
    monthTransactions.filter(t => t.transactionType === 'deposit' && t.categoryId !== DEPOSIT_CATEGORY && t.categoryId !== INCOME_CATEGORY && t.categoryId !== TRANSFER_CATEGORY && t.categoryId !== CC_PAYMENT_CATEGORY).forEach(t => {
      map[t.categoryId] = (map[t.categoryId] || 0) - Math.abs(t.amount);
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

  const variableCategoryIds = useMemo(() => new Set(categories.map(c => c.id)), [categories]);
  const totalVariableBudget = categories.reduce((s, c) => s + c.budgeted, 0);
  const totalVariableSpent = useMemo(() => {
    const rawSpent = Object.entries(spentByCategory)
      .filter(([id]) => variableCategoryIds.has(id))
      .reduce((s, [, v]) => s + v, 0);
    const varTransferAdj = categories.reduce((s, c) => s + (transferAdjustments[c.id] || 0), 0);
    return rawSpent - varTransferAdj;
  }, [spentByCategory, variableCategoryIds, categories, transferAdjustments]);
  const totalFixedAll = fixedExpenses.reduce((s, e) => s + e.amount, 0);

  const allFixedSpent = useMemo(() => {
    const ids = new Set(fixedExpenses.map(e => e.id));
    const rawSpent = Object.entries(spentByCategory)
      .filter(([id]) => ids.has(id))
      .reduce((s, [, v]) => s + v, 0);
    const fixedTransferAdj = fixedExpenses.reduce((s, e) => s + (transferAdjustments[e.id] || 0), 0);
    return rawSpent - fixedTransferAdj;
  }, [spentByCategory, fixedExpenses, transferAdjustments]);

  const totalBudget = totalVariableBudget + totalFixedAll;

  const assignedCategoryIds = useMemo(() => {
    const ids = new Set(categories.map(c => c.id));
    fixedExpenses.forEach(e => ids.add(e.id));
    return ids;
  }, [categories, fixedExpenses]);

  const accountSpending = useMemo(() => {
    return accounts.map(acct => ({
      label: acct.label,
      type: acct.type,
      amount: monthTransactions
        .filter(t => t.account === acct.id && t.transactionType === 'expense' && assignedCategoryIds.has(t.categoryId))
        .reduce((s, t) => s + t.amount, 0),
    }));
  }, [accounts, monthTransactions, assignedCategoryIds]);

  const totalPayoffs = useMemo(
    () => monthTransactions.filter(t => accounts.some(a => a.type === 'credit_card' && a.id === t.account) && t.transactionType === 'cc-payment').reduce((s, t) => s + Math.abs(t.amount), 0),
    [monthTransactions, accounts]
  );

  const unassignedTransactions = useMemo(
    () => monthTransactions.filter(t => t.categoryId === 'unassigned' && !isExcluded(t)),
    [monthTransactions]
  );

  // AI Insights
  const {
    insights, loading: insightsLoading, error: insightsError, lastUpdated: insightsLastUpdated,
    fetchInsights, chatMessages, chatLoading, sendChatMessage, clearChat,
  } = useBudgetInsights(
    activeMonth, categories, fixedExpenses, monthTransactions,
    spentByCategory, transferAdjustments, accountSpending, unassignedTransactions.length, totalBudget,
  );

  // Auto-fetch insights on first dashboard load
  useEffect(() => {
    if (activeMonth && categories.length > 0) {
      fetchInsights();
    }
  }, [activeMonth, categories.length]);

  const handleAddTransactions = async (txns: Omit<Transaction, 'id'>[]) => {
    await addTransactions(txns);
    setShowAddTransaction(false);
    // Refresh insights when transaction added
    setTimeout(() => fetchInsights(true), 1000);
  };

  const handleStartMonth = async (_nextMonthDate: Date, _nextCats: BudgetCategory[], _nextFixed: FixedExpense[]) => {
    // Month transitions now happen automatically — this is kept for compatibility
  };

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab);
    if (tab === 'more') setMoreSubView('menu');
  };

  const handleGoToTransaction = useCallback((transactionId: string) => {
    setSelectedCategoryId(null);
    setSelectedFixedExpenseId(null);
    setActiveTab('transactions');
    setTimeout(() => {
      // Find the transaction and open edit sheet
      const tx = transactions.find(t => t.id === transactionId);
      if (tx) {
        // Check if it's part of a split group
        const siblings = transactions.filter(
          t => t.id !== tx.id && t.description === tx.description && t.date === tx.date && t.account === tx.account && t.transactionType === 'expense'
        );
        if (siblings.length > 0 && tx.transactionType === 'expense') {
          setEditingTransaction(tx);
          setEditingSplitSiblings([tx, ...siblings]);
        } else {
          setEditingTransaction(tx);
          setEditingSplitSiblings([]);
        }
      }
      // Also scroll to it
      const el = document.getElementById(`tx-${transactionId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2', 'ring-accent', 'ring-offset-2', 'ring-offset-background');
        setTimeout(() => el.classList.remove('ring-2', 'ring-accent', 'ring-offset-2', 'ring-offset-background'), 2000);
      }
    }, 200);
  }, [transactions]);

  if (loading || !activeMonth) {
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
          fixedExpenses={fixedExpenses}
          transactions={budgetTransactions.filter(t => t.categoryId === cat.id)}
          deposits={monthTransactions.filter(t => t.transactionType === 'deposit' && t.categoryId === cat.id)}
          transfers={monthTransfers}
          spent={spentByCategory[cat.id] || 0}
          transferAdjustment={transferAdjustments[cat.id] || 0}
          onBack={() => setSelectedCategoryId(null)}
          onDeleteTransaction={deleteTransaction}
          onGoToTransaction={handleGoToTransaction}
          accounts={accounts}
        />
      );
    }
  }

  if (selectedFixedExpenseId) {
    const exp = fixedExpenses.find(e => e.id === selectedFixedExpenseId);
    if (exp) {
      const fixedTransactions = monthTransactions.filter(t => t.categoryId === exp.id && t.transactionType === 'expense');
      const fixedDeposits = monthTransactions.filter(t => t.transactionType === 'deposit' && t.categoryId === exp.id);
      const expFixedSpent = fixedTransactions.reduce((s, t) => s + t.amount, 0) - fixedDeposits.reduce((s, d) => s + Math.abs(d.amount), 0);
      return (
        <CategoryDetail
          category={{ id: exp.id, name: exp.name, budgeted: exp.amount }}
          categories={categories}
          fixedExpenses={fixedExpenses}
          transactions={fixedTransactions}
          deposits={fixedDeposits}
          transfers={monthTransfers}
          spent={expFixedSpent}
          transferAdjustment={transferAdjustments[exp.id] || 0}
          onBack={() => setSelectedFixedExpenseId(null)}
          onDeleteTransaction={deleteTransaction}
          onGoToTransaction={handleGoToTransaction}
          accounts={accounts}
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
            onAddTransaction={() => setShowAddTransaction(true)}
            accountSpending={accountSpending}
            totalPayoffs={totalPayoffs}
            unassignedTransactions={unassignedTransactions}
            onEditTransaction={setEditingTransaction}
            categories={categories}
            fixedExpenses={fixedExpenses}
            spentByCategory={spentByCategory}
            transferAdjustments={transferAdjustments}
            onSelectCategory={setSelectedCategoryId}
            onSelectFixedExpense={setSelectedFixedExpenseId}
            accounts={accounts}
            monthTransactions={monthTransactions}
            totalBudget={totalBudget}
            totalVariableSpent={totalVariableSpent}
            totalFixedSpent={allFixedSpent}
            onSyncComplete={() => fetchInsights(true)}
            insightsSection={
              <InsightsSection
                insights={insights}
                loading={insightsLoading}
                error={insightsError}
                lastUpdated={insightsLastUpdated}
                onSeeAll={() => { setActiveTab('more'); setMoreSubView('ai-advisor'); }}
                onRefresh={() => fetchInsights(true)}
              />
            }
          />
        )}
        {activeTab === 'variable' && (
          <SpendingView
            categories={categories}
            fixedExpenses={fixedExpenses}
            transactions={monthTransactions}
            spentByCategory={spentByCategory}
            transferAdjustments={transferAdjustments}
            onSelectCategory={setSelectedCategoryId}
            onSelectFixedExpense={setSelectedFixedExpenseId}
            onMoveFunds={id => setMoveFundsCategoryId(id)}
            onMoveFundsFixed={id => setMoveFundsFixedId(id)}
            monthLabel={monthLabel}
            totalBudget={totalBudget}
            variableBudget={totalVariableBudget}
            variableSpent={totalVariableSpent}
            fixedTotal={totalFixedAll}
            fixedSpent={allFixedSpent}
          />
        )}
        {activeTab === 'transactions' && (
          <TransactionsView
            transactions={monthTransactions}
            categories={categories}
            fixedExpenses={fixedExpenses}
            monthLabel={monthLabel}
            onAddTransaction={() => setShowAddTransaction(true)}
            onDeleteTransaction={deleteTransaction}
            onEditTransaction={(tx, splitSiblings) => {
              setEditingTransaction(tx);
              setEditingSplitSiblings(splitSiblings || []);
            }}
            accounts={accounts}
          />
        )}
        {activeTab === 'more' && moreSubView === 'menu' && (
          <MoreView onSelect={tab => setMoreSubView(tab)} />
        )}
        {activeTab === 'more' && moreSubView === 'planning' && (
          <PlanningView
            currentMonth={currentMonthDate}
            categories={categories}
            fixedExpenses={fixedExpenses}
            planningData={planningData}
            onUpdatePlanningData={updatePlanningData}
            onBack={() => setMoreSubView('menu')}
          />
        )}
        {activeTab === 'more' && moreSubView === 'settings' && (
          <SettingsView
            categories={categories}
            fixedExpenses={fixedExpenses}
            currentMonth={currentMonthDate}
            onUpdateCategories={updateCategories}
            onUpdateFixedExpenses={updateFixedExpenses}
            
            onBack={() => setMoreSubView('menu')}
            unassignedCount={unassignedTransactions.length}
            spentByCategory={spentByCategory}
            transferAdjustments={transferAdjustments}
            monthTransactions={monthTransactions}
          />
        )}
        {activeTab === 'more' && moreSubView === 'bank-connections' && (
          <BankConnectionView onBack={() => setMoreSubView('menu')} />
        )}
        {activeTab === 'more' && moreSubView === 'ai-advisor' && (
          <AIAdvisorView
            insights={insights}
            loading={insightsLoading}
            chatMessages={chatMessages}
            chatLoading={chatLoading}
            onSendMessage={sendChatMessage}
            onBack={() => setMoreSubView('menu')}
            onRefresh={() => fetchInsights(true)}
          />
        )}
      </div>

      <BottomNav activeTab={activeTab} onTabChange={handleTabChange} />

      <AddTransactionSheet
        open={showAddTransaction}
        onOpenChange={setShowAddTransaction}
        categories={categories}
        fixedExpenses={fixedExpenses}
        onAdd={handleAddTransactions}
        monthTransactions={monthTransactions}
        accounts={accounts}
      />

      <EditTransactionSheet
        transaction={editingTransaction}
        open={!!editingTransaction}
        onOpenChange={open => { if (!open) { setEditingTransaction(null); setEditingSplitSiblings([]); } }}
        categories={categories}
        fixedExpenses={fixedExpenses}
        activeMonth={activeMonth}
        monthTransactions={monthTransactions}
        splitSiblings={editingSplitSiblings}
        accounts={accounts}
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
