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

    // Get the household's active budget month
    const { data: household } = await serviceClient
      .from("households")
      .select("active_month")
      .eq("id", profile.household_id)
      .single();
    const activeBudgetMonth = (household as any)?.active_month || new Date().toISOString().slice(0, 7);

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
              // Store the raw signed amount so credits/payments reduce account balances
              const isCredit = plaidAmount < 0;
              const merchantName = (tx.merchant_name as string) || "";
              const txName = (tx.name as string) || "";
              // For Venmo, prefer the full tx name which includes the person's name
              const description = (merchantName.toLowerCase() === "venmo" && txName) ? txName : (merchantName || txName);
              const upperDesc = description.toUpperCase();
              // Auto-detect CC payments
              const isCcPayment = isCredit && (
                upperDesc.includes("MOBILE PAYMENT") ||
                upperDesc.includes("AMERICAN EXPRESS ACH PMT") ||
                upperDesc.includes("AMEX ACH PMT") ||
                upperDesc.includes("PAYMENT THANK YOU")
              );
              return {
                household_id: profile.household_id,
                date: tx.date as string,
                description,
                notes: "",
                amount: plaidAmount,
                category_slug: isCcPayment ? "cc-payment" : isCredit ? "ignore-income" : "unassigned",
                account,
                is_transfer_to_savings: false,
                transaction_type: isCcPayment ? "cc-payment" : isCredit ? "income" : "expense",
                entered_by: null,
                plaid_transaction_id: (tx.transaction_id as string) || null,
                budget_month: activeBudgetMonth,
              };
            });

          if (txRows.length > 0) {
            // Deduplicate by Plaid transaction ID, with fallback to backfill existing rows
            const deduped: typeof txRows = [];
            for (const row of txRows) {
              if (row.plaid_transaction_id) {
                // Check if this exact Plaid transaction ID already exists
                const { data: existingById } = await serviceClient
                  .from("transactions")
                  .select("id")
                  .eq("household_id", row.household_id)
                  .eq("plaid_transaction_id", row.plaid_transaction_id)
                  .limit(1);
                if (existingById && existingById.length > 0) {
                  continue; // Already imported with this Plaid ID — skip
                }

                // Check if a legacy row exists without a plaid_transaction_id (backfill it)
                // Use ±3 day tolerance since manually entered dates may differ from Plaid dates
                const txDate = new Date(row.date as string);
                const dateMin = new Date(txDate);
                dateMin.setDate(dateMin.getDate() - 3);
                const dateMax = new Date(txDate);
                dateMax.setDate(dateMax.getDate() + 3);
                const { data: legacyMatch } = await serviceClient
                  .from("transactions")
                  .select("id")
                  .eq("household_id", row.household_id)
                  .gte("date", dateMin.toISOString().slice(0, 10))
                  .lte("date", dateMax.toISOString().slice(0, 10))
                  .eq("amount", row.amount)
                  .eq("account", row.account)
                  .is("plaid_transaction_id", null)
                  .limit(1);
                if (legacyMatch && legacyMatch.length > 0) {
                  // Backfill the plaid_transaction_id on the existing row
                  await serviceClient
                    .from("transactions")
                    .update({ plaid_transaction_id: row.plaid_transaction_id })
                    .eq("id", legacyMatch[0].id);
                  continue;
                }
              }
              deduped.push(row);
            }
            if (deduped.length > 0) {
              await serviceClient.from("transactions").insert(deduped);
              totalAdded += deduped.length;
            }
          }
        }

        // Process removed transactions (e.g. pending → posted transition removes old pending ID)
        if (syncData.removed && syncData.removed.length > 0) {
          const removedIds = syncData.removed.map((r: Record<string, unknown>) => r.transaction_id as string).filter(Boolean);
          if (removedIds.length > 0) {
            const { data: removedRows } = await serviceClient
              .from("transactions")
              .select("id, plaid_transaction_id")
              .eq("household_id", profile.household_id)
              .in("plaid_transaction_id", removedIds);
            if (removedRows && removedRows.length > 0) {
              await serviceClient
                .from("transactions")
                .delete()
                .in("id", removedRows.map((r: { id: string }) => r.id));
              totalRemoved += removedRows.length;
            }
          }
        }

        // Process modified transactions (update date/amount/description if changed)
        if (syncData.modified && syncData.modified.length > 0) {
          for (const tx of syncData.modified) {
            const plaidTxId = tx.transaction_id as string;
            if (!plaidTxId) continue;
            const merchantName = (tx.merchant_name as string) || "";
            const txName = (tx.name as string) || "";
            const description = (merchantName.toLowerCase() === "venmo" && txName) ? txName : (merchantName || txName);
            await serviceClient
              .from("transactions")
              .update({
                date: tx.date as string,
                amount: tx.amount as number,
                description,
              })
              .eq("household_id", profile.household_id)
              .eq("plaid_transaction_id", plaidTxId);
            totalModified++;
          }
        }

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
