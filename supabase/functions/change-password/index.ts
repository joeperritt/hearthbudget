// Self-service password change with:
//   - Current password verification (re-authenticate via signInWithPassword,
//     which also defends against an attacker with only an active session token).
//   - MFA step-up if user has TOTP or email MFA enrolled. Either factor satisfies
//     the step-up; payload: { mfa_method: 'totp'|'email', mfa_code: '123456' }.
//   - Strength validation (mirrors client; defense in depth).
//   - Calls mfa-on-password-change wrapper (revokes trusted devices, audit log,
//     security notice email).
//   - Logs failed attempts to mfa_attempt_log so existing rate-limit applies.
//
// Body: {
//   current_password: string,
//   new_password: string,
//   mfa_method?: 'totp' | 'email',
//   mfa_code?: string,
// }
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
const MIN_PW_LENGTH = 12;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function validatePassword(pw: string): string | null {
  if (typeof pw !== "string" || pw.length < MIN_PW_LENGTH) return `Password must be at least ${MIN_PW_LENGTH} characters`;
  if (!/[A-Z]/.test(pw)) return "Password must contain an uppercase letter";
  if (!/[a-z]/.test(pw)) return "Password must contain a lowercase letter";
  if (!/[0-9]/.test(pw)) return "Password must contain a number";
  return null;
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
    const user = userRes.user;
    if (!user.email) return json(400, { error: "Account has no email on file" });

    const body = await req.json().catch(() => ({}));
    const currentPassword = typeof body?.current_password === "string" ? body.current_password : "";
    const newPassword = typeof body?.new_password === "string" ? body.new_password : "";
    const mfaMethod =
      body?.mfa_method === "totp" || body?.mfa_method === "email" ? body.mfa_method : null;
    const mfaCode = typeof body?.mfa_code === "string" ? body.mfa_code.trim() : "";

    if (!currentPassword) return json(400, { error: "Current password required" });
    const pwIssue = validatePassword(newPassword);
    if (pwIssue) return json(400, { error: pwIssue });
    if (newPassword === currentPassword) {
      return json(400, { error: "New password must be different from your current password" });
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      null;
    const ua = req.headers.get("user-agent") || null;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Preflight unified MFA lockout (covers password-attempt failures too)
    const { data: preLock } = await admin.rpc("recent_failed_mfa_attempts", {
      _user_id: user.id,
      _window_minutes: RATE_LIMIT_WINDOW_MIN,
    });
    if (((preLock as number) ?? 0) >= RATE_LIMIT_MAX_FAILURES) {
      return json(429, {
        error: "Too many failed attempts. Try again later.",
        locked: true,
        retry_after_minutes: RATE_LIMIT_WINDOW_MIN,
      });
    }

    // Step 1: verify current password by attempting a fresh sign-in on a
    // throwaway client. Does NOT affect the caller's session.
    const verifyClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: pwErr } = await verifyClient.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    if (pwErr) {
      await admin.from("mfa_attempt_log").insert({
        user_id: user.id,
        attempt_type: "password",
        success: false,
        ip_address: ip,
      });
      await admin.from("mfa_audit_log").insert({
        user_id: user.id,
        event: "password_change_failed",
        ip_address: ip,
        user_agent: ua,
        metadata: { reason: "wrong_current_password" },
      });
      const { data: failData } = await admin.rpc("recent_failed_mfa_attempts", {
        _user_id: user.id,
        _window_minutes: RATE_LIMIT_WINDOW_MIN,
      });
      const locked = ((failData as number) ?? 0) >= RATE_LIMIT_MAX_FAILURES;
      return json(401, {
        error: "Current password is incorrect",
        locked,
        retry_after_minutes: locked ? RATE_LIMIT_WINDOW_MIN : 0,
      });
    }

    // Step 2: MFA step-up if any factor enrolled
    const { data: factorsData } = await userClient.auth.mfa.listFactors();
    const verifiedTotp = (factorsData?.totp ?? []).find((f) => f.status === "verified");
    const { data: emailFactor } = await admin
      .from("user_mfa_email_factors")
      .select("verified_email, disabled_at")
      .eq("user_id", user.id)
      .maybeSingle();
    const hasEmailFactor = !!emailFactor && !emailFactor.disabled_at;
    const hasAnyMfa = !!verifiedTotp || hasEmailFactor;

    if (hasAnyMfa) {
      if (!mfaMethod || !mfaCode) {
        return json(400, {
          error: "MFA verification required",
          mfa_required: true,
          methods: {
            totp: !!verifiedTotp,
            email: hasEmailFactor,
          },
        });
      }
      if (!/^\d{6}$/.test(mfaCode)) return json(400, { error: "MFA code must be 6 digits" });

      let stepUpOk = false;

      if (mfaMethod === "totp") {
        if (!verifiedTotp) return json(400, { error: "TOTP not enrolled" });
        const { data: chal, error: chalErr } = await userClient.auth.mfa.challenge({
          factorId: verifiedTotp.id,
        });
        if (chalErr || !chal) return json(500, { error: chalErr?.message ?? "Challenge failed" });
        const { error: vErr } = await userClient.auth.mfa.verify({
          factorId: verifiedTotp.id,
          challengeId: chal.id,
          code: mfaCode,
        });
        stepUpOk = !vErr;
        await admin.from("mfa_attempt_log").insert({
          user_id: user.id,
          attempt_type: "totp",
          success: stepUpOk,
          ip_address: ip,
        });
      } else {
        if (!hasEmailFactor) return json(400, { error: "Email MFA not enrolled" });
        const { data: pending } = await admin
          .from("mfa_email_codes")
          .select("id, code_hash, attempts")
          .eq("user_id", user.id)
          .eq("purpose", "step_up")
          .is("consumed_at", null)
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!pending) return json(400, { error: "No active code. Request a new one." });
        stepUpOk = await bcrypt.compare(mfaCode, pending.code_hash);
        await admin.from("mfa_attempt_log").insert({
          user_id: user.id,
          attempt_type: "email_code",
          success: stepUpOk,
          ip_address: ip,
        });
        if (stepUpOk) {
          await admin.from("mfa_email_codes")
            .update({ consumed_at: new Date().toISOString() })
            .eq("id", pending.id);
        } else {
          await admin.from("mfa_email_codes")
            .update({ attempts: pending.attempts + 1 })
            .eq("id", pending.id);
        }
      }

      if (!stepUpOk) {
        const { data: failData } = await admin.rpc("recent_failed_mfa_attempts", {
          _user_id: user.id,
          _window_minutes: RATE_LIMIT_WINDOW_MIN,
        });
        const locked = ((failData as number) ?? 0) >= RATE_LIMIT_MAX_FAILURES;
        await admin.from("mfa_audit_log").insert({
          user_id: user.id,
          event: "password_change_failed",
          ip_address: ip,
          user_agent: ua,
          metadata: { reason: "mfa_failed", method: mfaMethod },
        });
        return json(401, {
          error: "Invalid MFA code",
          mfa_failed: true,
          locked,
          retry_after_minutes: locked ? RATE_LIMIT_WINDOW_MIN : 0,
        });
      }
    }

    // Step 3: update password via admin API
    const { error: updErr } = await admin.auth.admin.updateUserById(user.id, {
      password: newPassword,
    });
    if (updErr) {
      await admin.from("mfa_audit_log").insert({
        user_id: user.id,
        event: "password_change_failed",
        ip_address: ip,
        user_agent: ua,
        metadata: { reason: "update_failed", error: updErr.message },
      });
      return json(400, { error: updErr.message });
    }

    // Step 4: invoke wrapper (revoke devices, audit, notify)
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/mfa-on-password-change`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": SUPABASE_SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          reason: "admin_reset",
          target_user_id: user.id,
          actor_user_id: user.id,
        }),
      });
    } catch (e) {
      console.error("mfa-on-password-change invoke failed", e);
    }

    return json(200, { ok: true });
  } catch (e) {
    console.error("change-password error", e);
    return json(500, { error: e instanceof Error ? e.message : "Internal error" });
  }
});
