import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { BudgetCategory, FixedExpense, Transaction } from '@/types/budget';
import { differenceInDays, startOfMonth, addMonths, format } from 'date-fns';

export interface Insight {
  type: 'warning' | 'encouragement' | 'tip' | 'giving' | 'savings';
  title: string;
  body: string;
}

interface BudgetSummary {
  currentMonth: string;
  daysRemaining: number;
  totalBudget: number;
  totalCommitted: number;
  variableCategories: { name: string; budgeted: number; spent: number; percentUsed: number }[];
  fixedBills: { name: string; amount: number; paid: boolean; amountPaid: number }[];
  totalGiving: number;
  givingPercentOfSpending: number;
  savingsBuckets: { name: string; amount: number; contributed: number }[];
  accountTotals: { label: string; amount: number }[];
  unassignedCount: number;
}

function buildBudgetSummary(
  activeMonth: string,
  categories: BudgetCategory[],
  fixedExpenses: FixedExpense[],
  monthTransactions: Transaction[],
  spentByCategory: Record<string, number>,
  transferAdjustments: Record<string, number>,
  accountSpending: { label: string; amount: number }[],
  unassignedCount: number,
  totalBudget: number,
): BudgetSummary {
  const today = new Date();
  const nextMonth = startOfMonth(addMonths(today, 1));
  const daysRemaining = differenceInDays(nextMonth, today);

  const variableCategories = categories.map(c => {
    const raw = spentByCategory[c.id] || 0;
    const adj = transferAdjustments[c.id] || 0;
    const spent = raw;
    const effectiveBudget = c.budgeted + adj;
    return {
      name: c.name,
      budgeted: effectiveBudget,
      spent,
      percentUsed: effectiveBudget > 0 ? Math.round((spent / effectiveBudget) * 100) : 0,
    };
  });

  const fixedBills = fixedExpenses.map(e => {
    const spent = spentByCategory[e.id] || 0;
    return {
      name: e.name,
      amount: e.amount,
      paid: spent >= e.amount * 0.95,
      amountPaid: spent,
    };
  });

  const givingCats = categories.filter(c => c.group === 'giving');
  const givingFixed = fixedExpenses.filter(e => e.group === 'tithe');
  const totalGivingSpent = [...givingCats, ...givingFixed].reduce((s, c) => s + (spentByCategory[c.id] || 0), 0);
  const totalSpent = Object.values(spentByCategory).reduce((s, v) => s + v, 0);

  const savingsBuckets = fixedExpenses.filter(e => e.group === 'savings').map(e => ({
    name: e.name,
    amount: e.amount,
    contributed: spentByCategory[e.id] || 0,
  }));

  const totalCommitted = totalSpent;

  return {
    currentMonth: format(new Date(activeMonth + '-01'), 'MMMM yyyy'),
    daysRemaining,
    totalBudget,
    totalCommitted,
    variableCategories,
    fixedBills,
    totalGiving: totalGivingSpent,
    givingPercentOfSpending: totalSpent > 0 ? Math.round((totalGivingSpent / totalSpent) * 100) : 0,
    savingsBuckets,
    accountTotals: accountSpending,
    unassignedCount,
  };
}

export function useBudgetInsights(
  activeMonth: string,
  categories: BudgetCategory[],
  fixedExpenses: FixedExpense[],
  monthTransactions: Transaction[],
  spentByCategory: Record<string, number>,
  transferAdjustments: Record<string, number>,
  accountSpending: { label: string; amount: number }[],
  unassignedCount: number,
  totalBudget: number,
) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const cacheKey = useRef<string>('');

  const summary = useCallback(() => buildBudgetSummary(
    activeMonth, categories, fixedExpenses, monthTransactions,
    spentByCategory, transferAdjustments, accountSpending, unassignedCount, totalBudget,
  ), [activeMonth, categories, fixedExpenses, monthTransactions, spentByCategory, transferAdjustments, accountSpending, unassignedCount, totalBudget]);

  const fetchInsights = useCallback(async (force = false) => {
    const key = JSON.stringify({ activeMonth, txCount: monthTransactions.length });
    if (!force && key === cacheKey.current && insights.length > 0) return;
    cacheKey.current = key;

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('budget-insights', {
        body: { budgetSummary: summary() },
      });
      if (error) throw error;
      const content = data?.content || '';
      // Parse JSON from the response - might be wrapped in markdown code fences
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Insight[];
        setInsights(parsed);
        setLastUpdated(new Date());
      }
    } catch (e) {
      console.error('Failed to fetch insights:', e);
    } finally {
      setLoading(false);
    }
  }, [summary, activeMonth, monthTransactions.length, insights.length]);

  const sendChatMessage = useCallback(async (message: string) => {
    const userMsg = { role: 'user' as const, content: message };
    const newMessages = [...chatMessages, userMsg];
    setChatMessages(newMessages);
    setChatLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('budget-insights', {
        body: { budgetSummary: summary(), chatMessages: newMessages },
      });
      if (error) throw error;
      const content = data?.content || 'Sorry, I couldn\'t generate a response.';
      setChatMessages(prev => [...prev, { role: 'assistant', content }]);
    } catch (e) {
      console.error('Chat error:', e);
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Please try again.' }]);
    } finally {
      setChatLoading(false);
    }
  }, [chatMessages, summary]);

  return {
    insights,
    loading,
    lastUpdated,
    fetchInsights,
    chatMessages,
    chatLoading,
    sendChatMessage,
    clearChat: () => setChatMessages([]),
  };
}
