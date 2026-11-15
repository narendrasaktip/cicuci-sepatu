import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import type { MessageMedia } from 'whatsapp-web.js';
import { WhatsAppWeb } from '../src/integrations/whatsapp/web.js';
import { sendDiagnostic } from '../src/integrations/whatsapp/diagnostics.js';

class FakeClient extends EventEmitter {
  sent: { to: string; content: string | MessageMedia; options?: { caption: string } }[] = [];
  async initialize() {}
  async destroy() {}
  async logout() {}
  async sendMessage(to: string, content: string | MessageMedia, options?: { caption: string }) {
    this.sent.push({ to, content, options });
    return undefined;
  }
}

test('QR image uses local media and caption only on explicit adapter call', async () => {
  const client = new FakeClient();
  const web = new WhatsAppWeb(async () => client);
  const input = { eventKey: 'test', recipient: '+628123456789', message: 'caption' };
  await assert.rejects(web.sendQr(input), /NOT_READY/);
  await web.start(); client.emit('ready');
  await assert.rejects(web.sendQr({ ...input, recipient: 'invalid' }), /INVALID_RECIPIENT/);
  assert.equal(client.sent.length, 0);
  assert.deepEqual(await web.sendQr(input), { delivery: 'submitted', messageId: null, actualOutbound: true, messageIdMissing: true });
  const sent = client.sent[0]!;
  assert.equal(sent.to, '628123456789@c.us');
  assert.deepEqual(sent.options, { caption: 'caption' });
  assert.notEqual(typeof sent.content, 'string');
  const media = sent.content as MessageMedia;
  assert.equal(media.mimetype, 'image/jpeg');
  assert.equal(media.data, (await readFile(new URL('../../../img/qr.jpeg', import.meta.url))).toString('base64'));
  await web.send(input);
  assert.equal(client.sent[1]?.content, 'caption');
  assert.equal(client.sent[1]?.options, undefined);
  await web.stop();
});

test('QR browser media failure stays observable, never falls back to another send', async () => {
  const client = new FakeClient();
  let calls = 0;
  client.sendMessage = async () => {
    calls++;
    throw new Error('Evaluation failed: upload failed: media entry was not created private-token');
  };
  const web = new WhatsAppWeb(async () => client);
  await web.start(); client.emit('ready');
  try {
    await assert.rejects(web.sendQr({ eventKey: 'fake-event', recipient: '+628123456789', message: 'fake-caption' }), error => {
      const diagnostic = sendDiagnostic(error);
      assert.equal(diagnostic.diagnosticCode, 'MEDIA_UPLOAD_FAILED');
      assert.doesNotMatch(JSON.stringify(diagnostic), /private-token/);
      return true;
    });
    assert.equal(calls, 1);
  } finally { await web.stop(); }
});
