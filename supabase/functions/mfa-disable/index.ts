// Disable MFA for the calling user.
// Requires BOTH password re-auth AND a fresh TOTP code, so neither a stolen
// session alone (no password) nor stolen credentials alone (no TOTP) can
// disable two-factor.
//
// Steps:
// 1. Validate caller JWT.
// 2. Re-validate password via signInWithPassword (does NOT replace the active
//    session because we use a separate ephemeral client).
// 3. Validate the 6-digit TOTP code against the user's verified factor via
//    mfa.challenge + mfa.verify on the user-scoped client (this also natively
//    upgrades AAL on that ephemeral session, but we discard it).
// 4. On success: unenroll all TOTP factors, delete all recovery codes,
//    write 'disabled' to mfa_audit_log.
// 5. Always logs the TOTP attempt to mfa_attempt_log (success/failure) so
//    failed disable attempts contribute to the unified lockout counter.
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

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse(401, { error: "Missing Authorization header" });

    // 1. Identify caller from JWT
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return jsonResponse(401, { error: "Unauthorized" });
    const userId = userRes.user.id;
    const email = userRes.user.email;
    if (!email) return jsonResponse(400, { error: "Account has no email on file" });

    const body = await req.json().catch(() => ({}));
    const password = typeof body?.password === "string" ? body.password : "";
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    if (!password || !/^\d{6}$/.test(code)) {
      return jsonResponse(400, { error: "Password and 6-digit code are required" });
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      null;
    const ua = req.headers.get("user-agent") || null;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Preflight: if already locked out (unified counter), reject before
    // exposing the password validator to additional brute-force pressure.
    const { data: preLock } = await admin.rpc("recent_failed_mfa_attempts", {
      _user_id: userId,
      _window_minutes: RATE_LIMIT_WINDOW_MIN,
    });
    if (((preLock as number) ?? 0) >= RATE_LIMIT_MAX_FAILURES) {
      return jsonResponse(429, {
        error: "Too many failed attempts. Try again later.",
        locked: true,
        retry_after_minutes: RATE_LIMIT_WINDOW_MIN,
      });
    }

    // 2. Re-validate password using a fresh ephemeral client so the user's
    // real session is untouched.
    const reauthClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: pwErr } = await reauthClient.auth.signInWithPassword({ email, password });
    if (pwErr) {
      // Do NOT log this as a TOTP failure — it's a password failure. Auth
      // failures already feed Supabase's own rate limiter.
      return jsonResponse(401, { error: "Incorrect password" });
    }

    // 3. Validate TOTP using the user-scoped client (operates on caller's session)
    const { data: factors } = await userClient.auth.mfa.listFactors();
    const verified = (factors?.totp ?? []).find((f) => f.status === "verified");
    if (!verified) {
      // Nothing to disable — treat as success-idempotent.
      return jsonResponse(200, { ok: true, alreadyDisabled: true });
    }

    const { data: chal, error: chalErr } = await userClient.auth.mfa.challenge({
      factorId: verified.id,
    });
    if (chalErr || !chal) {
      return jsonResponse(500, { error: chalErr?.message ?? "Could not start MFA challenge" });
    }

    const { error: verErr } = await userClient.auth.mfa.verify({
      factorId: verified.id,
      challengeId: chal.id,
      code,
    });

    // Always log the TOTP attempt (counts toward unified lockout)
    await admin.from("mfa_attempt_log").insert({
      user_id: userId,
      attempt_type: "totp",
      success: !verErr,
      ip_address: ip,
    });

    if (verErr) {
      const { data: failData } = await admin.rpc("recent_failed_mfa_attempts", {
        _user_id: userId,
        _window_minutes: RATE_LIMIT_WINDOW_MIN,
      });
      const recentFails = (failData as number) ?? 0;
      const locked = recentFails >= RATE_LIMIT_MAX_FAILURES;
      await admin.from("mfa_audit_log").insert({
        user_id: userId,
        event: "verify_failed",
        ip_address: ip,
        user_agent: ua,
        metadata: { method: "totp", context: "disable" },
      });
      return jsonResponse(401, {
        error: "Invalid code",
        locked,
        retry_after_minutes: locked ? RATE_LIMIT_WINDOW_MIN : 0,
      });
    }

    // 4. Both factors validated. Unenroll all TOTP factors.
    for (const f of factors?.totp ?? []) {
      await userClient.auth.mfa.unenroll({ factorId: f.id }).catch(() => {});
    }

    // 5. Wipe recovery codes (service role required — RLS blocks direct delete)
    await admin.from("user_mfa_recovery_codes").delete().eq("user_id", userId);

    // 6. Audit log
    await admin.from("mfa_audit_log").insert({
      user_id: userId,
      event: "disabled",
      ip_address: ip,
      user_agent: ua,
      metadata: { factor_id: verified.id },
    });

    return jsonResponse(200, { ok: true });
  } catch (e) {
    console.error("mfa-disable error", e);
    return jsonResponse(500, { error: e instanceof Error ? e.message : "Internal error" });
  }
});
