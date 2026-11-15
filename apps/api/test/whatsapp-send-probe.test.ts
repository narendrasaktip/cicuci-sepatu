import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { probeScript, probedSend } from '../src/integrations/whatsapp/send-probe.js';
import { sendDiagnostic } from '../src/integrations/whatsapp/diagnostics.js';

function fixture(failing = '') {
  const context = vm.createContext({ failing });
  vm.runInContext(`
    const secret = 'private-recipient private-caption private-media private-id';
    const fail = () => { throw new TypeError(secret); };
    const upload = { uploadMedia: async () => failing === 'uploadMedia' ? fail() : 'uploaded' };
    const submit = { addAndSendMsgToChat: () => failing === 'submitMessage' ? fail() : ['submitted'] };
    globalThis.require = name => name === 'WAWebMediaMmsV4Upload' ? upload : submit;
    globalThis.WWebJS = {
      getChat: async () => failing === 'getChat' ? fail() : { private: secret },
      sendSeen: async () => failing === 'sendSeen' ? fail() : true,
      processMediaData: async () => { if (failing === 'processMediaData') fail(); return upload.uploadMedia(); },
      sendMessage: async () => { if (failing === 'sendMessage') fail(); await WWebJS.processMediaData(); return submit.addAndSendMsgToChat(); },
      getMessageModel: function(value) { if (failing === 'getMessageModel') fail(); return value; }
    };
    globalThis.originals = {...WWebJS};
    globalThis.fakeSend = async () => { await WWebJS.getChat(); await WWebJS.sendSeen(); const msg = await WWebJS.sendMessage(); return WWebJS.getMessageModel(msg); };
  `, context);
  return {
    context,
    page: { evaluate: async (script: string) => vm.runInContext(script, context) as unknown },
    send: async () => await vm.runInContext('fakeSend()', context) as unknown,
    restored: () => assert.equal(vm.runInContext('!globalThis.__cicuciSendProbe && Object.keys(originals).every(k => originals[k] === WWebJS[k])', context), true),
  };
}

test('serialized browser probe identifies every stage, deepest wins; private exception never crosses boundary', async () => {
  for (const phase of ['getChat', 'sendSeen', 'processMediaData', 'uploadMedia', 'sendMessage', 'submitMessage', 'getMessageModel']) {
    const f = fixture(phase);
    await assert.rejects(probedSend(f.page, f.send), error => {
      assert.deepEqual(sendDiagnostic(error), { stage: 'send', operation: 'sendMessage', sendPhase: phase, errorType: 'TypeError', diagnosticCode: 'UNKNOWN' });
      assert.doesNotMatch(JSON.stringify(error), /private/);
      assert.doesNotMatch(String(error), /private/);
      return true;
    });
    f.restored();
  }
});

test('success preserves synchronous helpers, receiver, arguments, result; restores wrappers', async () => {
  const f = fixture();
  await f.page.evaluate(probeScript('install'));
  assert.equal(vm.runInContext('WWebJS.getMessageModel(42)', f.context), 42);
  await f.page.evaluate(probeScript('restore'));
  assert.deepEqual(Array.from(await probedSend(f.page, f.send) as string[]), ['submitted']);
  f.restored();
});

test('missing internals fail closed before send; partial install rolled back; repeated install blocked', async () => {
  const f = fixture();
  vm.runInContext('delete WWebJS.processMediaData; delete originals.processMediaData;', f.context);
  let sent = false;
  await assert.rejects(probedSend(f.page, async () => { sent = true; }), /SEND_PROBE_UNAVAILABLE/);
  assert.equal(sent, false); f.restored();
  const g = fixture();
  await g.page.evaluate(probeScript('install'));
  await assert.rejects(g.page.evaluate(probeScript('install')), /SEND_PROBE_BUSY/);
  await g.page.evaluate(probeScript('restore')); g.restored();
});

test('submission promise-array rejection retains precise submission phase', async () => {
  const f = fixture();
  vm.runInContext(`
    submit.addAndSendMsgToChat = () => [Promise.reject(new TypeError('private')), Promise.resolve('result')];
    WWebJS.sendMessage = async () => { const [message] = submit.addAndSendMsgToChat(); await message; };
  `, f.context);
  await assert.rejects(probedSend(f.page, f.send), error => {
    assert.equal(sendDiagnostic(error).sendPhase, 'submitMessage'); return true;
  });
  assert.equal(vm.runInContext('!globalThis.__cicuciSendProbe', f.context), true);
});

test('restore context loss never changes resolved submission or original rejection', async () => {
  const page = { evaluate: async (script: string) => { if (script === probeScript('restore')) throw Error('context lost'); return null; } };
  assert.equal(await probedSend(page, async () => undefined), undefined);
  const original = new Error('original');
  await assert.rejects(probedSend(page, async () => { throw original; }), error => error === original);
});

test('browser diagnostic boundary allowlists hostile fields', async () => {
  const page = { evaluate: async (script: string) => script === probeScript('install') ? null : { sendPhase: 'private', errorType: 'private', diagnosticCode: 'private', recipient: 'private' } };
  await assert.rejects(probedSend(page, async () => { throw Error('private'); }), error => {
    assert.deepEqual(sendDiagnostic(error), { stage: 'send', operation: 'sendMessage', sendPhase: 'unknown', errorType: 'Unknown', diagnosticCode: 'UNKNOWN' }); return true;
  });
});
