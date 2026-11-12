# Product Requirements Document — Cicuci Sepatu — Management & Tracking
Version: 1.2 (MVP; authorized workflow simplification 2026-11-11) | Status: owner-authorized WhatsApp provider amendment 2026-11-11

## 1. Product overview
Web application for cicuci-sepatu operations. Admins register orders, inspect individual shoes, manage cleaning progress, upload before/after photos, track payment, and notify customers automatically via WhatsApp. Customers view progress through a secure tracking link without an account.

## 2. Goals and non-goals
Goals: prevent lost orders; provide traceable shoe-level progress; require consent for risky cleaning; provide customer visibility; automate notifications without blocking operations.
Non-goals (MVP): online booking, courier integration, QRIS gateway, multi-tenant SaaS, loyalty points, native mobile app.

## 3. Users and permissions
- Owner: manage users, prices, configuration, reports and all orders.
- Admin: register customers/orders, inspect, update statuses, upload photos, manage payments and review notification failures.
- Staff: view assigned work and update permitted processing steps, no access to configuration.
- Customer: read only the specific order accessible through a random tracking token; may approve or reject documented cleaning risks via an expiring, single-use approval action.

## 4. MVP functional requirements
### FR-01 Customers
Store customer name, normalized WhatsApp number, optional notes, and notification consent timestamp. Allow searching existing customers.
### FR-02 Orders and shoes
Generate unique order number; one order contains 1..N shoe items. Record required shoe brand, optional model/color (empty strings when absent), service type, initial notes, estimated completion date, per-item quoted price and before photos. Show order history. New orders automatically receive a server-calculated estimate: 5 inclusive calendar days (weekends included), using actual saved creation time in Asia/Jakarta. Before 12:00 WIB the creation date is day 1; at/after 12:00 the next date is day 1. Tuesday 11:59 finishes Saturday; Tuesday 12:00 finishes Sunday. Store the estimated day at 23:59:59.999 WIB (16:59:59.999 UTC), avoiding premature overdue at midnight. No manual date during creation; existing estimates and authorized estimate edits remain unchanged. Idempotent replay returns the original estimate.
### FR-03 Inspection
For each item record inspection notes, optional private damage/risk photos, assessment: APPROVED, NEEDS_CONSENT, REJECTED. BEFORE photo remains required. Approved items can be scheduled. Needs-consent items require meaningful findings and risk; cannot be washed until customer explicitly approves documented risk and quoted price. Rejected items have cleaning fee 0 and must be returned without washing. Record decision actor and timestamp. If customer declines risk, mark item DECLINED, cleaning fee 0, and arrange return.
### FR-04 Shoe-level workflow
Operator stages: Pemeriksaan (RECEIVED/INSPECTION; approved QUEUED), Pengerjaan (WASHING), Pengeringan (DRYING), Siap diambil (READY_FOR_PICKUP); Sudah diambil (HANDED_OVER) is terminal. From DRYING, Mulai pengemasan dan QC opens the ready confirmation; passing records DRYING -> READY_FOR_PICKUP directly. Ready requires explicit dry/finishing/QC confirmation and saved customer-visible AFTER photo. No fabricated PACKING/FINISHING/QC transitions, history or notifications. Existing PACKING and legacy FINISHING/QC/REWORK remain operable; PACKING/FINISHING/QC may finalize with the same guards. QC failure transitions from DRYING/PACKING/legacy stages to REWORK then WASHING/FINISHING as appropriate. REJECTED/DECLINED bypass cleaning and enter RETURN_PENDING -> RETURNED. Enforce transitions server-side and record history. Order aggregate status is computed from items; do not assume all items share the same status.
### FR-05 Photos
Upload before, inspection and after photos per shoe; validate file type/size; store files privately; only expose authorized customer-safe images through tracking access. Require after photo and QC pass before READY_FOR_PICKUP (unless returned unwashed).
### FR-06 Tracking
Generate unguessable tracking token per order. Display shoe list, individual status timeline, estimated completion, before/after photos when available, total charges and pickup instructions. Do not expose internal staff notes or customer lists. Support token rotation/revocation.
### FR-07 WhatsApp notifications
Send on order receipt, inspection outcome, consent request, washing start, finishing, ready for pickup, handover; optional pickup reminder. Use event outbox + background queue, whatsapp-web.js as sole operational provider after initial mock development (completed). Log notification event, template, recipient, provider response, attempts and status. Retry transient errors with backoff, deduplicate by event key. Honor consent/opt-out. Owner pairing and explicit risk-acknowledged activation required. Without activation, persist SKIPPED/NOT_ENABLED and actualOutbound:false; disconnected/unavailable worker also blocks new events. Historical mock/SIMULATED records are immutable, never replayed. Ambiguous submissions never automatically retried.
### FR-08 Payments
Record order-level payment status UNPAID/PARTIAL/PAID/REFUNDED, payment method, amount, timestamp and reference. Compute totals from accepted items; never charge rejected/declined cleaning items. Payment status independent of fulfillment status.
### FR-09 Dashboard
Show total active orders, waiting inspection, awaiting consent, in progress, ready pickup, overdue, and revenue; filter/search orders by customer, order ID and status.
### FR-10 Audit and security
Admin login, role-based authorization, password hashing, rate limiting, server-side validation, audit logs, protected image access, and no secrets in repository.

## 5. Primary workflow
1. Admin creates customer and order with one or more shoe items and before photos.
2. Order receipt saved; WA receipt event queued.
3. Staff inspects each item; approved/consent-required/rejected branches.
4. Customer grants or denies risky-cleaning consent via secure action; decision logged.
5. Approved items start pengerjaan, then pengeringan. Mulai pengemasan dan QC opens the ready form, saving AFTER photo first and requiring explicit dry, finishing complete and QC pass confirmation before direct ready finalization.
6. Failed QC enters rework; passed QC with after photo becomes ready for pickup.
7. Customer receives tracking and pickup notification.
8. Admin records payment and physical handover; rejected items are returned without cleaning charge.

## 6. Core data entities
User, Customer, Order, OrderItem, Service, Inspection, ConsentDecision, StatusHistory, Photo, Payment, NotificationEvent, NotificationAttempt, AuditLog. Every item belongs to exactly one order. Monetary amounts stored as integer IDR, timestamps stored UTC and shown in Asia/Jakarta.

## 7. API outline
POST /auth/login; GET/POST /customers; GET/POST /orders; GET /orders/:id; POST /orders/:id/items; POST /items/:id/inspection; POST /items/:id/transition; POST /items/:id/photos; POST /orders/:id/payments; GET /track/:token; POST /track/:token/consent (signed one-time action); GET /notifications; POST /notifications/:id/retry. Detailed contracts to be written in docs/API_SPEC.md.

## 8. Non-functional requirements
Mobile-friendly tracking; responsive admin UI; secure session handling; upload limits; notification processing asynchronous; idempotent events; pagination; structured logging; migrations and backups; graceful gateway failure. No production data in seed/test fixtures.

## 9. Acceptance criteria
- One order with three shoes can have three distinct inspection outcomes and independent statuses.
- No washing transition is possible for REJECTED, DECLINED or consent-pending shoes.
- Rejected/declined items have Rp0 cleaning fees.
- WhatsApp outage does not roll back a successful order status update.
- Duplicate status events do not cause duplicate WA notifications.
- Customer tracking cannot enumerate orders and cannot access other customers' data.
- Ready-for-pickup requires successful QC and after photo for cleaned items.
- Payment can remain unpaid when an item is ready for pickup.
- Status history records actor, time, old status and new status.

## 10. Delivery phases
Phase 1: architecture, schema, API contracts, UI wireframes.
Phase 2: auth, customers, order creation and multi-shoe management.
Phase 3: inspection, consent, status engine, photo upload.
Phase 4: dashboard, tracking, payments.
Phase 5: owner-authorized WhatsApp Web, queue, delivery logs; test-only fakes.
Phase 6: tests, security review, deployment documentation.

## 11. Open decisions
- Single store or multi-outlet? Default MVP: single store.
- Customer risk approval via tracking link or WA interactive button? Default: secure tracking link.
- WA provider? whatsapp-web.js only; no provider selector.
- Payment timing? Default: configurable, manual record.
- Hosting and file storage? Decide before deployment.

## 12. Brand and product identity
- Public brand: **Cicuci Sepatu**.
- Application title: **Cicuci Sepatu Management System**.
- Admin interface: **Cicuci Admin**; customer tracking: **Cicuci Tracking**.
- Repository/package naming: `cicuci-sepatu`.
- Use Indonesian for customer-facing UI, order status labels and WhatsApp templates; keep internal code identifiers in English.
- Example message: "Halo Kak {customer_name}, sepatu pada pesanan {order_number} sudah kami terima di Cicuci Sepatu. Cek progres: {tracking_url}".
- Never assume an actual domain, phone number, address or operating hours; configure them in settings.

## 13. WhatsApp communication rules
- Capture customer opt-in for service notifications and allow opt-out.
- Notify on received, inspection result, risk approval request, washing start, finishing, ready for pickup and handover; ensure all customer-visible messages use the Cicuci Sepatu brand.
- Customer consent for risky cleaning is separate from consent to receive WhatsApp messages.
- No real outbound tests or autoactivation. Injectable fakes exist only in tests. Operational sending requires owner activation and current customer consent.

## 14. Authorized contextual workflow forms
Inspection: one form, prefilled price, notes, safe/needs-consent/rejected outcome; automatic BEFORE upload, private INSPECTION risk evidence only when needed. No photo-kind selector. Save required uploads before finalization; failure retains fields/status, successful uploads reused on retry with stable idempotency keys. Ready form follows the same upload-first rule; upload failure never emits ready notification. Edit, assignment, history and photo management remain under Detail lainnya. Unconfirmed price displays Harga belum dikonfirmasi, not zero. Each shoe remains independent; payments separate; aggregate derived; historical records unchanged.

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

Owners may create arbitrary named plans (for example Christmast), rename, replace all rules, deactivate/reactivate. No hard delete. RatePlan is separate from legacy Service/basePriceIdr. Existing catalog roles remain: authenticated OWNER/ADMIN/STAFF may read plans and preview; only OWNER may mutate plans. Order creation remains OWNER/ADMIN. CSRF required for every POST/PATCH. Catalog mutations and order creation require UUID Idempotency-Key, using the existing encrypted transactional response wrapper; replay returns the original response, changed payload/key reuse returns 409 IDEMPOTENCY_CONFLICT.

### Exact API contracts (relative to /api/v1)

- GET /pricing/plans, no query: unpaginated array of `{id,name,isActive,revision,rules}`, including inactive plans; stable name/id ascending order. No writes/default provisioning during reads.
- POST /pricing/plans: full `{name,isActive,rules}`; 201 with saved plan, revision 1. Name trimmed, 1..100 characters, unique case-insensitively by MySQL utf8mb4_unicode_ci (also accent-insensitive).
- PATCH /pricing/plans/:id: full `{name,isActive,rules,revision}`; 200 with updated plan, revision incremented. Partial updates rejected. Stale revision returns 409 REVISION_CONFLICT; missing plan 404 NOT_FOUND; duplicate name 409 CONFLICT. No DELETE endpoint.
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

Kak/Pak/Bu remains; Kak default, edits affect future greetings only. Migration011 remains byte-for-byte unchanged: additive salutation plus reserved nullable archive columns, retained to avoid migration churn. No archive route/action remains; defensive old-column checks remain fail-closed. Deployment 2026-11-11 completed through authorized staged recovery of migration012 after MariaDB errno121 in its combined final ALTER. Payment snapshots are required and populated 5/5; live `orderId` is nullable with `SET NULL/CASCADE`; immutable original payment fields/revenue100000 and historical evidence remain preserved. API returned health HTTP200 after restart; worker PID54229 remained unchanged. No force/reset/repair, fixture, real deletion, WhatsApp action, or live deletion/SET NULL test occurred. See [`DEPLOYMENT_LEDGER_20261111.md`](../../docs/DEPLOYMENT_LEDGER_20261111.md:1).


## Paid-order physical deletion — deployed after recovery (2026-11-11)

Supersedes the previous ORDER_HAS_PAYMENTS refusal. OWNER-only DELETE /orders/:id retains strict confirmation, CSRF, UUID idempotency and one transactional deletion audit. Paid, partially paid and refunded orders may be physically removed; deletion is not a refund or financial correction. Operational children/tracking disappear. Payment/refund ledger, historical audit, terminal notification snapshots/attempts remain. PENDING/PROCESSING events or PROCESSING attempts still return 409 NOTIFICATION_IN_PROGRESS; unexpected restrictive FKs return 409 DELETE_DEPENDENCY, rolling back the entire deletion. Audit failure also rolls back all deletion/detachment. Same-key replay returns its receipt without repeating effects; a new key against a missing order returns 404.

Migration source 202611110012_detached_payment_ledger adds required immutable Payment.originalOrderId (30 chars) and originalOrderNumber (50 chars), backfilled from the still-FK-protected original Order before weakening the FK. Payment.orderId and Payment.order become nullable; ON DELETE SET NULL changes only the live link. Historical amounts, methods, references, reasons, actors, receivedAt and createdAt are never rewritten. No customer PII snapshots added. Every new payment/refund uses the shared ledger writer to snapshot order ID/number under the existing order row lock. Required fields have no defaults; old writers fail rather than inventing identity. Migration011 remains unchanged.

Reference audit: shared ledger writer is the sole production Payment.create; no production ledger update/delete exists. Order detail/list/tracking/pricing use the live Order.payments collection and do not dereference Payment.order; detached entries intentionally do not attach to any order. User history guards still query Payment.actorUserId regardless of detached state. Dashboard queries Payment independently with an extant Order relation, sums PAYMENT minus REFUND only for surviving orders, and filters inclusively by receivedAt from/to, never by order creation/status. Detached payments/refunds remain physically retained but excluded from dashboard revenue; no surviving orders means revenueIdr 0. This overrides prior immutable-ledger dashboard semantics, not ledger/audit retention. STAFF neither queries the ledger nor receives revenue. Operational counts use surviving orders only. Workspace retains metrics clearing before refresh and reload after successful deletion/navigation; protected failures retain unchanged counts. No ledger browsing/reconciliation endpoint added.

Deployment completed 2026-11-11 after owner-confirmed staged recovery of migration012. Required identity snapshots populated 5/5; nullable live orderId; SET NULL/CASCADE FK and nonempty identity check verified. Prisma resolve recorded matching-checksum applied012 after schema verification, retaining the failed record as rolled-back evidence. Source migration/schema unchanged. Client regenerated; API typecheck passed. API57749 started Wed Nov 11 23:28:30 2026, health HTTP200; worker54229 retained original start Wed Nov 11 16:44:04 2026 and cwd. Original application-column hashes, payment ledger/revenue100000 IDR, audit and delivery evidence preserved. No real deletion, live deletion/SET NULL test, login, fixture, worker/WhatsApp control, or system repair/upgrade. Accepted backup excludes routines/events; restore untested. See deployment ledger for historical failure and recovery details.

Validation for this amendment: selected salutation-deletions backend regression passed (in-memory tables/import hooks; ephemeral loopback HTTP only); dashboard-deletion browser regression passed in classic/new presentations (2 tests, all API routes mocked fail-closed, service workers blocked, explicit Chrome). API/web typecheck, lint and builds passed. No full suite or order-customer browser test executed.

## Optional assignment — approved 2026-11-11
OWNER/ADMIN may start eligible unassigned shoes; assignment remains optional, never automatic. STAFF may process only their own assigned items; handover/return remains OWNER/ADMIN. Inspection, risk consent, zero rejected/declined fees, explicit smart-price agreement, valid transitions, photo/QC, transaction/history/audit/idempotency/outbox safeguards remain unchanged.

## Inspection establishes final pricing (2026-11-11; supersedes mandatory price agreement)
Completed staff inspections establish FINAL pricing automatically after outstanding explicit risk decisions are resolved. FINAL is sufficient for work/payment; no duplicate customer price-confirmation step. New FINAL snapshots carry verifiedAt/verifiedBy and PRICING_STAFF_VERIFIED audit evidence; never create customer consent, agreedTotalIdr/agreedAllocations, lockedAt or PRICING_CONFIRMED automatically. If the last event is a public risk decision, provenance refers to the recorded inspector, not the customer as staff.

Existing FINAL orders remain eligible by read-only validation of completed inspections, explicit consumed risk approvals, current item allocations/count/total, and nonpending statuses. No historical backfill or fabricated consent. Stale/mismatched prices fail PRICE_CHANGED; incomplete inspection/consent fails PRICE_NOT_FINAL. Historical LOCKED snapshots, original agreements and payment ledger remain intact. Existing explicit price-confirmation endpoints remain compatibility-only, never called automatically. Finalized smart orders cannot add/edit intake items. Historical FINAL/LOCKED allocations remain unchanged on reads and ordinary refresh. New authorized cancellation transitions opt into a separate current calculation using the original selected tariff snapshot and remaining eligible count; no average-allocation subtraction. Original agreement, staff provenance, initial estimate, consent evidence and payments remain unchanged; current allocations may increase when package eligibility is lost. Initial estimate, accepted-pair count, all-rejected zero and refund accounting remain accurate. STAFF assignment scope unchanged; OWNER/ADMIN need no assignment. Risk consent remains explicit and separate. No schema change/migration.


### Cancellation repricing and public tracking — current amendment 2026-11-11
New RETURN_PENDING cancellation/rejection/risk-decline transitions recalculate remaining eligible shoes using the existing named-plan rule engine and saved v2 rules (v1 fixed legacy NORMAL/PROMO tariff), never today’s catalog. Three-pair package losing one shoe uses saved singles; remaining valid packages/ranges still apply; all excluded costs zero. JSON cancellation evidence retains original total/count/allocations; historic agreement fields and staff verification are not rewritten. Before/after audit records remain; no consent fabrication, automatic refund, schema migration or historical backfill. Historical reads/ordinary refresh do not enroll old cancellations into the new policy.

Public tracking projects safe pricing only: name, estimate/final stage, count, initial/current/original totals, original/excluded counts, basis (INSPECTION/HISTORICAL_AGREEMENT/CANCELLATION), staffVerified boolean, turnaround policy and authoritative breakdown (kind, quantity, pairs, priceIdr, totalIdr). No staff ID, internal service/plan IDs, allocation evidence or raw rules. When historical allocations do not match current package math, breakdown is empty and calculationMatches=false; UI labels historical allocations, never invents a package. Unfinished active inspection/risk keeps public stage ESTIMATE. Net payments, balance and refund due stay ledger-derived; pending totals do not claim a fixed remaining balance. Rejected/declined item cleaning fees stay zero.

Tracking shows chosen tariff, eligible count, actual package/unit lines, initial versus cancellation-adjusted amount and eligibility explanation. Common service appears once at order level; genuinely mixed services retain per-shoe labels. Historical agreement is labelled historical, not new customer approval. API activation requires separately authorized restart; none performed for this patch.

## Editable workflow display names and tracking origin — 2026-11-12
Owner Pengaturan edits display text only: admin, public order, public shoe badge, public history contexts. READY_FOR_PICKUP defaults respectively Siap diambil, Siap Diambil, Selesai Dicuci, Selesai Dikerjakan. Consent/rework/return/handover remain truthful; codes, transitions, pricing, risk approval, payment, authorization and action wording remain unchanged. Group reset restores defaults. No arbitrary workflow steps.

Validated server-stored public origin governs newly generated manual links and WhatsApp snapshots. Existing APP_BASE_URL is fallback until saved; absent configuration defaults to http://127.0.0.1:5173. HTTPS required except exact loopback HTTP hosts. Settings do not provision DNS/TLS/hosting or change API routing/CORS/cookies. Old encrypted messages/events remain immutable, never replayed by settings changes.

Source-only nullable JSON column migration required before activating new API. Migration not applied; no API restart, worker/WhatsApp operation or live DB verification authorized/performed. Tests use isolated fake DB/control hooks and fail-closed browser API mocks, not live integration.

## Revised customer display-stage editor — approved 2026-11-12 (supersedes four-group editor)

Owner Pengaturan contains ONE ordered **Tahap Pengerjaan Pelanggan** list: edit plain-text names, toggle visibility, keyboard-accessible up/down, add custom informational stage, remove display configuration. Default list: Sepatu Diterima / Pemeriksaan Selesai / Dalam Proses Pencucian / Dalam Proses Pengeringan / Selesai Dikerjakan. No operational enum/status additions. Inspection, explicit risk consent, staff authorization, pricing, photo/QC gates and operational transitions remain unchanged.

Settings JSON adds `trackingStages`: ordered array of `{id, anchor, name, visible}`; 0–20 entries. Stable builtin IDs are `builtin.RECEIVED`, `builtin.QUEUED`, `builtin.WASHING`, `builtin.DRYING`, `builtin.READY_FOR_PICKUP`; builtin anchor must match ID. Custom IDs use `custom.` plus 1–64 ASCII letters/digits/underscore/hyphen. Custom anchors allow only those same five existing milestones. Unique IDs required; names trimmed, 1–80 characters, no markup/control/bidi controls; strict objects reject extra fields. Omitted array preserves saved configuration; absent legacy array uses safe defaults; empty array intentionally displays no configured steps. Legacy contextual status labels remain persisted/backward compatible, not editable through four groups.

`GET /api/v1/settings` is Owner-only, returns `trackingStagesVersion: 1` only after successful settings read. `PATCH /api/v1/settings` remains Owner-only with existing CSRF, idempotency, actor revalidation, row locking and transactional SETTINGS_UPDATED audit. Public tracking allowlists visible display entries and safe contextual labels only; no origin, admin labels, provider configuration, completion flag or synthetic timestamps. Existing authenticated `/display-settings` remains compatible.

Public per-shoe ordered display steps are separate from chronological factual history. Builtin evidence means only its exact operational event exists, never inferred from a later status. Custom steps explicitly say informational/linked to anchor; reaching anchor never claims custom execution/completion, never supplies a custom timestamp/event. Future/unperformed anchors clearly say not recorded. Reordering/hiding/deleting config cannot reorder/remove factual history, including hidden/deleted builtins, consent/rework/return/handover. Safety details and actual status stay independent. No historical backfill.

Old API without version/array, or failed settings read: local defaults stay visible; explicit unavailable/needs-activation message; save disabled, never pretend saved. Domain website field retained. Canonical HTTPS/loopback rules, new manual links/rotations/consent fragments, immutable old WhatsApp snapshots unchanged.

**Deployment gate: NOT DEPLOYED.** Existing `202611120001_display_settings` nullable JSON migration remains UNAPPLIED. No new migration needed. Separately authorize backup/review, migration and API activation in that order; do not activate new API against missing column. No live DB reads/writes, migration execution, API/worker restart or WhatsApp operations performed. Existing live internal-error/worker-lease problems outside scope. MySQL behavior/live integration not validated. Tests only isolated fake DB/queue interception and fail-closed browser API mocks with service workers blocked; full suite/order-customer excluded.


## Structured inspection / customer risk consent — 2026-11-12 (source only)

- Customer-visible fields are separate: `findings` (Temuan), existing `risk` (Risiko), `customerNote` (Catatan untuk Customer, optional). Internal `notes`, intake notes, history reasons remain private. No automatic splitting/backfill of old descriptions.
- New NEEDS_CONSENT submissions require trimmed findings and risk: 3..3000 characters, at least one Unicode letter/number. Optional public note: trimmed, maximum 3000; empty persists null. Internal notes remain optional/private, maximum 4000. BEFORE remains required; private INSPECTION risk photo is optional in UI and API. Supplied evidence remains private; photo limits/optimization unchanged. Strict Zod validation before mutation; assignment, role, token, single-use, expiry and explicit risk consent/washing guards unchanged. OWNER/ADMIN inspection scope unchanged.
- Nullable TEXT findings/customerNote added to Inspection and ConsentDecision. Issuing/reissuing copies public fields into a new consent evidence snapshot. Existing snapshots, historical agreements/payments/notifications stay unchanged. Legacy reissue may retain null findings; display one original description labelled legacy, never invented findings.
- Tracking explicitly allowlists public fields; consent card uses consent snapshot, not mutable inspection text. Title: Menunggu Persetujuan Customer. Separate Temuan/Risiko/Catatan, omitted blank note; no amount or Penanganan field. Actual expiry, rejection consequence, explicit approve/decline retained. Vue text interpolation escapes customer content; awaiting-consent summary does not duplicate risk.
- New CONSENT_REQUEST encrypted outbound snapshots append public findings/risk/optional note, or one legacy description; no internal notes or pricing append. Customer-safe control-character normalization retains up to 3000 characters per structured field. Existing encrypted notification snapshots remain immutable, no replay.
- Authenticated GET `/api/v1/settings/inspection-capabilities` returns `{ "structuredRiskConsent": true }` for OWNER/ADMIN. Form checks on opening and before uploads/mutation. Missing/unsupported API shows a deployment/migration/API activation warning near submit; retains fields/files, sends no uploads/inspection, never drops structured fields. Network/auth/server errors report verification failure, not unproven missing deployment; submit can retry. New API rejects missing required findings for risky submissions; approved/rejected legacy inputs remain compatible.
- Audit `/unmatched` is a sanitized placeholder for unknown/non-allowlisted routes, not the original URL. The submit path above requests the capability endpoint; old active API lacks it and falls through to NOT_FOUND. Original URLs for request IDs d3730728-75c9-4634-83cf-705a6b63f943 / 8c595549-1c8c-496d-a302-1c11fb6d12ae cannot be recovered from these audit entries alone. Health 200 does not establish structured inspection support.
- Optional-photo patch needs no additional schema/migration. Isolated verification: 4/4 backend tests (inspection, workflow, photo limits/optimization/privacy), 14/14 fail-closed browser tests; API/web/test typechecks and API/web ESLint passed. No live submission, full suite, deployment, migration, restart or WhatsApp operation performed. Existing activation gate below remains unresolved.

**Activation gate: NOT LIVE READY.** `202611120002_structured_risk_consent` is CREATE-ONLY / UNAPPLIED. Earlier unrelated `202611120001_display_settings` also remains UNAPPLIED. No migration/deploy/push/seed/reset, live DB write, API/worker restart, WhatsApp connect/activate/send/replay authorized or executed. Worker left running. Separately authorize backup/review and pending migrations in order, regenerate deployment client/build, then API activation only after columns exist. Frontend HMR alone cannot activate this feature; health 200 does not prove capability. MySQL/live integration unvalidated.

Validation restricted to API/web/test typechecks, relevant lint, isolated fake-DB workflow/HTTP/encrypted-snapshot tests, fail-closed browser mocks installed before navigation with service workers blocked. Full suite and order-customer browser tests excluded.

Final isolated verification: 5/5 backend tests passed (inspection-notes, simplified-workflow, whatsapp-templates); 18/18 browser tests passed (structured-consent, simplified-workflow). API/web/test typechecks passed; targeted ESLint passed with zero warnings. Earlier browser fixture failures (closed mobile menu, obsolete item-price assertion) corrected without changing UI behavior. No full suite, live MySQL integration, deployment, lifecycle restart or WhatsApp send performed. Both pending migrations remain UNAPPLIED; activation gates above still apply.

## Separate packing stage — approved 2026-11-12 (source only)

Supersedes the earlier direct drying-to-ready workflow: DRYING -> PACKING -> READY_FOR_PICKUP. PACKING participates in in-progress aggregation, pricing freeze and factual status history; it does not imply ready or payment completion. Existing ready photo/confirmation, risk consent, authorization, rework, audit and outbox guards remain. Legacy FINISHING/QC paths stay operable. The five configurable customer display anchors remain unchanged; PACKING is an actual operational/history event, not an added configurable anchor or fabricated completion.

Source migration `202611120003_packing_stage` adds PACKING to OrderItem.status. Activation requires separately authorized review/backup, pending migrations in order, deployment-client generation/build and API activation. This investigation does not inspect or change live migration state, execute migrations, deploy, restart API/worker or operate WhatsApp. Earlier deployment gates remain applicable; live MySQL integration is unvalidated.

Isolated verification for this investigation: 8/8 backend tests passed (display-settings, simplified-workflow, inspection-notes, whatsapp-templates); 19/19 browser tests passed (display-settings, simplified-workflow; API mocks, service workers blocked). API/web/test typechecks and application ESLint passed without warnings, using locally installed Node 25.2.1; default Node 20 cannot run registerHooks. MESSAGE_PAYLOAD_INVALID was an obsolete consent fixture missing consentDecision lookup, leaving no encrypted message; fixture and pre-decryption/content assertions corrected. Browser assertions scoped to badge/history and current rework wording; production code unchanged. Global ESLint remains blocked by 36 errors/2 warnings in third-party references/tabler, untouched. No full suite, live integration, deployment or outbound WhatsApp performed.

## Confirmed packing/QC workflow — 2026-11-12 (source only)

Supersedes the separate-stage requirement: the drying action opens the existing photo/QC form without a transition or notification. Successful confirmation records DRYING to READY_FOR_PICKUP directly; the next fulfillment action is payment-guarded handover. Existing PACKING records/history and older API transition remain compatible. Failed QC can enter REWORK. Existing consent, price, photo, role, audit, aggregate and outbox safeguards remain; no synthetic status or automatic messaging changes. No new migration or historical backfill. Activation requires backup/review, pending migrations and worker/notification readiness review; no deployment or live order changes in this patch.
