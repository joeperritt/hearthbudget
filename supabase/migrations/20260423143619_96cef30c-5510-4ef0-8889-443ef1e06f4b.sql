CREATE OR REPLACE FUNCTION public._tmp_list_vault_secrets()
RETURNS TABLE(name text)
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS
$$ SELECT name FROM vault.secrets; $$;