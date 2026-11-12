import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { WhatsAppWeb } from '../src/integrations/whatsapp/web.js';
class FakeClient extends EventEmitter {
  starts = 0; closes = 0; logouts = 0; sent: string[] = [];
  result: { id?: { _serialized?: string } } | undefined = { id: { _serialized: 'fake-id' } };
  async initialize() { this.starts++; }
  async destroy() { this.closes++; }
  async logout() { this.logouts++; }
  async sendMessage(to: string, _text: string) { this.sent.push(to); return this.result; }
}
test('fake client: pairing, QR expiry/redaction, readiness, disconnect, late events', async () => {
  const client = new FakeClient(); const web = new WhatsAppWeb(async () => client);
  await assert.rejects(web.send({ eventKey: 'one', recipient: '+628123456789', message: 'fake' }), /NOT_READY/);
  await web.start(); await web.start(); assert.equal(client.starts, 1);
  client.emit('qr', 'secret-qr'); assert.equal(web.status.qr, 'secret-qr');
  const now = Date.now; Date.now = () => now() + 46000;
  try { assert.equal(web.status.qr, undefined); } finally { Date.now = now; }
  client.emit('authenticated'); assert.equal(web.status.qr, undefined);
  client.emit('ready'); assert.equal(web.status.state, 'ready');
  await assert.rejects(web.send({ eventKey: 'one', recipient: 'group@g.us', message: 'fake' }), /INVALID_RECIPIENT/);
  assert.equal((await web.send({ eventKey: 'one', recipient: '+628123456789', message: 'fake' })).actualOutbound, true);
  assert.deepEqual(client.sent, ['628123456789@c.us']);
  // whatsapp-web.js resolves undefined after a committed send; must not become a false failure.
  client.result = undefined;
  assert.deepEqual(await web.send({ eventKey: 'one', recipient: '+628123456789', message: 'fake' }), { delivery: 'submitted', messageId: null, actualOutbound: true, messageIdMissing: true });
  client.result = { id: {} };
  assert.equal((await web.send({ eventKey: 'one', recipient: '+628123456789', message: 'fake' })).messageId, null);
  client.result = { id: { _serialized: 'fake-id' } };
  await web.stop(true); assert.equal(client.logouts, 1); assert.equal(client.closes, 1);
  client.emit('qr', 'late'); client.emit('ready'); assert.equal(web.status.state, 'stopped'); assert.equal(web.status.qr, undefined);
});
test('fake client initialization/authentication failures redact details', async () => {
  const client = new FakeClient(); client.initialize = async () => { throw new Error('sensitive session'); };
  const web = new WhatsAppWeb(async () => client); await web.start(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(web.status.error, 'INITIALIZATION_FAILED'); assert.equal(client.closes, 1); assert.ok(!JSON.stringify(web.status).includes('sensitive'));
  await web.start(); client.emit('auth_failure', 'private data'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(web.status.qr, undefined); await web.stop();
});

test('stop during pending factory destroys late client without initialize or readiness resurrection', async () => {
  let resolve!: (client: FakeClient) => void;
  const client = new FakeClient();
  const web = new WhatsAppWeb(() => new Promise<FakeClient>(done => { resolve = done; }));
  const starting = web.start();
  await web.stop(); resolve(client); await starting;
  client.emit('ready');
  assert.equal(client.starts, 0); assert.equal(client.closes, 1); assert.equal(client.logouts, 0);
  assert.equal(web.status.state, 'stopped');
  await assert.rejects(web.send({ eventKey: 'fake', recipient: '+628123456789', message: 'fake' }), /NOT_READY/);
});
