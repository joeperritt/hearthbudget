import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveCardholder, type CardholderRule } from "./cardholder-matcher.ts";

const RULES: CardholderRule[] = [
  { slug: "joe", patterns: ["JOE M"] },
  { slug: "katie", patterns: ["KATIE M"] },
];

Deno.test("matches by account_owner exact", () => {
  assertEquals(
    resolveCardholder({ account_owner: "JOE M", name: "Amazon" }, RULES, "unassigned"),
    "joe",
  );
});

Deno.test("matches by account_owner case-insensitive", () => {
  assertEquals(
    resolveCardholder({ account_owner: "joe m", name: "Amazon" }, RULES, "unassigned"),
    "joe",
  );
});

Deno.test("falls back to tx name when account_owner missing", () => {
  assertEquals(
    resolveCardholder({ account_owner: null, name: "Costco JOE M" }, RULES, "unassigned"),
    "joe",
  );
});

Deno.test("substring match counts (owner field contains pattern)", () => {
  assertEquals(
    resolveCardholder({ account_owner: "Joseph M (JOE M)", name: "" }, RULES, "unassigned"),
    "joe",
  );
});

Deno.test("first matching rule wins (order matters)", () => {
  // Both patterns would match the search text; first in array should win.
  const ambiguous: CardholderRule[] = [
    { slug: "katie", patterns: ["M"] },
    { slug: "joe", patterns: ["JOE M"] },
  ];
  assertEquals(
    resolveCardholder({ account_owner: "JOE M", name: "" }, ambiguous, "unassigned"),
    "katie",
  );
});

Deno.test("no match returns fallback", () => {
  assertEquals(
    resolveCardholder({ account_owner: "DAVE", name: "Amazon" }, RULES, "fallback-slug"),
    "fallback-slug",
  );
});

Deno.test("empty rules returns fallback", () => {
  assertEquals(
    resolveCardholder({ account_owner: "JOE M", name: "Amazon" }, [], "fallback-slug"),
    "fallback-slug",
  );
});

Deno.test("blank inputs return fallback", () => {
  assertEquals(
    resolveCardholder({ account_owner: null, name: null }, RULES, "fallback-slug"),
    "fallback-slug",
  );
  assertEquals(
    resolveCardholder({ account_owner: "", name: "" }, RULES, "fallback-slug"),
    "fallback-slug",
  );
});

Deno.test("empty pattern strings are ignored (no false positive)", () => {
  const buggy: CardholderRule[] = [{ slug: "katie", patterns: [""] }];
  assertEquals(
    resolveCardholder({ account_owner: "JOE M", name: "" }, buggy, "fallback"),
    "fallback",
  );
});

Deno.test("account_owner takes precedence over name when both present", () => {
  // owner is JOE, name contains KATIE — should attribute to joe.
  assertEquals(
    resolveCardholder(
      { account_owner: "JOE M", name: "Walmart KATIE M" },
      RULES,
      "unassigned",
    ),
    "joe",
  );
});

Deno.test("multi-pattern rule: any pattern matches", () => {
  const multi: CardholderRule[] = [
    { slug: "joe", patterns: ["JOE M", "JOSEPH"] },
  ];
  assertEquals(
    resolveCardholder({ account_owner: "JOSEPH", name: "" }, multi, "unassigned"),
    "joe",
  );
});
