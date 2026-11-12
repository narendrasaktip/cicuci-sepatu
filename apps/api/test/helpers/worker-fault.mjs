// Subprocess fixture: every worker I/O import replaced BEFORE worker import.
/* eslint-disable @typescript-eslint/no-this-alias -- expose fake instances to fault driver */
import process from 'node:process';
import { setImmediate } from 'node:timers';
import { registerHooks } from 'node:module';
import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
const scenario = process.argv[2];
const trace = value => console.log(value);
const never = () => new Promise(() => {});
let owner;
let redis;
let now = 0;
Object.defineProperty(globalThis, "performance", { value: { now: () => now } });
let pid;
let replacement = false;
let browser;
let control;
let notification;
let intervals = [];
let lateSend;
let published = 0;
const nativeTimeout = globalThis.setTimeout;
// Virtual interval ticks; hard deadlines accelerated only inside this fake-only child.
globalThis.setInterval = (fn, ms) => { const timer = { fn, ms }; intervals.push(timer); return timer; };
globalThis.clearInterval = timer => { intervals = intervals.filter(value => value !== timer); };
globalThis.setTimeout = (fn, ms, ...args) => nativeTimeout(fn, ms === 10000 ? 100 : ms, ...args);
const tick = () => intervals.find(timer => timer.ms === 3000)?.fn();
const settle = () => new Promise(resolve => setImmediate(resolve));
const fs = {
  mkdir: async () => {},
  readFile: async () => { if (scenario === 'duplicate-pid') return String(process.pid); if (pid === undefined) throw Object.assign(new Error('fake missing'), { code: 'ENOENT' }); return pid; },
  writeFile: async (_path, value) => { assert.equal(pid, undefined); pid = value; trace('PID_CREATED'); },
  unlink: async () => { pid = undefined; trace('PID_REMOVED'); },
};
const db = {
  storeSettings: {
    updateMany: async input => { trace(input.where ? 'DISARM_COMPARE' : 'DISARM'); if (scenario === 'startup-db') throw new Error('private DB details'); if (scenario === 'startup-hang') return never(); return { count: 1 }; },
    upsert: async () => { trace('ACTIVATE'); return {}; },
  },
  notificationAttempt: { updateMany: async () => ({ count: 0 }) },
  notificationEvent: { updateMany: async () => ({ count: 0 }), findMany: async () => [], findUnique: async () => ({ status: 'SENT' }) },
  user: { findUnique: async () => ({ id: 'owner', role: scenario === 'non-owner' ? 'ADMIN' : 'OWNER', isActive: true }) },
  $disconnect: async () => trace('DB_CLOSED'),
};
class Redis extends EventEmitter {
  constructor(_url, options) { super(); redis = this; assert.equal(options.enableOfflineQueue, false); assert.equal(options.commandTimeout, 3000); }
  async connect() { if (scenario === 'startup-redis') throw new Error('private redis'); }
  async set(_key, value) { if (scenario === 'duplicate-lease') return null; owner = value; trace('LEASE_ACQUIRED'); return 'OK'; }
  async get() { return replacement ? 'replacement' : owner; }
  async eval(script, _n, ...args) {
    if (script.includes('pexpire')) {
      if (scenario === 'redis-error') throw new Error('private Redis endpoint');
      if (scenario === 'redis-hang') return never();
      if (scenario === 'deadline') { now = 16000; return 1; }
      if (['expired', 'replaced', 'blocked-control', 'blocked-send', 'late-send', 'queued-control'].includes(scenario)) { replacement = scenario === 'replaced'; return 0; }
      return 1;
    }
    if (script.includes("'del'")) { assert.equal(args[2], owner); trace(replacement ? 'REPLACEMENT_PRESERVED' : 'LEASE_RELEASED'); return replacement ? 0 : 2; }
    if (script.includes("'set'")) {
      if (scenario === 'publish-error') throw new Error('private status');
      published++;
      if (published === 1) nativeTimeout(() => { void exercise().catch(error => { console.error(error); process.exit(9); }); }, 0);
      return 'OK';
    }
    throw new Error('UNEXPECTED_REDIS');
  }
  disconnect() { trace('REDIS_CLOSED'); }
}
class Queue extends EventEmitter { async close() { trace('QUEUE_CLOSED'); } async add() {} }
class Worker extends EventEmitter {
  constructor(name, run) { super(); this.name = name; this.run = run; if (name === 'notifications') notification = this; else control = this; }
  async close() { trace(`CLOSE:${this.name}`); if (scenario === 'cleanup-error') throw new Error('private cleanup'); if (scenario === 'blocked-control' && this === control || scenario === 'blocked-send' && this === notification) return never(); }
}
class WhatsAppWeb {
  constructor(_factory, changed) { this.changed = changed; this.status = { state: 'stopped' }; browser = this; }
  async start() { trace('BROWSER_START'); if (scenario === 'blocked-control') return never(); this.status = { state: 'ready' }; this.changed(this.status); }
  async stop() { trace('BROWSER_STOP'); this.status = { state: 'stopped' }; if (scenario === 'blocked-browser') return never(); }
  async send() { trace('BROWSER_SEND'); if (scenario === 'blocked-send') return never(); return { actualOutbound: true }; }
}
const api = { fs, db, Redis, Queue, Worker, WhatsAppWeb,
  recordActivity: async () => {},
  deliverNotification: async (_id, _generation, provider) => {
    trace('CLAIM');
    if (scenario === 'late-send') { lateSend = () => provider.send({}); return never(); }
    return provider.send({});
  },
};
globalThis.__workerFault = api;
const module = code => ({ url: 'data:text/javascript,' + encodeURIComponent(code), shortCircuit: true });
const expose = names => module(`const api = globalThis.__workerFault; ${names.map(name => `export const ${name} = api.${name};`).join(' ')}`);
registerHooks({ resolve(specifier, context, next) {
  if (!context.parentURL?.endsWith('/src/worker.ts')) return next(specifier, context);
  if (specifier === 'node:fs/promises') return module('const fs = globalThis.__workerFault.fs; export const {mkdir,readFile,writeFile,unlink} = fs;');
  if (specifier === 'bullmq') return expose(['Queue', 'Worker']);
  if (specifier === 'ioredis') return expose(['Redis']);
  if (specifier === './lib/db.js') return expose(['db']);
  if (specifier === './lib/config.js') return module('export const config = { REDIS_URL: "redis://fake.invalid" };');
  if (specifier === './lib/audit.js') return expose(['recordActivity']);
  if (specifier === './lib/whatsapp-control.js') return module('export const connection = {}; export const lockKey = "lock"; export const statusKey = "status"; export async function sign() { return "s".repeat(64); } export async function verify() { return true; } export async function closeControlConnections() { console.log("SHARED_CLOSED"); }');
  if (specifier === './integrations/whatsapp/web.js') return module('export const WhatsAppWeb = globalThis.__workerFault.WhatsAppWeb; export async function createBrowserClient() { throw new Error("UNEXPECTED_BROWSER"); } export async function clearBrowserSession() { throw new Error("UNEXPECTED_LOGOUT"); }');
  if (specifier === './services/notifications.js') return expose(['deliverNotification']);
  if (specifier === './integrations/whatsapp/lifecycle.js') return module('export const lifecycleAudit = () => () => {};');
  if (specifier === './integrations/whatsapp/diagnostics.js') return module('export const controlFailure = () => "CONTROL_FAILED";');
  return next(specifier, context);
} });
async function command(name) {
  const payload = JSON.stringify({ command: name, actorId: 'owner', workerId: owner, expiresAt: Date.now() + 30000 });
  return control.run({ data: { payload, signature: 's'.repeat(64) }, id: 'fake-command' });
}
async function exercise() {
  assert.equal(browser.status.state, 'stopped');
  if (['blocked-control', 'queued-control'].includes(scenario)) {
    const running = command('start').catch(() => {});
    await settle();
    if (scenario === 'queued-control') {
      const queued = command('activate').catch(() => trace('QUEUED_REJECTED'));
      tick(); await settle(); await running; await queued;
    } else tick();
    return;
  }
  if (['blocked-send', 'late-send'].includes(scenario)) {
    await command('start'); await command('activate');
    void notification.run({ data: { eventId: 'fake', generation: 0 } }).catch(() => {});
    await settle(); tick();
    if (lateSend) { await assert.rejects(lateSend(), /WORKER_LEASE_LOST/); trace('LATE_SEND_FENCED'); }
    return;
  }
  if (scenario === 'non-owner') { await assert.rejects(command('start'), /FORBIDDEN/); trace('OWNER_GUARD'); }
  if (scenario === 'redis-event') { redis.emit('error', new Error('private redis')); return; }
  if (['signal', 'blocked-browser', 'non-owner', 'cleanup-error'].includes(scenario)) { process.emit('SIGTERM'); return; }
  if (scenario === 'redis-hang') { tick(); process.emit('SIGINT'); return; }
  tick();
}
await import('../../src/worker.ts');
