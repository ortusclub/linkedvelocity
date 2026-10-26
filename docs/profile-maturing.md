# Profile Maturing

Admin route: `/admin/profile-maturing` (Ambassadors → Profile Maturing).

Use **Add account to mature** to search eligible inventory, select **Set up campaign**, configure the original Outreach editor, then choose **Start campaign**. Existing active accounts link to their campaign instead of creating duplicates. After launch the new campaign opens automatically; merely selecting an account or editing does not start activity.

This page reads and controls the existing Outreach cloud campaigns at `https://scraper.ortusclub.com`. It does not run another worker or copy campaign state into PostgreSQL. Only maturing campaigns owned by a `@linkedvelocity.com` operator are exposed. Every API request requires admin authorization; mutations also require the same browser origin.

`src/lib/maturing/shared` contains the desktop plan editor, schedule, pool, ramp and board modules from Outreach v3.1.128 (10a6b902). The editor fetch adapter uses authenticated server routes. Warm campaigns allow only the LinkedVelocity pool. Recipients must have a matching LinkedVelocity inventory profile and be unrented, unrestricted, available and not removed. The same rule is enforced in server dispatch, not only the editor. Ortus and combined pools are rejected. Credentials remain server-side.

Production settings: `MATURING_ENGINE_TOKEN`, optional `MATURING_ENGINE_URL`, existing `DATABASE_URL`, `GOLOGIN_API_TOKEN`, and `GOLOGIN_API_TOKEN_KLABBER`. Do not commit values.

Auto-start (optional). `/api/cron/auto-start-maturing` (every 15 min) starts a maturing campaign automatically when an account reaches **Level 4** (its application is verified / passed QC) and either has **never** had a campaign or its previous campaign **failed** (see retry below). It uses a **warm-only** ramp (LinkedVelocity recipients only; cold is a deliberate post-onboarding step): an aggressive 10 → 18 → 25/day over 7 days for clean accounts, or a **gentle** 2 → 5 → 8/day over 14 days for accounts restricted/recovered in the last 30 days (fragile — warmed slowly per the restriction-avoidance SOP). It is **off** unless `MATURING_AUTOSTART=on`, and starts at most `MATURING_AUTOSTART_MAX` (default 5) campaigns per run so a backlog can't fire all at once. It excludes only the hard cases: rented accounts, accounts with an explicit restriction mark (`restrictedAt` / permanently restricted), removed/retired/maintenance accounts, and any profile with a campaign that is still **running** or that already **completed** ("done"); it does nothing while the engine is unavailable. **Retry:** a profile whose campaigns have **all failed** (`cancelled` / `error`) is restarted with a fresh replacement plan (excluding anyone already contacted), but only once per cooldown window (`MATURING_RETRY_COOLDOWN_H`, default 24h) so a permanently-broken account can't re-fire every tick — it just fails again on its own, per the no-gate policy. There is deliberately **no readiness gate** beyond that — a verified account that can't actually run (a login challenge, a stale/unresolved security email, a health check that flagged it) is still allowed to start and simply fails on its own, rather than being held back. (Reconcile matches this: it auto-stops a campaign only for a rental or an explicit restriction mark, not for a health flag.) Each start is logged to the account's Activity timeline. To tune the ramp, edit `autoWarmPlan` in the cron route.

The board progressively fetches current warm/cold activity, refreshes every 30 seconds while visible, and paginates accounts and workbook recipients. Pause, continue, stop and acceptance checks use the same engine endpoints as Outreach. Starting a plan uses a per-account database advisory lock and deterministic dispatch IDs. Existing active campaigns must be stopped explicitly before a replacement; prior attempted recipients are excluded. Rented/restricted accounts cannot start or resume.

Local desktop-only settings (including its local blocklist and hidden-row preferences) are not synchronized by the engine. The website does not expose desktop browser windows. Cold pools should be maintained with the appropriate exclusions in the source sheet. Opening the page never launches activity.

Validation:

```
node --test tests/profile-maturing.test.mjs tests/profile-maturing-api.test.cjs
npx tsc --noEmit
npm run build
CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node tests/profile-maturing-browser.cjs
```

The browser test uses local API fixtures on port 3127 and sends no real outreach. Live verification should read the engine and inventory; do not launch test campaigns against real recipients.
