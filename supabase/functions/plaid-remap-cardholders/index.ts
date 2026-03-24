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
      .eq("user_id", claimsData.claims.sub)
      .single();

    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get all plaid items for this household
    const { data: plaidItems } = await serviceClient
      .from("plaid_items")
      .select("*, plaid_accounts(*)")
      .eq("household_id", profile.household_id);

    if (!plaidItems || plaidItems.length === 0) {
      return new Response(JSON.stringify({ error: "No linked bank accounts" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let totalUpdated = 0;

    for (const item of plaidItems) {
      // Check if any account is an Amex
      const hasAmex = (item.plaid_accounts || []).some(
        (acc: Record<string, unknown>) => ((acc.app_account as string) || "").includes("amex")
      );
      if (!hasAmex) continue;

      // Use /transactions/get to pull all historical transactions with account_owner
      let offset = 0;
      const count = 500;
      let totalTransactions = Infinity;

      while (offset < totalTransactions) {
        const getRes = await fetch(`${plaidBaseUrl}/transactions/get`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: PLAID_CLIENT_ID,
            secret: PLAID_SECRET,
            access_token: item.access_token,
            start_date: "2020-01-01",
            end_date: new Date().toISOString().split("T")[0],
            options: {
              count,
              offset,
              include_personal_finance_category: false,
            },
          }),
        });

        const getData = await getRes.json();
        if (!getRes.ok) {
          console.error("Plaid get error for item", item.id, getData);
          break;
        }

        totalTransactions = getData.total_transactions;

        // For each transaction, check cardholder and update matching DB records
        for (const tx of getData.transactions) {
          const owner = (tx.account_owner || "").toLowerCase();
          const txName = (tx.name || "").toLowerCase();
          const searchText = owner || txName;

          let newAccount: string | null = null;
          if (searchText.includes("katherine") || searchText.includes("katie")) {
            newAccount = "katie-amex";
          } else if (searchText.includes("joseph") || searchText.includes("joe")) {
            newAccount = "joe-amex";
          }

          if (!newAccount) continue;

          // Match by date + amount + description in our DB
          const merchantName = tx.merchant_name || tx.name || "";
          const amount = Math.abs(tx.amount);
          const date = tx.date;

          const { data: matchingTxs } = await serviceClient
            .from("transactions")
            .select("id, account")
            .eq("household_id", profile.household_id)
            .eq("date", date)
            .eq("amount", amount)
            .eq("description", merchantName);

          if (matchingTxs && matchingTxs.length > 0) {
            for (const dbTx of matchingTxs) {
              if (dbTx.account !== newAccount && dbTx.account.includes("amex")) {
                await serviceClient
                  .from("transactions")
                  .update({ account: newAccount })
                  .eq("id", dbTx.id);
                totalUpdated++;
              }
            }
          }
        }

        offset += count;
      }
    }

    return new Response(
      JSON.stringify({ success: true, updated: totalUpdated }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error remapping cardholders:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
