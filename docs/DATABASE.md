# Database — Cicuci Sepatu

## Konvensi

- MySQL 8, `utf8mb4`, timezone koneksi UTC.
- Prisma memakai provider `mysql`; `DATABASE_URL` berisi credential environment.
- PK: `CHAR(26)` ULID dibuat aplikasi. Timestamp: `DATETIME(3)` UTC.
- Mata uang IDR: `INT UNSIGNED`, tidak memakai float.
- Enum Prisma/MySQL untuk status tetap. Label Indonesia dipetakan di web.
- Foreign key wajib `RESTRICT` untuk data operasional; detail yang aman dihapus memakai `CASCADE`.

## Entitas

| Tabel | Field penting | Aturan |
|---|---|---|
| `users` | id, name, email, passwordHash, role, isActive | `email` unik; role OWNER/ADMIN/STAFF. |
| `customers` | id, name, whatsappNormalized, notes, notificationConsentAt, notificationOptOutAt | Nomor format E.164, index pencarian. |
| `services` | id, name, basePriceIdr, isActive | Katalog harga. Harga snapshot disimpan di item. |
| `orders` | id, orderNumber, customerId, estimatedCompletionAt, trackingTokenHash, trackingTokenCreatedAt, trackingTokenRevokedAt, paymentStatus, totalAcceptedIdr, paidAmountIdr, aggregateStatus | `orderNumber` unik; aggregate selalu dihitung ulang service. |
| `order_items` | id, orderId, sequence, brand, model, color, serviceName, quotedPriceIdr, finalPriceIdr, initialNotes, status, inspectionOutcome, assignedUserId | unik pada `(orderId, sequence)`; seluruh workflow per sepatu. |
| `inspections` | id, orderItemId, notes, outcome, riskDescription, assessedByUserId, assessedAt | Satu inspection aktif per item untuk MVP. |
| `consent_decisions` | id, orderItemId, decision, quotedPriceIdr, riskSnapshot, approvalTokenHash, expiresAt, usedAt, decidedAt, ipHash | Satu request aktif per item; token tidak disimpan mentah. |
| `status_histories` | id, orderItemId, fromStatus, toStatus, reason, actorType, actorUserId, occurredAt | Append-only. |
| `photos` | id, orderItemId, kind, storageKey, mimeType, byteSize, sha256, isCustomerVisible, uploadedByUserId | `storageKey` unik; binary tidak di database. |
| `payments` | id, orderId, amountIdr, method, reference, receivedAt, recordedByUserId, voidedAt | Jumlah valid dihitung untuk payment status. |
| `notification_events` | id, eventKey, orderId, orderItemId, type, recipient, payloadJson, status, availableAt, lockedAt, completedAt | `eventKey` unik untuk deduplikasi outbox. |
| `notification_attempts` | id, notificationEventId, attemptNo, provider, requestJson, responseJson, status, attemptedAt | unik `(notificationEventId, attemptNo)`. |
| `audit_logs` | id, actorUserId, action, entityType, entityId, beforeJson, afterJson, ipHash, occurredAt | Append-only; tidak menyimpan password/token mentah. |

`aggregateStatus` adalah cache query untuk dashboard. Sumber kebenaran tetap status item serta aturan pada [`BUSINESS_FLOW.md`](BUSINESS_FLOW.md:1).

## Constraint bisnis

- `quotedPriceIdr`, `finalPriceIdr`, `amountIdr`, `totalAcceptedIdr`, `paidAmountIdr` bernilai nol atau positif.
- Item `REJECTED` atau `DECLINED` harus `finalPriceIdr=0`. Service menegakkan sebelum commit; validasi database tambahan dapat memakai MySQL trigger bila laporan admin dapat melakukan SQL langsung.
- Item selesai dibersihkan membutuhkan inspection `APPROVED` atau consent `APPROVED` sebelum transition washing.
- `READY_FOR_PICKUP` untuk item cleaned membutuhkan QC pass dan foto AFTER customer-visible.
- Satu request consent terbuka per item: service menandai request sebelumnya kedaluwarsa sebelum menerbitkan yang baru.
- Payment tidak mengubah status laundry.

## Indeks

| Tabel | Indeks |
|---|---|
| `users` | unique email |
| `customers` | whatsappNormalized, name |
| `orders` | unique orderNumber, unique trackingTokenHash, customerId plus createdAt, aggregateStatus plus estimatedCompletionAt |
| `order_items` | orderId plus sequence unique, status plus updatedAt, assignedUserId plus status |
| `inspections` | orderItemId unique |
| `consent_decisions` | approvalTokenHash unique, orderItemId plus decision, expiresAt |
| `status_histories` | orderItemId plus occurredAt |
| `photos` | storageKey unique, orderItemId plus kind |
| `payments` | orderId plus receivedAt |
| `notification_events` | eventKey unique, status plus availableAt |
| `audit_logs` | entityType plus entityId plus occurredAt, actorUserId plus occurredAt |

## Migration plan

1. Buat baseline Prisma: enum, semua tabel, foreign key, unique key, index.
2. Seed hanya role owner bootstrap serta service contoh development. Tidak memakai data produksi.
3. Setiap perubahan schema berikutnya melalui `prisma migrate dev --name <deskripsi>` lalu commit folder migration.
4. Production memakai `prisma migrate deploy`; dilarang `db push`.
5. Backup sebelum migration destruktif; migration harus backward-compatible bila API lama masih berjalan.

## Retensi

Foto dihapus hanya melalui proses retensi terotorisasi. Hapus record photo serta file dengan job terukur; tidak menghapus file pada request biasa. Notification payload harus menghindari data lebih dari yang diperlukan.


## Permanent deletion — supersedes archive / no-hard-delete contracts (2026-11-11)
OWNER only: DELETE /customers/:id, /orders/:id, /pricing/plans/:id, /users/:id. CSRF + UUID Idempotency-Key required. Strict body {"confirmed":true,"confirmation":"HAPUS"}; missing/wrong confirmation 400, unauthorized 403, missing record 404. Successful response {id,deleted:true}; physical removal, no restore. Same-key replay returns original receipt without another deletion/audit.

Order deletion transaction locks order then notification rows (same order as worker claim), permits paid/partially paid/fully refunded orders while preserving every ledger entry, rejects PENDING/PROCESSING events or PROCESSING attempts (NOTIFICATION_IN_PROGRESS). Deletes photos (DB blobs), inspection, consent, status history, items, then order; tracking/photos/approval tokens cease resolving. Terminal notification events, encrypted snapshots and attempts remain: existing migration002 FK uses ON DELETE SET NULL. No send/replay/cancel/refund. Unexpected restrictive FK returns DELETE_DEPENDENCY; entire transaction rolls back, never deletes ledger, audit or delivery evidence.

Customers with any orders reject CUSTOMER_HAS_ORDERS; no cascade. Users referenced by assignments, inspections, status history or payments reject USER_HAS_HISTORY. Audit-only references do not block physical deletion; all existing audit rows and actorUserId values remain unchanged. Eligible deletion revokes sessions transactionally. Own account protected CURRENT_ACCOUNT; last active Owner protected LAST_OWNER with same ordered Owner locks as edits. API mutations lock/revalidate actor to serialize historical actor references against deletion. In-flight reads may finish.

RatePlan has no order FK: planId/name/rules/revision/policy are historical JSON snapshots; deletion leaves them unchanged. Unique plan names/user emails released only by physical delete. Success audit records actor, entity type/ID and confirmed:true only; no PII/password/token snapshots.

Kak/Pak/Bu remains; Kak default, edits affect future greetings only. Migration011 remains byte-for-byte unchanged: additive salutation plus reserved nullable archive columns, retained to avoid migration churn. No archive route/action remains; defensive old-column checks remain fail-closed. Deployment 2026-11-11 completed after authorized forward recovery from Prisma P3018/MariaDB errno121 in migration012's combined ALTER. `Payment.originalOrderId`/`originalOrderNumber` are required immutable snapshots, `Payment.orderId` is nullable, and `Payment_orderId_fkey` is `ON DELETE SET NULL ON UPDATE CASCADE`; `Payment_original_identity_check` rejects empty snapshots. The original failed migration record remains rolled-back evidence; a matching checksum applied record is present. API PID57749 returned health HTTP200; worker PID54229 remained unchanged. Original application rows, payment net revenue100000 IDR, and historical audit/delivery evidence were preserved. No force/reset/repair, real deletion, fixture, WhatsApp action, or live deletion/SET NULL test occurred. See [`DEPLOYMENT_LEDGER_20261111.md`](DEPLOYMENT_LEDGER_20261111.md:1).


## Paid-order physical deletion — deployed after recovery (2026-11-11)

Supersedes the previous ORDER_HAS_PAYMENTS refusal. OWNER-only DELETE /orders/:id retains strict confirmation, CSRF, UUID idempotency and one transactional deletion audit. Paid, partially paid and refunded orders may be physically removed; deletion is not a refund or financial correction. Operational children/tracking disappear. Payment/refund ledger, historical audit, terminal notification snapshots/attempts remain. PENDING/PROCESSING events or PROCESSING attempts still return 409 NOTIFICATION_IN_PROGRESS; unexpected restrictive FKs return 409 DELETE_DEPENDENCY, rolling back the entire deletion. Audit failure also rolls back all deletion/detachment. Same-key replay returns its receipt without repeating effects; a new key against a missing order returns 404.

Migration source 202611110012_detached_payment_ledger adds required immutable Payment.originalOrderId (30 chars) and originalOrderNumber (50 chars), backfilled from the still-FK-protected original Order before weakening the FK. Payment.orderId and Payment.order become nullable; ON DELETE SET NULL changes only the live link. Historical amounts, methods, references, reasons, actors, receivedAt and createdAt are never rewritten. No customer PII snapshots added. Every new payment/refund uses the shared ledger writer to snapshot order ID/number under the existing order row lock. Required fields have no defaults; old writers fail rather than inventing identity. Migration011 remains unchanged.

Reference audit: shared ledger writer is the sole production Payment.create; no production ledger update/delete exists. Order detail/list/tracking/pricing use the live Order.payments collection and do not dereference Payment.order; detached entries intentionally do not attach to any order. User history guards still query Payment.actorUserId regardless of detached state. Dashboard queries Payment independently with an extant Order relation, sums PAYMENT minus REFUND only for surviving orders, and filters inclusively by receivedAt from/to, never by order creation/status. Detached payments/refunds remain physically retained but excluded from dashboard revenue; no surviving orders means revenueIdr 0. This overrides prior immutable-ledger dashboard semantics, not ledger/audit retention. STAFF neither queries the ledger nor receives revenue. Operational counts use surviving orders only. Workspace retains metrics clearing before refresh and reload after successful deletion/navigation; protected failures retain unchanged counts. No ledger browsing/reconciliation endpoint added.

Deployment completed 2026-11-11 after owner-confirmed staged recovery of migration012. Required identity snapshots populated 5/5; nullable live orderId; SET NULL/CASCADE FK and nonempty identity check verified. Prisma resolve recorded matching-checksum applied012 after schema verification, retaining the failed record as rolled-back evidence. Source migration/schema unchanged. Client regenerated; API typecheck passed. API57749 started Wed Nov 11 23:28:30 2026, health HTTP200; worker54229 retained original start Wed Nov 11 16:44:04 2026 and cwd. Original application-column hashes, payment ledger/revenue100000 IDR, audit and delivery evidence preserved. No real deletion, live deletion/SET NULL test, login, fixture, worker/WhatsApp control, or system repair/upgrade. Accepted backup excludes routines/events; restore untested. See deployment ledger for historical failure and recovery details.

Validation for this amendment: selected salutation-deletions backend regression passed (in-memory tables/import hooks; ephemeral loopback HTTP only); dashboard-deletion browser regression passed in classic/new presentations (2 tests, all API routes mocked fail-closed, service workers blocked, explicit Chrome). API/web typecheck, lint and builds passed. No full suite or order-customer browser test executed.
