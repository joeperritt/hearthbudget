// Send a 6-digit email MFA code.
// Purposes: 'enroll' | 'login' | 'disable' | 'step_up'
// Rate limits: 60s cooldown between sends per user+purpose, max 5 sends per 60min.
// Codes: 6 digits, bcrypt-hashed (cost 10), 10-min expiry.
// For 'enroll': sends to caller's CURRENT auth.users email (no factor exists yet).
// For 'login' | 'disable' | 'step_up': sends to the SNAPSHOTTED verified_email
// from user_mfa_email_factors. If user has no enrolled email factor, returns 400.
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
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM = "Keeper <hello@keeperbudget.com>";

const COOLDOWN_SECONDS = 60;
const MAX_SENDS_PER_HOUR = 5;
const CODE_TTL_MINUTES = 10;
const VALID_PURPOSES = new Set(["enroll", "login", "disable", "step_up"]);

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function generateCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 1_000_000).padStart(6, "0");
}

function maskEmail(e: string): string {
  const [u, d] = e.split("@");
  if (!u || !d) return e;
  const head = u.length <= 2 ? u[0] : u.slice(0, 2);
  return `${head}***@${d}`;
}

function emailHtml(code: string, purpose: string): string {
  const purposeText =
    purpose === "enroll"
      ? "Use this code to finish setting up email two-factor authentication on your Keeper account."
      : purpose === "disable"
        ? "Use this code to confirm disabling two-factor authentication."
        : purpose === "step_up"
          ? "Use this code to confirm a sensitive change to your Keeper account."
          : "Use this code to finish signing in to Keeper.";
  return `<!doctype html><html><body style="margin:0;padding:0;background:#ffffff;font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;padding:32px 20px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #F5F1EA;border-radius:12px;overflow:hidden;max-width:560px;">
        <tr><td style="background:#1A2332;padding:28px 32px;text-align:center;">
          <div style="display:inline-block;width:44px;height:44px;line-height:44px;border-radius:50%;border:1.5px solid #C9A84C;color:#fff;font-family:'Playfair Display',Georgia,serif;font-size:22px;font-weight:700;">K</div>
          <p style="color:#fff;font-family:'Playfair Display',Georgia,serif;font-size:18px;letter-spacing:0.04em;margin:12px 0 0;">KEEPER</p>
        </td></tr>
        <tr><td style="padding:36px 32px 28px;color:#1A2332;">
          <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:24px;font-weight:normal;margin:0 0 18px;">Your verification code</h1>
          <p style="font-size:15px;line-height:1.6;color:#4A5568;margin:0 0 20px;">${purposeText}</p>
          <div style="font-family:Courier,monospace;font-size:32px;font-weight:bold;color:#1A2332;background:#F5F1EA;padding:16px 24px;border-radius:6px;letter-spacing:0.2em;text-align:center;margin:0 0 24px;">${code}</div>
          <p style="font-size:13px;color:#8A8F99;margin:0 0 8px;">This code expires in 10 minutes. If you didn't request it, you can safely ignore this email.</p>
        </td></tr>
        <tr><td style="background:#F5F1EA;padding:20px 32px;text-align:center;">
          <p style="font-family:'Playfair Display',Georgia,serif;font-size:13px;color:#1A2332;letter-spacing:0.04em;margin:0;">Keeper · Budgeting together.</p>
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
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
    const currentEmail = userRes.user.email ?? "";

    const body = await req.json().catch(() => ({}));
    const purpose = typeof body?.purpose === "string" ? body.purpose : "";
    if (!VALID_PURPOSES.has(purpose)) return json(400, { error: "Invalid purpose" });

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      null;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Resolve target email
    let targetEmail = "";
    if (purpose === "enroll") {
      if (!currentEmail) return json(400, { error: "Account has no email on file" });
      targetEmail = currentEmail;
    } else {
      const { data: factor } = await admin
        .from("user_mfa_email_factors")
        .select("verified_email, disabled_at")
        .eq("user_id", userId)
        .maybeSingle();
      if (!factor || factor.disabled_at) {
        return json(400, { error: "Email MFA not enrolled" });
      }
      targetEmail = factor.verified_email;
    }

    // Rate limits — count recent un-consumed sends for same user+purpose
    const sinceCooldown = new Date(Date.now() - COOLDOWN_SECONDS * 1000).toISOString();
    const sinceHour = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { count: recentCount } = await admin
      .from("mfa_email_codes")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("purpose", purpose)
      .gte("created_at", sinceCooldown);
    if ((recentCount ?? 0) > 0) {
      return json(429, { error: "Please wait before requesting another code", retry_after_seconds: COOLDOWN_SECONDS });
    }

    const { count: hourCount } = await admin
      .from("mfa_email_codes")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("purpose", purpose)
      .gte("created_at", sinceHour);
    if ((hourCount ?? 0) >= MAX_SENDS_PER_HOUR) {
      return json(429, { error: "Too many code requests. Try again later.", retry_after_seconds: 3600 });
    }

    // Generate + hash + insert
    const code = generateCode();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString();

    const { error: insErr } = await admin.from("mfa_email_codes").insert({
      user_id: userId,
      code_hash: codeHash,
      email: targetEmail,
      purpose,
      expires_at: expiresAt,
      ip_address: ip,
    });
    if (insErr) return json(500, { error: "Could not enqueue code" });

    // Send via Resend (skip silently in environments without key — code still in table for tests)
    if (RESEND_API_KEY) {
      const subject =
        purpose === "enroll"
          ? "Verify your email for Keeper two-factor"
          : purpose === "disable"
            ? "Confirm disabling Keeper two-factor"
            : purpose === "step_up"
              ? "Confirm a change to your Keeper account"
              : "Your Keeper sign-in code";
      const sendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: FROM,
          to: [targetEmail],
          subject,
          html: emailHtml(code, purpose),
          text: `Your Keeper verification code is ${code}. It expires in 10 minutes.`,
        }),
      });
      if (!sendRes.ok) {
        console.error("Resend send failed", sendRes.status, await sendRes.text());
      }
    }

    return json(200, {
      ok: true,
      sent_to: maskEmail(targetEmail),
      expires_in_seconds: CODE_TTL_MINUTES * 60,
    });
  } catch (e) {
    console.error("mfa-email-send error", e);
    return json(500, { error: e instanceof Error ? e.message : "Internal error" });
  }
});
