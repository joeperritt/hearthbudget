// Password validation + HIBP (Have I Been Pwned) k-anonymity check.

export interface PasswordCheck {
  ok: boolean;
  score: 0 | 1 | 2 | 3 | 4; // weak..very strong
  issues: string[];
}

export function validatePassword(pw: string): PasswordCheck {
  const issues: string[] = [];
  if (pw.length < 12) issues.push("At least 12 characters");
  if (!/[A-Z]/.test(pw)) issues.push("Add an uppercase letter");
  if (!/[a-z]/.test(pw)) issues.push("Add a lowercase letter");
  if (!/[0-9]/.test(pw)) issues.push("Add a number");

  let score = 0;
  if (pw.length >= 12) score++;
  if (pw.length >= 16) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw)) score++;
  const finalScore = Math.min(4, score) as 0 | 1 | 2 | 3 | 4;

  return { ok: issues.length === 0, score: finalScore, issues };
}

async function sha1Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/** Returns true if password appears in a known breach. */
export async function isPasswordPwned(pw: string): Promise<boolean> {
  try {
    const hash = await sha1Hex(pw);
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
    if (!res.ok) return false; // fail open — don't block signup if HIBP is down
    const text = await res.text();
    return text.split("\n").some((line) => line.split(":")[0].trim() === suffix);
  } catch {
    return false;
  }
}

export function strengthLabel(score: number) {
  return ["Very weak", "Weak", "Fair", "Strong", "Very strong"][score] ?? "Weak";
}
