// Verify an MFA recovery code at login time.
// - Authenticates the caller via JWT (must already have aal1 session)
// - Rate-limits via recent_failed_mfa_attempts (5 in 15 min = locked out)
// - Bcrypt-compares submitted code against unconsumed rows in user_mfa_recovery_codes
// - On match: marks that row consumed, logs success, returns { ok: true, remaining }
// - On miss: logs failure, returns generic { ok: false } error (no info leak)
// - On success the client also calls supabase.auth.mfa.challenge/verify-style upgrade?
//   No — recovery codes bypass TOTP entirely. The client treats this as session promotion
//   and simply trusts the existing session as MFA-passed for this app's routing.
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

function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

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
    const submittedRaw = typeof body?.code === "string" ? body.code : "";
    const submitted = normalizeCode(submittedRaw);
    if (submitted.length < 8) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid code" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      null;
    const ua = req.headers.get("user-agent") || null;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Rate limit check
    const { data: rateData, error: rateErr } = await admin.rpc("recent_failed_mfa_attempts", {
      _user_id: userId,
      _window_minutes: RATE_LIMIT_WINDOW_MIN,
    });
    if (rateErr) throw rateErr;
    const recentFails = (rateData as number) ?? 0;
    if (recentFails >= RATE_LIMIT_MAX_FAILURES) {
      return new Response(
        JSON.stringify({
          ok: false,
          locked: true,
          retry_after_minutes: RATE_LIMIT_WINDOW_MIN,
          error: `Too many attempts. Try again in ${RATE_LIMIT_WINDOW_MIN} minutes.`,
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Pull unconsumed codes
    const { data: codes, error: codesErr } = await admin
      .from("user_mfa_recovery_codes")
      .select("id, code_hash")
      .eq("user_id", userId)
      .is("consumed_at", null);
    if (codesErr) throw codesErr;

    let matchedId: string | null = null;
    for (const row of codes ?? []) {
      // Compare normalized submitted (without dash) and stored hash (which was hashed
      // from formatted XXXXX-XXXXX). Re-format submitted to that shape before compare.
      const formatted =
        submitted.length === 10
          ? `${submitted.slice(0, 5)}-${submitted.slice(5)}`
          : submitted;
      const ok = await bcrypt.compare(formatted, row.code_hash);
      if (ok) {
        matchedId = row.id;
        break;
      }
    }

    if (!matchedId) {
      await admin.from("mfa_attempt_log").insert({
        user_id: userId,
        attempt_type: "recovery_code",
        success: false,
        ip_address: ip,
      });
      await admin.from("mfa_audit_log").insert({
        user_id: userId,
        event: "verify_failed",
        ip_address: ip,
        user_agent: ua,
        metadata: { method: "recovery_code" },
      });
      return new Response(JSON.stringify({ ok: false, error: "Invalid code" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mark consumed
    const { error: updErr } = await admin
      .from("user_mfa_recovery_codes")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", matchedId);
    if (updErr) throw updErr;

    // Count remaining
    const { count: remaining } = await admin
      .from("user_mfa_recovery_codes")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("consumed_at", null);

    await admin.from("mfa_attempt_log").insert({
      user_id: userId,
      attempt_type: "recovery_code",
      success: true,
      ip_address: ip,
    });
    await admin.from("mfa_audit_log").insert({
      user_id: userId,
      event: "recovery_code_used",
      ip_address: ip,
      user_agent: ua,
      metadata: { remaining: remaining ?? 0 },
    });

    return new Response(
      JSON.stringify({ ok: true, remaining: remaining ?? 0 }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("mfa-verify-recovery-code error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
