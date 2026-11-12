import { recordActivity } from './lib/audit.js';
import { lifecycleAudit } from './integrations/whatsapp/lifecycle.js';
import { controlFailure } from './integrations/whatsapp/diagnostics.js';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { z } from 'zod';
import { config } from './lib/config.js';
import { db } from './lib/db.js';
import { connection, lockKey, statusKey, sign, verify, closeControlConnections } from './lib/whatsapp-control.js';
import { WhatsAppWeb, createBrowserClient, clearBrowserSession } from './integrations/whatsapp/web.js';
import { deliverNotification } from './services/notifications.js';
const root = fileURLToPath(new URL('../../../var/whatsapp-control/', import.meta.url));
const pidPath = `${root}worker.pid`;
const owner = randomUUID();
const leaseMs = 15000;
let ownsPid = false;
let ownsLease = false;
let deadline = 0;
let activation: string | null = null;
let stopping = false;
let queue: Queue | undefined;
let redis: Redis | undefined;
let worker: Worker | undefined;
let controls: Worker | undefined;
let browser: WhatsAppWeb | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let watchdog: ReturnType<typeof setTimeout> | undefined;
let startupTimer: ReturnType<typeof setTimeout> | undefined;
let shutdownTask: Promise<void> | undefined;
let lastCommand: { command: string; status: string; error?: string } | undefined;
let startActor: string | undefined;
const auditLifecycle = lifecycleAudit(recordActivity);
let chain = Promise.resolve();
function exclusive<T>(run: () => Promise<T>): Promise<T> {
  const task = chain.then(() => { if (stopping) throw new Error('WORKER_STOPPING'); return run(); });
  chain = task.then(() => {}, () => {}); return task;
}
function fail(reason: string) {
  console.error(reason); void shutdown(1);
}
function checkLocal() {
  if (stopping) throw new Error('WORKER_LEASE_LOST');
  if (!ownsLease || performance.now() >= deadline) { fail('WORKER_LEASE_LOST'); throw new Error('WORKER_LEASE_LOST'); }
}
async function assertLease() {
  checkLocal();
  try {
    if (await redis!.get(lockKey) !== owner) { fail('WORKER_LEASE_LOST'); throw new Error('WORKER_LEASE_LOST'); }
  } catch (error) {
    if (!stopping) fail('WORKER_REDIS_CHECK_FAILED');
    throw error;
  }
  checkLocal();
}
function renewed(started: number) {
  deadline = started + leaseMs;
  clearTimeout(watchdog);
  watchdog = setTimeout(() => fail('WORKER_LEASE_DEADLINE_EXCEEDED'), Math.max(0, deadline - performance.now()));
  checkLocal();
}
async function disarm() {
  const wasEnabled = !!activation; activation = null;
  await db.storeSettings.updateMany({ data: { waActivation: null } });
  if (wasEnabled) await recordActivity({ action: 'WA_SENDING_DISABLED', entityType: 'WhatsApp', metadata: { realSendEnabled: false } });
}
async function publish() {
  checkLocal();
  const state = browser!.status;
  const payload = JSON.stringify({ ...state, workerId: owner, ready: state.state === 'ready', activation, realSendEnabled: !!activation && state.state === 'ready', lastCommand, updatedAt: Date.now() });
  const envelope = JSON.stringify({ payload, signature: await sign(payload) });
  checkLocal();
  const result = await redis!.eval("if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('set',KEYS[2],ARGV[2],'PX',12000) else return 0 end", 2, lockKey, statusKey, owner, envelope);
  if (result !== 'OK') { fail('WORKER_LEASE_LOST'); throw new Error('WORKER_LEASE_LOST'); }
}
async function main() {
  startupTimer = setTimeout(() => fail('WORKER_STARTUP_TIMEOUT'), 10000);
  process.umask(0o077);
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (stopping) return;
  try {
    const pid = Number(await readFile(pidPath, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('INVALID_WORKER_PID');
    try { process.kill(pid, 0); throw new Error('WORKER_ALREADY_RUNNING'); }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error; }
    await unlink(pidPath);
  } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  if (stopping) return;
  await writeFile(pidPath, String(process.pid), { flag: 'wx', mode: 0o600 }); ownsPid = true;
  if (stopping) return;
  redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 3000, commandTimeout: 3000, enableOfflineQueue: false, lazyConnect: true, retryStrategy: () => null });
  redis.on('error', () => fail('WORKER_REDIS_UNAVAILABLE'));
  redis.on('close', () => { if (!stopping) fail('WORKER_REDIS_CLOSED'); });
  await redis.connect();
  if (stopping) return;
  const started = performance.now();
  if (await redis.set(lockKey, owner, 'PX', leaseMs, 'NX') !== 'OK') throw new Error('WORKER_LEASE_HELD');
  ownsLease = true;
  if (stopping) return;
  renewed(started);
  let heartbeatBusy = false;
  heartbeat = setInterval(() => {
    if (heartbeatBusy || stopping) return;
    heartbeatBusy = true;
    void (async () => {
      checkLocal();
      const start = performance.now();
      let result;
      try { result = await redis!.eval("if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('pexpire',KEYS[1],15000) else return 0 end", 1, lockKey, owner); }
      catch { fail('WORKER_LEASE_RENEW_FAILED'); return; }
      if (result !== 1) { fail('WORKER_LEASE_LOST'); return; }
      if (stopping) return;
      checkLocal();
      renewed(start);
      if (browser) await publish();
    })().catch(() => { if (!stopping) fail('WORKER_STATUS_PUBLISH_FAILED'); }).finally(() => { heartbeatBusy = false; });
  }, 3000);
  await disarm();
  await assertLease();
  // A crashed send is ambiguous. Never repeat a potentially submitted message.
  const recoveredAttempts = await db.notificationAttempt.updateMany({ where: { provider: 'whatsapp-web.js', status: 'PROCESSING' }, data: { status: 'FAILED', response: { error: 'WORKER_RESTART_AMBIGUOUS_SEND', actualOutbound: 'unknown', retryable: false } } });
  await assertLease();
  const recoveredEvents = await db.notificationEvent.updateMany({ where: { provider: 'whatsapp-web.js', status: 'PROCESSING' }, data: { status: 'FAILED' } });
  if (recoveredAttempts.count || recoveredEvents.count) await recordActivity({ action: 'NOTIFICATION_RECOVERY_FAILED', entityType: 'WhatsApp', metadata: { reason: 'WORKER_RESTART_AMBIGUOUS_SEND', actualOutbound: 'unknown', retryable: false, count: recoveredEvents.count, attemptCount: recoveredAttempts.count } });
  await assertLease();
  browser = new WhatsAppWeb(createBrowserClient, state => {
    auditLifecycle(state);
    if (stopping) return;
    if (lastCommand?.command === 'start' && lastCommand.status === 'starting' && ['error', 'ready', 'disconnected'].includes(state.state)) {
      const failed = state.state !== 'ready';
      lastCommand = { command: 'start', status: failed ? 'failed' : 'completed', ...(failed ? { error: state.error ?? 'NOT_READY' } : {}) };
      void recordActivity({ action: failed ? 'WA_START_FAILED' : 'WA_START_COMPLETED', entityType: 'WhatsApp', actorId: startActor, metadata: { state: state.state, outcome: failed ? 'FAILED' : 'SUCCESS', ...(failed ? { reason: state.error ?? 'NOT_READY' } : {}), ...state.diagnostic } }).catch(() => fail('WORKER_AUDIT_FAILED'));
    }
    if (state.state !== 'ready') void disarm().catch(() => fail('WORKER_DISARM_FAILED'));
  }, clearBrowserSession);
  queue = new Queue('notifications', { connection });
  queue.on('error', () => fail('WORKER_OUTBOX_QUEUE_ERROR'));
  worker = new Worker('notifications', job => exclusive(async () => {
    await assertLease();
    const permission = activation;
    await deliverNotification(String(job.data.eventId), Number(job.data.generation), { activation: permission, ready: browser!.status.state === 'ready', send: async input => {
      // Recheck after SQL claim/audit awaits, immediately before browser submission.
      await assertLease();
      if (!permission || activation !== permission) throw new Error('ACTIVATION_CHANGED');
      return browser!.send(input);
    } });
    const event = await db.notificationEvent.findUnique({where:{id:String(job.data.eventId)}});
    if (!stopping && event?.provider === 'whatsapp-web.js' && event.status === 'FAILED') await disarm();
  }), { connection, concurrency: 1 });
  worker.on('error', () => fail('WORKER_NOTIFICATION_QUEUE_ERROR'));
  worker.on('failed', job => { console.error('Notification failed', job?.id); void recordActivity({action:'NOTIFICATION_JOB_FAILED',entityType:'NotificationEvent',entityId:job?.data?.eventId,metadata:{outcome:'FAILED'}}).catch(() => fail('WORKER_AUDIT_FAILED')); });
  controls = new Worker('cicuci-wa-control', job => exclusive(async () => {
    await assertLease();
    const { payload, signature } = z.object({ payload: z.string().max(2048), signature: z.string().length(64) }).parse(job.data);
    if (!await verify(payload, signature)) throw new Error('INVALID_COMMAND');
    const input = z.object({ command: z.enum(['start', 'disconnect', 'activate', 'deactivate']), actorId: z.string(), workerId: z.string(), expiresAt: z.number() }).strict().parse(JSON.parse(payload));
    if (input.workerId !== owner) throw new Error('INVALID_COMMAND');
    if (input.expiresAt < Date.now()) throw new Error('COMMAND_EXPIRED');
    const actor = await db.user.findUnique({ where: { id: input.actorId } });
    if (!actor?.isActive || actor.role !== 'OWNER') throw new Error('FORBIDDEN');
    await assertLease();
    if (input.command === 'start') { if (browser!.status.state !== 'ready') await disarm(); await assertLease(); startActor = actor.id; lastCommand = { command: 'start', status: 'starting' }; await browser!.start(); }
    if (input.command === 'disconnect') { await disarm(); await assertLease(); await browser!.stop(true); }
    if (input.command === 'deactivate') await disarm();
    if (input.command === 'activate') {
      if (browser!.status.state !== 'ready') throw new Error('NOT_READY');
      if (!activation) {
        const nextActivation = randomUUID();
        await db.storeSettings.upsert({ where: { id: 1 }, create: { waActivation: nextActivation }, update: { waActivation: nextActivation } });
        await assertLease();
        activation = nextActivation;
      }
    }
    checkLocal();
    if (browser!.status.state === 'error' && input.command !== 'deactivate') throw new Error(browser!.status.error);
    if (input.command !== 'start') lastCommand = { command: input.command, status: 'completed' };
    else if (browser!.status.state === 'ready') lastCommand = { command: 'start', status: 'completed' };
    await recordActivity({ actorId: actor.id, action: `WA_${input.command.toUpperCase()}_${input.command === 'start' ? 'ACCEPTED' : 'COMPLETED'}`, entityType: 'WhatsApp', entityId: job.id });
    await publish();
  }), { connection, concurrency: 1 });
  controls.on('error', () => fail('WORKER_CONTROL_QUEUE_ERROR'));
  controls.on('failed', (job, error) => { lastCommand = { command: 'control', status: 'failed', error: controlFailure(error) }; void recordActivity({ action: 'WA_CONTROL_FAILED', entityType: 'WhatsApp', entityId: job?.id, metadata: { reason: controlFailure(error) } }).catch(() => fail('WORKER_AUDIT_FAILED')); console.error('WhatsApp command failed', job?.id); if (!stopping) void publish().catch(() => fail('WORKER_STATUS_PUBLISH_FAILED')); });
  let polling = false;
  async function dispatch() {
    if (polling || stopping) return;
    polling = true;
    try {
      await assertLease();
      const events = await db.notificationEvent.findMany({ where: { provider: 'whatsapp-web.js', status: 'PENDING', nextAttemptAt: { lte: new Date() } }, take: 100, orderBy: { createdAt: 'asc' } });
      for (const event of events) { checkLocal(); await queue!.add('deliver', { eventId: event.id, generation: event.generation }, { jobId: `${event.id}-${event.generation}`, attempts: 5, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: true, removeOnFail: true }); }
    } catch { if (!stopping) { console.error('Outbox dispatch failed'); await recordActivity({action:'OUTBOX_DISPATCH_FAILED',entityType:'Worker',metadata:{outcome:'FAILED'}}); } }
    finally { polling = false; }
  }
  try { await publish(); } catch { if (!stopping) fail('WORKER_STATUS_PUBLISH_FAILED'); return; }
  checkLocal();
  clearTimeout(startupTimer);
  timer = setInterval(() => { void dispatch().catch(() => fail('WORKER_DISPATCH_FAILED')); }, 3000);
  void dispatch().catch(() => fail('WORKER_DISPATCH_FAILED'));
}
function shutdown(code = 0): Promise<void> {
  if (code) process.exitCode = code;
  if (shutdownTask) return shutdownTask;
  const shutdownActivation = activation;
  stopping = true; activation = null;
  clearInterval(timer); clearInterval(heartbeat); clearTimeout(watchdog); clearTimeout(startupTimer);
  // Hard deadline remains referenced: hung browser/SQL/BullMQ must not strand an alive worker.
  const hardStop = setTimeout(() => { console.error('WORKER_SHUTDOWN_TIMEOUT'); process.exit(1); }, 10000);
  shutdownTask = (async () => {
    const cleanup = async (stage: string, run: () => Promise<unknown>) => {
      try { await run(); } catch { console.error(`WORKER_CLEANUP_FAILED:${stage}`); process.exitCode = 1; }
    };
    // Revoke in memory first; stop browser concurrently with drains, never wait for a blocked control.
    // Compare activation: never clear a replacement worker's permission after lease loss.
    const hidden = ownsLease ? cleanup('status', async () => redis!.eval("if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[2]) else return 0 end", 2, lockKey, statusKey, owner)) : Promise.resolve();
    const disarmed = ownsLease ? cleanup('activation', async () => {
      await db.storeSettings.updateMany({ where: { waActivation: shutdownActivation }, data: { waActivation: null } });
    }) : Promise.resolve();
    await Promise.all([
      hidden, disarmed,
      cleanup('notifications', async () => worker?.close()),
      cleanup('controls', async () => controls?.close()),
      cleanup('browser', async () => browser?.stop()),
    ]);
    await Promise.all([
      cleanup('queue', async () => queue?.close()),
      cleanup('shared-connections', closeControlConnections),
      cleanup('database', () => db.$disconnect()),
    ]);
    if (ownsLease) await cleanup('lease', async () => redis!.eval("if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1],KEYS[2]) else return 0 end", 2, lockKey, statusKey, owner));
    await cleanup('redis', async () => { redis?.disconnect(); });
    if (ownsPid) await cleanup('pid', async () => { if (await readFile(pidPath, 'utf8') === String(process.pid)) await unlink(pidPath); });
    clearTimeout(hardStop);
    process.exit(process.exitCode ? 1 : 0);
  })();
  return shutdownTask;
}
process.on('SIGTERM', () => { console.error('WORKER_SIGNAL:SIGTERM'); void shutdown(); });
process.on('SIGINT', () => { console.error('WORKER_SIGNAL:SIGINT'); void shutdown(); });
process.on('uncaughtException', () => fail('WORKER_UNCAUGHT_EXCEPTION'));
process.on('unhandledRejection', () => fail('WORKER_UNHANDLED_REJECTION'));
await main().catch(error => {
  const reason = error instanceof Error && ['WORKER_ALREADY_RUNNING', 'INVALID_WORKER_PID', 'WORKER_LEASE_HELD'].includes(error.message) ? error.message : 'WORKER_STARTUP_FAILED';
  fail(reason);
});
