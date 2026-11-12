import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { initializationCause, initializationDiagnostic, controlFailure } from '../src/integrations/whatsapp/diagnostics.js';
import { lifecycleAudit } from '../src/integrations/whatsapp/lifecycle.js';
import { WhatsAppWeb } from '../src/integrations/whatsapp/web.js';

test('initialization classification returns codes only, never private exception details', () => {
  for (const [message, expected] of [
    ['SingletonLock /private/session secret-qr', 'BROWSER_PROFILE_LOCKED'],
    ['Permission denied /private/session', 'BROWSER_PERMISSION_DENIED'],
    ['Could not find Chrome /private/browser', 'BROWSER_NOT_FOUND'],
    ['No usable sandbox!', 'BROWSER_SANDBOX_FAILED'],
    ['net::ERR_CONNECTION_REFUSED https://private/token', 'WHATSAPP_NETWORK_FAILED'],
    ['Navigation timeout of 30000 ms exceeded', 'INITIALIZATION_TIMEOUT'],
    ['Failed to launch the browser process /private/browser', 'BROWSER_LAUNCH_FAILED'],
    ['private account secret unknown failure', 'INITIALIZATION_FAILED'],
  ]) assert.equal(initializationCause(new Error(message)), expected);
  assert.equal(initializationCause(Object.assign(new Error('private'), { code: 'ENOENT' })), 'BROWSER_NOT_FOUND');
  assert.equal(initializationCause({ message: 'secret' }), 'INITIALIZATION_FAILED');
  assert.equal(controlFailure(new Error('COMMAND_EXPIRED')), 'COMMAND_EXPIRED');
  assert.equal(controlFailure(new Error('secret-command')), 'INITIALIZATION_FAILED');
});

test('unknown errors retain safe type/stage; protocol operations identified without private details', () => {
  const error = Object.assign(new TypeError('private-account private-qr'), { code: 'private-token' });
  error.stack = 'TypeError: private-token\n at Client.initialize (private-path)';
  assert.deepEqual(initializationDiagnostic(error, 'initialize'), { stage: 'initialize', errorType: 'TypeError', diagnosticCode: 'UNKNOWN', operation: 'unknown' });
  error.name = 'private-name';
  assert.equal(initializationDiagnostic(error, 'factory').errorType, 'Unknown');
  const protocol = new Error('Protocol error (Network.setUserAgentOverride): Invalid parameters private-token');
  assert.equal(initializationCause(protocol), 'BROWSER_PROTOCOL_FAILED');
  assert.deepEqual(initializationDiagnostic(protocol, 'initialize'), { stage: 'initialize', errorType: 'Error', diagnosticCode: 'INVALID_PARAMETERS', operation: 'setUserAgent' });
  assert.equal(initializationCause('ready timeout'), 'INITIALIZATION_TIMEOUT');
});

test('fake lifecycle audits transitions once, QR refreshes never persisted, initialization failure truthful', async () => {
  const activities: object[] = [];
  const audit = lifecycleAudit(async data => { activities.push(data); });
  const client = new EventEmitter();
  const web = new WhatsAppWeb(async () => Object.assign(client, {
    initialize: async () => { throw new Error('SingletonLock /private/session secret'); },
    destroy: async () => {}, logout: async () => {},
    sendMessage: async () => { throw new Error('must not send'); },
  }), audit);
  await web.start(); await new Promise(resolve => setImmediate(resolve));
  const diagnostic = { stage: 'initialize', errorType: 'Error', diagnosticCode: 'UNKNOWN', operation: 'unknown' };
  assert.deepEqual(web.status, { state: 'error', error: 'BROWSER_PROFILE_LOCKED', diagnostic });
  audit(web.status); // Heartbeat does not create another audit entry.
  assert.deepEqual(activities, [
    { action: 'WA_STATE_CHANGED', entityType: 'WhatsApp', metadata: { fromState: 'stopped', state: 'starting' } },
    { action: 'WA_STATE_CHANGED', entityType: 'WhatsApp', metadata: { fromState: 'starting', state: 'error', reason: 'BROWSER_PROFILE_LOCKED', outcome: 'FAILED', ...diagnostic } },
  ]);
  audit({ state: 'qr', qr: 'private-qr', qrExpiresAt: Date.now() + 1000 });
  audit({ state: 'qr', qr: 'replacement-secret', qrExpiresAt: Date.now() + 2000 });
  assert.equal(activities.length, 3);
  assert.doesNotMatch(JSON.stringify(activities), /private|secret|qrExpiresAt/);
});
