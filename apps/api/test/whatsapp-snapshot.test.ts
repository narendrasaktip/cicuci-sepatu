import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readWorkerSnapshot } from '../src/integrations/whatsapp/snapshot.js';

test('signed status reads preserve ready/activation; stale, missing, wrong-instance snapshots fail closed', async () => {
  const state = { workerId: 'worker-test', updatedAt: 20000, state: 'ready', ready: true, realSendEnabled: true, activation: 'test-activation', lastCommand: { command: 'disconnect', status: 'completed' } };
  let reads = 0; let valid = true; let owner: string | null = state.workerId;
  const read = async (): Promise<[string | null, string | null]> => { reads++; return [JSON.stringify({ payload: JSON.stringify(state), signature: 'test-only' }), owner]; };
  const verify = async () => valid;
  for (let i = 0; i < 5; i++) assert.deepEqual(await readWorkerSnapshot(read, verify, 21000), state);
  assert.equal(reads, 5); assert.equal(state.realSendEnabled, true);
  assert.equal(await readWorkerSnapshot(read, verify, 33000), undefined);
  assert.equal(await readWorkerSnapshot(read, verify, 19000), undefined);
  owner = 'other-worker'; assert.equal(await readWorkerSnapshot(read, verify, 21000), undefined);
  owner = null; assert.equal(await readWorkerSnapshot(read, verify, 21000), undefined);
  owner = state.workerId; valid = false;
  await assert.rejects(readWorkerSnapshot(read, verify, 21000), /INVALID_WORKER_STATUS/);
  valid = true; state.ready = false;
  await assert.rejects(readWorkerSnapshot(read, verify, 21000), /INVALID_WORKER_STATUS/);
  assert.equal(await readWorkerSnapshot(async () => [null, owner], verify), undefined);
});
