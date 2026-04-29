export type AccountSource = string;

export type TransactionType = 'expense' | 'budget-adjustment' | 'income' | 'deposit' | 'cc-payment' | 'transfer' | 'prior-month';

// Special category slugs for transactions that should be excluded from all budget tracking.
// All ignore-* slugs render as a muted "Ignore" row in the UI; the specific slug carries
// analytic intent (auto-detected vs. user-marked).
export const INCOME_CATEGORY = 'ignore-income';
export const DEPOSIT_CATEGORY = 'ignore-deposit';
export const TRANSFER_CATEGORY = 'ignore-transfer';
export const CC_PAYMENT_CATEGORY = 'ignore-cc-payment';
export const USER_IGNORE_CATEGORY = 'ignore-user';
export const PRIOR_MONTH_CATEGORY = 'ignore-prior-month';

// Set of all slugs that mean "ignore this transaction for budget purposes."
export const IGNORE_CATEGORY_SLUGS = new Set<string>([
  INCOME_CATEGORY,
  DEPOSIT_CATEGORY,
  TRANSFER_CATEGORY,
  CC_PAYMENT_CATEGORY,
  USER_IGNORE_CATEGORY,
  PRIOR_MONTH_CATEGORY,
]);

export type TransactionSource = 'plaid' | 'manual';

export interface Transaction {
  id: string;
  date: string;
  description: string;
  notes: string;
  amount: number;
  categoryId: string;
  account: AccountSource;
  isTransferToSavings: boolean;
  transactionType: TransactionType;
  enteredBy?: string | null;
  budgetMonth: string;
  source: TransactionSource;
}

// A split transaction creates multiple TransactionSplit entries under one parent
export interface TransactionSplit {
  categoryId: string;
  amount: number;
}

export interface BudgetCategory {
  id: string;
  name: string;
  budgeted: number;
  group: 'shared' | 'joe' | 'katie' | 'giving' | 'savings';
  notesRequired: boolean;
  startMonth?: string | null;
  endMonth?: string | null;
}

/** Check if a category requires notes (works for both variable and fixed categories) */
export function categoryRequiresNotes(categoryId: string, categories: BudgetCategory[], fixedExpenses?: FixedExpense[]): boolean {
  if (categories.some(c => c.id === categoryId && c.notesRequired)) return true;
  if (fixedExpenses?.some(e => e.id === categoryId && e.notesRequired)) return true;
  return false;
}

export interface FixedExpense {
  id: string;
  name: string;
  amount: number;
  group: 'bills' | 'savings' | 'tithe';
  notesRequired: boolean;
  startMonth?: string | null;
  endMonth?: string | null;
}

export interface BudgetTransfer {
  id: string;
  date: string;
  fromCategoryId: string;
  toCategoryId: string;
  amount: number;
}

export interface MonthlyBudget {
  month: string; // YYYY-MM
  categories: BudgetCategory[];
  fixedExpenses: FixedExpense[];
  transactions: Transaction[];
}

export type TabId = 'dashboard' | 'variable' | 'transactions' | 'budget' | 'plan' | 'profile';

// Legacy constant kept for reference — use categoryRequiresNotes() instead
export const NOTES_REQUIRED_CATEGORIES = ['random', 'gifts', 'hosting-gifts'];

// The Hosting/Gifts/Random category ID — rolls up into giving totals
export const GIVING_VARIABLE_CATEGORY = 'hosting-gifts';
