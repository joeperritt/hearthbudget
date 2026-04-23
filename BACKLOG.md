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

**Known gotcha (April 23, 2026):** This list must contain ONLY real production domains. NEVER add preview/dev domains like `hearthbudget.lovable.app` or any `*-preview--*.lovable.app` URL — doing so locks system_admins out of the test tool everywhere usable (preview iframe URLs aren't navigable directly). The published `hearthbudget.lovable.app` URL was briefly in the block list and had to be removed.

## Phase 4 remaining

### Phase 4C — MFA / 2FA via TOTP

Next major auth block after 4B is complete. Knocks out one of the remaining Plaid compliance items.

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
