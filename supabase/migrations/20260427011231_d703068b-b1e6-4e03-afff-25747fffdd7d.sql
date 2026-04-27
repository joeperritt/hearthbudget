ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_transaction_type_check;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_transaction_type_check
  CHECK (transaction_type = ANY (ARRAY[
    'expense'::text,
    'budget-adjustment'::text,
    'income'::text,
    'deposit'::text,
    'cc-payment'::text,
    'unassigned'::text,
    'transfer'::text,
    'prior-month'::text
  ]));