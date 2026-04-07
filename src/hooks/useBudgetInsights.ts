import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { BudgetCategory, FixedExpense, GIVING_VARIABLE_CATEGORY, Transaction } from '@/types/budget';
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
  totalGivingBudgeted: number;
  givingBreakdown: { name: string; budgeted: number; spent: number; type: 'fixed' | 'variable' }[];
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
  const totalGivingBudgeted = givingCats.reduce((s, c) => s + c.budgeted, 0) + givingFixed.reduce((s, e) => s + e.amount, 0);
  const totalSpent = Object.values(spentByCategory).reduce((s, v) => s + v, 0);

  const savingsBuckets = fixedExpenses.filter(e => e.group === 'savings').map(e => ({
    name: e.name,
    amount: e.amount,
    contributed: spentByCategory[e.id] || 0,
  }));

  const givingBreakdown = [
    ...givingFixed.map(e => ({ name: e.name, budgeted: e.amount, spent: spentByCategory[e.id] || 0, type: 'fixed' as const })),
    ...givingCats.map(c => ({ name: c.name, budgeted: c.budgeted, spent: spentByCategory[c.id] || 0, type: 'variable' as const })),
  ];

  return {
    currentMonth: format(new Date(activeMonth + '-01'), 'MMMM yyyy'),
    daysRemaining,
    totalBudget,
    totalCommitted: totalSpent,
    variableCategories,
    fixedBills,
    totalGiving: totalGivingSpent,
    totalGivingBudgeted,
    givingBreakdown,
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
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const cacheKey = useRef<string>('');
  const insightsRef = useRef<Insight[]>([]);

  const summary = useCallback(() => buildBudgetSummary(
    activeMonth, categories, fixedExpenses, monthTransactions,
    spentByCategory, transferAdjustments, accountSpending, unassignedCount, totalBudget,
  ), [activeMonth, categories, fixedExpenses, monthTransactions, spentByCategory, transferAdjustments, accountSpending, unassignedCount, totalBudget]);

  const fetchInsights = useCallback(async (force = false) => {
    const key = JSON.stringify({ activeMonth, txCount: monthTransactions.length });
    if (!force && key === cacheKey.current && insightsRef.current.length > 0) return;
    cacheKey.current = key;

    setLoading(true);
    setError(null);
    try {
      console.log('[Insights] Calling budget-insights edge function...');
      const { data, error: fnError } = await supabase.functions.invoke('budget-insights', {
        body: { budgetSummary: summary() },
      });
      
      if (fnError) {
        console.error('[Insights] Function error:', fnError);
        throw new Error(fnError.message || 'Edge function returned an error');
      }
      
      if (!data) {
        throw new Error('No data returned from edge function');
      }

      console.log('[Insights] Response received:', typeof data, data);
      
      const content = data?.content || '';
      if (!content) {
        throw new Error('Empty content in response');
      }

      // Parse JSON from the response - might be wrapped in markdown code fences
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Insight[];
        setInsights(parsed);
        insightsRef.current = parsed;
        setLastUpdated(new Date());
        console.log('[Insights] Parsed', parsed.length, 'insights');
      } else {
        throw new Error('Could not parse insights JSON from response');
      }
    } catch (e: any) {
      const msg = e?.message || 'Unknown error generating insights';
      console.error('[Insights] Failed:', msg, e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [summary, activeMonth, monthTransactions.length]);

  const sendChatMessage = useCallback(async (message: string) => {
    const userMsg = { role: 'user' as const, content: message };
    const newMessages = [...chatMessages, userMsg];
    setChatMessages(newMessages);
    setChatLoading(true);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('budget-insights', {
        body: { budgetSummary: summary(), chatMessages: newMessages },
      });
      if (fnError) throw fnError;
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
    error,
    lastUpdated,
    fetchInsights,
    chatMessages,
    chatLoading,
    sendChatMessage,
    clearChat: () => setChatMessages([]),
  };
}
