// Scheduled by pg_cron (daily 04:00 UTC) and also callable by an admin via supabase.functions.invoke().
// Iterates over every household with at least one Plaid item that does NOT require reconnect,
// and runs the shared per-household sync. Per-household failures are isolated.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runHouseholdSync } from "../plaid-sync-transactions/sync-helper.ts";

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
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Optional body: { household_id?: string }
    // When provided, only that single household is synced. Used by the on-open
    // fallback so a user opening the app doesn't trigger a system-wide sync.
    let targetHouseholdId: string | null = null;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body && typeof body.household_id === "string") {
          targetHouseholdId = body.household_id;
        }
      } catch (_e) { /* no body — fine */ }
    }

    // If a single-household run was requested AND an Authorization header is present,
    // verify the caller belongs to that household. Service-key calls (cron) skip this.
    if (targetHouseholdId) {
      const authHeader = req.headers.get("Authorization");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      const isServiceKeyCall =
        authHeader && serviceKey && authHeader === `Bearer ${serviceKey}`;
      if (!isServiceKeyCall) {
        if (!authHeader?.startsWith("Bearer ")) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const userClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY")!,
          { global: { headers: { Authorization: authHeader } } },
        );
        const { data: { user }, error: userError } = await userClient.auth.getUser();
        if (userError || !user) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const { data: profile } = await serviceClient
          .from("profiles")
          .select("household_id")
          .eq("user_id", user.id)
          .single();
        if (!profile || profile.household_id !== targetHouseholdId) {
          return new Response(JSON.stringify({ error: "Forbidden" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // Discover every household that has at least one healthy Plaid item.
    let householdIds: string[] = [];
    if (targetHouseholdId) {
      householdIds = [targetHouseholdId];
    } else {
      const { data: items } = await serviceClient
        .from("plaid_items")
        .select("household_id")
        .eq("requires_reconnect", false);
      const set = new Set<string>();
      for (const it of items || []) {
        if ((it as any).household_id) set.add((it as any).household_id);
      }
      householdIds = Array.from(set);
    }

    let attempted = 0;
    let succeeded = 0;
    let failed = 0;
    let reconnect_required = 0;
    const perHousehold: Array<{ householdId: string; error?: string }> = [];

    for (const hhId of householdIds) {
      try {
        const r = await runHouseholdSync(
          serviceClient,
          hhId,
          { baseUrl: plaidBaseUrl, clientId: PLAID_CLIENT_ID, secret: PLAID_SECRET },
          { skipReconnectRequired: true },
        );
        attempted += r.itemsAttempted;
        succeeded += r.itemsSucceeded;
        failed += r.itemsFailed;
        reconnect_required += r.itemsRequiringReconnect;
        perHousehold.push({ householdId: hhId });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown";
        console.error(`Household ${hhId} sync failed:`, err);
        perHousehold.push({ householdId: hhId, error: msg });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        households: householdIds.length,
        attempted,
        succeeded,
        failed,
        reconnect_required,
        per_household: perHousehold,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("auto-sync-all-households error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
