# WhatsApp Web provider

Source-only worker reliability patch, fault-test results, supervisor requirements and outstanding production gates: [worker readiness](WHATSAPP_WORKER_READINESS.md). Not deployed; existing processes unchanged. This gate supersedes historical readiness claims below for the current source.

Unofficial `whatsapp-web.js`; not Meta Cloud API. May disconnect, break after WhatsApp changes, or cause account restriction/ban. Dedicated business number recommended. Official Business Platform remains the supported alternative. Risk accepted for this implementation; pairing and actual customer delivery still require owner action.

## Link without sending

1. Use Node >=22.12 (Node 24 recommended). Install locked dependencies with `npm ci`, generate Prisma, apply forward migrations with `npm run db:deploy`. Never reset the database.
2. No provider selector/configuration exists; whatsapp-web.js is the sole operational provider. Start Redis privately, API, web, exactly one worker. Worker does not auto-open browser or auto-enable outbound after restart.
3. Provide `WA_CHROME_PATH` to sandbox-capable Chrome, or install Puppeteer's browser using `npx puppeteer browsers install chrome`. Current macOS worker uses `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. No sandbox-disabling arguments are used. Patched Puppeteer 25 override requires modern Node; actual QR initialization verified on Node 25.2.1 (the local Homebrew Node 24 path resolves to that binary).
4. Log in as OWNER at `http://127.0.0.1:5173`; open WhatsApp, select **Mulai / tampilkan QR**. On the business phone: WhatsApp → Linked devices → Link a device. Scan the private owner-only QR. Never share screenshots.
5. Wait for `ready`. This only means browser pairing; real sending remains disabled. QR expires after at most 45 seconds, clears on authentication/disconnection/error, refreshes from WhatsApp; retries bounded. Start again after terminal failure. Pairing is not automatic after process restart.
6. **Putuskan & hapus sesi** disables outbound, logs out, closes browser, removes this application's isolated local profile. If logout fails remotely, remove the linked device on the phone too. A successful local deletion cannot guarantee remote revocation.

## Enable actual sends later

1. Run API and exactly one worker. No provider environment switch or restart is needed to enable sending. Restarts always disable activation; preserve the linked profile.
2. Start/pair again, wait for ready. Check risk acknowledgement; click **Aktifkan kirim nyata**. Confirm UI reports real sending active. Command acceptance (202) is not completion; UI shows last command result/readiness.
3. Only events created after successful activation receive its activation ID. Historical mock events retain their original provider/status/attempts unchanged (including pending/failed); SIMULATED remains simulation only. Events from prior activations are skipped, never replayed into a new activation. Disable/restart/disconnect invalidates activation. Existing real failures cannot be retried through notification retry API; review manually without blindly duplicating messages.
4. Customer's current consent, phone, order/item state, consent expiry are checked before the committed send claim. Consent changes after network submission cannot recall a message.

## Storage and control security

- Dedicated `var/whatsapp/session-cicuci-owner` LocalAuth, never old bot sessions. Private directory 0700, worker umask 0077; `var/` and conventional WhatsApp profile/cache paths ignored by Git. Treat all profile files/backups as account credentials; never serve them publicly. This workspace is under Google Drive: exclude private var/ from cloud synchronization/backups or deploy from non-synced private storage before scanning. Git ignore does not stop cloud sync.
- Owner-only status/start/disconnect/activate/deactivate. Mutations require session, CSRF, exact configured Origin, UUID idempotency key, strict Zod input; rate limited. API never owns a browser.
- BullMQ control jobs and Redis status carry HMAC signatures using private `var/whatsapp-control/key`; API and worker must share this private directory, not expose it. Status reads never control the browser; signed snapshots must match the live worker lease and freshness window. Browser refresh/navigation preserves worker readiness and activation. Worker restart still resets activation and starts stopped. Commands bind to the accepting worker instance and expire in 30 seconds; worker rechecks active owner. No QR/session payload logs. QR status has no-store headers, short Redis TTL and UI polling.
- Redis is a trusted internal dependency: loopback/protected mode locally; ACL authentication and TLS for remote deployment. Never expose Redis publicly. Signatures prevent unauthorized payload fabrication, not Redis denial of service or disclosure by a Redis administrator. Redis contains transient raw QR; protect access/backups accordingly.
- Local exclusive PID file plus renewed Redis lease prevents duplicate worker/browser ownership. One shared host/profile only; not a multi-host HA design. Gracefully stop worker before upgrades. An orphan browser after OS kill requires operator confirmation/cleanup before removing a stale lock; never start two clients against one profile.

## Delivery semantics

Atomic business outbox and event-key uniqueness retained. Serial queue; committed PROCESSING claim/attempt before browser I/O, no network inside SQL transaction. Current activation and consent enforced. Pre-submission not-ready failures retain bounded attempts/exponential backoff. At event creation, missing activation records SKIPPED/NOT_ENABLED; missing consent or unavailable/disconnected worker records SKIPPED with its reason and actualOutbound:false. Activation never requeues skipped events. Provider submission uses a 30-second timeout.

WhatsApp Web offers no server idempotency contract. Browser submission failure/timeout/crash is ambiguous: FAILED, no automatic/manual API retry; worker disarms sending on failed real delivery but retains the linked browser connection. Restart reconciles orphan PROCESSING claims/attempts to FAILED. This favors avoiding duplicates over guaranteed delivery; operator review is required. SENT means browser submission returned an ID, NOT delivery/read receipt. No inbound bot logic, receipt webhook, automatic reconnect, template editor, or historical backlog conversion.

## Verification (2026-11-11)

Refresh investigation: fresh signed worker snapshots genuinely reported stopped. Audit at 09:00:31 UTC showed AMBIGUOUS_SEND_MANUAL_REVIEW, sending disabled, then ready → stopped; browser teardown after notification failure caused the lost connection, not a status GET. Removed that teardown; permission revocation and failed-message quarantine remain. UI now explicitly loads status and rejects late responses. Snapshot reads bind signature, freshness and current worker lease; commands bind to the accepting worker instance.

Refresh regression: 31 selected mocked browser tests passed (repeated reload/remount, sending enabled/disabled, no disconnected flash, no automatic commands, stale response protection, existing Audit UI). Unit suites: 17 passed, four opt-in integration/QR suites skipped; typecheck, test typecheck, lint and build passed. An initial broad browser invocation also ran the live MVP suite; its WhatsApp expectation failed during the old/new worker protocol transition. That broad suite was not rerun. Changed worker restarted once gracefully; explicit existing-session start restored ready, sending disabled, verified by fresh signed reads. Zero notification attempts during this investigation; no activation, send, replay, logout or session deletion.

Sole-provider change: typecheck, test typecheck and default unit suites passed. Fake-only DB tests cover creation blocking, activation-scoped queueing, disconnection, current opt-in, historical provider isolation, concurrent dedupe and ambiguous-send quarantine. Live queue/business integration (2 tests), Playwright browser suites (2 tests), lint, build and both dependency audits passed (zero vulnerabilities); no real outbound test or automatic activation.

Before restart, worker reported ready with real sending disabled: an owner-linked session already exists. Graceful stop retained the profile (no logout/deletion); the old browser needed explicit normal termination after worker released its lease. New worker starts stopped; owner selects Start to restore the existing session, then explicitly activates sending. Restoration and actual delivery are not claimed until observed.

Never run the opt-in QR test against this linked account: it intentionally disconnects/deletes the session. Private session/control storage remains in Google Drive workspace; exclude from synchronization/backups or plan an offline move to non-cloud private storage. No live profile relocation was attempted.

## Debugging and truthful feedback

Order saved and WhatsApp delivery are separate. The UI reports persisted SKIPPED/PENDING/PROCESSING/SENT/FAILED; SENT means browser submission, not delivery/read confirmation. Start is incomplete until ready, asynchronous failures remain failed. Owner activation/risk acknowledgement and customer opt-in remain mandatory.

Owner Audit includes atomic business/auth history, API mutations and failed reads, WhatsApp lifecycle/control events, notification queued/skipped/attempt/submission/failure, and worker recovery failures. Successful GET polling and Audit reads are excluded. Details use allowlisted codes, route templates, server-generated request IDs; never request bodies, headers, tracking tokens, QR/session contents, phone numbers or raw provider exceptions. Audit persistence failure emits AUDIT_WRITE_FAILED without rolling back completed sends. This supplemental logging is best effort, not a durable external log sink.

Audit filters: q, action, entityType, outcome, requestId, from/to ISO datetimes, cursor/limit. Newest first; legacy records keep their original timestamps and may lack diagnostic metadata. Migration 202611110006 only adds nullable diagnostic columns.

Initialization failures now distinguish missing/locked/permission-denied browser, sandbox, network, timeout and launch errors. Unknown exceptions remain INITIALIZATION_FAILED. Previously discarded causes cannot be reconstructed; no repair claim without an owner-initiated connection attempt. Never delete the linked profile or disable the sandbox to diagnose.


## Customer message templates

WhatsApp menu: **Template pesan pelanggan** first, **Riwayat pengiriman** collapsed. Owner edits event name/body; owner/admin read and preview. Preview uses fictional data, never a live customer link or provider send. CSRF and owner authorization protect writes. GET/PATCH `/api/v1/whatsapp-templates`; POST `/api/v1/whatsapp-templates/preview`. Changes apply only to newly created events, never replay history.

Placeholders: `{nama_pelanggan}`, `{total_sepatu}` (whole order), `{detail_sepatu}` (whole-order shoe/service bullets), `{nomor_pesanan}`, `{sepatu}` (event item), `{url_tracking}`. All emitted item transitions plus receipt and consent have Indonesian defaults. No internal notes, risk prose or photos are inserted. Consent requests use an expiring single-use approval token in the tracking URL fragment; customer still explicitly approves/declines. HTML, literal URLs, controls, unknown/malformed placeholders and excessive length are rejected. Body max 2,000 characters; rendered message max 12,000. Cicuci Sepatu and tracking placeholder required.

Forward migration `202611110007_whatsapp_templates` adds settings JSON, encrypted order token and encrypted event snapshot. Public lookup remains SHA-256 hash-only. Configure **WA_MESSAGE_KEY** as a private random 32-byte hexadecimal secret shared by API/worker; back it up separately from DB, never log or commit it. Local development key provisioned without printing. AES-256-GCM protects recoverable tracking tokens and immutable customer messages at rest; notification history/API excludes ciphertext and shows a redacted message. Audit records event code only, never body, alias, recipient, URL or token. Existing idempotent response encryption is unchanged.

Origin uses configured **APP_BASE_URL**, no assumed store domain/address. HTTPS required except loopback HTTP. Localhost links work only locally; UI warns. Missing key/token, invalid origin, oversized render: fail closed, no send. Older hash-only orders require explicit owner/admin tracking rotation before future notifications can contain links. Rotation/revocation makes pending old snapshots ineligible (`TRACKING_CHANGED`); no automatic replacement/replay. Key replacement invalidates old encrypted snapshots; rotate affected tracking links explicitly. Historical mock and legacy unsnapshotted events are never replayed; legacy pending messages skip (`MESSAGE_UNAVAILABLE`). Existing activation, current opt-in, recipient/state/consent checks and ambiguous-send no-retry remain mandatory. A token revoked after a browser submission cannot retract a submitted message; its URL immediately stops authorizing access.

Development API deliberately has no automatic watcher: cloud-drive filesystem events caused continuous dependency restarts even with watcher exclusions. Restart API manually after source edits. Worker restart disarms real sending and preserves the linked browser profile; owner must reconnect, then separately activate when appropriate. No real delivery test or activation performed for this feature.

## Salutation and deletion safety
`{sapaan}` renders the current customer's Kak/Pak/Bu (Kak default) in newly created notification snapshots. Default greetings use it. Saved custom bodies remain exact: literal Kak stays literal until Owner explicitly edits the body to use `{sapaan}`. Existing encrypted snapshots, redacted historical messages and mock history remain unchanged, without replay.

Permanent order deletion rejects PENDING/PROCESSING events or PROCESSING attempts under the same order lock used by delivery claims. Terminal events, encrypted snapshots and delivery attempts remain; the existing order foreign key detaches terminal events instead of deleting evidence. Restrictive dependencies reject deletion. Legacy archive-column checks remain defensive only; no archive action exists. No replacement, replay, activation, logout or live send accompanies deletion.
