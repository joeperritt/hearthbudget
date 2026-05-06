// Shared per-household Plaid sync logic. Used by:
//   - plaid-sync-transactions  (manual / on-open trigger by an authenticated user)
//   - auto-sync-all-households (scheduled cron, runs across all households)
//
// IMPORTANT: this helper updates plaid_items.requires_reconnect, sync_failure_count,
// last_sync_attempt_at, last_successful_sync_at, last_sync_error so the UI can
// surface health to users.

import { buildTransactionDescription, extractOriginalDescription, findLegacyTransactionGroup, type LegacyTransactionCandidate } from "./matching.ts";
// matching.ts lives next to this file in supabase/functions/_shared/

const PLAID_SYNC_MUTATION_ERROR = "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION";
const MAX_SYNC_RESTARTS = 2;
const REFRESH_SETTLE_DELAY_MS = 2500;
const FAILURE_COUNT_RECONNECT_THRESHOLD = 3;

// Plaid error_codes that indicate the user must re-authenticate via Plaid Link.
const REAUTH_ERROR_CODES = new Set([
  "ITEM_LOGIN_REQUIRED",
  "PENDING_EXPIRATION",
  "PENDING_DISCONNECT",
  "USER_PERMISSION_REVOKED",
  "USER_SETUP_REQUIRED",
  "ACCESS_NOT_GRANTED",
  "INVALID_ACCESS_TOKEN",
  "INVALID_CREDENTIALS",
  "INSTITUTION_LOGIN_REQUIRED",
]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const formatIsoDate = (date: Date) => date.toISOString().slice(0, 10);

type ImportedTransactionRow = {
  row: {
    household_id: string;
    date: string;
    description: string;
    original_description: string | null;
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

export type PlaidConfig = {
  baseUrl: string;
  clientId: string;
  secret: string;
};

export type HouseholdSyncResult = {
  householdId: string;
  itemsAttempted: number;
  itemsSucceeded: number;
  itemsFailed: number;
  itemsRequiringReconnect: number;
  added: number;
  modified: number;
  removed: number;
  errors: Array<{ itemId: string; institution: string; error: string }>;
};

function isReauthError(plaidErrorBody: any): boolean {
  if (!plaidErrorBody) return false;
  const code = (plaidErrorBody.error_code || "").toString().toUpperCase();
  if (REAUTH_ERROR_CODES.has(code)) return true;
  const type = (plaidErrorBody.error_type || "").toString().toUpperCase();
  if (type === "ITEM_ERROR" && code.includes("LOGIN")) return true;
  return false;
}

async function recordSyncFailure(
  serviceClient: any,
  itemId: string,
  errorMessage: string,
  reauthRequired: boolean,
  previousFailureCount: number,
) {
  const newCount = previousFailureCount + 1;
  const requires_reconnect =
    reauthRequired || newCount >= FAILURE_COUNT_RECONNECT_THRESHOLD;
  await serviceClient
    .from("plaid_items")
    .update({
      last_sync_attempt_at: new Date().toISOString(),
      last_sync_error: errorMessage.slice(0, 1000),
      sync_failure_count: newCount,
      requires_reconnect,
    })
    .eq("id", itemId);
  return { requires_reconnect };
}

async function recordSyncSuccess(serviceClient: any, itemId: string, cursor: string | null) {
  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    last_sync_attempt_at: now,
    last_successful_sync_at: now,
    last_synced_at: now,
    last_sync_error: null,
    sync_failure_count: 0,
    requires_reconnect: false,
  };
  if (cursor) update.cursor = cursor;
  await serviceClient.from("plaid_items").update(update).eq("id", itemId);
}

/**
 * Run a full Plaid sync for a single household. Per-item failures are caught
 * and recorded — one bad item never blocks the others.
 */
export async function runHouseholdSync(
  serviceClient: any,
  householdId: string,
  plaid: PlaidConfig,
  options: { skipReconnectRequired?: boolean } = {},
): Promise<HouseholdSyncResult> {
  const result: HouseholdSyncResult = {
    householdId,
    itemsAttempted: 0,
    itemsSucceeded: 0,
    itemsFailed: 0,
    itemsRequiringReconnect: 0,
    added: 0,
    modified: 0,
    removed: 0,
    errors: [],
  };

  // Active budget month for this household
  const { data: household } = await serviceClient
    .from("households")
    .select("active_month")
    .eq("id", householdId)
    .single();
  const activeBudgetMonth =
    (household as any)?.active_month || new Date().toISOString().slice(0, 7);

  // All Plaid items for this household
  let query = serviceClient
    .from("plaid_items")
    .select("*, plaid_accounts(*)")
    .eq("household_id", householdId);
  if (options.skipReconnectRequired) {
    query = query.eq("requires_reconnect", false);
  }
  const { data: plaidItems } = await query;

  if (!plaidItems || plaidItems.length === 0) {
    return result;
  }

  // Hydrate access_tokens from secure plaid_tokens table (service-role only)
  const itemIds = plaidItems.map((it: any) => it.id);
  const { data: tokenRows } = await serviceClient
    .from("plaid_tokens")
    .select("plaid_item_id, access_token")
    .in("plaid_item_id", itemIds);
  const tokenByItemId: Record<string, string> = {};
  for (const t of tokenRows || []) {
    tokenByItemId[(t as any).plaid_item_id] = (t as any).access_token;
  }
  for (const it of plaidItems) {
    (it as any).access_token = tokenByItemId[(it as any).id] || null;
  }

  for (const item of plaidItems) {
    if (!(item as any).access_token) {
      console.warn("Skipping plaid_item with no token in plaid_tokens", item.id);
      continue;
    }
    result.itemsAttempted += 1;
    const previousFailureCount = (item as any).sync_failure_count || 0;
    const institution = (item as any).institution_name || "Bank";

    // Mark attempt timestamp up-front so even a thrown exception is visible.
    try {
      await serviceClient
        .from("plaid_items")
        .update({ last_sync_attempt_at: new Date().toISOString() })
        .eq("id", item.id);
    } catch (_e) { /* non-fatal */ }

    try {
      const itemResult = await syncOneItem(serviceClient, item, householdId, activeBudgetMonth, plaid);
      result.added += itemResult.added;
      result.modified += itemResult.modified;
      result.removed += itemResult.removed;

      if (itemResult.failed) {
        result.itemsFailed += 1;
        const reauth = isReauthError(itemResult.plaidError);
        if (reauth) result.itemsRequiringReconnect += 1;
        const errMsg =
          itemResult.plaidError?.error_message ||
          itemResult.plaidError?.error_code ||
          itemResult.errorMessage ||
          "Unknown sync error";
        const recorded = await recordSyncFailure(
          serviceClient,
          item.id,
          errMsg,
          reauth,
          previousFailureCount,
        );
        if (recorded.requires_reconnect && !reauth) {
          result.itemsRequiringReconnect += 1;
        }
        result.errors.push({ itemId: item.id, institution, error: errMsg });
      } else {
        result.itemsSucceeded += 1;
        await recordSyncSuccess(serviceClient, item.id, itemResult.cursor);
      }
    } catch (err) {
      result.itemsFailed += 1;
      const errMsg = err instanceof Error ? err.message : "Unknown sync error";
      console.error(`Sync exception for item ${item.id}:`, err);
      const recorded = await recordSyncFailure(
        serviceClient,
        item.id,
        errMsg,
        false,
        previousFailureCount,
      );
      if (recorded.requires_reconnect) result.itemsRequiringReconnect += 1;
      result.errors.push({ itemId: item.id, institution, error: errMsg });
    }
  }

  return result;
}

type SyncOneItemResult = {
  added: number;
  modified: number;
  removed: number;
  cursor: string | null;
  failed: boolean;
  plaidError?: any;
  errorMessage?: string;
};

async function syncOneItem(
  serviceClient: any,
  item: any,
  householdId: string,
  activeBudgetMonth: string,
  plaid: PlaidConfig,
): Promise<SyncOneItemResult> {
  let added = 0;
  let modified = 0;
  let removed = 0;

  // Fire /transactions/refresh for depository items (checking/savings)
  const hasDepository = (item.plaid_accounts || []).some(
    (acc: any) =>
      acc.account_category === "checking" ||
      acc.account_category === "savings" ||
      acc.type === "depository" ||
      acc.subtype === "checking",
  );

  if (hasDepository) {
    try {
      const refreshRes = await fetch(`${plaid.baseUrl}/transactions/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: plaid.clientId,
          secret: plaid.secret,
          access_token: item.access_token,
        }),
      });
      const refreshData = await refreshRes.json();
      if (refreshRes.ok) {
        await sleep(REFRESH_SETTLE_DELAY_MS);
      } else {
        console.warn("transactions/refresh non-fatal error", item.id, refreshData);
      }
    } catch (refreshErr) {
      console.warn("transactions/refresh exception", item.id, refreshErr);
    }
  }

  // Build account + cardholder maps
  const accountMap: Record<string, string> = {};
  const cardholderMap: Record<string, Array<{ slug: string; patterns: string[] }>> = {};

  for (const acc of item.plaid_accounts || []) {
    const cat = acc.account_category || "credit_card";
    if (cat === "credit_card") {
      // resolved via cardholders below
    } else if (acc.app_account) {
      accountMap[acc.plaid_account_id] = acc.app_account;
    } else if (acc.nickname) {
      const slug = acc.nickname
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      accountMap[acc.plaid_account_id] = slug;
    }
  }

  const creditAccountIds = (item.plaid_accounts || [])
    .filter((a: any) => (a.account_category || "credit_card") === "credit_card")
    .map((a: any) => a.id);

  if (creditAccountIds.length > 0) {
    const { data: holders } = await serviceClient
      .from("plaid_cardholders")
      .select("plaid_account_id, name, slug, match_patterns")
      .in("plaid_account_id", creditAccountIds);

    for (const h of holders || []) {
      if (!cardholderMap[h.plaid_account_id]) cardholderMap[h.plaid_account_id] = [];
      cardholderMap[h.plaid_account_id].push({
        slug: h.slug,
        patterns: h.match_patterns || [],
      });
      const plaidAcc = (item.plaid_accounts || []).find(
        (a: any) => a.id === h.plaid_account_id,
      );
      if (plaidAcc && !accountMap[plaidAcc.plaid_account_id]) {
        accountMap[plaidAcc.plaid_account_id] = h.slug;
      }
    }
  }

  const resolveAccount = (tx: Record<string, unknown>, fallback: string): string => {
    const owner = ((tx.account_owner as string) || "").toLowerCase();
    const txName = ((tx.name as string) || "").toLowerCase();
    const searchText = owner || txName;
    const plaidAccountId = tx.account_id as string;
    const plaidAcc = (item.plaid_accounts || []).find(
      (a: any) => a.plaid_account_id === plaidAccountId,
    );
    if (plaidAcc && cardholderMap[plaidAcc.id]) {
      for (const holder of cardholderMap[plaidAcc.id]) {
        if (holder.patterns.some((p) => searchText.includes(p.toLowerCase()))) {
          return holder.slug;
        }
      }
    }
    return fallback;
  };

  const mapImportedTransaction = (tx: Record<string, unknown>): ImportedTransactionRow | null => {
    const baseAccount = accountMap[tx.account_id as string];
    if (!baseAccount) return null;

    const plaidAcc = (item.plaid_accounts || []).find(
      (a: any) => a.plaid_account_id === tx.account_id,
    );
    const isCreditCard =
      plaidAcc &&
      (plaidAcc.account_category === "credit_card" ||
        (!plaidAcc.account_category && plaidAcc.type === "credit"));
    const isCheckingAccount =
      plaidAcc && (plaidAcc.account_category === "checking" || plaidAcc.subtype === "checking");
    const account = isCreditCard ? resolveAccount(tx, baseAccount) : baseAccount;

    const plaidAmount = Number(tx.amount);
    const plaidTxType = ((tx.transaction_type as string) || "").toLowerCase();
    let isCredit = plaidAmount < 0;
    if (isCheckingAccount && !isCredit && plaidTxType === "credit") {
      isCredit = true;
    }
    const finalAmount = isCredit && plaidAmount > 0 ? -plaidAmount : plaidAmount;
    const description = buildTransactionDescription(tx);
    const originalDescription = extractOriginalDescription(tx);

    // Auto-detect routing for inter-account transfers and CC payments is INTENTIONALLY DISABLED
    // (per product decision 2026-04-27). Joe wants every Plaid-synced row to land in Unassigned
    // for explicit manual review. Users mark them as Ignore one-by-one via the Add/Edit sheets,
    // which writes the `ignore-user` slug.
    //
    // The legacy detection logic — Plaid personal_finance_category TRANSFER_OUT/TRANSFER_IN,
    // description regex (ONLINE TRANSFER, ACH TRANSFER, WAY2SAVE, etc.), and the Wells Fargo
    // VISA-card CC-payment regex — has been removed from the active path. The slug constants
    // (`ignore-transfer`, `ignore-cc-payment`) are preserved in src/types/budget.ts so this
    // routing can be re-enabled later via a user setting if desired. Existing rows already
    // tagged with those slugs are left untouched.

    let transactionType = "expense";
    const categorySlug = "unassigned";
    if (isCreditCard && plaidAmount < 0) {
      // Surface CC refunds/credits with the right type so totals stay correct,
      // but still leave them in Unassigned for manual review.
      transactionType = "deposit";
    }

    return {
      row: {
        household_id: householdId,
        date: tx.date as string,
        description,
        original_description: originalDescription,
        notes: "",
        amount: finalAmount,
        category_slug: categorySlug,
        account,
        is_transfer_to_savings: false,
        transaction_type: transactionType,
        entered_by: null,
        plaid_transaction_id: (tx.transaction_id as string) || null,
        budget_month: activeBudgetMonth,
      },
      pending_transaction_id: (tx.pending_transaction_id as string) || null,
    };
  };

  const persistImportedTransactions = async (txRows: ImportedTransactionRow[]) => {
    let addedHere = 0;
    let modifiedHere = 0;
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

        if (existingById && existingById.length > 0) continue;

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
            modifiedHere += pendingMatch.length;
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
          },
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
              .in("id", legacyMatch.map((m) => m.id));
          }
          modifiedHere += legacyMatch.length;
          continue;
        }
      }
      deduped.push(row);
    }

    if (deduped.length > 0) {
      const { error: insertError } = await serviceClient.from("transactions").insert(deduped);
      if (insertError) {
        console.error("Failed to insert transactions:", insertError);
        return { added: addedHere, modified: modifiedHere, insertFailed: true };
      }
      addedHere += deduped.length;
    }

    return { added: addedHere, modified: modifiedHere, insertFailed: false };
  };

  // Run /transactions/sync until has_more=false
  let hasMore = true;
  const syncStartCursor = item.cursor || undefined;
  let cursor: string | undefined = syncStartCursor;
  let syncRestartCount = 0;
  let syncPaginationMutated = false;
  let insertFailed = false;
  let syncFailed = false;
  let plaidErrorBody: any = null;

  while (hasMore) {
    const syncBody: Record<string, unknown> = {
      client_id: plaid.clientId,
      secret: plaid.secret,
      access_token: item.access_token,
    };
    if (cursor) syncBody.cursor = cursor;

    const syncRes = await fetch(`${plaid.baseUrl}/transactions/sync`, {
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
        await sleep(REFRESH_SETTLE_DELAY_MS * syncRestartCount);
        continue;
      }
      if (syncData?.error_code === PLAID_SYNC_MUTATION_ERROR) {
        syncPaginationMutated = true;
      } else {
        // Real error — record and stop.
        syncFailed = true;
        plaidErrorBody = syncData;
        console.error("Plaid sync error for item", item.id, syncData);
        hasMore = false;
        break;
      }
      hasMore = false;
      break;
    }

    if (syncData.added && syncData.added.length > 0) {
      const txRows = syncData.added
        .map((tx: Record<string, unknown>) => mapImportedTransaction(tx))
        .filter((txRow): txRow is ImportedTransactionRow => Boolean(txRow));
      if (txRows.length > 0) {
        const r = await persistImportedTransactions(txRows);
        added += r.added;
        modified += r.modified;
        if (r.insertFailed) {
          insertFailed = true;
          syncFailed = true;
          plaidErrorBody = { error_message: "Database insert failed" };
          hasMore = false;
          break;
        }
      }
    }

    if (syncData.removed && syncData.removed.length > 0) {
      const removedIds = syncData.removed
        .map((r: Record<string, unknown>) => r.transaction_id as string)
        .filter(Boolean);
      if (removedIds.length > 0) {
        const { data: removedRows } = await serviceClient
          .from("transactions")
          .select("id, plaid_transaction_id")
          .eq("household_id", householdId)
          .in("plaid_transaction_id", removedIds);
        if (removedRows && removedRows.length > 0) {
          await serviceClient
            .from("transactions")
            .delete()
            .in("id", removedRows.map((r: { id: string }) => r.id));
          removed += removedRows.length;
        }
      }
    }

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
          .eq("household_id", householdId)
          .eq("plaid_transaction_id", plaidTxId);
        modified++;
      }
    }

    hasMore = syncData.has_more;
    cursor = syncData.next_cursor;
  }

  // Pending transactions backfill (only for cursor that committed cleanly)
  if (!syncFailed) {
    const pendingStartDate = new Date();
    pendingStartDate.setDate(pendingStartDate.getDate() - 30);
    const pendingEndDate = new Date();
    pendingEndDate.setDate(pendingEndDate.getDate() + 7);
    let pendingOffset = 0;
    const pendingCount = 500;
    let totalPendingTransactions = Infinity;

    while (pendingOffset < totalPendingTransactions) {
      const pendingRes = await fetch(`${plaid.baseUrl}/transactions/get`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: plaid.clientId,
          secret: plaid.secret,
          access_token: item.access_token,
          start_date: formatIsoDate(pendingStartDate),
          end_date: formatIsoDate(pendingEndDate),
          options: {
            count: pendingCount,
            offset: pendingOffset,
            include_personal_finance_category: true,
          },
        }),
      });
      const pendingData = await pendingRes.json();
      if (!pendingRes.ok) {
        console.warn("pending fetch non-fatal error", item.id, pendingData);
        break;
      }
      totalPendingTransactions = Number(pendingData.total_transactions) || 0;
      const recentRows = (pendingData.transactions || [])
        .filter((tx: Record<string, unknown>) => syncPaginationMutated || tx.pending === true)
        .map((tx: Record<string, unknown>) => mapImportedTransaction(tx))
        .filter((txRow: ImportedTransactionRow | null): txRow is ImportedTransactionRow =>
          Boolean(txRow),
        );
      if (recentRows.length > 0) {
        const r = await persistImportedTransactions(recentRows);
        added += r.added;
        modified += r.modified;
      }
      pendingOffset += pendingCount;
      if ((pendingData.transactions || []).length < pendingCount) break;
    }
  }

  return {
    added,
    modified,
    removed,
    cursor: insertFailed ? null : (cursor || null),
    failed: syncFailed,
    plaidError: plaidErrorBody,
  };
}
