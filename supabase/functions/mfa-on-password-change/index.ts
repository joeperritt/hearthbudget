// Centralized side-effects for any password change.
// Responsibilities:
//   1. Revoke ALL trusted devices for the target user (defense in depth — a
//      stolen password should not bypass MFA via a long-lived trusted device).
//   2. Audit-log 'password_changed' + 'trusted_devices_revoked'.
//   3. Send a "your password was changed" security notice email to the user.
//
// Two call modes:
//   A) Self path: caller is the user themselves. Body: { reason: 'self' | 'reset' }
//      We use the caller's own auth.uid() — no target_user_id needed/honored.
//   B) Admin path: caller is service-role (called from another edge function on the
//      server side). Body: { target_user_id, reason: 'admin_reset' }
//      We require an internal shared secret OR an admin user JWT to authorize.
//
// This function MUST be idempotent — callers should invoke it after every
// successful auth.updateUser({ password }) or admin.updateUserById({ password }).
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM = "Keeper <hello@keeperbudget.com>";

const VALID_REASONS = new Set(["self", "reset", "admin_reset"]);

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function notificationHtml(): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#ffffff;font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;padding:32px 20px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #F5F1EA;border-radius:12px;overflow:hidden;max-width:560px;">
        <tr><td style="background:#1A2332;padding:28px 32px;text-align:center;">
          <div style="display:inline-block;width:44px;height:44px;line-height:44px;border-radius:50%;border:1.5px solid #C9A84C;color:#fff;font-family:'Playfair Display',Georgia,serif;font-size:22px;font-weight:700;">K</div>
          <p style="color:#fff;font-family:'Playfair Display',Georgia,serif;font-size:18px;letter-spacing:0.04em;margin:12px 0 0;">KEEPER</p>
        </td></tr>
        <tr><td style="padding:36px 32px 28px;color:#1A2332;">
          <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:24px;font-weight:normal;margin:0 0 18px;">Your password was changed</h1>
          <p style="font-size:15px;line-height:1.6;color:#4A5568;margin:0 0 16px;">This is a security notice that your Keeper password was just changed. As a precaution, all of your trusted devices have been revoked &mdash; you'll be asked for your two-factor code the next time you sign in on each device.</p>
          <p style="font-size:15px;line-height:1.6;color:#4A5568;margin:0 0 16px;"><strong>If this was you</strong>, no action is needed.</p>
          <p style="font-size:15px;line-height:1.6;color:#b91c1c;margin:0 0 8px;"><strong>If this wasn't you</strong>, reset your password immediately and contact us.</p>
        </td></tr>
        <tr><td style="background:#F5F1EA;padding:20px 32px;text-align:center;">
          <p style="font-family:'Playfair Display',Georgia,serif;font-size:13px;color:#1A2332;letter-spacing:0.04em;margin:0;">Keeper &middot; Budgeting together.</p>
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const reason = typeof body?.reason === "string" ? body.reason : "";
    if (!VALID_REASONS.has(reason)) return json(400, { error: "Invalid reason" });

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let targetUserId: string | null = null;
    let actorUserId: string | null = null;

    const internalSecret = req.headers.get("x-internal-secret");
    const usingServiceRole =
      internalSecret &&
      internalSecret === SUPABASE_SERVICE_ROLE_KEY &&
      reason === "admin_reset";

    if (usingServiceRole) {
      // Admin path called server-side (e.g. from admin-users)
      const t = typeof body?.target_user_id === "string" ? body.target_user_id : "";
      if (!t) return json(400, { error: "target_user_id required for admin_reset" });
      targetUserId = t;
      actorUserId = typeof body?.actor_user_id === "string" ? body.actor_user_id : null;
    } else {
      // Self path — must be a valid user JWT
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return json(401, { error: "Missing Authorization header" });
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userRes, error: userErr } = await userClient.auth.getUser();
      if (userErr || !userRes.user) return json(401, { error: "Unauthorized" });
      if (reason === "admin_reset") return json(403, { error: "admin_reset requires service-role" });
      targetUserId = userRes.user.id;
      actorUserId = userRes.user.id;
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      null;
    const ua = req.headers.get("user-agent") || null;

    // 1. Revoke trusted devices
    const { data: revokedCount, error: revokeErr } = await admin.rpc(
      "revoke_all_trusted_devices",
      { _user_id: targetUserId },
    );
    if (revokeErr) {
      console.error("revoke_all_trusted_devices failed", revokeErr);
    }

    // 2. Audit-log
    await admin.from("mfa_audit_log").insert([
      {
        user_id: targetUserId,
        event: "password_changed",
        ip_address: ip,
        user_agent: ua,
        metadata: {
          reason,
          actor_user_id: actorUserId,
          devices_revoked: (revokedCount as number | null) ?? 0,
        },
      },
      {
        user_id: targetUserId,
        event: "trusted_devices_revoked",
        ip_address: ip,
        user_agent: ua,
        metadata: { reason: `password_changed:${reason}` },
      },
    ]);

    // 3. Notification email — best-effort
    if (RESEND_API_KEY) {
      const { data: targetAuthUser } = await admin.auth.admin.getUserById(targetUserId!);
      const targetEmail = targetAuthUser?.user?.email;
      if (targetEmail) {
        try {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: FROM,
              to: [targetEmail],
              subject: "Your Keeper password was changed",
              html: notificationHtml(),
              text:
                "Your Keeper password was just changed. As a precaution, all trusted devices have been revoked. " +
                "If this wasn't you, reset your password immediately.\n\nKeeper · Budgeting together.",
            }),
          });
        } catch (e) {
          console.error("notification email failed", e);
        }
      }
    }

    return json(200, { ok: true, devices_revoked: (revokedCount as number | null) ?? 0 });
  } catch (e) {
    console.error("mfa-on-password-change error", e);
    return json(500, { error: e instanceof Error ? e.message : "Internal error" });
  }
});
