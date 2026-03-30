import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildTransactionDescription, findLegacyTransactionGroup, type LegacyTransactionCandidate } from "./matching.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const formatIsoDate = (date: Date) => date.toISOString().slice(0, 10);
const PLAID_SYNC_MUTATION_ERROR = "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION";
const MAX_SYNC_RESTARTS = 2;
const REFRESH_SETTLE_DELAY_MS = 2500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type ImportedTransactionRow = {
  row: {
    household_id: string;
    date: string;
    description: string;
    notes: string;
    amount: number;
    category_slug: string;
    account: string;
    is_transfer_to_savings: boolean;
    transaction_type: string;
    entered_by: null;
    plaid_transaction_id: string | null;
    budget_month: string;
  };
  pending_transaction_id: string | null;
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

    // Fire /transactions/refresh for Wells Fargo items (checking accounts)
    // to get the freshest data. Skip Amex items.
    for (const item of plaidItems) {
      const hasChecking = (item.plaid_accounts || []).some(
        (acc: { type?: string; subtype?: string }) =>
          acc.type === "depository" || acc.subtype === "checking"
      );

      if (hasChecking) {
        try {
          const refreshRes = await fetch(`${plaidBaseUrl}/transactions/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              client_id: PLAID_CLIENT_ID,
              secret: PLAID_SECRET,
              access_token: item.access_token,
            }),
          });
          const refreshData = await refreshRes.json();
          if (!refreshRes.ok) {
            console.error("Plaid transactions/refresh error for item", item.id, refreshData);
          } else {
            console.log("Plaid transactions/refresh triggered for item", item.id);
            await sleep(REFRESH_SETTLE_DELAY_MS);
          }
        } catch (refreshErr) {
          console.error("Plaid transactions/refresh exception for item", item.id, refreshErr);
        }
      }

      let hasMore = true;
      const syncStartCursor = item.cursor || undefined;
      let cursor = syncStartCursor;
      let syncRestartCount = 0;
      let syncPaginationMutated = false;

      const accountMap: Record<string, string> = {};
      for (const acc of item.plaid_accounts || []) {
        if (acc.app_account) {
          accountMap[acc.plaid_account_id] = acc.app_account;
        }
      }

      const resolveAccount = (tx: Record<string, unknown>, fallback: string): string => {
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

      const mapImportedTransaction = (tx: Record<string, unknown>): ImportedTransactionRow | null => {
        const baseAccount = accountMap[tx.account_id as string];
        if (!baseAccount) return null;

        const account = baseAccount.includes("amex")
          ? resolveAccount(tx, baseAccount)
          : baseAccount;
        const plaidAmount = Number(tx.amount);
        const isCredit = plaidAmount < 0;
        const description = buildTransactionDescription(tx);
        const upperDesc = description.toUpperCase();
        const isCcPayment = isCredit && (
          upperDesc.includes("MOBILE PAYMENT") ||
          upperDesc.includes("AMERICAN EXPRESS ACH PMT") ||
          upperDesc.includes("AMEX ACH PMT") ||
          upperDesc.includes("PAYMENT THANK YOU")
        );

        return {
          row: {
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
          },
          pending_transaction_id: (tx.pending_transaction_id as string) || null,
        };
      };

      const persistImportedTransactions = async (txRows: ImportedTransactionRow[]) => {
        let added = 0;
        let modified = 0;
        const deduped: ImportedTransactionRow["row"][] = [];

        for (const txRow of txRows) {
          const { row, pending_transaction_id } = txRow;

          if (row.plaid_transaction_id) {
            const { data: existingById } = await serviceClient
              .from("transactions")
              .select("id")
              .eq("household_id", row.household_id)
              .eq("plaid_transaction_id", row.plaid_transaction_id)
              .limit(1);

            if (existingById && existingById.length > 0) {
              continue;
            }

            if (pending_transaction_id) {
              const { data: pendingMatch } = await serviceClient
                .from("transactions")
                .select("id")
                .eq("household_id", row.household_id)
                .eq("plaid_transaction_id", pending_transaction_id);

              if (pendingMatch && pendingMatch.length > 0) {
                await serviceClient
                  .from("transactions")
                  .update({
                    plaid_transaction_id: row.plaid_transaction_id,
                    date: row.date,
                    amount: row.amount,
                    description: row.description,
                  })
                  .eq("household_id", row.household_id)
                  .eq("plaid_transaction_id", pending_transaction_id);
                modified += pendingMatch.length;
                continue;
              }
            }

            const txDate = new Date(row.date as string);
            const dateMin = new Date(txDate);
            dateMin.setDate(dateMin.getDate() - 3);
            const dateMax = new Date(txDate);
            dateMax.setDate(dateMax.getDate() + 3);
            const { data: legacyCandidates } = await serviceClient
              .from("transactions")
              .select("id, amount, date, description, account, plaid_transaction_id, created_at")
              .eq("household_id", row.household_id)
              .eq("account", row.account)
              .gte("date", dateMin.toISOString().slice(0, 10))
              .lte("date", dateMax.toISOString().slice(0, 10))
              .is("plaid_transaction_id", null)
              .limit(50);

            const legacyMatch = findLegacyTransactionGroup(
              (legacyCandidates || []) as LegacyTransactionCandidate[],
              {
                amount: row.amount,
                date: row.date as string,
                description: row.description as string,
              }
            );

            if (legacyMatch && legacyMatch.length > 0) {
              if (legacyMatch.length === 1) {
                await serviceClient
                  .from("transactions")
                  .update({
                    plaid_transaction_id: row.plaid_transaction_id,
                    date: row.date,
                    amount: row.amount,
                    description: row.description,
                  })
                  .eq("id", legacyMatch[0].id);
              } else {
                await serviceClient
                  .from("transactions")
                  .update({
                    date: row.date,
                    description: row.description,
                  })
                  .in("id", legacyMatch.map((match) => match.id));
              }
              modified += legacyMatch.length;
              continue;
            }
          }

          deduped.push(row);
        }

        if (deduped.length > 0) {
          await serviceClient.from("transactions").insert(deduped);
          added += deduped.length;
        }

        return { added, modified };
      };

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
          if (
            syncData?.error_code === PLAID_SYNC_MUTATION_ERROR &&
            syncRestartCount < MAX_SYNC_RESTARTS
          ) {
            syncRestartCount += 1;
            cursor = syncStartCursor;
            hasMore = true;
            console.warn(
              `Plaid sync pagination changed during refresh for item ${item.id}; restarting from saved cursor (${syncRestartCount}/${MAX_SYNC_RESTARTS})`
            );
            await sleep(REFRESH_SETTLE_DELAY_MS * syncRestartCount);
            continue;
          }

          if (syncData?.error_code === PLAID_SYNC_MUTATION_ERROR) {
            syncPaginationMutated = true;
          }

          console.error("Plaid sync error for item", item.id, syncData);
          break;
        }

        // Process added transactions
        if (syncData.added && syncData.added.length > 0) {
          const txRows = syncData.added
            .map((tx: Record<string, unknown>) => mapImportedTransaction(tx))
            .filter((txRow): txRow is ImportedTransactionRow => Boolean(txRow));

          if (txRows.length > 0) {
            const { added, modified } = await persistImportedTransactions(txRows);
            totalAdded += added;
            totalModified += modified;
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
            const description = buildTransactionDescription(tx);
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

      const pendingStartDate = new Date();
      pendingStartDate.setDate(pendingStartDate.getDate() - 30);
      const pendingEndDate = new Date();
      pendingEndDate.setDate(pendingEndDate.getDate() + 7);
      let pendingOffset = 0;
      const pendingCount = 500;
      let totalPendingTransactions = Infinity;

      while (pendingOffset < totalPendingTransactions) {
        const pendingRes = await fetch(`${plaidBaseUrl}/transactions/get`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: PLAID_CLIENT_ID,
            secret: PLAID_SECRET,
            access_token: item.access_token,
            start_date: formatIsoDate(pendingStartDate),
            end_date: formatIsoDate(pendingEndDate),
            options: {
              count: pendingCount,
              offset: pendingOffset,
              include_personal_finance_category: false,
            },
          }),
        });

        const pendingData = await pendingRes.json();

        if (!pendingRes.ok) {
          console.error("Plaid pending fetch error for item", item.id, pendingData);
          break;
        }

        totalPendingTransactions = Number(pendingData.total_transactions) || 0;

        const recentRows = (pendingData.transactions || [])
          .filter((tx: Record<string, unknown>) => syncPaginationMutated || tx.pending === true)
          .map((tx: Record<string, unknown>) => mapImportedTransaction(tx))
          .filter((txRow: ImportedTransactionRow | null): txRow is ImportedTransactionRow => Boolean(txRow));

        if (syncPaginationMutated && recentRows.length > 0) {
          console.warn(
            `Falling back to recent transactions/get import for item ${item.id} after sync pagination kept mutating`
          );
        }

        if (recentRows.length > 0) {
          const { added, modified } = await persistImportedTransactions(recentRows);
          totalAdded += added;
          totalModified += modified;
        }

        pendingOffset += pendingCount;
        if ((pendingData.transactions || []).length < pendingCount) {
          break;
        }
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
