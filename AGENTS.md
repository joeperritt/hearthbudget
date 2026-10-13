# AGENTS.md

- Auth is plain email/password via the built-in auth client; no app-level MFA/CAPTCHA layers — the app serves a fixed, closed set of users with signup disabled at the auth level.
- Outbound auth links use `getPublicOrigin()` — preview hosts require a Lovable login, so links route to the published app.
- Budget amount edits for future months go to `budget_amount_overrides` and are promoted at month rollover — so closed/current months are never retroactively changed.
- Home page cards come from a per-user list (`user_home_layouts.cards`, falling back to a default order) — so each person's Home can differ later without code changes.
