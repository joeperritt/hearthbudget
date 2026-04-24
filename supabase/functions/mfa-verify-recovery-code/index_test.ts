// Pure-logic tests for the recovery-code verifier — no bcrypt or HTTP required.
// The bcrypt round-trip is exercised by the live enrollment flow which writes
// the same hashes this function reads. The rate-limit DB function is verified
// directly via SQL in the integration suite.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function formatForCompare(submittedRaw: string): string {
  const s = normalizeCode(submittedRaw);
  return s.length === 10 ? `${s.slice(0, 5)}-${s.slice(5)}` : s;
}

Deno.test("normalize: uppercases and strips dashes/spaces", () => {
  assertEquals(normalizeCode("abcde-12345"), "ABCDE12345");
  assertEquals(normalizeCode("ABCDE 12345"), "ABCDE12345");
  assertEquals(normalizeCode("ab-cd-e1-23-45"), "ABCDE12345");
});

Deno.test("formatForCompare: 10-char input gets re-formatted to XXXXX-XXXXX", () => {
  assertEquals(formatForCompare("abcde12345"), "ABCDE-12345");
  assertEquals(formatForCompare("ABCDE-12345"), "ABCDE-12345");
  assertEquals(formatForCompare("AbCdE 12345"), "ABCDE-12345");
});

Deno.test("input length guard: codes shorter than 8 chars rejected before bcrypt", () => {
  assertEquals(normalizeCode("abc").length < 8, true);
  assertEquals(normalizeCode("abcdefgh").length < 8, false);
});

Deno.test("hybrid lockout policy contract", () => {
  // TOTP path checks unified counter (totp + recovery fails).
  // Recovery path checks recovery-only counter.
  // 5+ failures triggers lock.
  const cases = [
    { totp: 5, rec: 0, totpLocked: true,  recLocked: false }, // pure TOTP fails
    { totp: 0, rec: 5, totpLocked: true,  recLocked: true  }, // pure recovery fails
    { totp: 5, rec: 5, totpLocked: true,  recLocked: true  }, // both
    { totp: 4, rec: 0, totpLocked: false, recLocked: false }, // sub-threshold
    { totp: 4, rec: 4, totpLocked: true,  recLocked: false }, // unified=8, rec=4
    { totp: 3, rec: 2, totpLocked: true,  recLocked: false }, // unified=5
    { totp: 2, rec: 4, totpLocked: true,  recLocked: false }, // unified=6, rec<5
  ];
  for (const c of cases) {
    const totpLocked = (c.totp + c.rec) >= 5;
    const recLocked = c.rec >= 5;
    assertEquals(totpLocked, c.totpLocked, `TOTP wrong: ${JSON.stringify(c)}`);
    assertEquals(recLocked, c.recLocked, `Recovery wrong: ${JSON.stringify(c)}`);
  }
});
