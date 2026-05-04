// Disable email MFA for the calling user.
// Step-up requirement: must provide either a fresh email-code (purpose='disable')
//   OR a fresh TOTP code if the user has TOTP enrolled. Either factor satisfies
//   step-up so users with both methods aren't locked into one.
// Body: { method: 'email'|'totp', code: string }
// On success: marks user_mfa_email_factors.disabled_at = now(), revokes all
//   trusted devices, audit-logs 'email_disabled'.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import bcrypt from "npm:bcryptjs@2.4.3";

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

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { error: "Missing Authorization header" });

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json(401, { error: "Unauthorized" });
    const userId = userRes.user.id;

    const body = await req.json().catch(() => ({}));
    const method = body?.method === "totp" ? "totp" : body?.method === "email" ? "email" : null;
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    if (!method) return json(400, { error: "method must be 'email' or 'totp'" });
    if (!/^\d{6}$/.test(code)) return json(400, { error: "Code must be 6 digits" });

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      null;
    const ua = req.headers.get("user-agent") || null;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Idempotency: if no factor or already disabled, succeed
    const { data: factor } = await admin
      .from("user_mfa_email_factors")
      .select("verified_email, disabled_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (!factor || factor.disabled_at) {
      return json(200, { ok: true, alreadyDisabled: true });
    }

    // Preflight unified lockout
    const { data: preLock } = await admin.rpc("recent_failed_mfa_attempts", {
      _user_id: userId, _window_minutes: RATE_LIMIT_WINDOW_MIN,
    });
    if (((preLock as number) ?? 0) >= RATE_LIMIT_MAX_FAILURES) {
      return json(429, {
        error: "Too many failed attempts. Try again later.",
        locked: true, retry_after_minutes: RATE_LIMIT_WINDOW_MIN,
      });
    }

    let stepUpOk = false;

    if (method === "email") {
      // Validate fresh email code with purpose 'disable'
      const { data: pending } = await admin
        .from("mfa_email_codes")
        .select("id, code_hash, attempts")
        .eq("user_id", userId)
        .eq("purpose", "disable")
        .is("consumed_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!pending) return json(400, { error: "No active code. Request a new one." });
      stepUpOk = await bcrypt.compare(code, pending.code_hash);
      await admin.from("mfa_attempt_log").insert({
        user_id: userId, attempt_type: "email_code", success: stepUpOk, ip_address: ip,
      });
      if (stepUpOk) {
        await admin.from("mfa_email_codes")
          .update({ consumed_at: new Date().toISOString() }).eq("id", pending.id);
      } else {
        await admin.from("mfa_email_codes")
          .update({ attempts: pending.attempts + 1 }).eq("id", pending.id);
      }
    } else {
      // method === 'totp' — must have a verified TOTP factor
      const { data: factors } = await userClient.auth.mfa.listFactors();
      const verified = (factors?.totp ?? []).find((f) => f.status === "verified");
      if (!verified) return json(400, { error: "No TOTP factor enrolled" });
      const { data: chal, error: chalErr } = await userClient.auth.mfa.challenge({
        factorId: verified.id,
      });
      if (chalErr || !chal) return json(500, { error: chalErr?.message ?? "Could not start TOTP challenge" });
      const { error: verErr } = await userClient.auth.mfa.verify({
        factorId: verified.id, challengeId: chal.id, code,
      });
      stepUpOk = !verErr;
      await admin.from("mfa_attempt_log").insert({
        user_id: userId, attempt_type: "totp", success: stepUpOk, ip_address: ip,
      });
    }

    if (!stepUpOk) {
      const { data: failData } = await admin.rpc("recent_failed_mfa_attempts", {
        _user_id: userId, _window_minutes: RATE_LIMIT_WINDOW_MIN,
      });
      const recentFails = (failData as number) ?? 0;
      const locked = recentFails >= RATE_LIMIT_MAX_FAILURES;
      await admin.from("mfa_audit_log").insert({
        user_id: userId, event: "verify_failed", ip_address: ip, user_agent: ua,
        metadata: { method, context: "email_disable" },
      });
      return json(401, {
        error: "Invalid code", locked,
        retry_after_minutes: locked ? RATE_LIMIT_WINDOW_MIN : 0,
      });
    }

    // Success — disable factor, revoke trusted devices
    await admin
      .from("user_mfa_email_factors")
      .update({ disabled_at: new Date().toISOString() })
      .eq("user_id", userId);
    await admin.rpc("revoke_all_trusted_devices", { _user_id: userId });

    await admin.from("mfa_audit_log").insert({
      user_id: userId, event: "email_disabled", ip_address: ip, user_agent: ua,
      metadata: { step_up_method: method },
    });
    await admin.from("mfa_audit_log").insert({
      user_id: userId, event: "trusted_devices_revoked", ip_address: ip, user_agent: ua,
      metadata: { reason: "email_mfa_disabled" },
    });

    return json(200, { ok: true });
  } catch (e) {
    console.error("mfa-email-disable error", e);
    return json(500, { error: e instanceof Error ? e.message : "Internal error" });
  }
});
