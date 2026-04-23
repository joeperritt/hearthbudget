// Admin test fixtures edge function.
//
// SECURITY MODEL (defense in depth):
//   1. Caller must have a valid Supabase JWT.
//   2. Caller must have the `system_admin` role.
//   3. The TEST_MODE_ENABLED env var must be exactly "true".
//   4. Request Origin must NOT match a known production hostname.
//
// If ANY of (2)–(4) fail we return 404 (not 401/403) so the page does not
// reveal that it exists or that test mode is off. (1) returns 401 because
// it can only be hit by an authenticated client at all.
//
// PRODUCTION_HOSTS maintenance:
//   This list MUST contain ONLY real production domains. NEVER add preview/dev
//   domains (e.g. `hearthbudget.lovable.app`, any `*-preview--*.lovable.app`)
//   or admins will be locked out of the test tool everywhere usable.
//   Current production domains:
//     - keeperbudget.com
//     - www.keeperbudget.com
//   When adding a new production domain (apex or subdomain), add it here in
//   the SAME commit that wires it up.
//
// Every action logs a structured audit line to the function logs.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PRODUCTION_HOSTS = new Set([
  "keeperbudget.com",
  "www.keeperbudget.com",
]);

const TEST_EMAIL_PREFIX = "test+";
const TEST_EMAIL_DOMAIN = "@keeperbudget.com";

function notFound() {
  // Indistinguishable from a missing route.
  return new Response("Not Found", {
    status: 404,
    headers: { ...corsHeaders, "Content-Type": "text/plain" },
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function audit(actor: string, action: string, detail: Record<string, unknown> = {}) {
  console.log(JSON.stringify({
    audit: true,
    ts: new Date().toISOString(),
    actor,
    action,
    ...detail,
  }));
}

function generateTestEmail(label: string): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 6);
  return `${TEST_EMAIL_PREFIX}${label}-${ts}-${rand}${TEST_EMAIL_DOMAIN}`;
}

function generateTestPassword(): string {
  // Strong unique password — the page surfaces it in plaintext for tester use.
  return `Test-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}!A1`;
}

function generateInviteCode(): string {
  return `TEST-${Math.random().toString(36).slice(2, 8).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // ---- Layer 4 (production hostname block) ----
  // Reject before any other check so test fixtures cannot run on prod even if
  // TEST_MODE_ENABLED were flipped on. Returns 404 to hide existence.
  const originHeader = req.headers.get("Origin") || req.headers.get("Referer") || "";
  try {
    if (originHeader) {
      const u = new URL(originHeader);
      if (PRODUCTION_HOSTS.has(u.hostname)) {
        return notFound();
      }
    }
  } catch {
    // Invalid origin header — fall through; remaining layers will gate.
  }

  // ---- Layer 1 (JWT presence) ----
  // Must have an Authorization header at all to proceed.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const testModeRaw = Deno.env.get("TEST_MODE_ENABLED") ?? "";
  const testModeEnabled = testModeRaw.trim().toLowerCase() === "true";

  const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user: caller } } = await callerClient.auth.getUser();
  if (!caller) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  // ---- Layer 2 (system_admin check) ----
  // Use service role here so the check itself can't be defeated by RLS edge cases.
  const adminClient = createClient(supabaseUrl, supabaseServiceKey);
  const { data: roles } = await adminClient
    .from("user_roles")
    .select("role")
    .eq("user_id", caller.id);
  const isSystemAdmin = roles?.some((r: { role: string }) => r.role === "system_admin") ?? false;

  if (!isSystemAdmin) {
    audit(caller.id, "denied:not_system_admin");
    return notFound();
  }

  // ---- Layer 3 (TEST_MODE_ENABLED) ----
  // Secret must be the literal string "true" to enable test fixtures.
  if (!testModeEnabled) {
    audit(caller.id, "denied:test_mode_disabled");
    return notFound();
  }

  // ---- Routing ----
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const action = body?.action as string | undefined;

  try {
    switch (action) {
      case "list-test-data": {
        const { data: authList } = await adminClient.auth.admin.listUsers({ perPage: 200 });
        const allUsers = authList?.users ?? [];
        const testUsers = allUsers.filter(u =>
          (u.email ?? "").startsWith(TEST_EMAIL_PREFIX)
        );

        // Enrich with profile + roles
        const userIds = testUsers.map(u => u.id);
        const [{ data: profiles }, { data: rolesData }] = await Promise.all([
          adminClient.from("profiles").select("user_id, household_id, display_name").in("user_id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]),
          adminClient.from("user_roles").select("user_id, role, household_id").in("user_id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]),
        ]);

        const enriched = testUsers.map(u => {
          const profile = profiles?.find((p: any) => p.user_id === u.id);
          const userRoles = rolesData?.filter((r: any) => r.user_id === u.id) ?? [];
          return {
            user_id: u.id,
            email: u.email,
            email_confirmed: !!u.email_confirmed_at,
            created_at: u.created_at,
            household_id: profile?.household_id ?? null,
            display_name: profile?.display_name ?? null,
            roles: userRoles.map((r: any) => r.role),
          };
        });

        // Households + member counts
        const { data: households } = await adminClient.from("households").select("id, name");
        const { data: allProfiles } = await adminClient.from("profiles").select("household_id");
        const memberCounts = new Map<string, number>();
        (allProfiles ?? []).forEach((p: any) => {
          if (!p.household_id) return;
          memberCounts.set(p.household_id, (memberCounts.get(p.household_id) ?? 0) + 1);
        });
        const householdsWithCounts = (households ?? []).map((h: any) => ({
          id: h.id,
          name: h.name,
          member_count: memberCounts.get(h.id) ?? 0,
        }));
        const orphanCount = householdsWithCounts.filter(h => h.member_count === 0).length;

        return jsonResponse({
          test_users: enriched,
          test_user_count: enriched.length,
          households: householdsWithCounts,
          orphan_household_count: orphanCount,
        });
      }

      case "create-verified": {
        const email = generateTestEmail("verified");
        const password = generateTestPassword();
        const { data, error } = await adminClient.auth.admin.createUser({
          email, password, email_confirm: true,
        });
        if (error) return jsonResponse({ error: error.message }, 400);
        audit(caller.id, "create-verified", { user_id: data.user.id, email });
        return jsonResponse({ success: true, email, password, user_id: data.user.id });
      }

      case "create-unverified": {
        const email = generateTestEmail("unverified");
        const password = generateTestPassword();
        const { data, error } = await adminClient.auth.admin.createUser({
          email, password, email_confirm: false,
        });
        if (error) return jsonResponse({ error: error.message }, 400);
        audit(caller.id, "create-unverified", { user_id: data.user.id, email });
        return jsonResponse({ success: true, email, password, user_id: data.user.id });
      }

      case "create-household-admin": {
        const email = generateTestEmail("hhadmin");
        const password = generateTestPassword();

        // Create household
        const { data: household, error: hhErr } = await adminClient
          .from("households")
          .insert({ name: `Test Household ${Date.now()}` })
          .select()
          .single();
        if (hhErr) return jsonResponse({ error: hhErr.message }, 400);

        // Create user
        const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
          email, password, email_confirm: true,
        });
        if (createErr) return jsonResponse({ error: createErr.message }, 400);

        // Profile + role
        await adminClient.from("profiles").insert({
          user_id: created.user.id,
          household_id: household.id,
          display_name: "Test Admin",
          avatar_initial: "T",
        });
        await adminClient.from("user_roles").insert({
          user_id: created.user.id,
          role: "household_admin",
          household_id: household.id,
        });

        // Seed starter budget data (mirrors seed-household categories/expenses)
        const categories = [
          { slug: "groceries", name: "Groceries", budgeted: 700, group: "shared", sort_order: 0 },
          { slug: "gas", name: "Gas", budgeted: 200, group: "shared", sort_order: 1 },
          { slug: "dining", name: "Dining", budgeted: 250, group: "shared", sort_order: 2 },
          { slug: "personal", name: "Personal", budgeted: 150, group: "shared", sort_order: 3 },
        ].map(c => ({ ...c, household_id: household.id }));
        const expenses = [
          { slug: "rent", name: "Rent", amount: 2000, group: "bills", sort_order: 0 },
          { slug: "utilities", name: "Utilities", amount: 200, group: "bills", sort_order: 1 },
          { slug: "internet", name: "Internet", amount: 70, group: "bills", sort_order: 2 },
          { slug: "emergency", name: "Emergency Fund", amount: 300, group: "savings", sort_order: 0 },
        ].map(e => ({ ...e, household_id: household.id }));
        await adminClient.from("budget_categories").insert(categories);
        await adminClient.from("fixed_expenses").insert(expenses);

        audit(caller.id, "create-household-admin", {
          user_id: created.user.id, email, household_id: household.id,
        });
        return jsonResponse({
          success: true, email, password,
          user_id: created.user.id, household_id: household.id,
        });
      }

      case "create-household-member": {
        const { household_id } = body;
        if (!household_id) return jsonResponse({ error: "household_id required" }, 400);
        // Validate household exists
        const { data: hh } = await adminClient.from("households").select("id").eq("id", household_id).maybeSingle();
        if (!hh) return jsonResponse({ error: "household not found" }, 400);

        const email = generateTestEmail("member");
        const password = generateTestPassword();
        const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
          email, password, email_confirm: true,
        });
        if (createErr) return jsonResponse({ error: createErr.message }, 400);

        await adminClient.from("profiles").insert({
          user_id: created.user.id,
          household_id,
          display_name: "Test Member",
          avatar_initial: "T",
        });
        await adminClient.from("user_roles").insert({
          user_id: created.user.id,
          role: "household_member",
          household_id,
        });

        audit(caller.id, "create-household-member", {
          user_id: created.user.id, email, household_id,
        });
        return jsonResponse({
          success: true, email, password,
          user_id: created.user.id, household_id,
        });
      }

      case "create-invite-new-household": {
        const code = generateInviteCode();
        const { data, error } = await adminClient.from("invites").insert({
          code,
          created_by: caller.id,
          household_id: null,
        }).select().single();
        if (error) return jsonResponse({ error: error.message }, 400);
        audit(caller.id, "create-invite-new-household", { invite_id: data.id, code });
        return jsonResponse({ success: true, code, invite_id: data.id });
      }

      case "create-invite-existing-household": {
        const { household_id } = body;
        if (!household_id) return jsonResponse({ error: "household_id required" }, 400);
        const code = generateInviteCode();
        const { data, error } = await adminClient.from("invites").insert({
          code,
          created_by: caller.id,
          household_id,
        }).select().single();
        if (error) return jsonResponse({ error: error.message }, 400);
        audit(caller.id, "create-invite-existing-household", { invite_id: data.id, code, household_id });
        return jsonResponse({ success: true, code, invite_id: data.id, household_id });
      }

      case "delete-user": {
        const { user_id } = body;
        if (!user_id) return jsonResponse({ error: "user_id required" }, 400);
        if (user_id === caller.id) {
          return jsonResponse({ error: "Cannot delete self" }, 400);
        }
        // Sanity: refuse to delete a user that is NOT a test user (email check).
        const { data: target } = await adminClient.auth.admin.getUserById(user_id);
        const targetEmail = target?.user?.email ?? "";
        if (!targetEmail.startsWith(TEST_EMAIL_PREFIX)) {
          return jsonResponse({ error: "Refusing to delete non-test user" }, 400);
        }
        const { error } = await adminClient.auth.admin.deleteUser(user_id);
        if (error) return jsonResponse({ error: error.message }, 400);
        audit(caller.id, "delete-user", { user_id, email: targetEmail });
        return jsonResponse({ success: true });
      }

      case "delete-all-test-users": {
        const { data: list } = await adminClient.auth.admin.listUsers({ perPage: 200 });
        const targets = (list?.users ?? []).filter(u =>
          (u.email ?? "").startsWith(TEST_EMAIL_PREFIX) && u.id !== caller.id
        );
        let deleted = 0;
        const errors: string[] = [];
        for (const u of targets) {
          const { error } = await adminClient.auth.admin.deleteUser(u.id);
          if (error) errors.push(`${u.email}: ${error.message}`);
          else deleted++;
        }
        audit(caller.id, "delete-all-test-users", { deleted, attempted: targets.length });
        return jsonResponse({ success: true, deleted, attempted: targets.length, errors });
      }

      case "delete-orphan-households": {
        const { data: households } = await adminClient.from("households").select("id, name");
        const { data: allProfiles } = await adminClient.from("profiles").select("household_id");
        const memberCounts = new Map<string, number>();
        (allProfiles ?? []).forEach((p: any) => {
          if (!p.household_id) return;
          memberCounts.set(p.household_id, (memberCounts.get(p.household_id) ?? 0) + 1);
        });
        const orphans = (households ?? []).filter((h: any) => (memberCounts.get(h.id) ?? 0) === 0);
        let deleted = 0;
        const errors: string[] = [];
        for (const h of orphans) {
          // Clean dependent rows first (no FK cascade configured on all tables).
          await adminClient.from("budget_categories").delete().eq("household_id", h.id);
          await adminClient.from("fixed_expenses").delete().eq("household_id", h.id);
          await adminClient.from("budget_transfers").delete().eq("household_id", h.id);
          await adminClient.from("budget_month_snapshots").delete().eq("household_id", h.id);
          await adminClient.from("transactions").delete().eq("household_id", h.id);
          await adminClient.from("invites").delete().eq("household_id", h.id);
          await adminClient.from("tool_states").delete().eq("household_id", h.id);
          const { error } = await adminClient.from("households").delete().eq("id", h.id);
          if (error) errors.push(`${h.id}: ${error.message}`);
          else deleted++;
        }
        audit(caller.id, "delete-orphan-households", { deleted, attempted: orphans.length });
        return jsonResponse({ success: true, deleted, attempted: orphans.length, errors });
      }

      case "ping": {
        // Used by the page to confirm access (anything else = 404 = render NotFound).
        return jsonResponse({ ok: true });
      }

      default:
        return jsonResponse({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    console.error("admin-test-auth error", err);
    return jsonResponse({ error: String(err) }, 500);
  }
});
