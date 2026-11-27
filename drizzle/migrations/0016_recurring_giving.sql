CREATE TABLE public.giving_recurring (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL DEFAULT public.get_household_id() REFERENCES public.households(id) ON DELETE CASCADE,
  recipient text NOT NULL,
  type text NOT NULL CHECK (type IN ('Church','Charity - Ministry','Charity - Other','Generosity - see notes')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  kind text NOT NULL DEFAULT 'fixed' CHECK (kind IN ('fixed','bucket')),
  start_month date NOT NULL CHECK (extract(day FROM start_month) = 1),
  end_month date CHECK (end_month IS NULL OR (extract(day FROM end_month) = 1 AND end_month >= start_month)),
  sort_order integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.giving_recurring TO authenticated;
GRANT ALL ON public.giving_recurring TO service_role;
ALTER TABLE public.giving_recurring ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Household reads recurring giving" ON public.giving_recurring FOR SELECT TO authenticated USING (household_id = (select public.get_household_id()));
CREATE POLICY "Household adds recurring giving" ON public.giving_recurring FOR INSERT TO authenticated WITH CHECK (household_id = (select public.get_household_id()));
CREATE POLICY "Household updates recurring giving" ON public.giving_recurring FOR UPDATE TO authenticated USING (household_id = (select public.get_household_id())) WITH CHECK (household_id = (select public.get_household_id()));
CREATE POLICY "Household deletes recurring giving" ON public.giving_recurring FOR DELETE TO authenticated USING (household_id = (select public.get_household_id()));
CREATE INDEX giving_recurring_household_idx ON public.giving_recurring (household_id, sort_order);
CREATE TRIGGER giving_recurring_household BEFORE INSERT ON public.giving_recurring FOR EACH ROW EXECUTE FUNCTION public.set_household_id_default();
CREATE TRIGGER giving_recurring_updated BEFORE UPDATE ON public.giving_recurring FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.giving_entries
  ADD COLUMN recurring_id uuid REFERENCES public.giving_recurring(id) ON DELETE SET NULL,
  ADD COLUMN recurring_month date,
  ADD COLUMN unassigned boolean NOT NULL DEFAULT false,
  ADD COLUMN skipped boolean NOT NULL DEFAULT false,
  ADD COLUMN split_from uuid;
CREATE UNIQUE INDEX giving_entries_recurring_month_uidx ON public.giving_entries (recurring_id, recurring_month) WHERE recurring_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.generate_recurring_giving()
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE cur date := date_trunc('month', (now() AT TIME ZONE 'America/New_York'))::date; n integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  INSERT INTO public.giving_entries (household_id, gift_date, type, recipient, amount, notes, recurring_id, recurring_month, unassigned)
  SELECT r.household_id, m::date, r.type, r.recipient, r.amount, r.notes, r.id, m::date, r.kind = 'bucket'
  FROM public.giving_recurring r
  CROSS JOIN LATERAL generate_series(r.start_month, least(coalesce(r.end_month, cur), cur), interval '1 month') m
  WHERE r.household_id = public.get_household_id()
  ON CONFLICT (recurring_id, recurring_month) WHERE recurring_id IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.assign_giving_bucket(_entry_id uuid, _gifts jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE e public.giving_entries%ROWTYPE; g jsonb; i int := 0; total numeric := 0;
BEGIN
  SELECT * INTO e FROM public.giving_entries WHERE id = _entry_id AND unassigned FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This bucket is no longer available'; END IF;
  IF jsonb_typeof(_gifts) <> 'array' OR jsonb_array_length(_gifts) = 0 THEN RAISE EXCEPTION 'Add at least one gift'; END IF;
  FOR g IN SELECT * FROM jsonb_array_elements(_gifts) LOOP
    IF coalesce((g->>'amount')::numeric, 0) <= 0 OR btrim(coalesce(g->>'recipient','')) = '' THEN RAISE EXCEPTION 'Each gift needs a recipient and amount'; END IF;
    total := total + (g->>'amount')::numeric;
  END LOOP;
  IF total > e.amount THEN RAISE EXCEPTION 'Gifts add up to more than the bucket'; END IF;
  FOR g IN SELECT * FROM jsonb_array_elements(_gifts) LOOP
    IF i = 0 THEN
      UPDATE public.giving_entries SET recipient = btrim(g->>'recipient'), type = g->>'type', amount = round((g->>'amount')::numeric, 2),
        notes = coalesce(nullif(btrim(coalesce(g->>'notes','')), ''), notes), unassigned = false WHERE id = e.id;
    ELSE
      INSERT INTO public.giving_entries (household_id, gift_date, type, recipient, amount, notes, split_from)
      VALUES (e.household_id, e.gift_date, g->>'type', btrim(g->>'recipient'), round((g->>'amount')::numeric, 2), nullif(btrim(coalesce(g->>'notes','')), ''), e.id);
    END IF;
    i := i + 1;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.change_recurring_amount(_id uuid, _amount numeric, _effective date)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE r public.giving_recurring%ROWTYPE; eff date := date_trunc('month', _effective)::date; nid uuid;
BEGIN
  SELECT * INTO r FROM public.giving_recurring WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item not found'; END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF eff <= r.start_month THEN
    UPDATE public.giving_recurring SET amount = round(_amount, 2) WHERE id = _id;
    RETURN _id;
  END IF;
  UPDATE public.giving_recurring SET end_month = (eff - interval '1 month')::date WHERE id = _id;
  INSERT INTO public.giving_recurring (household_id, recipient, type, amount, kind, start_month, end_month, sort_order, notes)
  VALUES (r.household_id, r.recipient, r.type, round(_amount, 2), r.kind, eff, CASE WHEN r.end_month >= eff THEN r.end_month END, r.sort_order, r.notes)
  RETURNING id INTO nid;
  RETURN nid;
END $$;

REVOKE EXECUTE ON FUNCTION public.generate_recurring_giving() FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.assign_giving_bucket(uuid, jsonb) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.change_recurring_amount(uuid, numeric, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.generate_recurring_giving() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assign_giving_bucket(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.change_recurring_amount(uuid, numeric, date) TO authenticated, service_role;