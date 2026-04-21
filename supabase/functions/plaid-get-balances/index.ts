import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const PLAID_CLIENT_ID = Deno.env.get("PLAID_CLIENT_ID");
    const PLAID_SECRET = Deno.env.get("PLAID_SECRET");
    const PLAID_ENV = Deno.env.get("PLAID_ENV") || "production";

    if (!PLAID_CLIENT_ID || !PLAID_SECRET) {
      return new Response(JSON.stringify({ error: "Plaid credentials not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const plaidBaseUrl =
      PLAID_ENV === "sandbox"
        ? "https://sandbox.plaid.com"
        : PLAID_ENV === "development"
        ? "https://development.plaid.com"
        : "https://production.plaid.com";

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get household_id
    const { data: profile } = await serviceClient
      .from("profiles")
      .select("household_id")
      .eq("user_id", user.id)
      .single();

    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get all plaid items
    const { data: plaidItems } = await serviceClient
      .from("plaid_items")
      .select("*, plaid_accounts(*)")
      .eq("household_id", profile.household_id);

    // Hydrate access tokens from secure plaid_tokens table
    if (plaidItems && plaidItems.length > 0) {
      const itemIds = plaidItems.map((it: Record<string, unknown>) => it.id as string);
      const { data: tokenRows } = await serviceClient
        .from("plaid_tokens")
        .select("plaid_item_id, access_token")
        .in("plaid_item_id", itemIds);
      const tokenMap: Record<string, string> = {};
      for (const t of tokenRows || []) {
        tokenMap[(t as Record<string, string>).plaid_item_id] = (t as Record<string, string>).access_token;
      }
      for (const it of plaidItems) {
        (it as Record<string, unknown>).access_token = tokenMap[(it as Record<string, string>).id] || null;
      }
    }

    if (!plaidItems || plaidItems.length === 0) {
      return new Response(JSON.stringify({ balances: [] }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const balances: Array<{
      account_name: string;
      app_account: string | null;
      current: number;
      available: number | null;
      type: string;
      subtype: string | null;
      mask: string | null;
    }> = [];

    for (const item of plaidItems) {
      if (!item.access_token) {
        console.warn("Skipping balance fetch — no token in plaid_tokens", item.id);
        continue;
      }
      // Skip items where all accounts are checking/savings — avoids Plaid balance errors on some banks
      const mappedAccounts = (item.plaid_accounts || []).filter((a: { app_account: string | null; account_category?: string }) => a.app_account || a.account_category);
      const allDepository = mappedAccounts.length > 0 && mappedAccounts.every((a: { account_category?: string; app_account?: string | null }) => 
        a.account_category === 'checking' || a.account_category === 'savings' || a.app_account === 'checking'
      );
      if (allDepository) {
        console.log("Skipping balance fetch for depository-only item", item.id);
        continue;
      }

      const balRes = await fetch(`${plaidBaseUrl}/accounts/balance/get`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: PLAID_CLIENT_ID,
          secret: PLAID_SECRET,
          access_token: item.access_token,
        }),
      });

      const balData = await balRes.json();

      if (!balRes.ok) {
        console.error("Plaid balance error for item", item.id, balData);
        continue;
      }

      // Build account mapping
      const accountMap: Record<string, { app_account: string | null }> = {};
      for (const acc of item.plaid_accounts || []) {
        accountMap[acc.plaid_account_id] = { app_account: acc.app_account };
      }

      for (const acc of balData.accounts || []) {
        const mapped = accountMap[acc.account_id];
        balances.push({
          account_name: acc.official_name || acc.name,
          app_account: mapped?.app_account || null,
          current: acc.balances.current,
          available: acc.balances.available,
          type: acc.type,
          subtype: acc.subtype,
          mask: acc.mask,
        });
      }
    }

    return new Response(JSON.stringify({ balances }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error getting balances:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
