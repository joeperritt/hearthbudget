// Record a TOTP verification outcome (success or failure) on behalf of the user.
// Called by the client after supabase.auth.mfa.verify() resolves so the rate limiter
// (recent_failed_mfa_attempts) sees TOTP failures alongside recovery-code failures.
//
// Also returns the current count of recent failures so the client can preflight
// the rate limit before the user attempts another code.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const RATE_LIMIT_WINDOW_MIN = 15;
const RATE_LIMIT_MAX_FAILURES = 5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userRes.user.id;

    const body = await req.json().catch(() => ({}));
    const success = body?.success === true;
    const action = typeof body?.action === "string" ? body.action : "log";
    // action: "log" (write attempt) | "preflight" (just check rate limit)

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      null;
    const ua = req.headers.get("user-agent") || null;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (action === "log") {
      await admin.from("mfa_attempt_log").insert({
        user_id: userId,
        attempt_type: "totp",
        success,
        ip_address: ip,
      });
      await admin.from("mfa_audit_log").insert({
        user_id: userId,
        event: success ? "verify_success" : "verify_failed",
        ip_address: ip,
        user_agent: ua,
        metadata: { method: "totp" },
      });
    }

    // Total failures (any type) - drives the unified lock
    const { data: totalData } = await admin.rpc("recent_failed_mfa_attempts", {
      _user_id: userId,
      _window_minutes: RATE_LIMIT_WINDOW_MIN,
    });
    // Recovery-only failures - if this is below the limit, the recovery escape
    // hatch is still available even when the unified lock has tripped.
    const { data: recoveryData } = await admin.rpc("recent_failed_mfa_attempts", {
      _user_id: userId,
      _window_minutes: RATE_LIMIT_WINDOW_MIN,
      _attempt_type: "recovery_code",
    });
    const recentFails = (totalData as number) ?? 0;
    const recoveryFails = (recoveryData as number) ?? 0;
    const locked = recentFails >= RATE_LIMIT_MAX_FAILURES;
    const recoveryLocked = recoveryFails >= RATE_LIMIT_MAX_FAILURES;

    return new Response(
      JSON.stringify({
        ok: true,
        recent_failures: recentFails,
        recovery_failures: recoveryFails,
        locked,
        recovery_locked: recoveryLocked,
        retry_after_minutes: locked ? RATE_LIMIT_WINDOW_MIN : 0,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("mfa-log-attempt error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
