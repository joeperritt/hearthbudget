// Validate a trusted-device token for the authenticated user.
// If the token belongs to this user, is not revoked, and is not expired,
// return { trusted: true } and bump last_used_at. Otherwise { trusted: false }.
//
// We rotate the token on each successful use to limit replay risk if local
// storage leaks: a fresh token is minted, the old row is deleted, and the
// new plaintext token is returned to the client to overwrite local storage.
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

const TRUST_DAYS = 60;

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function base64UrlRandom(byteLen = 32): string {
  const buf = new Uint8Array(byteLen);
  crypto.getRandomValues(buf);
  let bin = "";
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ trusted: false, error: "no_auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) {
      return new Response(JSON.stringify({ trusted: false, error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userRes.user.id;

    const body = await req.json().catch(() => ({}));
    const token = typeof body?.token === "string" ? body.token : null;
    if (!token) {
      return new Response(JSON.stringify({ trusted: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tokenHash = await sha256Hex(token);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: row } = await admin
      .from("mfa_trusted_devices")
      .select("id, user_id, expires_at, revoked_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (!row || row.user_id !== userId) {
      return new Response(JSON.stringify({ trusted: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (row.revoked_at) {
      return new Response(JSON.stringify({ trusted: false, reason: "revoked" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return new Response(JSON.stringify({ trusted: false, reason: "expired" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Rotate: delete old row, insert new one with fresh token + reset expiry.
    const newToken = base64UrlRandom(32);
    const newHash = await sha256Hex(newToken);
    const newExpires = new Date(Date.now() + TRUST_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const ua = req.headers.get("user-agent");
    let label = "Unknown device";
    if (ua) {
      if (/iPhone/i.test(ua)) label = "iPhone";
      else if (/iPad/i.test(ua)) label = "iPad";
      else if (/Android/i.test(ua)) label = "Android";
      else if (/Mac OS X/i.test(ua)) label = "Mac";
      else if (/Windows/i.test(ua)) label = "Windows PC";
      else if (/Linux/i.test(ua)) label = "Linux";
    }

    await admin.from("mfa_trusted_devices").delete().eq("id", row.id);
    await admin.from("mfa_trusted_devices").insert({
      user_id: userId,
      token_hash: newHash,
      device_label: label,
      expires_at: newExpires,
      last_used_at: new Date().toISOString(),
    });

    return new Response(
      JSON.stringify({ trusted: true, token: newToken, expires_at: newExpires }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("mfa-check-trusted-device error", e);
    return new Response(
      JSON.stringify({ trusted: false, error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
