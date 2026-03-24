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

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const PLAID_CLIENT_ID = Deno.env.get("PLAID_CLIENT_ID");
    const PLAID_SECRET = Deno.env.get("PLAID_SECRET");
    const PLAID_ENV = Deno.env.get("PLAID_ENV") || "production";

    const plaidBaseUrl =
      PLAID_ENV === "sandbox" ? "https://sandbox.plaid.com"
        : PLAID_ENV === "development" ? "https://development.plaid.com"
        : "https://production.plaid.com";

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: profile } = await serviceClient
      .from("profiles")
      .select("household_id")
      .eq("user_id", claimsData.claims.sub)
      .single();

    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get checking account plaid items
    const { data: plaidItems } = await serviceClient
      .from("plaid_items")
      .select("*, plaid_accounts(*)")
      .eq("household_id", profile.household_id);

    if (!plaidItems || plaidItems.length === 0) {
      return new Response(JSON.stringify({ error: "No plaid items" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find the checking account item
    let checkingItem = null;
    let checkingPlaidAccountId = null;
    for (const item of plaidItems) {
      for (const acc of item.plaid_accounts || []) {
        if (acc.app_account === "checking") {
          checkingItem = item;
          checkingPlaidAccountId = acc.plaid_account_id;
          break;
        }
      }
      if (checkingItem) break;
    }

    if (!checkingItem || !checkingPlaidAccountId) {
      return new Response(JSON.stringify({ error: "No checking account found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch transactions from Plaid for the date range of our Venmo transactions
    const res = await fetch(`${plaidBaseUrl}/transactions/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: PLAID_CLIENT_ID,
        secret: PLAID_SECRET,
        access_token: checkingItem.access_token,
        start_date: "2025-12-01",
        end_date: "2026-03-31",
        options: {
          account_ids: [checkingPlaidAccountId],
          count: 500,
        },
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error("Plaid error:", data);
      return new Response(JSON.stringify({ error: "Plaid API error", details: data }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Filter for Venmo transactions where name has more info than merchant_name
    const venmoTxns = (data.transactions || []).filter((tx: Record<string, unknown>) => {
      const merchant = ((tx.merchant_name as string) || "").toLowerCase();
      const name = ((tx.name as string) || "");
      return merchant === "venmo" && name.toLowerCase() !== "venmo" && name.length > 0;
    });

    let updated = 0;
    for (const tx of venmoTxns) {
      const plaidAmount = tx.amount as number;
      const plaidDate = tx.date as string;
      const fullName = tx.name as string;

      // Find matching DB transaction by date, amount, account=checking, description=Venmo
      const { data: matches } = await serviceClient
        .from("transactions")
        .select("id")
        .eq("household_id", profile.household_id)
        .eq("account", "checking")
        .eq("description", "Venmo")
        .eq("date", plaidDate)
        .eq("amount", plaidAmount)
        .limit(1);

      if (matches && matches.length > 0) {
        await serviceClient
          .from("transactions")
          .update({ description: fullName })
          .eq("id", matches[0].id);
        updated++;
      }
    }

    return new Response(
      JSON.stringify({ success: true, venmoFound: venmoTxns.length, updated }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
