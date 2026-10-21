# AGENTS.md

- Auth is plain email/password via the built-in auth client; no app-level MFA/CAPTCHA layers — the app serves a fixed, closed set of users with signup disabled at the auth level.
- Outbound auth links use `getPublicOrigin()` — preview hosts require a Lovable login, so links route to the published app.
- Budget amount edits for future months go to `budget_amount_overrides` and are promoted at month rollover — so closed/current months are never retroactively changed.
- Home page cards come from a per-user list (`user_home_layouts.cards`, falling back to a default order) — so each person's Home can differ later without code changes.
- Home's Budget shortcut receives its count and navigation callback from Index's existing active-month transaction state — so realtime updates and Activity filtering reuse budget logic without a second query.
- Calendar events carry stable calendar IDs; ownership only sets default visibility, and per-user visibility is saved via an atomic invoker RPC on user_home_layouts — so toggles preserve card order, respect RLS, and sync across devices.
- To dos live in home_list_items (list_type 'todo') with user_id as owner (null = Family); owner colors derive from each owner's calendar color, and chip visibility saves via an invoker RPC into user_home_layouts.todo_visibility — so to dos and calendars stay visually consistent.
- Reminder notification actions route through the signed-in app; snoozes use an invoker RPC with the current user's reminder row — so no session tokens are stored in the service worker and recurring rules stay unchanged.
- Scheduled-job log retention runs as one bounded SQL-only cron command with statement and lock timeouts and a post-cleanup size safeguard — so log growth is contained without an extra HTTP worker.
- Calendars without a Google Calendar ID or with read_only set are view only, enforced by a DB trigger, the shared writeBlockReason guard in calendar write functions, and isCalendarWritable in pickers — so no client can write to them.
