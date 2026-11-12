import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const cases = [
  ['expired', 'WORKER_LEASE_LOST'], ['replaced', 'WORKER_LEASE_LOST'],
  ['redis-error', 'WORKER_LEASE_RENEW_FAILED'], ['redis-event', 'WORKER_REDIS_UNAVAILABLE'],
  ['deadline', 'WORKER_LEASE_LOST'], ['cleanup-error', 'WORKER_CLEANUP_FAILED'], ['publish-error', 'WORKER_STATUS_PUBLISH_FAILED'],
  ['startup-db', 'WORKER_STARTUP_FAILED'], ['startup-redis', 'WORKER_STARTUP_FAILED'],
  ['startup-hang', 'WORKER_STARTUP_TIMEOUT'], ['duplicate-pid', 'WORKER_ALREADY_RUNNING'],
  ['duplicate-lease', 'WORKER_LEASE_HELD'], ['signal', 'WORKER_SIGNAL:SIGTERM'],
  ['redis-hang', 'WORKER_SIGNAL:SIGINT'], ['blocked-control', 'WORKER_SHUTDOWN_TIMEOUT'],
  ['blocked-browser', 'WORKER_SHUTDOWN_TIMEOUT'], ['blocked-send', 'WORKER_SHUTDOWN_TIMEOUT'],
  ['late-send', 'LATE_SEND_FENCED'], ['queued-control', 'QUEUED_REJECTED'], ['non-owner', 'OWNER_GUARD'],
] as const;
for (const [scenario, expected] of cases) test(`isolated worker: ${scenario}`, () => {
  // No inherited NODE_OPTIONS/env-file/database/Redis configuration. No child signals.
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./helpers/worker-fault.mjs', import.meta.url)), scenario], {
    env: { PATH: process.env.PATH, NODE_NO_WARNINGS: '1' }, encoding: 'utf8', timeout: 5000,
  });
  const output = child.stdout + child.stderr;
  assert.equal(child.error, undefined, output);
  assert.equal(child.signal, null, output);
  assert.equal(child.status, ['signal', 'non-owner', 'redis-hang'].includes(scenario) ? 0 : 1, output);
  assert.ok(output.includes(expected), output);
  assert.doesNotMatch(output, /private|UNEXPECTED|AssertionError/);
  if (!['duplicate-pid', 'duplicate-lease', 'startup-redis'].includes(scenario)) assert.ok(output.includes('DISARM_COMPARE'), output);
  if (scenario === 'replaced') assert.match(output, /REPLACEMENT_PRESERVED/);
  if (['duplicate-pid', 'duplicate-lease'].includes(scenario)) assert.doesNotMatch(output, /DISARM|BROWSER_START|LEASE_RELEASED/);
  if (scenario !== 'blocked-send') assert.doesNotMatch(output, /BROWSER_SEND/);
  if (!['blocked-control', 'late-send', 'blocked-send', 'queued-control'].includes(scenario)) assert.doesNotMatch(output, /BROWSER_START|ACTIVATE/);
  if (['blocked-control', 'blocked-send', 'blocked-browser'].includes(scenario)) assert.match(output, /BROWSER_STOP/);
});
