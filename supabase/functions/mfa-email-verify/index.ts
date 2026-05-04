// Verify a 6-digit email MFA code.
// Body: { code: string, purpose: 'enroll'|'login'|'disable'|'step_up' }
// On success for purpose='enroll', writes user_mfa_email_factors row
//   (snapshotting the email the code was sent to) and revokes all trusted devices.
// Logs every attempt to mfa_attempt_log (attempt_type='email_code') so the
//   unified lockout (recent_failed_mfa_attempts) covers email codes.
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
const MAX_ATTEMPTS_PER_CODE = 5;
const VALID_PURPOSES = new Set(["enroll", "login", "disable", "step_up"]);

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
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    const purpose = typeof body?.purpose === "string" ? body.purpose : "";
    if (!/^\d{6}$/.test(code)) return json(400, { error: "Code must be 6 digits" });
    if (!VALID_PURPOSES.has(purpose)) return json(400, { error: "Invalid purpose" });

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      null;
    const ua = req.headers.get("user-agent") || null;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Preflight unified lockout
    const { data: preLock } = await admin.rpc("recent_failed_mfa_attempts", {
      _user_id: userId,
      _window_minutes: RATE_LIMIT_WINDOW_MIN,
    });
    if (((preLock as number) ?? 0) >= RATE_LIMIT_MAX_FAILURES) {
      return json(429, {
        error: "Too many failed attempts. Try again later.",
        locked: true,
        retry_after_minutes: RATE_LIMIT_WINDOW_MIN,
      });
    }

    // Pull most recent un-consumed, un-expired code for this user+purpose
    const { data: pending } = await admin
      .from("mfa_email_codes")
      .select("id, code_hash, attempts, email, expires_at")
      .eq("user_id", userId)
      .eq("purpose", purpose)
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!pending) {
      await admin.from("mfa_attempt_log").insert({
        user_id: userId, attempt_type: "email_code", success: false, ip_address: ip,
      });
      return json(400, { error: "No active code. Request a new one." });
    }

    if (pending.attempts >= MAX_ATTEMPTS_PER_CODE) {
      // Burn the code so user must request a new one
      await admin
        .from("mfa_email_codes")
        .update({ consumed_at: new Date().toISOString() })
        .eq("id", pending.id);
      return json(400, { error: "Too many attempts on this code. Request a new one." });
    }

    const ok = await bcrypt.compare(code, pending.code_hash);

    // Always log attempt
    await admin.from("mfa_attempt_log").insert({
      user_id: userId, attempt_type: "email_code", success: ok, ip_address: ip,
    });

    if (!ok) {
      await admin
        .from("mfa_email_codes")
        .update({ attempts: pending.attempts + 1 })
        .eq("id", pending.id);
      const { data: failData } = await admin.rpc("recent_failed_mfa_attempts", {
        _user_id: userId, _window_minutes: RATE_LIMIT_WINDOW_MIN,
      });
      const recentFails = (failData as number) ?? 0;
      const locked = recentFails >= RATE_LIMIT_MAX_FAILURES;
      await admin.from("mfa_audit_log").insert({
        user_id: userId, event: "verify_failed", ip_address: ip, user_agent: ua,
        metadata: { method: "email_code", purpose },
      });
      return json(401, {
        error: "Invalid code",
        locked,
        retry_after_minutes: locked ? RATE_LIMIT_WINDOW_MIN : 0,
      });
    }

    // Success path: consume code
    await admin
      .from("mfa_email_codes")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", pending.id);

    if (purpose === "enroll") {
      // Snapshot email at enrollment moment
      await admin.from("user_mfa_email_factors").upsert(
        {
          user_id: userId,
          verified_email: pending.email,
          enrolled_at: new Date().toISOString(),
          disabled_at: null,
        },
        { onConflict: "user_id" },
      );
      await admin.rpc("revoke_all_trusted_devices", { _user_id: userId });
      await admin.from("mfa_audit_log").insert({
        user_id: userId, event: "email_enroll_verified", ip_address: ip, user_agent: ua,
        metadata: { email: pending.email },
      });
      await admin.from("mfa_audit_log").insert({
        user_id: userId, event: "trusted_devices_revoked", ip_address: ip, user_agent: ua,
        metadata: { reason: "email_mfa_enrolled" },
      });
    } else {
      await admin.from("mfa_audit_log").insert({
        user_id: userId, event: "verify_success", ip_address: ip, user_agent: ua,
        metadata: { method: "email_code", purpose },
      });
      // Update last-used method (helps login flow default to user's recent choice)
      await admin.from("user_mfa_method_pref").upsert(
        { user_id: userId, last_used_method: "email" },
        { onConflict: "user_id" },
      );
    }

    return json(200, { ok: true, purpose });
  } catch (e) {
    console.error("mfa-email-verify error", e);
    return json(500, { error: e instanceof Error ? e.message : "Internal error" });
  }
});
