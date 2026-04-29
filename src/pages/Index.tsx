import { useState, useMemo, useCallback, useEffect } from 'react';
import { format, parse } from 'date-fns';
import { Transaction, BudgetCategory, FixedExpense, BudgetTransfer, TabId, GIVING_VARIABLE_CATEGORY, INCOME_CATEGORY, DEPOSIT_CATEGORY, TRANSFER_CATEGORY, CC_PAYMENT_CATEGORY, USER_IGNORE_CATEGORY, PRIOR_MONTH_CATEGORY } from '@/types/budget';
import { useAccounts } from '@/hooks/useAccounts';
import { filterForMonth, useBudgetData } from '@/hooks/useBudgetData';
import { useBudgetInsights } from '@/hooks/useBudgetInsights';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { BottomNav } from '@/components/keeper/BottomNav';
import { SideNav, ProfileSidebarItem } from '@/components/keeper/SideNav';
import { Dashboard } from '@/components/keeper/Dashboard';
import { SpendingView } from '@/components/keeper/SpendingView';
import { TransactionsView } from '@/components/keeper/TransactionsView';
import { AddTransactionSheet } from '@/components/keeper/AddTransactionSheet';
import { EditTransactionSheet } from '@/components/keeper/EditTransactionSheet';
import { CategoryDetail } from '@/components/keeper/CategoryDetail';

import { MoveFundsSheet } from '@/components/keeper/MoveFundsSheet';
import { ProfileTab } from '@/components/keeper/ProfileTab';
import { SettingsView } from '@/components/keeper/SettingsView';
import { InsightsSection } from '@/components/keeper/InsightsSection';
import { AIAdvisorView } from '@/components/keeper/AIAdvisorView';
import { BankConnectionView } from '@/components/keeper/BankConnectionView';
import { SecurityView } from '@/components/keeper/SecurityView';
import { SpendingTrendsView } from '@/components/keeper/SpendingTrendsView';
import { BudgetTabView } from '@/components/keeper/BudgetTabView';
import { PlanView } from '@/components/keeper/PlanView';

import { CalculatorsList } from '@/components/keeper/CalculatorsList';
import { MortgageCalculator } from '@/components/keeper/MortgageCalculator';
import { DebtPayoffCalculator } from '@/components/keeper/DebtPayoffCalculator';
import { CarLoanCalculator } from '@/components/keeper/CarLoanCalculator';
import { TaxWithholdingCalculator } from '@/components/keeper/TaxWithholdingCalculator';
import { RetirementPlanner } from '@/components/keeper/RetirementPlanner';
import { CFPProfileView } from '@/components/keeper/CFPProfileView';
import { GoalsPlanner } from '@/components/keeper/GoalsPlanner';
import { EmergencyFundAnalysis } from '@/components/keeper/EmergencyFundAnalysis';
import { LifeInsuranceAnalysis } from '@/components/keeper/LifeInsuranceAnalysis';
import { AdminMfaBanner } from '@/components/auth/AdminMfaBanner';
import { OnboardingFlow } from '@/components/keeper/OnboardingFlow';
import { PostOnboardingCards } from '@/components/keeper/PostOnboardingCards';

type ProfileTab = 'profile' | 'income' | 'housing' | 'debts' | 'accounts' | 'insurance';

type PlanSubView = 'menu' | 'financial-profile' | 'calculators'
  | 'mortgage-analyzer' | 'debt-payoff' | 'tax-estimator' | 'life-insurance'
  | 'emergency-fund' | 'savings-goals' | 'retirement'
  | 'mortgage-shopping' | 'car-loan';

type ProfileSubView = 'menu' | 'financial-profile' | 'settings' | 'bank-connections' | 'ai-advisor' | 'trends'
  | 'calculators' | 'mortgage-shopping' | 'car-loan' | 'tax-estimator' | 'security';

const Index = () => {
  const {
    categories, fixedExpenses, transactions, transfers,
    activeMonth, loading, householdId,
    addTransactions, deleteTransaction, addTransfer, deleteTransfer,
    updateCategories, updateFixedExpenses, startNewMonth,
    addCategoryForMonth, addFixedExpenseForMonth,
    removeCategoryFromMonth, removeFixedExpenseFromMonth,
    planningData, updatePlanningData,
  } = useBudgetData();

  const { accounts } = useAccounts();
  const { user } = useAuth();

  const [householdMembers, setHouseholdMembers] = useState<{ primaryName: string; partnerName: string | null }>({ primaryName: '', partnerName: null });
  // Onboarding gate. `null` = unknown (still loading), `true` = show app,
  // `false` = render the OnboardingFlow on top of everything else.
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean | null>(null);
  useEffect(() => {
    if (!householdId || !user) return;
    supabase
      .from('profiles')
      .select('user_id, display_name')
      .eq('household_id', householdId)
      .then(({ data }) => {
        if (!data || data.length === 0) return;
        const me = data.find(p => p.user_id === user.id);
        const other = data.find(p => p.user_id !== user.id);
        setHouseholdMembers({
          primaryName: me?.display_name || '',
          partnerName: other?.display_name || null,
        });
      });
  }, [householdId, user]);

  // Pull onboarding_completed once the household is known.
  useEffect(() => {
    if (!householdId) return;
    let cancelled = false;
    supabase
      .from('households')
      .select('onboarding_completed')
      .eq('id', householdId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setOnboardingCompleted(data?.onboarding_completed ?? true);
      });
    return () => { cancelled = true; };
  }, [householdId]);

  // On-open fallback sync: if the most recent successful sync for this household
  // is more than 4 hours old (or never), kick off a background sync. We don't
  // block the UI — realtime subscriptions reflect new transactions automatically.
  useEffect(() => {
    if (!householdId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('plaid_items')
        .select('last_successful_sync_at')
        .eq('household_id', householdId)
        .order('last_successful_sync_at', { ascending: false, nullsFirst: false })
        .limit(1);
      if (cancelled) return;
      const last = data?.[0]?.last_successful_sync_at as string | null | undefined;
      const fourHoursMs = 4 * 60 * 60 * 1000;
      const stale = !last || (Date.now() - new Date(last).getTime()) > fourHoursMs;
      if (!stale) return;
      try {
        await supabase.functions.invoke('auto-sync-all-households', {
          body: { household_id: householdId },
        });
      } catch (e) {
        console.warn('On-open background sync failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [householdId]);

  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [activityInitialFilter, setActivityInitialFilter] = useState<string | undefined>(undefined);

  // Allow other components (e.g. Dashboard reconnect banner) to navigate to
  // the Bank Connections screen via a global event.
  useEffect(() => {
    const handler = () => {
      setActiveTab('profile');
      setProfileSubView('bank-connections');
    };
    window.addEventListener('open-bank-connections', handler);
    return () => window.removeEventListener('open-bank-connections', handler);
  }, []);
  const [showAddTransaction, setShowAddTransaction] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [editingSplitSiblings, setEditingSplitSiblings] = useState<Transaction[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedFixedExpenseId, setSelectedFixedExpenseId] = useState<string | null>(null);
  const [moveFundsCategoryId, setMoveFundsCategoryId] = useState<string | null>(null);
  const [moveFundsFixedId, setMoveFundsFixedId] = useState<string | null>(null);
  const [planSubView, setPlanSubView] = useState<PlanSubView>('menu');
  const [profileInitialTab, setProfileInitialTab] = useState<ProfileTab | undefined>(undefined);
  const [profileSubView, setProfileSubView] = useState<ProfileSubView>('menu');
  const [budgetSubView, setBudgetSubView] = useState<'main' | 'settings'>('main');
  const [budgetTargetMonth, setBudgetTargetMonth] = useState<string | undefined>(undefined);

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

  const activeMonthCategories = useMemo(
    () => filterForMonth(categories, monthKey),
    [categories, monthKey]
  );

  const activeMonthFixedExpenses = useMemo(
    () => filterForMonth(fixedExpenses, monthKey),
    [fixedExpenses, monthKey]
  );

  const monthTransfers = useMemo(
    () => transfers.filter(t => t.date.startsWith(monthKey)),
    [transfers, monthKey]
  );

  const isExcluded = (t: Transaction) => t.isTransferToSavings || t.transactionType === 'income' || t.transactionType === 'deposit' || t.transactionType === 'cc-payment' || t.transactionType === 'transfer' || t.categoryId === INCOME_CATEGORY || t.categoryId === DEPOSIT_CATEGORY || t.categoryId === TRANSFER_CATEGORY || t.categoryId === CC_PAYMENT_CATEGORY || t.categoryId === USER_IGNORE_CATEGORY || t.categoryId === PRIOR_MONTH_CATEGORY;

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

  const variableCategoryIds = useMemo(() => new Set(activeMonthCategories.map(c => c.id)), [activeMonthCategories]);
  const totalVariableBudget = activeMonthCategories.reduce((s, c) => s + c.budgeted, 0);
  const totalVariableSpent = useMemo(() => {
    const rawSpent = Object.entries(spentByCategory)
      .filter(([id]) => variableCategoryIds.has(id))
      .reduce((s, [, v]) => s + v, 0);
    const varTransferAdj = activeMonthCategories.reduce((s, c) => s + (transferAdjustments[c.id] || 0), 0);
    return rawSpent - varTransferAdj;
  }, [spentByCategory, variableCategoryIds, activeMonthCategories, transferAdjustments]);
  const totalFixedAll = activeMonthFixedExpenses.reduce((s, e) => s + e.amount, 0);

  const allFixedSpent = useMemo(() => {
    const ids = new Set(activeMonthFixedExpenses.map(e => e.id));
    const rawSpent = Object.entries(spentByCategory)
      .filter(([id]) => ids.has(id))
      .reduce((s, [, v]) => s + v, 0);
    const fixedTransferAdj = activeMonthFixedExpenses.reduce((s, e) => s + (transferAdjustments[e.id] || 0), 0);
    return rawSpent - fixedTransferAdj;
  }, [spentByCategory, activeMonthFixedExpenses, transferAdjustments]);

  const totalBudget = totalVariableBudget + totalFixedAll;

  const assignedCategoryIds = useMemo(() => {
    const ids = new Set(activeMonthCategories.map(c => c.id));
    activeMonthFixedExpenses.forEach(e => ids.add(e.id));
    return ids;
  }, [activeMonthCategories, activeMonthFixedExpenses]);

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

  const {
    insights, loading: insightsLoading, error: insightsError, lastUpdated: insightsLastUpdated,
    hasCached: insightsHasCached, generateInsights,
    bigPictureInsights, bigPictureLoading, bigPictureError, bigPictureLastUpdated,
    bigPictureHasCached, generateBigPicture,
    chatMessages, chatLoading, sendChatMessage, clearChat,
  } = useBudgetInsights(
    activeMonth, activeMonthCategories, activeMonthFixedExpenses, monthTransactions,
    spentByCategory, transferAdjustments, accountSpending, unassignedTransactions.length, totalBudget,
    householdId, planningData,
  );

  const handleAddTransactions = async (txns: Omit<Transaction, 'id'>[]) => {
    try {
      await addTransactions(txns);
      const { toast } = await import('sonner');
      toast.success(txns.length > 1 ? `${txns.length} transactions added` : 'Transaction added');
      setShowAddTransaction(false);
    } catch (err: any) {
      const { toast } = await import('sonner');
      toast.error(err?.message || 'Failed to save transaction. Please try again.');
    }
  };

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab);
    if (tab === 'profile') setProfileSubView('menu');
    if (tab === 'plan') setPlanSubView('menu');
    if (tab === 'budget') setBudgetSubView('main');
  };

  const handleGoToTransaction = useCallback((transactionId: string) => {
    setSelectedCategoryId(null);
    setSelectedFixedExpenseId(null);
    setActiveTab('transactions');
    setTimeout(() => {
      const tx = transactions.find(t => t.id === transactionId);
      if (tx) {
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
      const el = document.getElementById(`tx-${transactionId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2', 'ring-accent', 'ring-offset-2', 'ring-offset-background');
        setTimeout(() => el.classList.remove('ring-2', 'ring-accent', 'ring-offset-2', 'ring-offset-background'), 2000);
      }
    }, 200);
  }, [transactions]);

  // Helper to navigate to insight/calculator tool from Plan or More
  const navigateToTool = (tool: string, fromTab: 'plan' | 'profile') => {
    if (fromTab === 'plan') {
      setPlanSubView(tool as PlanSubView);
    } else {
      setProfileSubView(tool as ProfileSubView);
    }
  };

  // Navigate to Financial Profile with a specific tab open
  const navigateToProfile = useCallback((tab?: ProfileTab) => {
    setProfileInitialTab(tab);
    setPlanSubView('financial-profile');
    setActiveTab('plan');
  }, []);

  // Navigate to a calculator/tool
  const navigateToCalculator = useCallback((toolId: string) => {
    setPlanSubView(toolId as PlanSubView);
    setActiveTab('plan');
  }, []);

  // Navigate to Budget tab with a specific month preselected
  const navigateToBudget = useCallback((monthKey: string) => {
    setBudgetTargetMonth(monthKey);
    setBudgetSubView('main');
    setActiveTab('budget');
  }, []);

  // Helper to get back target for tools
  const getToolBackTarget = (fromTab: 'plan' | 'profile', parent: string) => {
    if (fromTab === 'plan') return () => setPlanSubView(parent as PlanSubView);
    return () => setProfileSubView(parent as ProfileSubView);
  };

  if (loading || !activeMonth || onboardingCompleted === null) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-10 h-10 rounded-2xl bg-primary flex items-center justify-center animate-pulse">
          <span className="text-primary-foreground font-display text-lg font-bold">K</span>
        </div>
      </div>
    );
  }

  // Onboarding takes over the entire screen until completed. The rest of the
  // app stays mounted underneath but is visually covered by the fixed overlay.
  if (onboardingCompleted === false && householdId) {
    return (
      <OnboardingFlow
        householdId={householdId}
        onComplete={() => setOnboardingCompleted(true)}
      />
    );
  }

  if (selectedCategoryId) {
    const cat = activeMonthCategories.find(c => c.id === selectedCategoryId);
    if (cat) {
      return (
        <CategoryDetail
          category={{ id: cat.id, name: cat.name, budgeted: cat.budgeted }}
          categories={activeMonthCategories}
          fixedExpenses={activeMonthFixedExpenses}
          transactions={budgetTransactions.filter(t => t.categoryId === cat.id)}
          deposits={monthTransactions.filter(t => t.transactionType === 'deposit' && t.categoryId === cat.id)}
          transfers={monthTransfers}
          spent={spentByCategory[cat.id] || 0}
          transferAdjustment={transferAdjustments[cat.id] || 0}
          onBack={() => setSelectedCategoryId(null)}
          onDeleteTransaction={deleteTransaction}
          onDeleteTransfer={deleteTransfer}
          onGoToTransaction={handleGoToTransaction}
          accounts={accounts}
        />
      );
    }
  }

  if (selectedFixedExpenseId) {
    const exp = activeMonthFixedExpenses.find(e => e.id === selectedFixedExpenseId);
    if (exp) {
      const fixedTransactions = monthTransactions.filter(t => t.categoryId === exp.id && t.transactionType === 'expense');
      const fixedDeposits = monthTransactions.filter(t => t.transactionType === 'deposit' && t.categoryId === exp.id);
      const expFixedSpent = fixedTransactions.reduce((s, t) => s + t.amount, 0) - fixedDeposits.reduce((s, d) => s + Math.abs(d.amount), 0);
      return (
        <CategoryDetail
          category={{ id: exp.id, name: exp.name, budgeted: exp.amount }}
          categories={activeMonthCategories}
          fixedExpenses={activeMonthFixedExpenses}
          transactions={fixedTransactions}
          deposits={fixedDeposits}
          transfers={monthTransfers}
          spent={expFixedSpent}
          transferAdjustment={transferAdjustments[exp.id] || 0}
          onBack={() => setSelectedFixedExpenseId(null)}
          onDeleteTransaction={deleteTransaction}
          onDeleteTransfer={deleteTransfer}
          onGoToTransaction={handleGoToTransaction}
          accounts={accounts}
        />
      );
    }
  }

  // Render a tool component based on tool id, with back navigation
  const renderTool = (toolId: string, onBack: () => void) => {
    switch (toolId) {
      case 'mortgage-analyzer':
        return <MortgageCalculator planningData={planningData} onBack={onBack} householdId={householdId} onNavigateToProfile={navigateToProfile} onNavigateToCalculator={navigateToCalculator} onNavigateToBudget={navigateToBudget} onNavigateToPlanTool={(t) => navigateToCalculator(t)} />;
      case 'debt-payoff':
        return <DebtPayoffCalculator onBack={onBack} householdId={householdId} onNavigateToProfile={navigateToProfile} onNavigateToBudget={navigateToBudget} onNavigateToPlanTool={(t) => navigateToCalculator(t)} />;
      case 'tax-estimator':
        return <TaxWithholdingCalculator onBack={onBack} householdId={householdId} onNavigateToProfile={navigateToProfile} />;
      case 'life-insurance':
        return <LifeInsuranceAnalysis onBack={onBack} householdId={householdId} onNavigateToProfile={navigateToProfile} onNavigateToBudget={navigateToBudget} onNavigateToPlanTool={(t) => navigateToCalculator(t)} />;
      case 'emergency-fund':
        return <EmergencyFundAnalysis onBack={onBack} householdId={householdId} onNavigateToProfile={navigateToProfile} onNavigateToBudget={navigateToBudget} onNavigateToPlanTool={(t) => navigateToCalculator(t)} householdMembers={householdMembers} />;
      case 'savings-goals':
        return <GoalsPlanner onBack={onBack} householdId={householdId} onNavigateToProfile={navigateToProfile} onNavigateToBudget={navigateToBudget} onNavigateToPlanTool={(t) => navigateToCalculator(t)} />;
      case 'retirement':
        return <RetirementPlanner onBack={onBack} householdId={householdId} onNavigateToProfile={navigateToProfile} onNavigateToBudget={navigateToBudget} onNavigateToPlanTool={(t) => navigateToCalculator(t)} />;
      case 'mortgage-shopping':
        return <MortgageCalculator planningData={planningData} onBack={onBack} householdId={householdId} shoppingOnly onNavigateToProfile={navigateToProfile} onNavigateToBudget={navigateToBudget} onNavigateToPlanTool={(t) => navigateToCalculator(t)} />;
      case 'car-loan':
        return <CarLoanCalculator onBack={onBack} householdId={householdId} shoppingOnly onNavigateToProfile={navigateToProfile} />;
      case 'financial-profile':
        return <CFPProfileView onBack={onBack} householdId={householdId} initialTab={profileInitialTab} />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <SideNav
        activeTab={activeTab}
        onTabChange={handleTabChange}
        activeProfileItem={activeTab === 'profile' && profileSubView !== 'menu' ? (profileSubView as ProfileSidebarItem) : null}
        onSelectProfileItem={(item) => { setActiveTab('profile'); setProfileSubView(item as ProfileSubView); }}
      />
      <div className="flex-1 overflow-y-auto pb-24 lg:pb-10 lg:pt-10 lg:pl-[220px]">
        <AdminMfaBanner
          hidden={activeTab === 'profile' && profileSubView === 'security'}
          onOpenSecurity={() => { setActiveTab('profile'); setProfileSubView('security'); }}
        />
        <div className="lg:px-12 xl:px-16 lg:[&>*]:max-w-none lg:[&>*]:mx-0 lg:[&>*]:w-full">
        {activeTab === 'dashboard' && (
          <Dashboard
            monthLabel={monthLabel}
            onAddTransaction={() => setShowAddTransaction(true)}
            accountSpending={accountSpending}
            totalPayoffs={totalPayoffs}
            unassignedTransactions={unassignedTransactions}
            onEditTransaction={setEditingTransaction}
            categories={activeMonthCategories}
            fixedExpenses={activeMonthFixedExpenses}
            spentByCategory={spentByCategory}
            transferAdjustments={transferAdjustments}
            onSelectCategory={setSelectedCategoryId}
            onSelectFixedExpense={setSelectedFixedExpenseId}
            accounts={accounts}
            monthTransactions={monthTransactions}
            totalBudget={totalBudget}
            totalVariableSpent={totalVariableSpent}
            totalFixedSpent={allFixedSpent}
            onSyncComplete={() => {}}
            onViewAllUnassigned={() => {
              setActivityInitialFilter('unassigned');
              setActiveTab('transactions');
            }}
            onViewAllActivity={() => {
              setActivityInitialFilter(undefined);
              setActiveTab('transactions');
            }}
            topBanner={
              <PostOnboardingCards
                householdId={householdId}
                onOpenBudget={() => { setBudgetSubView('main'); setActiveTab('budget'); }}
                onOpenAccounts={() => { setProfileSubView('bank-connections'); setActiveTab('profile'); }}
              />
            }
            insightsSection={
              <InsightsSection
                insights={insights}
                loading={insightsLoading}
                error={insightsError}
                lastUpdated={insightsLastUpdated}
                hasCached={insightsHasCached}
                onGenerate={generateInsights}
              />
            }
          />
        )}
        {activeTab === 'variable' && (
          <SpendingView
            categories={activeMonthCategories}
            fixedExpenses={activeMonthFixedExpenses}
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
            transfers={monthTransfers}
            categories={activeMonthCategories}
            fixedExpenses={activeMonthFixedExpenses}
            monthLabel={monthLabel}
            onAddTransaction={() => setShowAddTransaction(true)}
            onDeleteTransaction={deleteTransaction}
            onEditTransaction={(tx, splitSiblings) => {
              setEditingTransaction(tx);
              setEditingSplitSiblings(splitSiblings || []);
            }}
            accounts={accounts}
            initialFilter={activityInitialFilter}
          />
        )}

        {/* Budget Tab */}
        {activeTab === 'budget' && budgetSubView === 'main' && (
          <BudgetTabView
            categories={categories}
            fixedExpenses={fixedExpenses}
            currentMonth={currentMonthDate}
            onUpdateCategories={updateCategories}
            onUpdateFixedExpenses={updateFixedExpenses}
            onAddCategoryForMonth={addCategoryForMonth}
            onAddFixedExpenseForMonth={addFixedExpenseForMonth}
            onRemoveCategoryFromMonth={removeCategoryFromMonth}
            onRemoveFixedExpenseFromMonth={removeFixedExpenseFromMonth}
            unassignedCount={unassignedTransactions.length}
            spentByCategory={spentByCategory}
            transferAdjustments={transferAdjustments}
            monthTransactions={monthTransactions}
            planningData={planningData}
            onUpdatePlanningData={updatePlanningData}
            initialViewMonth={budgetTargetMonth}
            onOpenProfile={() => {
              setProfileSubView('menu');
              setActiveTab('profile');
            }}
          />
        )}

        {/* Plan Tab */}
        {activeTab === 'plan' && planSubView === 'menu' && (
          <PlanView
            householdId={householdId}
            onNavigate={(target) => setPlanSubView(target as PlanSubView)}
          />
        )}
        {activeTab === 'plan' && planSubView === 'calculators' && (
          <CalculatorsList
            onBack={() => setPlanSubView('menu')}
            onSelectCalculator={(calc) => setPlanSubView(calc as PlanSubView)}
          />
        )}
        {activeTab === 'plan' && planSubView === 'financial-profile' && (
          <CFPProfileView onBack={() => setPlanSubView('menu')} householdId={householdId} initialTab={profileInitialTab} />
        )}
        {activeTab === 'plan' && ['mortgage-analyzer', 'debt-payoff', 'life-insurance', 'emergency-fund', 'savings-goals', 'retirement'].includes(planSubView) && (
          renderTool(planSubView, () => setPlanSubView('menu'))
        )}
        {activeTab === 'plan' && ['mortgage-shopping', 'car-loan', 'tax-estimator'].includes(planSubView) && (
          renderTool(planSubView, () => setPlanSubView('calculators'))
        )}

        {/* More Tab */}
        {activeTab === 'profile' && profileSubView === 'menu' && (
          <ProfileTab onSelect={tab => setProfileSubView(tab as ProfileSubView)} householdId={householdId} />
        )}
        {activeTab === 'profile' && profileSubView === 'financial-profile' && (
          <CFPProfileView onBack={() => setProfileSubView('menu')} householdId={householdId} initialTab={profileInitialTab} />
        )}
        {activeTab === 'profile' && profileSubView === 'bank-connections' && (
          <BankConnectionView onBack={() => setProfileSubView('menu')} />
        )}
        {activeTab === 'profile' && profileSubView === 'ai-advisor' && (
          <AIAdvisorView
            bigPictureInsights={bigPictureInsights}
            bigPictureLoading={bigPictureLoading}
            bigPictureError={bigPictureError}
            bigPictureLastUpdated={bigPictureLastUpdated}
            bigPictureHasCached={bigPictureHasCached}
            onGenerateBigPicture={generateBigPicture}
            chatMessages={chatMessages}
            chatLoading={chatLoading}
            onSendMessage={sendChatMessage}
            onBack={() => setProfileSubView('menu')}
          />
        )}
        {activeTab === 'profile' && profileSubView === 'trends' && (
          <SpendingTrendsView
            activeMonth={activeMonth}
            categories={activeMonthCategories}
            fixedExpenses={activeMonthFixedExpenses}
            spentByCategory={spentByCategory}
            onBack={() => setProfileSubView('menu')}
          />
        )}
        {activeTab === 'profile' && profileSubView === 'calculators' && (
          <CalculatorsList
            onBack={() => setProfileSubView('menu')}
            onSelectCalculator={(calc) => setProfileSubView(calc as ProfileSubView)}
          />
        )}
        {activeTab === 'profile' && ['mortgage-shopping', 'car-loan', 'tax-estimator'].includes(profileSubView) && (
          renderTool(profileSubView, () => setProfileSubView('calculators'))
        )}
        {activeTab === 'profile' && profileSubView === 'security' && (
          <SecurityView onBack={() => setProfileSubView('menu')} />
        )}
        </div>
      </div>

      <BottomNav activeTab={activeTab} onTabChange={handleTabChange} />

      <AddTransactionSheet
        open={showAddTransaction}
        onOpenChange={setShowAddTransaction}
        categories={activeMonthCategories}
        fixedExpenses={activeMonthFixedExpenses}
        onAdd={handleAddTransactions}
        monthTransactions={monthTransactions}
        accounts={accounts}
        transferAdjustments={transferAdjustments}
      />

      <EditTransactionSheet
        transaction={editingTransaction}
        open={!!editingTransaction}
        onOpenChange={open => { if (!open) { setEditingTransaction(null); setEditingSplitSiblings([]); } }}
        categories={activeMonthCategories}
        fixedExpenses={activeMonthFixedExpenses}
        activeMonth={activeMonth}
        monthTransactions={monthTransactions}
        splitSiblings={editingSplitSiblings}
        accounts={accounts}
        allTransactions={transactions}
        transferAdjustments={transferAdjustments}
      />

      {moveFundsCategoryId && (
        <MoveFundsSheet
          open={!!moveFundsCategoryId}
          onOpenChange={open => { if (!open) setMoveFundsCategoryId(null); }}
          categories={activeMonthCategories}
          fixedExpenses={activeMonthFixedExpenses}
          fromCategoryId={moveFundsCategoryId}
          onMove={addTransfer}
          monthTransactions={monthTransactions}
          transferAdjustments={transferAdjustments}
        />
      )}

      {moveFundsFixedId && (
        <MoveFundsSheet
          open={!!moveFundsFixedId}
          onOpenChange={open => { if (!open) setMoveFundsFixedId(null); }}
          categories={activeMonthCategories}
          fixedExpenses={activeMonthFixedExpenses}
          fromCategoryId={moveFundsFixedId}
          onMove={addTransfer}
          monthTransactions={monthTransactions}
          transferAdjustments={transferAdjustments}
        />
      )}
    </div>
  );
};

export default Index;
