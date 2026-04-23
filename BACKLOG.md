# Keeper Backlog

Running list of things to get to, known limitations, and stuff to remember about this project. When working with Lovable, you can point it at this file: "check BACKLOG.md."

Last updated: April 23, 2026

## Security — pre-launch

### Cloudflare WAF in front of keeperbudget.com

Put the domain behind Cloudflare (free tier is fine) before any real marketing or public launch. Gives us:

- Real IP-based rate limiting at the edge (covers the gap left by Lovable Cloud not exposing GoTrue CAPTCHA config)
- DDoS protection
- Bot detection
- Additional layer in front of Supabase auth

This is the proper fix for the login/password-reset CAPTCHA enforcement gap below. Required before we scale.

**Also covers MFA rate limiting (April 23, 2026):** The MFA verify lockout (5 failed attempts → 15 min, in `mfa-verify-totp` and `mfa-verify-recovery-code` edge functions, backed by `public.mfa_attempt_log`) is implemented in application code on top of Postgres. It works for casual abuse but has known race-condition gaps under parallel load and is per-user, not per-IP. Cloudflare WAF is the proper distributed rate-limit layer for MFA verify endpoints — once it's in front of the project, layer IP-based rate limits on the `/functions/v1/mfa-verify-*` paths and the app-layer counter becomes a defense-in-depth backup rather than the primary control. **Linked: see "Phase 4C — MFA / 2FA via TOTP" below.**

### GoTrue CAPTCHA enforcement limitation

Lovable Cloud does NOT expose GoTrue env vars. This means native server-side CAPTCHA validation on login and password reset is NOT enforced — only on signup (via our custom edge function).

Mitigations currently in place:

- Turnstile widget renders on login + password reset pages (adds friction for bots)
- HIBP password check on
- Supabase default per-IP rate limits (30 per 5 min on sign-in attempts)

If we ever see credential-stuffing or reset-spam patterns in logs, the answer is Cloudflare WAF (above), not migrating to self-hosted Supabase. Confirmed by Lovable support April 23, 2026.

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

## Feature backlog

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

- Loading page still shows "H" not "K"
- Browser tab icon has white border
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
