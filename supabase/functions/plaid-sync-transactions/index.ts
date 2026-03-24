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

    let totalAdded = 0;
    let totalModified = 0;
    let totalRemoved = 0;

    for (const item of plaidItems) {
      let hasMore = true;
      let cursor = item.cursor || undefined;

      while (hasMore) {
        const syncBody: Record<string, unknown> = {
          client_id: PLAID_CLIENT_ID,
          secret: PLAID_SECRET,
          access_token: item.access_token,
        };
        if (cursor) syncBody.cursor = cursor;

        const syncRes = await fetch(`${plaidBaseUrl}/transactions/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(syncBody),
        });

        const syncData = await syncRes.json();

        if (!syncRes.ok) {
          console.error("Plaid sync error for item", item.id, syncData);
          break;
        }

        // Build account mapping: plaid_account_id → app_account
        const accountMap: Record<string, string> = {};
        for (const acc of item.plaid_accounts || []) {
          if (acc.app_account) {
            accountMap[acc.plaid_account_id] = acc.app_account;
          }
        }

        // Helper: resolve the correct app account using cardholder name
        const resolveAccount = (tx: Record<string, unknown>, fallback: string): string => {
          // Plaid may provide account_owner or cardholder info
          const owner = ((tx.account_owner as string) || "").toLowerCase();
          const txName = ((tx.name as string) || "").toLowerCase();
          const searchText = owner || txName;

          if (searchText.includes("katherine") || searchText.includes("katie")) {
            return "katie-amex";
          }
          if (searchText.includes("joseph") || searchText.includes("joe")) {
            return "joe-amex";
          }
          return fallback;
        };

        // Process added transactions
        if (syncData.added && syncData.added.length > 0) {
          const txRows = syncData.added
            .filter((tx: Record<string, unknown>) => {
              const accId = tx.account_id as string;
              return accountMap[accId]; // Only import mapped accounts
            })
            .map((tx: Record<string, unknown>) => {
              const baseAccount = accountMap[tx.account_id as string];
              // For Amex accounts, resolve by cardholder name
              const account = baseAccount.includes("amex")
                ? resolveAccount(tx, baseAccount)
                : baseAccount;
              const plaidAmount = tx.amount as number;
              // Plaid: positive = money leaving (debit/expense), negative = money entering (credit/deposit/payment)
              const isIncome = plaidAmount < 0;
              return {
                household_id: profile.household_id,
                date: tx.date as string,
                description: (tx.merchant_name as string) || (tx.name as string) || "",
                notes: "",
                amount: Math.abs(plaidAmount),
                category_slug: isIncome ? "ignore-income" : "unassigned",
                account,
                is_transfer_to_savings: false,
                transaction_type: isIncome ? "income" : "expense",
                entered_by: null,
              };
            });

          if (txRows.length > 0) {
            await serviceClient.from("transactions").insert(txRows);
            totalAdded += txRows.length;
          }
        }

        totalModified += (syncData.modified || []).length;
        totalRemoved += (syncData.removed || []).length;

        hasMore = syncData.has_more;
        cursor = syncData.next_cursor;
      }

      // Update cursor
      if (cursor) {
        await serviceClient
          .from("plaid_items")
          .update({ cursor, last_synced_at: new Date().toISOString() })
          .eq("id", item.id);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        added: totalAdded,
        modified: totalModified,
        removed: totalRemoved,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error syncing transactions:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
