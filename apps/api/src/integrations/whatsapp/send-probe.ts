import type { SendDiagnostic } from './diagnostics.js';

// Serialized into the browser: no closures, payloads, stacks or exception text leave this function.
export function browserSendProbe(action: 'install' | 'restore') {
  type Fn = (this: unknown, ...args: unknown[]) => unknown;
  type Probe = { restore: (() => void)[]; failure?: { sendPhase: SendDiagnostic['sendPhase']; errorType: string; diagnosticCode: string } };
  const root = globalThis as unknown as { WWebJS?: Record<string, Fn>; require?: (name: string) => Record<string, Fn>; __cicuciSendProbe?: Probe };
  if (action === 'restore') {
    const probe = root.__cicuciSendProbe;
    if (!probe) return null;
    try { for (const restore of probe.restore.reverse()) restore(); return probe.failure ?? null; }
    finally { delete root.__cicuciSendProbe; }
  }
  if (root.__cicuciSendProbe) throw new Error('SEND_PROBE_BUSY');
  const probe: Probe = { restore: [] };
  root.__cicuciSendProbe = probe;
  const wrap = (target: Record<string, Fn> | undefined, key: string, sendPhase: SendDiagnostic['sendPhase']) => {
    const original = target?.[key];
    if (!target || typeof original !== 'function') throw new Error('SEND_PROBE_UNAVAILABLE');
    const failed = (error: unknown): never => {
      // First failure is deepest; nested wrappers must not overwrite it.
      if (!probe.failure) {
        const name = error instanceof Error ? error.name : '';
        const message = error instanceof Error ? error.message : '';
        probe.failure = {
          sendPhase,
          errorType: ['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'TimeoutError'].includes(name) ? name : 'Unknown',
          diagnosticCode: /upload failed: media entry was not created/.test(message) ? 'MEDIA_UPLOAD_FAILED'
            : /media-fault: sendToChat filehash undefined/.test(message) ? 'MEDIA_PREPARATION_FAILED' : 'UNKNOWN',
        };
      }
      throw error;
    };
    const wrapped: Fn = function (...args) {
      try {
        const result = original.apply(this, args);
        // Submission returns [messagePromise, sendResultPromise], not a single promise.
        // Observe the message promise awaited by the installed runtime; do not consume the unawaited result.
        if (sendPhase === 'submitMessage' && Array.isArray(result) && result[0] instanceof Promise) {
          return [result[0].catch(failed), ...result.slice(1)];
        }
        // Keep synchronous helpers synchronous; preserve receiver, arguments and resolved values.
        return result instanceof Promise ? result.catch(failed) : result;
      } catch (error) { return failed(error); }
    };
    target[key] = wrapped;
    probe.restore.push(() => { if (target[key] === wrapped) target[key] = original; });
  };
  try {
    for (const phase of ['getChat', 'sendSeen', 'processMediaData', 'sendMessage', 'getMessageModel'] as const) wrap(root.WWebJS, phase, phase);
    wrap(root.require?.('WAWebMediaMmsV4Upload'), 'uploadMedia', 'uploadMedia');
    wrap(root.require?.('WAWebSendMsgChatAction'), 'addAndSendMsgToChat', 'submitMessage');
    return null;
  } catch (error) {
    for (const restore of probe.restore.reverse()) restore();
    delete root.__cicuciSendProbe;
    throw error;
  }
}

export class BrowserSendError extends Error {
  constructor(readonly diagnostic: SendDiagnostic) { super('BROWSER_SEND_FAILED'); }
}

// tsx keepNames injects __name references; explicitly bind its identity helper inside serialization.
export function probeScript(action: 'install' | 'restore') {
  return `((__name) => (${browserSendProbe.toString()})(${JSON.stringify(action)}))((fn) => fn)`;
}
export async function probedSend<T>(page: { evaluate: (script: string) => Promise<unknown> }, send: () => Promise<T>): Promise<T> {
  await page.evaluate(probeScript('install'));
  let failure: unknown;
  let rejected = false;
  let result: T | undefined;
  try { result = await send(); }
  catch (error) { rejected = true; failure = error; }
  let data: Record<string, unknown> | null = null;
  try { data = await page.evaluate(probeScript('restore')) as Record<string, unknown> | null; }
  catch { console.error('WHATSAPP_SEND_PROBE_RESTORE_FAILED'); }
  // A lost browser context cannot invalidate a resolved submission or replace its original failure.
  if (rejected && data) {
    const phases = ['getChat', 'sendSeen', 'processMediaData', 'uploadMedia', 'submitMessage', 'getMessageModel', 'sendMessage'];
    const types = ['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'TimeoutError', 'Unknown'];
    const codes = ['MEDIA_UPLOAD_FAILED', 'MEDIA_PREPARATION_FAILED', 'UNKNOWN'];
    throw new BrowserSendError({ stage: 'send', operation: 'sendMessage', sendPhase: phases.includes(String(data.sendPhase)) ? data.sendPhase as SendDiagnostic['sendPhase'] : 'unknown', errorType: types.includes(String(data.errorType)) ? String(data.errorType) : 'Unknown', diagnosticCode: codes.includes(String(data.diagnosticCode)) ? String(data.diagnosticCode) : 'UNKNOWN' });
  }
  if (rejected) throw failure;
  return result as T;
}
