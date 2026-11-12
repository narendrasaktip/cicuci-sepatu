# Backend MVP: implemented integration contract

This document describes the running backend, superseding proposed contracts in the root docs. Scope: apps/api only. No frontend changes.

## Transport / authentication

- Base: `/api/v1`; development proxy `http://localhost:5173/api/v1`.
- JSON bodies, strict unknown-field rejection. Money: integer IDR, 0..100000000 per amount. Dates: ISO UTC datetime strings. IDs: opaque strings. Default body limit 16 KiB; photo upload 3 MiB JSON.
- `POST /auth/login {email,password}`: 204 + HttpOnly SameSite=Lax session cookie. Origin must match configured APP_BASE_URL. `GET /auth/me`: `{user:{id,name,email,role},csrfToken}`. `POST /auth/logout`: 204.
- Every authenticated mutation requires session cookie, `X-CSRF-Token`, UUID `Idempotency-Key`. Send `{}` for no-body actions. GET requests must not include unsupported query fields.
- Repeating a key with the same session/method/URL/validated input returns the same successful response. Different payload returns 409. Concurrent collisions can return 409; retry the same key. Keys are session-scoped. Cached responses AES-256-GCM encrypted using session CSRF material; raw tracking/approval tokens never persist unencrypted. No automatic idempotency retention cleanup yet.
- Errors: `{error:{code,message,details?}}`. 400 validation/upload, 401 unauthenticated, 403 role/assignment/CSRF, 404 missing/revoked token, 409 conflict/workflow guard, 410 expired approval, 413 oversized, 429 rate limit.
- OWNER: all. ADMIN: customers/orders/inspection/payment/photos/notification review. STAFF: catalog, assigned work only, processing transitions/photo upload; no configuration/customer lists/payment writes/handover. Owner-only refunds/users/services/settings/audit. Last active owner cannot be disabled/demoted. Password/role/disable changes revoke target sessions.
- Public tracking/consent do not use session, CSRF or idempotency headers. Bearer token authorization; consent itself consumes a single-use action token. Public rate limit: 90/minute/IP, process-local.

## Lists

Lists return `{data:[...],page:{nextCursor:string|null}}`. Query `cursor`, `limit` (1..100, default 25), `q` where supported. Default cursor order: ascending opaque ID, not chronological order.

Orders additionally accept `sort=createdAt|customer|status|estimatedCompletionAt` and `direction=asc|desc` (default asc). Sorting applies before pagination; customer sorts by stored name, status groups by stored aggregate status code. Equal values use ID in the same direction. Changing sort resets the UI cursor.

| Route | Input / behavior |
|---|---|
| GET /customers | q matches name/WhatsApp |
| POST /customers | `{name,whatsapp,notes?,notificationConsent:boolean}`; 201 |
| GET /customers/:id | Customer record; orders via `/orders?customerId=...` |
| PATCH /customers/:id | Partial create fields. Explicit true records consent timestamp; false clears it |
| GET /services | q matches name; `active=true|false` optional |
| POST /services | `{name,basePriceIdr,isActive?}`; owner; 201 |
| PATCH /services/:id | Partial create fields; owner |
| GET /users | q matches name/email; safe fields only; owner |
| POST /users | `{name,email,password,role,isActive?}`; password 12..128; 201 |
| PATCH /users/:id | `{name?,password?,role?,isActive?}`; no email mutation |
| GET /settings | `{id:1,name,pickupInstructions,consentHours}`; owner |
| PATCH /settings | `{name?,pickupInstructions?,consentHours?}`; expiry 1..168 hours |
| GET /audit | Paginated actor/action/entity/timestamp; owner |

WhatsApp normalized: 08… to +628…, 62… to +62…, spaces/hyphens/parentheses removed; international E.164 form required afterward. Notes max 4000 characters; names/brand/model/color max 100.

## Orders / items

Creation estimate: server uses the actual persisted `createdAt`, not form opening/client time. Five inclusive calendar days in Asia/Jakarta; weekends count. Before 12:00 WIB, that date is day 1; at/after 12:00, tomorrow is day 1. Tuesday 11:59 gives Saturday; Tuesday 12:00 gives Sunday. Estimated timestamp is 23:59:59.999 WIB (16:59:59.999 UTC), not midnight. `estimatedCompletionAt` on POST is optional for legacy callers: if present it must remain valid ISO UTC, but its value is ignored. Same-key replay preserves the original response/estimate; existing request fingerprint conflict rules remain. Existing records and PATCH estimate editing are unchanged.


`POST /orders` (201):

```json
{
  "customerId": "opaque-id",
  "pickupInstructions": "Bring receipt",
  "items": [{"serviceId":"opaque-id","brand":"Nike","model":"Air Force 1","color":"White","initialNotes":"Internal notes","quotedPriceIdr":50000,"assignedUserId":null}]
}
```

1..50 items. Active service required. Service name/base price snapshot; quote optional defaults to service price. Unique order number. Returns full order plus `trackingToken`, `trackingPath` once (same-key replay permitted). Store token securely; normal order reads never return token/hash. Tracking path is an API path, not a frontend page URL.

- `GET /orders`: q matches number/customer name/WhatsApp; `status`, `customerId`, `overdue=true|false`, `assignedUserId`. STAFF constrained to assigned orders. Summaries include customer name, item count, aggregate and financial fields.
- `GET /orders/:id`: items, immutable inspection, sanitized consent records, history, photo metadata, payments/customer for admin. STAFF receives assigned items only, no customer/contact record or ledger.
- `PATCH /orders/:id {estimatedCompletionAt?,pickupInstructions?}`.
- `POST /orders/:id/items`: same item input, 201. Only before any payment ledger entries, before completion, max 50 items.
- `PATCH /items/:id`: partial item input, only RECEIVED/INSPECTION. Cannot directly write status/outcome/final fee.
- `POST /items/:id/assignment {assignedUserId:string|null}`: admin, active user, nonterminal item.
- `POST /items/:id/transition {toStatus,reason?,qcPassed?,dryConfirmed?,finishingConfirmed?}`: returns updated order (STAFF sanitized). Owner/admin can process any item; STAFF only assigned item.

### Locked state machine

All item mutations, approvals and ledger operations lock the parent order in a READ COMMITTED transaction; history, audit, derived aggregate and outbox commit atomically. No manual status override.

| From | To / guard |
|---|---|
| RECEIVED | INSPECTION |
| INSPECTION | Inspection endpoint below chooses QUEUED / AWAITING_CONSENT / RETURN_PENDING |
| AWAITING_CONSENT | Customer APPROVE: QUEUED; DECLINE: RETURN_PENDING; documented admin return permitted |
| QUEUED | WASHING; approved inspection or consumed APPROVE consent required |
| WASHING | DRYING or FINISHING |
| DRYING | READY_FOR_PICKUP (guard below), REWORK (failed QC + reason), FINISHING (legacy) |
| FINISHING | READY_FOR_PICKUP (guard below), REWORK (failed QC + reason), QC (legacy) |
| QC | READY_FOR_PICKUP: qcPassed=true + dryConfirmed=true + finishingConfirmed=true + customer-visible AFTER photo + approved/consented; REWORK: qcPassed=false + nonempty reason |
| REWORK | WASHING or FINISHING |
| READY_FOR_PICKUP | HANDED_OVER; admin only, payment independent |
| RETURN_PENDING | RETURNED; admin only, cleaning fee remains zero |

`POST /items/:id/inspection {outcome,notes?,findings?,risk?,customerNote?,quotedPriceIdr}`: ADMIN/OWNER, RECEIVED or INSPECTION only, at least one BEFORE photo. outcome APPROVED / NEEDS_CONSENT / REJECTED. Risk branch requires meaningful findings/risk (trimmed 3..3000 characters); private INSPECTION photo optional, never exposed publicly if supplied. Internal notes remain private. Inspection immutable, public evidence/quote snapshotted. Rejected immediately zero fee. Pending risk zero accepted fee until explicit customer approval. Returns `{order,consent?}`; consent contains `{approvalToken,expiresAt,consentId}`. Owner/admin must securely share action token manually when notification is blocked. Optional photo requires no new schema/migration; existing structured-inspection/display-settings migrations remain unapplied, API activation separately authorized.

- `POST /items/:id/consent/reissue {}`: invalidates all unconsumed actions; new token and expiry.
- `POST /items/:id/consent/return {reason}`: documented return, invalidates actions, DECLINED, fee zero.
- Expiry is enforced at decision time and exposed as `expired` in tracking. Expiry never silently declines a shoe. Admin reissues or documents return; no expiry cron needed for correctness.

Aggregate priority: all terminal COMPLETED; any ready READY_FOR_PICKUP; any washing/drying/finishing/QC/rework IN_PROGRESS; any consent AWAITING_CONSENT; any received/inspection WAITING_INSPECTION; return RETURN_PENDING; otherwise QUEUED. Always derived, never client-written.

## Photos: implemented JSON upload, not multipart

`POST /items/:id/photos` (201):

```json
{"kind":"BEFORE","customerVisible":true,"mime":"image/png","base64":"canonical-base64-without-data-url-prefix"}
```

- BEFORE / INSPECTION / AFTER; INSPECTION must remain private.
- Max 10 MiB decoded (10 × 1024 × 1024 = 10,485,760 bytes; inclusive), 20 images/item, max 16 million pixels. PNG signature/chunk bounds/CRC/IEND/inflate validation (128 MiB decompression ceiling); JPEG signature/frame bounds/dimensions/scan/end checks. Only PNG/JPEG input; SVG/HTML rejected.
- New uploads additionally decode through Sharp (16 MP limit, warnings/errors rejected), auto-orient, resize inside 1600 × 1600 without enlargement, encode WebP quality 85, strip metadata. Target 200–500 KB is approximate, never guaranteed; no quality reduction loop. Corrupt input/conversion failure returns 400 UPLOAD_INVALID; no original-byte fallback or photo write. No malware scanner.
- Store only resulting WebP bytes privately in existing MySQL MEDIUMBLOB with `mime:image/webp`; no public static directory/path. Metadata returned: `{id,kind,mime,customerVisible}`. Existing MIME varchar accepts WebP; no schema change, migration or backfill. Historical bytes/MIME unchanged. Admin/public binary responses use each record's stored MIME; existing assignment/token/order/visibility guards unchanged.
- `GET /photos/:id`: authenticated binary; STAFF assigned only.
- `DELETE /photos/:id {}`: admin. Returns `{deleted:true}`. Ready/terminal photos locked; inspection evidence and intake BEFORE cannot be deleted after inspection.
- No uploads after handover/return. History evidence retained.

Photo upload size contract: 10 MiB = 10,485,760 decoded bytes, inclusive. Canonical base64 maximum 13,981,016 characters; upload-route JSON body maximum 13,982,040 bytes (base64 ceiling + 1 KiB metadata/whitespace). Other JSON routes retain 16 KiB. Decoded size remains authoritative: 10 MiB + 1 byte is rejected even when base64 has the same encoded length. Oversized body returns 413 UPLOAD_INVALID; invalid image/decoded size returns 400 UPLOAD_INVALID; schema overflow returns 400 VALIDATION_ERROR. PNG/JPEG structure, pixel/decompression bounds, private inspection evidence, authenticated access and tracking visibility remain unchanged. JSON/base64 only, no multipart. API restart requires separate authorization; no runtime restart performed.

## Tracking / consent

- `GET /track/:token`: only order number/ETA/instructions/aggregate/financial summary; shoe identity, service, status/outcome/quotes/final fees, risk snapshots/expiry/decisions; timeline only status/time; visible BEFORE/AFTER paths. No customer record/contact, staff IDs, internal notes/reasons, payment references, notification records, token hashes, private photo bytes or storage metadata.
- `GET /track/:token/photos/:id`: binary, order-bound + visible BEFORE/AFTER only.
- `POST /track/:token/consent {approvalToken,decision:"APPROVE"|"DECLINE"}`: matches order/item/action; unconsumed and unexpired; atomic single use. Returns `{decision}`. Concurrent second use 409. Decline fee zero.
- `POST /orders/:id/tracking-token/rotate {}`: `{trackingToken,trackingPath}`; old token invalid immediately.
- `POST /orders/:id/tracking-token/revoke {}`: both fields null; can rotate afterward.
- Tokens: 32 random bytes, SHA-256 at rest, no plaintext audit/event payloads. Tracking revoke/rotation also invalidates old tracking photo paths and consent access through old tracking token. Action tokens remain separately bound to their item.

## Immutable payment / refund ledger

- `POST /orders/:id/payments {amountIdr,method,reference?,reason?,receivedAt}`: admin, 201 updated order. Positive amount; method CASH/TRANSFER/EWALLET/OTHER. Requires all inspection outcomes finalized, no awaiting consent. Reject overpayment under order lock.
- `POST /orders/:id/refunds`: same input, OWNER, mandatory nonempty reason, positive amount <= current net paid. 201 updated order. Refunds append independent ledger entries; do not edit/delete/void historic money.
- No `/payments/:id/void`; corrections use explicit refunds. No payment gateway, payment QR or external transfer occurs.
- `totalIdr` sum final accepted fees. `paidIdr` payments minus refunds. `balanceIdr=total-paid`. `paymentStatus`: UNPAID / PARTIAL / PAID / REFUNDED (net zero after a refund). Zero-fee never-paid order remains UNPAID. Payment never blocks washing/ready/handover or changes laundry status.

## Dashboard / notification admin

- `GET /dashboard?from=ISO&to=ISO`: activeOrders/overdue count orders; waitingInspection/awaitingConsent/inProgress/readyForPickup count items. Revenue is net ledger receipts in range (not accounting accrual revenue). STAFF scoped to assigned orders, revenue omitted.
- `GET /notifications`: pagination plus `status`, `template`, `orderId`; events/attempts; `provider` reports configured server provider; `actualOutbound:false` is not a delivery claim (consult per-event attempts/status). q matches recipient/template/event key.
- `POST /notifications/:id/retry {}`: compatibility endpoint; existing records return 409 NOT_RETRYABLE without mutation. No historical or ambiguous event replay. Automatic pre-submission not-ready retries remain bounded to five attempts with backoff.
- Receipt, every item transition/inspection outcome, consent issue/reissue create atomic outbox entries; eventKey unique, history/consent IDs prevent duplicates. No controller calls provider.
- Worker polls committed PENDING outbox every 3 seconds, BullMQ jobs dedupe by event ID/generation. Current opt-in, recipient, item state, consent expiry/consumption rechecked before delivery. Stale/opted-out events SKIPPED with reason; pre-submission not-ready failures bounded; ambiguous submission FAILED without retry; SENT means browser submission, not receipt. SIMULATED is historical only. All attempt responses recorded. Notification failure cannot roll back business transaction.
- Provider has no outbound network calls. Consent/tracking action links are deliberately not persisted inside message payloads. Manual secure token sharing required until an official provider and encrypted delivery-secret storage are implemented. Pickup-reminder scheduling/template editing outside MVP; settings cover store name/pickup instructions/consent lifetime.

## Operations / verified checks

From repo root:

```sh
npm run db:generate
npm run db:deploy
npm run typecheck -w apps/api
npx tsc --noEmit -p apps/api/test/tsconfig.json
npx eslint apps/api
npm run test -w apps/api
npm run test:integration -w apps/api
RUN_QUEUE_TESTS=1 node --env-file=.env --import tsx --test apps/api/test/queue.test.ts
npm run worker -w apps/api
```

Deploy script refuses any DATABASE_URL database except cicuci_sepatu_dev. Forward migrations 002/003 deployed without reset/drop/truncate. Live introspection was blocked by pre-existing MariaDB mysql.proc version mismatch; migration SQL generated from foundation datamodel to target datamodel with Prisma migrate diff (no shadow DB), then migrate deploy succeeded. No MariaDB system tables changed.

Tests create random isolated fixture records in cicuci_sepatu_dev and delete captured IDs child-first; no global cleanup/reset. Workflow suite uses real login/CSRF and live Vite proxy at 5173, real MySQL. Queue suite needs running Redis/worker. Regular unit suite skips opt-in live tests. Verified full workflow plus concurrent transitions/single-use consent, expiry/reissue/decline, rejected zero fees, QC/rework/photo guard, ledger overpay/refund bounds, rotation/revocation, public redaction/private photos, RBAC/CSRF, idempotency, manual-retry rejection/current opt-out/stale skipping, actual BullMQ safe skipping without activation.

Development Redis installed via brew, bound to loopback with persistence disabled; MySQL outbox remains durable and repopulates lost queue jobs. Redis/worker left running in terminals. No production persistence/service supervision configured. Public/login rate limiting remains process-local. Dashboard currently computes in application memory; SQL aggregation needed at larger volume. Images are signature/structure validated, not fully decoded/re-encoded. Production target migration allowance intentionally requires an explicit reviewed change.

## Owner WhatsApp Web control

- `GET /api/v1/whatsapp/status`: OWNER only; no-store; signed fresh worker status, expiring QR PNG, browser readiness, actual outbound activation, last command. Offline if stale.
- `POST /api/v1/whatsapp/start|disconnect|deactivate`: strict `{}`.
- `POST /api/v1/whatsapp/activate`: `{ "acknowledgeRisk": true }`; API and worker must explicitly configure real provider; browser ready required by worker.
- All mutations: owner session + CSRF + exact Origin + UUID Idempotency-Key; 202 means queued, not complete. Signed command expires after 30s; repeated key deduplicates 24h. Read status for completion. Rate limit 12/minute.
- Notification events expose immutable provider/activation; no events manually retryable. SENT is browser submission, not customer delivery. [Setup/security/limitations](../../docs/WHATSAPP.md).

Authorized simplified workflow: four operator stages Pemeriksaan, Pengerjaan, Pengeringan, Siap diambil; terminal Sudah diambil. Direct inspection finalization and DRYING/FINISHING readiness create only actual source/destination history and notification events, never synthetic FINISHING/QC events. Ready guards above apply to DRYING, FINISHING and QC; explicit completion confirmations audited as READY_DRY_FINISHING_QC_CONFIRMED. Upload-first contextual forms use stable idempotency keys and reuse saved evidence on retry. Legacy transitions remain valid.

## Smart package pricing — approved 2026-11-11 (historical v1; named-plan amendment below)

One OrderItem represents **one pair**, not a single shoe. New UI orders choose only Promo/Normal. Server resolves reserved internal cleaning service `cicuci-cleaning-v1` (`Cuci sepatu`, base price 0, active), idempotently inside the order transaction; never chooses/renames historical services. A conflicting reserved record fails closed. Menu Tarif pesanan displays readonly rates from authenticated GET /pricing/rates, calculated by packageTotal; legacy catalog management remains under Lanjutan: layanan lama with existing role permissions. Internal service edits are blocked; basePriceIdr is not the smart tariff. Existing manual orders (`pricing = NULL`) keep historical/manual behavior and editing.

| Pairs | Promo IDR | Normal IDR |
|---|---:|---:|
| 0 | 0 | 0 |
| 1 | 45,000 | 50,000 |
| 2 | 90,000 | 100,000 |
| 3 | 130,000 | 145,000 |
| 4 (3+1) | 175,000 | 195,000 |
| 5 | 210,000 | 225,000 |
| 6–9 | 41,000/pair | 45,000/pair |
| 10+ | 40,000/pair | 43,000/pair |

No artificial tier splitting. Integer rupiah allocation: sort item IDs, floor(total/count), distribute remainder one rupiah to earliest IDs. Snapshot v1 preserves rate mode, service, initial estimate, stage, allocations, agreement time and original agreed total/allocations.

Initial estimate counts all pairs. Rejected/risk-declined pairs always zero. Before all inspection/risk decisions finish, show ESTIMATE, not final charges. All decisions finished: FINAL, visible through admin/tracking before work. Explicit customer tracking confirmation, or admin confirmation with actual customer agreement evidence, locks the displayed total; stale totals rejected. Risk consent alone never locks prices. Work/payment blocked until LOCKED. Idempotent confirmation does not create another agreement. No mode/service/manual-price changes after lock. Later explicit cancellation with reason zeroes only that pair; remaining locked allocations never increase/repackage. Original agreement and audit metadata remain available. Payment/refund ledger immutable; excess is refundDueIdr/negative balance, never fabricated refund. Actual refunds use existing owner ledger action.

Smart receipt/status notifications append pricing stage and total through the existing outbox, not direct sends; previous encrypted snapshots/history remain immutable. Automatic five-calendar-day estimate and simplified inspection/ready workflow remain unchanged. Nullable additive migration only; old workers ignore the new column, no worker restart needed. Tests use isolated DB/provider fixtures and browser route mocks, never real customer mutations or WhatsApp sends.

API additions: POST /orders accepts optional rateMode (PROMO/NORMAL); smart items omit serviceId and quotedPriceIdr. Optional explicit packageServiceId/item serviceId must equal the reserved internal identity; unrelated historical services are rejected for new smart orders. Without rateMode, each manual item still requires serviceId. Legacy omission retains manual behavior. POST /orders/:id/pricing/confirm requires {totalIdr, confirmed:true, reason}; POST /track/:token/pricing/confirm requires {totalIdr, confirmed:true}. POST /items/:id/decline-cleaning requires {reason}; admin only, smart orders only, records return transition. Responses expose pricing snapshot and refundDueIdr. Smart inspection omits quotedPriceIdr; legacy inspection still requires it.

## Named rate plans — approved 2026-11-11 (supersedes fixed-only UI tariff selection)

Owners may create arbitrary named plans (for example Christmast), rename, replace all rules, deactivate/reactivate. Owner permanent deletion supported; see deletion contract. RatePlan is separate from legacy Service/basePriceIdr. Existing catalog roles remain: authenticated OWNER/ADMIN/STAFF may read plans and preview; only OWNER may mutate plans. Order creation remains OWNER/ADMIN. CSRF required for every POST/PATCH. Catalog mutations and order creation require UUID Idempotency-Key, using the existing encrypted transactional response wrapper; replay returns the original response, changed payload/key reuse returns 409 IDEMPOTENCY_CONFLICT.

### Exact API contracts (relative to /api/v1)

- GET /pricing/plans, no query: unpaginated array of `{id,name,isActive,revision,rules}`, including inactive plans; stable name/id ascending order. No writes/default provisioning during reads.
- POST /pricing/plans: full `{name,isActive,rules}`; 201 with saved plan, revision 1. Name trimmed, 1..100 characters, unique case-insensitively by MySQL utf8mb4_unicode_ci (also accent-insensitive).
- PATCH /pricing/plans/:id: full `{name,isActive,rules,revision}`; 200 with updated plan, revision incremented. Partial updates rejected. Stale revision returns 409 REVISION_CONFLICT; missing plan 404 NOT_FOUND; duplicate name 409 CONFLICT. Owner DELETE supported; see deletion contract.
- POST /pricing/preview: `{rules,pairs}`; 200 `{totalIdr,breakdown:[{kind,quantity,pairs,priceIdr,totalIdr}]}`. Pure authenticated calculation; no persistence/idempotency key required. Preview pairs integer 0..50 (0 produces total 0, empty breakdown); actual orders 1..50 items. Client preview never determines saved charges.
- A rule is exactly `{kind:'PACKAGE'|'PER_PAIR',minPairs,maxPairs,priceIdr}`. Bounds integers 1..50; maxPairs may be null only for PER_PAIR (unbounded within order limit 50). PACKAGE requires maxPairs=minPairs. Rupiah integer 1..100000000. Rules array 1..100 entries. Unknown fields rejected at every boundary.
- Single-pair baseline mandatory: PACKAGE 1 (minPairs=maxPairs=1). PER_PAIR ranges cannot supply a package baseline. Duplicate package sizes, inverted ranges, overlapping PER_PAIR ranges, packages whose sizes lie inside any PER_PAIR range rejected. Every total for 0..50 must fit signed database Int (2147483647). Invalid input 400 VALIDATION_ERROR; unauthorized mutation 403 FORBIDDEN.
- POST /orders accepts ratePlanId, mutually exclusive with legacy rateMode (both return 400 PRICING_SELECTION_CONFLICT). Plan must exist and be active (409 RATE_PLAN_INACTIVE otherwise). Smart items omit serviceId/quotedPriceIdr; explicit service identifiers must equal canonical cicuci-cleaning-v1. Saved item.serviceName is the snapshot plan name; internal service relation unchanged. Omit both selectors for historical/manual intake, requiring per-item serviceId. Legacy rateMode PROMO/NORMAL continues creating version-1 fixed-tariff snapshots; GET /pricing/rates retains those original rates, never live plan edits.

### Deterministic pricing and immutable agreement

First choose a PER_PAIR range eligible for the **whole accepted pair count**; its per-pair price takes precedence even if packages would be cheaper. Otherwise minimize total cost using exact package combinations, reusable packages, no fractional pairs. PER_PAIR rates never apply outside their eligible whole-count range; package combinations use PACKAGE rules only. Equal-cost combinations prefer larger package size at each dynamic-programming choice, independent of input rule order. Breakdown PACKAGE quantity is package count, pairs is package size; PER_PAIR quantity is pair count, pairs is 1; totalIdr=quantity*priceIdr. No tier splitting.

New selected-plan snapshots are version 2: `{version:2,planId,name,revision,rules,serviceId,stage,initialTotalIdr,totalIdr,pairs,lockedAt,allocations,agreedTotalIdr?,agreedAllocations?}`. Rules/name/revision copied transactionally at intake. Later add-item/inspection/rejection/risk-consent changes recalculate solely from saved rules, never live catalog; editing/deactivation does not affect old orders. Snapshot plan name also preserved on item edits/additions. Version 1 and pricing=NULL manual behavior unchanged.

Pending inspection/consent stays ESTIMATE; all decisions complete becomes FINAL. Existing explicit customer/admin evidence confirmation locks allocations. Work/payment guards, zero rejected/declined fees, consent protection, post-lock cancellation without repricing remaining allocations, original agreement and immutable payment/refund ledger remain unchanged. Prices allocated by sorted item IDs, floor division, earliest-ID remainder.

Plan PATCH and selected-plan order intake acquire SELECT FOR UPDATE on the same RatePlan row inside the existing transaction. PATCH additionally uses revision compare-and-increment. Database unique name constraint arbitrates concurrent creates/renames. Audit RATE_PLAN_CREATED/RATE_PLAN_UPDATED records actor, entity, before/after in the same transaction; successful idempotent replay never duplicates audit or order.

### Defaults and deployment boundary

Additive migration 202611110009_named_rate_plans creates only RatePlan, unique name, revision and rules. Insert-only, idempotent defaults: Promo packages 1=45000,3=130000,5=210000; range 6–9=41000/pair,10+=40000/pair. Normal packages 1=50000,3=145000,5=225000; range 6–9=45000/pair,10+=43000/pair. Existing matching ID/name is not overwritten. No seed/startup/GET synchronization, no changes to orders, services, payment ledger or customer data. Generate Prisma client, then parent performs data-count-safe migration and API reload separately. This implementation does not deploy migration or restart API/worker, read secrets/profiles, or send WhatsApp.

Validation: isolated Node-hook/in-memory DB tests only; no live DB mutations. Real MySQL migration execution, collation/row-lock behavior and deployed frontend/backend integration require post-migration validation by parent.

### Fast turnaround (2026-11-11)
Named plans expose `turnaroundPolicy`: `REGULAR` (default for existing plans/omitted API input) or `FAST`; owner editor supports both. Policy is independent of mutable name. POST/PATCH plan accepts this field; PATCH still requires full name/isActive/rules/revision. New version-2 pricing snapshots copy policy with name/rules/revision; old snapshots default REGULAR on read, no historical rewrite.
Fast default is insert-only migration 202611110010_fast_turnaround: Rp80000 per item (=pair), reusable single-pair package supports 1..50 accepted pairs; rejected/declined cleaning fee remains zero. No startup seed/sync or overwrite of owner edits.
FAST estimate uses actual stored server `createdAt`, Asia/Jakarta: at/before exactly 17:00:00.000 WIB due next calendar day 17:00 WIB; 17:00:00.001 or later due following calendar day 17:00 WIB. Monday <=17:00 due Tuesday; later due Wednesday. Weekends/month/year/leap boundaries count. Not same-day or rolling 24h. REGULAR unchanged: 5 inclusive calendar days, before 12:00 counts current day, >=12:00 next day; due 23:59:59.999 WIB. Saved due never recalculated on inspection, plan edit/rename/deactivation or idempotent replay; existing authorized manual estimate edits remain available. Pricing/consent/payment locks unchanged.

## Permanent deletion — supersedes archive / no-hard-delete contracts (2026-11-11)
OWNER only: DELETE /customers/:id, /orders/:id, /pricing/plans/:id, /users/:id. CSRF + UUID Idempotency-Key required. Strict body {"confirmed":true,"confirmation":"HAPUS"}; missing/wrong confirmation 400, unauthorized 403, missing record 404. Successful response {id,deleted:true}; physical removal, no restore. Same-key replay returns original receipt without another deletion/audit.

Order deletion transaction locks order then notification rows (same order as worker claim), permits paid/partially paid/fully refunded orders while preserving every ledger entry, rejects PENDING/PROCESSING events or PROCESSING attempts (NOTIFICATION_IN_PROGRESS). Deletes photos (DB blobs), inspection, consent, status history, items, then order; tracking/photos/approval tokens cease resolving. Terminal notification events, encrypted snapshots and attempts remain: existing migration002 FK uses ON DELETE SET NULL. No send/replay/cancel/refund. Unexpected restrictive FK returns DELETE_DEPENDENCY; entire transaction rolls back, never deletes ledger, audit or delivery evidence.

Customers with any orders reject CUSTOMER_HAS_ORDERS; no cascade. Users referenced by assignments, inspections, status history or payments reject USER_HAS_HISTORY. Audit-only references do not block physical deletion; all existing audit rows and actorUserId values remain unchanged. Eligible deletion revokes sessions transactionally. Own account protected CURRENT_ACCOUNT; last active Owner protected LAST_OWNER with same ordered Owner locks as edits. API mutations lock/revalidate actor to serialize historical actor references against deletion. In-flight reads may finish.

RatePlan has no order FK: planId/name/rules/revision/policy are historical JSON snapshots; deletion leaves them unchanged. Unique plan names/user emails released only by physical delete. Success audit records actor, entity type/ID and confirmed:true only; no PII/password/token snapshots.

Kak/Pak/Bu remains; Kak default, edits affect future greetings only. Migration011 remains byte-for-byte unchanged: additive salutation plus reserved nullable archive columns, retained to avoid migration churn. No archive route/action remains; defensive old-column checks remain fail-closed. Migration011 reported UNAPPLIED; failed backup means no valid backup. No migration, deployment, service restart or worker change performed. Source features require a separately authorized safe deployment; real MySQL FK/locking validation still required.


## Paid-order physical deletion — source-only amendment (2026-11-11)

Supersedes the previous ORDER_HAS_PAYMENTS refusal. OWNER-only DELETE /orders/:id retains strict confirmation, CSRF, UUID idempotency and one transactional deletion audit. Paid, partially paid and refunded orders may be physically removed; deletion is not a refund or financial correction. Operational children/tracking disappear. Payment/refund ledger, historical audit, terminal notification snapshots/attempts remain. PENDING/PROCESSING events or PROCESSING attempts still return 409 NOTIFICATION_IN_PROGRESS; unexpected restrictive FKs return 409 DELETE_DEPENDENCY, rolling back the entire deletion. Audit failure also rolls back all deletion/detachment. Same-key replay returns its receipt without repeating effects; a new key against a missing order returns 404.

Migration source 202611110012_detached_payment_ledger adds required immutable Payment.originalOrderId (30 chars) and originalOrderNumber (50 chars), backfilled from the still-FK-protected original Order before weakening the FK. Payment.orderId and Payment.order become nullable; ON DELETE SET NULL changes only the live link. Historical amounts, methods, references, reasons, actors, receivedAt and createdAt are never rewritten. No customer PII snapshots added. Every new payment/refund uses the shared ledger writer to snapshot order ID/number under the existing order row lock. Required fields have no defaults; old writers fail rather than inventing identity. Migration011 remains unchanged.

Reference audit: shared ledger writer is the sole production Payment.create; no production ledger update/delete exists. Order detail/list/tracking/pricing use the live Order.payments collection and do not dereference Payment.order; detached entries intentionally do not attach to any order. User history guards still query Payment.actorUserId regardless of detached state. Dashboard queries Payment independently with an extant Order relation, sums PAYMENT minus REFUND only for surviving orders, and filters inclusively by receivedAt from/to, never by order creation/status. Detached payments/refunds remain physically retained but excluded from dashboard revenue; no surviving orders means revenueIdr 0. This overrides prior immutable-ledger dashboard semantics, not ledger/audit retention. STAFF neither queries the ledger nor receives revenue. Operational counts use surviving orders only. Workspace retains metrics clearing before refresh and reload after successful deletion/navigation; protected failures retain unchanged counts. No ledger browsing/reconciliation endpoint added.

Deployment PENDING. Source changes and isolated in-memory/fully mocked browser validation only; no real DB mutation, migration deployment, API/worker restart, secret/profile access or WhatsApp action authorized/performed. Existing running API still rejects real paid-order deletion until separately authorized migration/client/API deployment. Future deployment requires verified backup, quiesced writers, identity/count/sum verification, coordinated regenerated-client rollout; MySQL DDL is nontransactional, so inspect partial state before failed-migration recovery. Real MySQL backfill/FK/row-lock behavior remains untested. In-memory serialization tests verify application contracts, not InnoDB scheduling. Never apply this migration with old writers active.

Validation for this amendment: selected salutation-deletions backend regression passed (in-memory tables/import hooks; ephemeral loopback HTTP only); dashboard-deletion browser regression passed in classic/new presentations (2 tests, all API routes mocked fail-closed, service workers blocked, explicit Chrome). API/web typecheck, lint and builds passed. No full suite or order-customer browser test executed.

## Optional assignment (2026-11-11)
OWNER/ADMIN can transition eligible unassigned shoes without assignment writes. STAFF remains scoped to their own assigned shoes; handover/return still requires OWNER/ADMIN. Transition validation, risk consent, smart-price LOCKED agreement, photo/QC, transaction, audit, idempotency and outbox remain unchanged. Assignment endpoint remains optional, OWNER/ADMIN-only, accepts assignedUserId:null.

## Inspection establishes final pricing (2026-11-11; supersedes mandatory price agreement)
Completed staff inspections establish FINAL pricing automatically after outstanding explicit risk decisions are resolved. FINAL is sufficient for work/payment; no duplicate customer price-confirmation step. New FINAL snapshots carry verifiedAt/verifiedBy and PRICING_STAFF_VERIFIED audit evidence; never create customer consent, agreedTotalIdr/agreedAllocations, lockedAt or PRICING_CONFIRMED automatically. If the last event is a public risk decision, provenance refers to the recorded inspector, not the customer as staff.

Existing FINAL orders remain eligible by read-only validation of completed inspections, explicit consumed risk approvals, current item allocations/count/total, and nonpending statuses. No historical backfill or fabricated consent. Stale/mismatched prices fail PRICE_CHANGED; incomplete inspection/consent fails PRICE_NOT_FINAL. Historical LOCKED snapshots, original agreements and payment ledger remain intact. Existing explicit price-confirmation endpoints remain compatibility-only, never called automatically. Finalized smart orders cannot add/edit intake items. Historical FINAL/LOCKED allocations remain unchanged on reads and ordinary refresh. New authorized cancellation transitions opt into a separate current calculation using the original selected tariff snapshot and remaining eligible count; no average-allocation subtraction. Original agreement, staff provenance, initial estimate, consent evidence and payments remain unchanged; current allocations may increase when package eligibility is lost. Initial estimate, accepted-pair count, all-rejected zero and refund accounting remain accurate. STAFF assignment scope unchanged; OWNER/ADMIN need no assignment. Risk consent remains explicit and separate. No schema change/migration.


### Cancellation repricing and public tracking — current amendment 2026-11-11
New RETURN_PENDING cancellation/rejection/risk-decline transitions recalculate remaining eligible shoes using the existing named-plan rule engine and saved v2 rules (v1 fixed legacy NORMAL/PROMO tariff), never today’s catalog. Three-pair package losing one shoe uses saved singles; remaining valid packages/ranges still apply; all excluded costs zero. JSON cancellation evidence retains original total/count/allocations; historic agreement fields and staff verification are not rewritten. Before/after audit records remain; no consent fabrication, automatic refund, schema migration or historical backfill. Historical reads/ordinary refresh do not enroll old cancellations into the new policy.

Public tracking projects safe pricing only: name, estimate/final stage, count, initial/current/original totals, original/excluded counts, basis (INSPECTION/HISTORICAL_AGREEMENT/CANCELLATION), staffVerified boolean, turnaround policy and authoritative breakdown (kind, quantity, pairs, priceIdr, totalIdr). No staff ID, internal service/plan IDs, allocation evidence or raw rules. When historical allocations do not match current package math, breakdown is empty and calculationMatches=false; UI labels historical allocations, never invents a package. Unfinished active inspection/risk keeps public stage ESTIMATE. Net payments, balance and refund due stay ledger-derived; pending totals do not claim a fixed remaining balance. Rejected/declined item cleaning fees stay zero.

Tracking shows chosen tariff, eligible count, actual package/unit lines, initial versus cancellation-adjusted amount and eligibility explanation. Common service appears once at order level; genuinely mixed services retain per-shoe labels. Historical agreement is labelled historical, not new customer approval. API activation requires separately authorized restart; none performed for this patch.

## Revised customer display-stage editor — approved 2026-11-12 (supersedes four-group editor)

Owner Pengaturan contains ONE ordered **Tahap Pengerjaan Pelanggan** list: edit plain-text names, toggle visibility, keyboard-accessible up/down, add custom informational stage, remove display configuration. Default list: Sepatu Diterima / Pemeriksaan Selesai / Dalam Proses Pencucian / Dalam Proses Pengeringan / Selesai Dikerjakan. No operational enum/status additions. Inspection, explicit risk consent, staff authorization, pricing, photo/QC gates and operational transitions remain unchanged.

Settings JSON adds `trackingStages`: ordered array of `{id, anchor, name, visible}`; 0–20 entries. Stable builtin IDs are `builtin.RECEIVED`, `builtin.QUEUED`, `builtin.WASHING`, `builtin.DRYING`, `builtin.READY_FOR_PICKUP`; builtin anchor must match ID. Custom IDs use `custom.` plus 1–64 ASCII letters/digits/underscore/hyphen. Custom anchors allow only those same five existing milestones. Unique IDs required; names trimmed, 1–80 characters, no markup/control/bidi controls; strict objects reject extra fields. Omitted array preserves saved configuration; absent legacy array uses safe defaults; empty array intentionally displays no configured steps. Legacy contextual status labels remain persisted/backward compatible, not editable through four groups.

`GET /api/v1/settings` is Owner-only, returns `trackingStagesVersion: 1` only after successful settings read. `PATCH /api/v1/settings` remains Owner-only with existing CSRF, idempotency, actor revalidation, row locking and transactional SETTINGS_UPDATED audit. Public tracking allowlists visible display entries and safe contextual labels only; no origin, admin labels, provider configuration, completion flag or synthetic timestamps. Existing authenticated `/display-settings` remains compatible.

Public per-shoe ordered display steps are separate from chronological factual history. Builtin evidence means only its exact operational event exists, never inferred from a later status. Custom steps explicitly say informational/linked to anchor; reaching anchor never claims custom execution/completion, never supplies a custom timestamp/event. Future/unperformed anchors clearly say not recorded. Reordering/hiding/deleting config cannot reorder/remove factual history, including hidden/deleted builtins, consent/rework/return/handover. Safety details and actual status stay independent. No historical backfill.

Old API without version/array, or failed settings read: local defaults stay visible; explicit unavailable/needs-activation message; save disabled, never pretend saved. Domain website field retained. Canonical HTTPS/loopback rules, new manual links/rotations/consent fragments, immutable old WhatsApp snapshots unchanged.

**Deployment gate: NOT DEPLOYED.** Existing `202611120001_display_settings` nullable JSON migration remains UNAPPLIED. No new migration needed. Separately authorize backup/review, migration and API activation in that order; do not activate new API against missing column. No live DB reads/writes, migration execution, API/worker restart or WhatsApp operations performed. Existing live internal-error/worker-lease problems outside scope. MySQL behavior/live integration not validated. Tests only isolated fake DB/queue interception and fail-closed browser API mocks with service workers blocked; full suite/order-customer excluded.


## Structured inspection / customer risk consent — 2026-11-12 (source only)

- Customer-visible fields are separate: `findings` (Temuan), existing `risk` (Risiko), `customerNote` (Catatan untuk Customer, optional). Internal `notes`, intake notes, history reasons remain private. No automatic splitting/backfill of old descriptions.
- New NEEDS_CONSENT submissions require trimmed findings and risk: 3..3000 characters, at least one Unicode letter/number. Optional public note: trimmed, maximum 3000; empty persists null. Internal notes remain optional, maximum 4000. Strict Zod validation before mutation; existing photo, assignment, role, token, single-use, expiry and washing guards unchanged. OWNER/ADMIN inspection scope unchanged.
- Nullable TEXT findings/customerNote added to Inspection and ConsentDecision. Issuing/reissuing copies public fields into a new consent evidence snapshot. Existing snapshots, historical agreements/payments/notifications stay unchanged. Legacy reissue may retain null findings; display one original description labelled legacy, never invented findings.
- Tracking explicitly allowlists public fields; consent card uses consent snapshot, not mutable inspection text. Title: Menunggu Persetujuan Customer. Separate Temuan/Risiko/Catatan, omitted blank note; no amount or Penanganan field. Actual expiry, rejection consequence, explicit approve/decline retained. Vue text interpolation escapes customer content; awaiting-consent summary does not duplicate risk.
- New CONSENT_REQUEST encrypted outbound snapshots append public findings/risk/optional note, or one legacy description; no internal notes or pricing append. Customer-safe control-character normalization retains up to 3000 characters per structured field. Existing encrypted notification snapshots remain immutable, no replay.
- Authenticated GET `/api/v1/settings/inspection-capabilities` returns `{ "structuredRiskConsent": true }` for OWNER/ADMIN. Form checks before uploads/mutation. Missing/old API blocks submission with actionable migration/API activation message; keeps fields, never retries by dropping public data. New API rejects missing required findings for risky submissions; approved/rejected legacy inputs remain compatible.

**Activation gate: NOT LIVE READY.** `202611120002_structured_risk_consent` is CREATE-ONLY / UNAPPLIED. Earlier unrelated `202611120001_display_settings` also remains UNAPPLIED. No migration/deploy/push/seed/reset, live DB write, API/worker restart, WhatsApp connect/activate/send/replay authorized or executed. Worker left running. Separately authorize backup/review and pending migrations in order, regenerate deployment client/build, then API activation only after columns exist. Frontend HMR alone cannot activate this feature; health 200 does not prove capability. MySQL/live integration unvalidated.

Validation restricted to API/web/test typechecks, relevant lint, isolated fake-DB workflow/HTTP/encrypted-snapshot tests, fail-closed browser mocks installed before navigation with service workers blocked. Full suite and order-customer browser tests excluded.

Final isolated verification: 5/5 backend tests passed (inspection-notes, simplified-workflow, whatsapp-templates); 18/18 browser tests passed (structured-consent, simplified-workflow). API/web/test typechecks passed; targeted ESLint passed with zero warnings. Earlier browser fixture failures (closed mobile menu, obsolete item-price assertion) corrected without changing UI behavior. No full suite, live MySQL integration, deployment, lifecycle restart or WhatsApp send performed. Both pending migrations remain UNAPPLIED; activation gates above still apply.
