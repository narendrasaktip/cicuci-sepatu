import { createHmac, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { config } from './config.js';
import { equalToken } from './security.js';
import { readWorkerSnapshot } from '../integrations/whatsapp/snapshot.js';
const url = new URL(config.REDIS_URL);
export const connection = { host: url.hostname, port: Number(url.port || 6379), username: decodeURIComponent(url.username) || undefined, password: decodeURIComponent(url.password) || undefined, db: Number(url.pathname.slice(1) || 0), ...(url.protocol === 'rediss:' ? { tls: {} } : {}) };
export const statusKey = 'cicuci:wa:status';
export const lockKey = 'cicuci:wa:worker';
export type Command = 'start' | 'disconnect' | 'activate' | 'deactivate';
const root = fileURLToPath(new URL('../../../../var/whatsapp-control/', import.meta.url));
let secret: Promise<Buffer> | undefined;
async function controlSecret() {
  await mkdir(root, { recursive: true, mode: 0o700 }); await chmod(root, 0o700);
  try { await writeFile(`${root}key`, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error; }
  return readFile(`${root}key`);
}
export async function sign(payload: string) { return createHmac('sha256', await (secret ??= controlSecret())).update(payload).digest('hex'); }
export async function verify(payload: string, signature: string) { return equalToken(await sign(payload), signature); }
let commands: Queue | undefined;
export function controlQueue() {
  if (!commands) { commands = new Queue('cicuci-wa-control', { connection }); commands.on('error', () => { /* Errors surfaced by request; never log payloads. */ }); }
  return commands;
}

let redis: Redis | undefined;
export function controlRedis() { if (!redis) { redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 3000 }); redis.on('error', () => {}); } return redis; }

export function workerSnapshot() {
  return readWorkerSnapshot(async () => {
    const values = await controlRedis().mget(statusKey, lockKey);
    return [values[0] ?? null, values[1] ?? null];
  }, verify);
}

// Worker shutdown only; never creates a connection just to close it.
export async function closeControlConnections() {
  redis?.disconnect(); redis = undefined;
  const queue = commands; commands = undefined;
  await queue?.close();
}

// Fail closed without rolling back laundry operations when worker status is unavailable.
export async function notificationBlocker(activation: string | null | undefined): Promise<string | undefined> {
  if (!activation) return 'NOT_ENABLED';
  try {
    const state = await workerSnapshot();
    if (!state) return 'WORKER_OFFLINE';
    if (!state.ready || !state.realSendEnabled || state.activation !== activation) return 'PROVIDER_NOT_READY';
  } catch { console.error('WhatsApp readiness unavailable'); return 'WORKER_UNAVAILABLE'; }
}
