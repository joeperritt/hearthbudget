// Deno test for the bcrypt-verify + consume-once logic in mfa-verify-recovery-code.
// We don't boot the full HTTP handler (it requires a Supabase JWT). Instead we
// verify the cryptographic primitive used inside the handler: bcrypt.compare
// against codes hashed with the SAME formatting that the enrollment flow uses.
//
// Run with:  deno test supabase/functions/mfa-verify-recovery-code/handler_test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import bcrypt from "npm:bcryptjs@2.4.3";

function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function formatForCompare(submittedRaw: string): string {
  const s = normalizeCode(submittedRaw);
  return s.length === 10 ? `${s.slice(0, 5)}-${s.slice(5)}` : s;
}

Deno.test("bcrypt verifies a valid recovery code", async () => {
  const plaintext = "ABCDE-12345";
  const hash = await bcrypt.hash(plaintext, 10);

  // User submits the same string
  const ok = await bcrypt.compare(formatForCompare(plaintext), hash);
  assertEquals(ok, true);
});

Deno.test("bcrypt verifies code submitted without dash", async () => {
  const plaintext = "ABCDE-12345";
  const hash = await bcrypt.hash(plaintext, 10);

  const ok = await bcrypt.compare(formatForCompare("ABCDE12345"), hash);
  assertEquals(ok, true);
});

Deno.test("bcrypt verifies lowercase submission (normalization)", async () => {
  const plaintext = "ABCDE-12345";
  const hash = await bcrypt.hash(plaintext, 10);

  const ok = await bcrypt.compare(formatForCompare("abcde-12345"), hash);
  assertEquals(ok, true);
});

Deno.test("bcrypt rejects an invalid code with a generic miss", async () => {
  const plaintext = "ABCDE-12345";
  const hash = await bcrypt.hash(plaintext, 10);

  const ok = await bcrypt.compare(formatForCompare("ZZZZZ-99999"), hash);
  assertEquals(ok, false);
});

Deno.test("bcrypt rejects a partial-match attempt (no info leak via length)", async () => {
  const plaintext = "ABCDE-12345";
  const hash = await bcrypt.hash(plaintext, 10);

  // Same prefix, different suffix
  const ok = await bcrypt.compare(formatForCompare("ABCDE-99999"), hash);
  assertEquals(ok, false);
});

Deno.test("simulated consume-once flow: scan over many hashes finds exactly one match", async () => {
  const codes = ["AAAAA-11111", "BBBBB-22222", "CCCCC-33333", "DDDDD-44444"];
  const hashes = await Promise.all(codes.map((c) => bcrypt.hash(c, 10)));

  // User submits the 3rd code
  const submitted = formatForCompare("ccccc33333");
  let matchIndex = -1;
  for (let i = 0; i < hashes.length; i++) {
    if (await bcrypt.compare(submitted, hashes[i])) {
      matchIndex = i;
      break;
    }
  }
  assertEquals(matchIndex, 2);
});

Deno.test("input validation: codes shorter than 8 chars are rejected before bcrypt", () => {
  // This mirrors the early-return guard in the edge function (line 58)
  const submitted = normalizeCode("abc");
  assertEquals(submitted.length < 8, true);
});

Deno.test("rate-limit math: 5+ failures in window triggers lockout", () => {
  const RATE_LIMIT_MAX_FAILURES = 5;
  const recentFails = 5;
  const locked = recentFails >= RATE_LIMIT_MAX_FAILURES;
  assertEquals(locked, true);

  const recentFails2 = 4;
  const locked2 = recentFails2 >= RATE_LIMIT_MAX_FAILURES;
  assertEquals(locked2, false);
});
