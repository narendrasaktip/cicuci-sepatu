# REST API — Cicuci Sepatu

Base URL: `/api/v1`. JSON memakai `camelCase`; tanggal ISO-8601 UTC; nilai uang integer IDR.

## Aturan umum

- Admin endpoints membutuhkan session dan role. `401` tanpa session; `403` tanpa hak akses.
- Semua request body, params, query divalidasi Zod.
- List memakai `?limit=25&cursor=<id>&q=<text>`; `limit` 1–100. Response `{ data, page: { nextCursor } }`.
- Error konsisten:

```json
{
  "error": {
    "code": "INVALID_TRANSITION",
    "message": "Transition status tidak diizinkan.",
    "details": [{ "path": "toStatus", "message": "invalid" }]
  }
}
```

- Kode utama: `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `INVALID_TRANSITION`, `CONSENT_REQUIRED`, `TOKEN_INVALID`, `TOKEN_EXPIRED`, `UPLOAD_INVALID`, `RATE_LIMITED`, `INTERNAL_ERROR`.
- Semua mutation menerima `Idempotency-Key` UUID. Service menyimpan respons sukses per actor/key selama 24 jam.

## Auth dan user

| Method/path | Role | Request | Response |
|---|---|---|---|
| `POST /auth/login` | publik | `{ email, password }` | `204`; set session cookie |
| `POST /auth/logout` | login | — | `204` |
| `GET /auth/me` | login | — | user aman |
| `GET /users` | OWNER | cursor/filter | daftar user |
| `POST /users` | OWNER | `{ name, email, password, role }` | user `201` |
| `PATCH /users/:id` | OWNER | `{ name?, role?, isActive?, password? }` | user |

## Customers dan service

| Method/path | Role | Request | Response |
|---|---|---|---|
| `GET /customers` | ADMIN+ | cursor, `q` | daftar customer |
| `POST /customers` | ADMIN+ | `{ name, whatsapp, notes?, notificationConsent }` | customer `201` |
| `GET /customers/:id` | ADMIN+ | — | customer dan ringkasan order |
| `PATCH /customers/:id` | ADMIN+ | field customer yang dapat diubah | customer |
| `GET /services` | STAFF+ | filter aktif | daftar service |
| `POST /services` | OWNER | `{ name, basePriceIdr }` | service `201` |
| `PATCH /services/:id` | OWNER | `{ name?, basePriceIdr?, isActive? }` | service |

`whatsapp` dinormalisasi server. `notificationConsent` wajib eksplisit saat create dan dipisahkan dari risk consent.

## Order dan item

Creation estimate: server uses the actual persisted `createdAt`, not form opening/client time. Five inclusive calendar days in Asia/Jakarta; weekends count. Before 12:00 WIB, that date is day 1; at/after 12:00, tomorrow is day 1. Tuesday 11:59 gives Saturday; Tuesday 12:00 gives Sunday. Estimated timestamp is 23:59:59.999 WIB (16:59:59.999 UTC), not midnight. `estimatedCompletionAt` on POST is optional for legacy callers: if present it must remain valid ISO UTC, but its value is ignored. Same-key replay preserves the original response/estimate; existing request fingerprint conflict rules remain. Existing records and PATCH estimate editing are unchanged.


| Method/path | Role | Request | Response |
|---|---|---|---|
| `GET /orders` | STAFF+ | cursor, `q`, `status`, `customerId`, `overdue` | ringkasan order |
| `POST /orders` | ADMIN+ | customer, items; estimasi otomatis | order `201`, tracking URL sekali |
| `GET /orders/:id` | STAFF+ | — | order, item, history, payment |
| `PATCH /orders/:id` | ADMIN+ | `{ estimatedCompletionAt?, pickupInstructions? }` | order |
| `POST /orders/:id/items` | ADMIN+ | item baru | item `201` |
| `PATCH /items/:id` | ADMIN+ | metadata non-status, harga | item |
| `POST /items/:id/inspection` | ADMIN+ | inspection outcome, notes, risk, quoted price | item updated |
| `POST /items/:id/transition` | STAFF+ | `{ toStatus, reason? }` | item updated plus history |
| `POST /orders/:id/tracking-token/rotate` | ADMIN+ | — | `{ trackingUrl }` sekali |

Create order body:

```json
{
  "customerId": "01...",
  "items": [{
    "brand": "Nike",
    "model": "Air Force 1",
    "color": "White",
    "serviceId": "01...",
    "quotedPriceIdr": 50000,
    "initialNotes": "Noda lumpur"
  }]
}
```

Create membutuhkan 1–N item. Harga service disnapshot. `transition` menjalankan aturan state machine server-side; klien tidak boleh menulis `status` langsung.

## Foto

| Method/path | Role | Request | Response |
|---|---|---|---|
| `POST /items/:id/photos` | ADMIN+ | JSON: `base64`, `mime` (PNG/JPEG), `kind`, `customerVisible` | metadata photo `201` |
| `GET /photos/:id` | admin atau tracking sah | — | stream binary terotorisasi |
| `DELETE /photos/:id` | ADMIN+ | — | `204` |

`kind`: `BEFORE`, `INSPECTION`, `AFTER`. Endpoint membatasi MIME/image signature, ukuran, kuota item. `customerVisible` hanya boleh true untuk BEFORE/AFTER.

Photo upload size contract: 10 MiB = 10,485,760 decoded bytes, inclusive. Canonical base64 maximum 13,981,016 characters; upload-route JSON body maximum 13,982,040 bytes (base64 ceiling + 1 KiB metadata/whitespace). Other JSON routes retain 16 KiB. Decoded size remains authoritative: 10 MiB + 1 byte is rejected even when base64 has the same encoded length. Oversized body returns 413 UPLOAD_INVALID; invalid image/decoded size returns 400 UPLOAD_INVALID; schema overflow returns 400 VALIDATION_ERROR. PNG/JPEG structure, pixel/decompression bounds, private inspection evidence, authenticated access and tracking visibility remain unchanged. JSON/base64 only, no multipart. API restart requires separate authorization; no runtime restart performed.

## Consent publik dan tracking

| Method/path | Akses | Request | Response |
|---|---|---|---|
| `GET /track/:token` | token valid | — | order customer-safe, item timeline, foto visible, total, instruksi |
| `POST /track/:token/consent` | token order + approval action sah | `{ approvalToken, decision }` | `204` |

`decision` adalah `APPROVE` atau `DECLINE`. Server memastikan token approval terkait item/order, belum dipakai, belum kedaluwarsa. Approval sukses mengonsumsi token. `GET /track` tidak pernah mengembalikan internal notes, nomor customer, event notification, audit, hash, atau metadata file privat.

## Payment dan notification

| Method/path | Role | Request | Response |
|---|---|---|---|
| `POST /orders/:id/payments` | ADMIN+ | `{ amountIdr, method, reference?, receivedAt }` | payment `201`, status payment baru |
| `POST /payments/:id/void` | OWNER | `{ reason }` | payment voided |
| `GET /notifications` | ADMIN+ | cursor, status, type | event dan attempts |
| `POST /notifications/:id/retry` | ADMIN+ | — | event dijadwalkan ulang `202` |

`method`: `CASH`, `TRANSFER`, `EWALLET`, `OTHER`. Payment accepted tidak boleh melebihi total final tanpa flow refund eksplisit. Retry hanya untuk event gagal dan tidak mengubah laundry state.

## Dashboard

`GET /dashboard` untuk STAFF+ mengembalikan `{ activeOrders, waitingInspection, awaitingConsent, inProgress, readyForPickup, overdue, revenueIdr }`. Filter rentang tanggal opsional untuk revenue; semua kategori berasal dari item/order aktual, bukan input klien.

## Simplified smart intake (approved 2026-11-11)
New UI orders choose only Promo/Normal. Server resolves reserved internal cleaning service `cicuci-cleaning-v1` (`Cuci sepatu`, base price 0, active), idempotently inside the order transaction; never chooses/renames historical services. A conflicting reserved record fails closed. Menu Tarif pesanan displays readonly rates from authenticated GET /pricing/rates, calculated by packageTotal; legacy catalog management remains under Lanjutan: layanan lama with existing role permissions. Internal service edits are blocked; basePriceIdr is not the smart tariff.
POST /orders with rateMode needs no packageServiceId or item serviceId. Optional explicit IDs must match the reserved identity; manual prices forbidden. Manual orders without rateMode still require item serviceId; existing smart/manual snapshots remain unchanged. No schema migration, no tariff editing.

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

Kak/Pak/Bu remains; Kak default, edits affect future greetings only. Migration011 remains byte-for-byte unchanged: additive salutation plus reserved nullable archive columns, retained to avoid migration churn. No archive route/action remains; defensive old-column checks remain fail-closed. Deployment preflight 2026-11-11 verified migration011 applied, with all migration001–011 checksums matching source. Migration012 remains pending: newly authorized deployment stopped before any DB mutation or service restart because complete backup metadata could not be verified (routine metadata DB1558; event metadata DB1577). No valid new backup was produced. See docs/DEPLOYMENT_LEDGER_20261111.md. Real MySQL FK/locking deletion validation remains unperformed.


## Paid-order physical deletion — deployment blocked (2026-11-11)

Supersedes the previous ORDER_HAS_PAYMENTS refusal. OWNER-only DELETE /orders/:id retains strict confirmation, CSRF, UUID idempotency and one transactional deletion audit. Paid, partially paid and refunded orders may be physically removed; deletion is not a refund or financial correction. Operational children/tracking disappear. Payment/refund ledger, historical audit, terminal notification snapshots/attempts remain. PENDING/PROCESSING events or PROCESSING attempts still return 409 NOTIFICATION_IN_PROGRESS; unexpected restrictive FKs return 409 DELETE_DEPENDENCY, rolling back the entire deletion. Audit failure also rolls back all deletion/detachment. Same-key replay returns its receipt without repeating effects; a new key against a missing order returns 404.

Migration source 202611110012_detached_payment_ledger adds required immutable Payment.originalOrderId (30 chars) and originalOrderNumber (50 chars), backfilled from the still-FK-protected original Order before weakening the FK. Payment.orderId and Payment.order become nullable; ON DELETE SET NULL changes only the live link. Historical amounts, methods, references, reasons, actors, receivedAt and createdAt are never rewritten. No customer PII snapshots added. Every new payment/refund uses the shared ledger writer to snapshot order ID/number under the existing order row lock. Required fields have no defaults; old writers fail rather than inventing identity. Migration011 remains unchanged.

Reference audit: shared ledger writer is the sole production Payment.create; no production ledger update/delete exists. Order detail/list/tracking/pricing use the live Order.payments collection and do not dereference Payment.order; detached entries intentionally do not attach to any order. User history guards still query Payment.actorUserId regardless of detached state. Dashboard queries Payment independently with an extant Order relation, sums PAYMENT minus REFUND only for surviving orders, and filters inclusively by receivedAt from/to, never by order creation/status. Detached payments/refunds remain physically retained but excluded from dashboard revenue; no surviving orders means revenueIdr 0. This overrides prior immutable-ledger dashboard semantics, not ledger/audit retention. STAFF neither queries the ledger nor receives revenue. Operational counts use surviving orders only. Workspace retains metrics clearing before refresh and reload after successful deletion/navigation; protected failures retain unchanged counts. No ledger browsing/reconciliation endpoint added.

Deployment AUTHORIZED but BLOCKED at backup preflight (2026-11-11). Complete routine/event metadata inspection failed with database codes1558/1577; no valid new backup, migration, client generation or API restart performed. API PID16110 remains healthy (HTTP200); worker PID54229 retains its original start identity. No real order deleted, WhatsApp action, profile/key access or environment-file content inspection performed; Node loaded environment internally for read-only DB preflight. Existing API has not received this deployment. See docs/DEPLOYMENT_LEDGER_20261111.md. Resume only after complete backup verification and revalidation of process/migration/data preconditions. MySQL DDL is nontransactional: inspect partial state before any failed-migration recovery. Real MySQL backfill/FK/row-lock deletion remains untested; in-memory tests do not establish InnoDB scheduling. Quiesce payment writers; the unchanged notification-only worker must remain running.

Validation for this amendment: selected salutation-deletions backend regression passed (in-memory tables/import hooks; ephemeral loopback HTTP only); dashboard-deletion browser regression passed in classic/new presentations (2 tests, all API routes mocked fail-closed, service workers blocked, explicit Chrome). API/web typecheck, lint and builds passed. No full suite or order-customer browser test executed.

## Optional assignment (2026-11-11)
POST /items/:id/transition: OWNER/ADMIN may start eligible unassigned items; assignedUserId is not required or fabricated. STAFF requires item.assignedUserId equal to actor.id, otherwise 403 FORBIDDEN; STAFF handover/return remains forbidden. Existing strict body, CSRF, UUID idempotency, transaction, locks, history/audit/outbox unchanged. Invalid stage returns INVALID_TRANSITION; missing risk consent CONSENT_REQUIRED; unlocked smart pricing PRICING_CONFIRMATION_REQUIRED. Assignment endpoint remains OWNER/ADMIN-only, nullable assignedUserId. Photo/QC guards and rejected/declined zero fees unchanged.

## Inspection establishes final pricing (2026-11-11; supersedes mandatory price agreement)
Completed staff inspections establish FINAL pricing automatically after outstanding explicit risk decisions are resolved. FINAL is sufficient for work/payment; no duplicate customer price-confirmation step. New FINAL snapshots carry verifiedAt/verifiedBy and PRICING_STAFF_VERIFIED audit evidence; never create customer consent, agreedTotalIdr/agreedAllocations, lockedAt or PRICING_CONFIRMED automatically. If the last event is a public risk decision, provenance refers to the recorded inspector, not the customer as staff.

Existing FINAL orders remain eligible by read-only validation of completed inspections, explicit consumed risk approvals, current item allocations/count/total, and nonpending statuses. No historical backfill or fabricated consent. Stale/mismatched prices fail PRICE_CHANGED; incomplete inspection/consent fails PRICE_NOT_FINAL. Historical LOCKED snapshots, original agreements and payment ledger remain intact. Existing explicit price-confirmation endpoints remain compatibility-only, never called automatically. Finalized smart orders cannot add/edit intake items. Historical FINAL/LOCKED allocations remain unchanged on reads and ordinary refresh. New authorized cancellation transitions opt into a separate current calculation using the original selected tariff snapshot and remaining eligible count; no average-allocation subtraction. Original agreement, staff provenance, initial estimate, consent evidence and payments remain unchanged; current allocations may increase when package eligibility is lost. Initial estimate, accepted-pair count, all-rejected zero and refund accounting remain accurate. STAFF assignment scope unchanged; OWNER/ADMIN need no assignment. Risk consent remains explicit and separate. No schema change/migration.


### Cancellation repricing and public tracking — current amendment 2026-11-11
New RETURN_PENDING cancellation/rejection/risk-decline transitions recalculate remaining eligible shoes using the existing named-plan rule engine and saved v2 rules (v1 fixed legacy NORMAL/PROMO tariff), never today’s catalog. Three-pair package losing one shoe uses saved singles; remaining valid packages/ranges still apply; all excluded costs zero. JSON cancellation evidence retains original total/count/allocations; historic agreement fields and staff verification are not rewritten. Before/after audit records remain; no consent fabrication, automatic refund, schema migration or historical backfill. Historical reads/ordinary refresh do not enroll old cancellations into the new policy.

Public tracking projects safe pricing only: name, estimate/final stage, count, initial/current/original totals, original/excluded counts, basis (INSPECTION/HISTORICAL_AGREEMENT/CANCELLATION), staffVerified boolean, turnaround policy and authoritative breakdown (kind, quantity, pairs, priceIdr, totalIdr). No staff ID, internal service/plan IDs, allocation evidence or raw rules. When historical allocations do not match current package math, breakdown is empty and calculationMatches=false; UI labels historical allocations, never invents a package. Unfinished active inspection/risk keeps public stage ESTIMATE. Net payments, balance and refund due stay ledger-derived; pending totals do not claim a fixed remaining balance. Rejected/declined item cleaning fees stay zero.

Tracking shows chosen tariff, eligible count, actual package/unit lines, initial versus cancellation-adjusted amount and eligibility explanation. Common service appears once at order level; genuinely mixed services retain per-shoe labels. Historical agreement is labelled historical, not new customer approval. API activation requires separately authorized restart; none performed for this patch.

## Display settings — 2026-11-12
OWNER GET /api/v1/settings adds statusLabels, defaultStatusLabels, publicOrigin to the existing safe store profile. OWNER PATCH /api/v1/settings accepts optional statusLabels/publicOrigin alongside existing profile inputs; strict allowlists reject other properties. Existing CSRF, transaction, actor revalidation, encrypted idempotency and SETTINGS_UPDATED audit remain. Omitted statusLabels preserves saved labels; supplied map replaces overrides; empty map resets defaults. Missing keys resolve to defaults. GET never provisions settings.

Label keys are allowlisted context.code pairs from the display-settings service: admin, order, shoe, history. Values are trimmed plain text, 1–80 characters; angle brackets, control/newline/bidi controls rejected. Public origin is trimmed, maximum 300 characters, canonical URL origin; HTTPS except HTTP localhost/127.0.0.1/[::1]. Credentials, nonroot path, query, fragment, malformed host and unsafe protocols rejected. Validation performs no fetch.

Authenticated GET /api/v1/display-settings returns only statusLabels (all roles). Public GET /api/v1/track/:token adds only order/shoe/history statusLabels; never store profile, publicOrigin, templates, activation secrets or admin labels. Existing tracking token validation remains. Authorized order detail, create-order and rotate/revoke results add publicOrigin for manual links. New notification snapshots read the same stored origin; approval token remains in URL fragment. Historical event upserts/encrypted snapshots unchanged.

Storage: nullable StoreSettings.displaySettings JSON; migration 202611120001_display_settings is source only, unapplied. Parameterized raw column access avoids regenerating the currently running Prisma client. Apply migration before separately authorized new API activation. Existing APP_BASE_URL fallback retained; no configured fallback means http://127.0.0.1:5173. No automatic DNS/TLS/CORS/session configuration or WhatsApp activation.

## Revised customer display-stage editor — approved 2026-11-12 (supersedes four-group editor)

Owner Pengaturan contains ONE ordered **Tahap Pengerjaan Pelanggan** list: edit plain-text names, toggle visibility, keyboard-accessible up/down, add custom informational stage, remove display configuration. Default list: Sepatu Diterima / Pemeriksaan Selesai / Dalam Proses Pencucian / Dalam Proses Pengeringan / Selesai Dikerjakan. No operational enum/status additions. Inspection, explicit risk consent, staff authorization, pricing, photo/QC gates and operational transitions remain unchanged.

Settings JSON adds `trackingStages`: ordered array of `{id, anchor, name, visible}`; 0–20 entries. Stable builtin IDs are `builtin.RECEIVED`, `builtin.QUEUED`, `builtin.WASHING`, `builtin.DRYING`, `builtin.READY_FOR_PICKUP`; builtin anchor must match ID. Custom IDs use `custom.` plus 1–64 ASCII letters/digits/underscore/hyphen. Custom anchors allow only those same five existing milestones. Unique IDs required; names trimmed, 1–80 characters, no markup/control/bidi controls; strict objects reject extra fields. Omitted array preserves saved configuration; absent legacy array uses safe defaults; empty array intentionally displays no configured steps. Legacy contextual status labels remain persisted/backward compatible, not editable through four groups.

`GET /api/v1/settings` is Owner-only, returns `trackingStagesVersion: 1` only after successful settings read. `PATCH /api/v1/settings` remains Owner-only with existing CSRF, idempotency, actor revalidation, row locking and transactional SETTINGS_UPDATED audit. Public tracking allowlists visible display entries and safe contextual labels only; no origin, admin labels, provider configuration, completion flag or synthetic timestamps. Existing authenticated `/display-settings` remains compatible.

Public per-shoe ordered display steps are separate from chronological factual history. Builtin evidence means only its exact operational event exists, never inferred from a later status. Custom steps explicitly say informational/linked to anchor; reaching anchor never claims custom execution/completion, never supplies a custom timestamp/event. Future/unperformed anchors clearly say not recorded. Reordering/hiding/deleting config cannot reorder/remove factual history, including hidden/deleted builtins, consent/rework/return/handover. Safety details and actual status stay independent. No historical backfill.

Old API without version/array, or failed settings read: local defaults stay visible; explicit unavailable/needs-activation message; save disabled, never pretend saved. Domain website field retained. Canonical HTTPS/loopback rules, new manual links/rotations/consent fragments, immutable old WhatsApp snapshots unchanged.

**Deployment gate: NOT DEPLOYED.** Existing `202611120001_display_settings` nullable JSON migration remains UNAPPLIED. No new migration needed. Separately authorize backup/review, migration and API activation in that order; do not activate new API against missing column. No live DB reads/writes, migration execution, API/worker restart or WhatsApp operations performed. Existing live internal-error/worker-lease problems outside scope. MySQL behavior/live integration not validated. Tests only isolated fake DB/queue interception and fail-closed browser API mocks with service workers blocked; full suite/order-customer excluded.
