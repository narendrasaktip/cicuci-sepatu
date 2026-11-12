# Cicuci frontend MVP

Indonesian operational UI using the implemented backend contract in `../api/API.md`. No backend/schema changes.

## Run / validate

From repository root:

```sh
npm run dev:web
npm run typecheck -w apps/web
npm run lint -w apps/web
npm run build -w apps/web
npx playwright install chromium
npx playwright test apps/web/test/smoke.spec.mjs --workers=1 --output=apps/web/test-results
npx playwright test apps/web/test/mvp.spec.mjs --workers=1 --output=apps/web/test-results
```

Use the exact origin configured by backend `APP_BASE_URL`, not a different localhost alias: login checks Origin. Public landing is `/`; admin login/workspace is `/admin`; tracking remains `/track/<token>`. Hosting must rewrite `/admin` and `/track/*` to the SPA entry and proxy `/api` to the API.

Set `VITE_PUBLIC_WHATSAPP_NUMBER` in the web build environment to the owner's verified public WhatsApp number in international digits only (no `+`, spaces or punctuation). It is embedded in the public frontend at build time, not a secret. Missing or invalid values show an unavailable-contact message. Rebuild to change it; the connected WhatsApp account is not automatically published.

## Implemented

- Dashboard live counts, ledger receipt date range; paginated order search, aggregate status, overdue filtering.
- Customer create/edit/detail, paginated customer orders, explicit WhatsApp opt-in.
- Service catalog; owner create/edit/deactivate. Owner users, password/role/active changes, settings, audit.
- Multi-shoe intake, active service price selection, quote, assignment ID, ETA/pickup metadata. Item editing/addition before backend locks.
- Independent shoe inspection, immutable result, private evidence, risk issue/reissue/documented return. Backend enforces transitions, zero rejection fees, consent locks and QC guards. UI offers state-specific actions, QC pass/rework reason and handover/return confirmation.
- PNG/JPEG JSON base64 uploads, client type/10 MiB checks, authenticated photo access/deletion, private/public distinction. Backend remains authoritative for image structure and workflow evidence.
- Immutable payment/refund ledger; owner-only refunds; confirmation explicitly states no external money transfer.
- Tracking token rotation/revocation, one-time secure manual URL sharing. Tokens stay in component memory, never local/session storage. Consent tokens use URL fragment, removed from address bar on page load. Referrer policy same-origin; external/photo links explicitly suppress referrers.
- Public tracking, safe backend fields only, shoe timelines/photos, price/risk/expiry/decision, single-use approval/decline confirmation.
- Notification statuses/attempts/reasons, no manual retry. Historical simulations remain historical; no fabricated delivery status. Owner-only unofficial WhatsApp Web pairing/status/disconnect, separate outbound risk acknowledgement. No credentials collected in browser. See [pairing/security](../../docs/WHATSAPP.md).
- Strict TypeScript, session cookies/CSRF/UUID idempotency, explicit API errors, session expiry return to login, native accessible dialogs/forms/focus, mobile navigation and tables.

## Verification: 2026-11-11

Passed root/web typecheck, zero-warning lint, production build. Actual Chromium browser suite: **2/2 passed** after recovering the stopped local MySQL service and fixing stale-token assertions.

Verified real owner login/CSRF, service/customer creation with opt-in, three-shoe intake, BEFORE/private INSPECTION/AFTER uploads, approved/risk/rejected inspections, manual secure URL, mobile public tracking, internal-note redaction, fragment removal, approval, washing/drying/finishing, QC failure/rework/pass, payment/refund, return, token rotation/revocation, notification API check, owner navigation and logout. Mobile smoke checks keyboard skip link, DEV preview, public invalid-token handling and no runtime page errors. No leftover fixtures reported after successful runs.

Backend real-DB workflow and actual Redis/BullMQ tests passed separately, covering concurrency, expiry/single-use/reissue/decline, guards, RBAC/CSRF and delivery failure/deduplication. Browser coverage is not exhaustive for every negative/role/configuration mutation.

Tests bootstrap a randomly named temporary owner directly in the configured development database; operational actions use browser/API. Cleanup targets only captured fixture records/keys. Do not run against production. Database loss can interrupt cleanup; inspect only `web-<UUID>` fixtures before any manual removal. No reset/drop/truncate is used. Generated reports can contain temporary test credentials/tokens; do not publish them.

## Deliberate MVP ceilings

- Owner assignment dropdown/detail active-service choices load first 100 records; intake service choices fetch all pages. Admin assignment uses validated user ID because no admin-accessible user-list contract exists.
- WhatsApp Web is the sole operational provider; owner can pair without sending. Explicit owner activation plus current customer consent required for new real events. No Meta Cloud API connection endpoint; WhatsApp Web is unofficial.
- Manual secure sharing only; reload loses secret tokens. Rotation/reissue explicitly replaces lost tokens. No automatic WhatsApp delivery, reminder scheduling, template editing, payment gateway or image transcoding.
- No automated screen-reader audit, Firefox/WebKit run or production hosting test yet.
