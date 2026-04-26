# Keeper Backlog

Running list of things to get to, known limitations, and stuff to remember about this project. When working with Lovable, you can point it at this file: "check BACKLOG.md."

Last updated: April 26, 2026

## Security — pre-launch

### Decide on real rate-limiting strategy for login/password reset before public launch

Options: Cloudflare Worker proxying Supabase, hosted edge proxy, or migrate off Lovable Cloud to access GoTrue config directly.

### GoTrue CAPTCHA enforcement limitation

Lovable Cloud does NOT expose GoTrue env vars. This means native server-side CAPTCHA validation on login and password reset is NOT enforced — only on signup (via our custom edge function).

Mitigations currently in place:

- Turnstile widget renders on login + password reset pages (adds friction for bots)
- HIBP password check on
- Supabase default per-IP rate limits (30 per 5 min on sign-in attempts)

If we ever see credential-stuffing or reset-spam patterns in logs, the answer is a real distributed rate-limiting layer (see "Decide on real rate-limiting strategy" above and the deferred Cloudflare entry under Security caveats), not migrating to self-hosted Supabase. Confirmed by Lovable support April 23, 2026.

### Production hostname block maintenance

`/admin/test-auth` relies on a hardcoded hostname block in the edge function (`supabase/functions/admin-test-auth/index.ts`, `PRODUCTION_HOSTS`) to prevent production access. The blocked list currently includes:

- `keeperbudget.com`
- `www.keeperbudget.com`

If we ever add a new production domain, update this list in the same commit that wires it up. `TEST_MODE_ENABLED=true` is global across environments, so the hostname block is the ONLY thing keeping test fixtures out of production.

**Two lists must stay in sync (April 23, 2026):** There are TWO hardcoded hostname lists that gate `/admin/test-auth`, and BOTH must be updated whenever a production domain is added or changed:

1. `supabase/functions/admin-test-auth/index.ts` → `PRODUCTION_HOSTS` — the real security boundary (edge function rejects the request).
2. `src/pages/AdminTestAuth.tsx` → `PROD_HOSTS` — frontend UX pre-check that short-circuits to NotFound before calling the edge function.

If only the edge function list is updated, the frontend will still render NotFound on the new domain (or fail to render on a domain you removed). This bit us today — the edge function was fixed but the frontend pre-check kept blocking `hearthbudget.lovable.app`.

**Known gotcha (April 23, 2026):** This list must contain ONLY real production domains. NEVER add preview/dev domains like `hearthbudget.lovable.app` or any `*-preview--*.lovable.app` URL — doing so locks system_admins out of the test tool everywhere usable (preview iframe URLs aren't navigable directly). The published `hearthbudget.lovable.app` URL was briefly in the block list and had to be removed.

**Correct preview URL for testing (April 23, 2026):** Use `https://id-preview--8f47a9fe-0fa7-4ba2-a252-02aee25c702d.lovable.app` for testing the admin tool and any auth/admin flow that must bypass production guards. Do NOT use `hearthbudget.lovable.app` — Lovable auto-redirects the published `.lovable.app` URL to the primary custom domain (`keeperbudget.com`) at the platform level, and that redirect is not route-scoped, so `/admin/test-auth` is unreachable there. The `id-preview--<project-id>.lovable.app` URL does not redirect and is the right place to test anything gated by production hostname checks.

## Phase 4 remaining

### Phase 4C — MFA / 2FA via TOTP

Next major auth block after 4B is complete. Knocks out one of the remaining Plaid compliance items.

**Known gap — MFA rate limiting is app-layer (April 23, 2026):** The 5-strikes / 15-min lockout on `mfa-verify-totp` and `mfa-verify-recovery-code` is enforced in the edge function via a Postgres count over `public.mfa_attempt_log`. Real distributed rate limiting belongs at Cloudflare WAF — see "Cloudflare WAF in front of keeperbudget.com" above. The app-layer version is a stopgap until WAF is in place; both should run in parallel post-launch (defense in depth).

**Follow-up — `mfa_attempt_log` cleanup job (Supabase/platform-dependent):** Table grows unbounded (one row per attempt, success or failure). Negligible at household scale (KBs per year), but before broader use add a `pg_cron` + `pg_net` scheduled job that runs nightly:

```sql
DELETE FROM public.mfa_attempt_log WHERE created_at < now() - interval '30 days';
```

Setup steps when ready: enable `pg_cron` and `pg_net` extensions, then use the Supabase data-insert path (NOT the migration tool — cron schedules embed project-specific URLs/keys and shouldn't ship in migrations). Batch this with other platform-dependent items (Cloudflare WAF setup above, any future scheduled jobs). `mfa_audit_log` does not need cleanup — keep audit history indefinitely; it's tiny and forensically valuable.

### Phase 5 — Onboarding flow

First-run experience for new users. Includes Stewardship Mode vs Standard Mode toggle for secular users. Should walk user through Plaid connection, category setup, initial budget creation.

### Plan tab empty state

Guided tour showing benefits when profile is incomplete. Currently just shows empty tools.

## Plaid compliance (due Sept 25, 2026)

- Published privacy policy
- Documented access control policy
- Information Security Policy doc
- Data retention policy
- MFA on consumer app (covered by Phase 4C above)
- Remaining enterprise security attestations

## Security caveats

**Cloudflare distributed rate limiting on auth endpoints — DEFERRED (April 26, 2026).** Earlier attempt configured a rate limit rule for `/auth/v1/*` paths, but those endpoints live on Supabase's domain (`*.supabase.co`), not `keeperbudget.com` — so the rule doesn't fire. Cloudflare proxy on the apex domain also breaks Lovable's certificate provisioning, so A records are grey-cloud (DNS only). Real solutions for this would be: (1) Build a Cloudflare Worker that proxies Supabase auth calls through `keeperbudget.com` so we can rate-limit them, or (2) Wait for Lovable to expose GoTrue env vars. Until then, rate limiting on login/password reset relies on Supabase's defaults (30 sign-in attempts per 5 min per IP) plus the Turnstile widget as frontend friction. Cloudflare zone remains active for DNS, Bot Fight Mode, and Block AI Bots (zone-wide settings), but does not actively proxy or filter auth traffic.

**SMS-based MFA — explicitly rejected.** Considered and ruled out due to SIM swap attack vulnerability, NIST SP 800-63B deprecation of SMS as an authenticator, and per-message carrier cost. Do not revisit without strong justification (e.g., a specific user segment that genuinely cannot use TOTP, email OTP, or passkeys, AND a mitigation for SIM swap risk).

**AI transport — direct Gemini, not Lovable AI Gateway.** App AI features (`budget-insights`, `categorize-transaction`) route directly to Gemini via a Google Cloud API key (`GEMINI_API_KEY`), not through Lovable's AI Gateway. This decouples production AI availability from Lovable platform billing and usage. Shared helper at `supabase/functions/_shared/gemini.ts`.

## Feature backlog

### "Remember this device for 30 days" at MFA prompt

UX improvement on the login MFA challenge — lets users trust a specific browser/device to skip the MFA step for 30 days. Password change or explicit "revoke trusted devices" action kills all trust tokens immediately. Nice-to-have post-launch; not a launch blocker.

### Passkeys (WebAuthn) support

Long-term upgrade path from TOTP. Better UX (Face ID / Touch ID / Windows Hello), cryptographically stronger (phishing-resistant), no shared secret to leak. Supabase supports WebAuthn factors. Consider for the 2027 roadmap once TOTP + recovery codes are stable in production.

### Email-based OTP as MFA fallback

Send a 6-digit code to the email on file as an alternative second factor when the user doesn't have access to their authenticator app (and recovery codes are exhausted or unavailable). Weaker than TOTP but materially better than SMS, and serves users without smartphones. Post-launch.

### Floating "Ask Keeper" AI button (post-launch)

Global floating action button, persistent across all screens. Opens chat panel with context-aware prompt (current screen + user's household data).

- Use cases: app help ("how do I record a manual expense?"), category setup guidance, spending pattern recs, budgeting best practices, general financial questions
- Respects Stewardship Mode toggle
- Powered by Gemini 2.5 Flash (same as existing AI Insights) with CFP/CKA system prompt
- Consider rate limiting per household to control API costs
- Consider conversation history per user so follow-ups work

### Per-device session tracking (Option B from session management)

Current session management is just "sign out of all other devices." Full version would show a list of active sessions with device, approximate location, last active timestamp, and per-row revoke.

Known limitation if we build it: Supabase JWTs remain valid until their expiry regardless of whether we mark a session revoked in our own table — so revoked sessions can stay live up to ~1 hour until next token refresh. Document this in the UI if we ship it.

Requires: custom `user_sessions` table, IP geolocation API (paid), heartbeat for last-active, update to privacy policy.

### Net worth tracking

Plan tab feature. Combines with Plaid Investments + Liabilities (below) for full financial picture.

### Plaid Investments product

Link retirement/brokerage accounts.

### Plaid Liabilities product

Link mortgage, student loans.

## Polish / quick fixes

- Split transactions showing "Manual" label when parent is synced (bug — only actual manual splits should show label)
- Non-retirement goals mobile view (Education Fund) display is off
- Unassigned transactions on Home desktop — apply Activity-tab-style single-row formatting
- Plan tab tools: gray out / lock tools requiring profile sections that aren't complete
- Home tab: add Savings + Giving sections (desktop only, pill-style like Fixed)
- Activity tab: increase category text weight vs merchant subtext
- Plan tab CFP tool desktop polish (some tools still mobile-shaped on desktop)

## Post-launch UX polish

- Empty states polish
- Loading skeletons
- Dark mode
- Reconciliation flag for potential manual/synced duplicate detection

## Business / ops

### LLC spin-up

Still operating as sole proprietor (Joseph Perritt). Plan to have Chad spin up "Keeper Budget LLC" in next few weeks alongside Blackbridge work. Will update Plaid Compliance Center and transfer Plaid account ownership once LLC exists.

### App Store submission prep

Screenshots, privacy policy, Capacitor iOS testing, TestFlight.

## Business / pricing

### Build comprehensive Keeper unit economics model

Inputs: Gemini API cost per generation call (~$0.0013), Plaid per-item monthly cost, Supabase tier thresholds, Resend email volume, projected hosting. Revenue side: pricing model TBD (subscription tier, freemium, per-household). Need to model gross margin per subscriber at 1K, 10K, 50K subscribers, identify cost cliffs (when does a tier upgrade hit), and determine break-even pricing. This is a strategic exercise to do as a dedicated Excel pro forma session, not piecemeal.
