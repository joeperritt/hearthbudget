// Service-account access token for Google Calendar, cached until shortly before expiry.
let cached: { token: string; exp: number } | null = null;

function b64url(data: Uint8Array | string) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Tolerates common paste damage (trailing commas, stray text, real newlines in the key).
function parseServiceAccount(raw: string): { client_email: string; private_key: string } {
  const text = raw.trim();
  const attempts = [text, text.replace(/,\s*([}\]])/g, '$1'), text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1).replace(/,\s*([}\]])/g, '$1')];
  for (const t of attempts) {
    try { const v = JSON.parse(t); if (v?.client_email && v?.private_key) return v; } catch { /* next */ }
  }
  const email = text.match(/"client_email"\s*:\s*"([^"]+)"/)?.[1];
  const key = text.match(/"private_key"\s*:\s*"([\s\S]*?-----END PRIVATE KEY-----[\s\S]*?)"/)?.[1];
  if (email && key) return { client_email: email, private_key: key.replace(/\\n/g, '\n') };
  throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid service account JSON; please re-paste the full key file');
}

export function hasServiceAccount() {
  return Boolean(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON'));
}

export async function getGoogleAccessToken(): Promise<string> {
  if (cached && Date.now() < cached.exp - 60_000) return cached.token;
  const raw = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set');
  const sa = parseServiceAccount(raw);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/calendar.events',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const pem = String(sa.private_key).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`)));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${b64url(sig)}` }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed [${res.status}]: ${await res.text()}`);
  const data = await res.json();
  cached = { token: data.access_token, exp: Date.now() + data.expires_in * 1000 };
  return cached.token;
}
