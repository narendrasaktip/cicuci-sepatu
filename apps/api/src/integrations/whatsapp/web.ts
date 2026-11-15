import { fileURLToPath } from 'node:url';
const authRoot = fileURLToPath(new URL('../../../../../var/whatsapp/', import.meta.url));
import type { MessageMedia } from 'whatsapp-web.js';
import type { WhatsAppMessage } from './types.js';
import { probedSend } from './send-probe.js';
import { mediaCompatibilityScript } from './media-compat.js';
import { initializationCause, initializationDiagnostic, type InitializationDiagnostic } from './diagnostics.js';
export class QrPreparationError extends Error {
  constructor() { super('QR_PREPARATION_FAILED'); }
}
export type WebState = { state: 'stopped' | 'starting' | 'qr' | 'authenticated' | 'ready' | 'disconnected' | 'error'; qr?: string; qrExpiresAt?: number; error?: string; diagnostic?: InitializationDiagnostic };
export type BrowserClient = {
  on(event: string, listener: (...args: string[]) => void): unknown;
  initialize(): Promise<void>; destroy(): Promise<void>; logout(): Promise<void>;
  // whatsapp-web.js resolves undefined when the send committed but the returned model was falsy.
  sendMessage(to: string, content: string | MessageMedia, options?: { caption: string }): Promise<{ id?: { _serialized?: string } } | undefined>;
};
export class WhatsAppWeb {
  private client?: BrowserClient;
  private value: WebState = { state: 'stopped' };
  private expiry?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private retry?: ReturnType<typeof setTimeout>;
  private attempts = 0;
  constructor(private factory: () => Promise<BrowserClient>, private changed: (state: WebState) => void = () => {}, private clearSession: () => Promise<void> = async () => {}, private autoReconnect = false) {}
  private async reconnect() {
    const stopping = this.stop(false);
    const generation = this.generation;
    await stopping;
    if (generation !== this.generation || !this.autoReconnect) return;
    // ponytail: retries continue at a 16-second ceiling; increase the ceiling if provider throttling requires it.
    this.retry = setTimeout(() => { if (generation === this.generation) void this.start(); }, 1000 * 2 ** Math.min(this.attempts++, 4));
    this.retry.unref();
  }
  async startManually() { this.attempts = 0; clearTimeout(this.retry); await this.start(); }
  get status(): WebState {
    if (this.value.qrExpiresAt && this.value.qrExpiresAt <= Date.now()) return { state: 'starting' };
    return { ...this.value };
  }
  private update(value: WebState) { clearTimeout(this.expiry); this.value = value; this.changed(this.status); }
  async start() {
    if (this.client || this.value.state === 'starting') return;
    const generation = ++this.generation;
    this.update({ state: 'starting' });
    try {
      const client = await this.factory();
      if (generation !== this.generation) { await client.destroy(); return; }
      this.client = client;
      const live = () => this.client === client;
      client.on('qr', qr => { if (!live()) return; this.update({ state: 'qr', qr, qrExpiresAt: Date.now() + 45000 }); this.expiry = setTimeout(() => { if (live()) this.update({ state: 'starting' }); }, 45000); this.expiry.unref(); });
      client.on('authenticated', () => { if (live()) this.update({ state: 'authenticated' }); });
      client.on('ready', () => { if (live()) { this.attempts = 0; this.update({ state: 'ready' }); } });
      client.on('auth_failure', () => { if (live()) { this.update({ state: 'error', error: 'AUTH_FAILED' }); void this.reconnect().catch(() => console.error('WHATSAPP_BROWSER_CLEANUP_FAILED')); } });
      client.on('disconnected', () => { if (live()) { this.update({ state: 'disconnected' }); void this.reconnect().catch(() => console.error('WHATSAPP_BROWSER_CLEANUP_FAILED')); } });
      void client.initialize().catch(async error => { if (live()) { this.update({ state: 'error', error: initializationCause(error), diagnostic: initializationDiagnostic(error, 'initialize') }); await this.reconnect(); } }).catch(() => { console.error('WHATSAPP_BROWSER_CLEANUP_FAILED'); });
    } catch (error) {
      if (generation !== this.generation) { console.error('WHATSAPP_CANCELLED_START_FAILED'); return; }
      this.update({ state: 'error', error: initializationCause(error), diagnostic: initializationDiagnostic(error, 'factory') }); await this.reconnect();
    }
  }
  async stop(logout = false) {
    ++this.generation;
    const client = this.client; this.client = undefined; clearTimeout(this.expiry); clearTimeout(this.retry);
    if (logout || !['error', 'disconnected'].includes(this.value.state)) this.update({ state: 'stopped' });
    if (client) {
      try { if (logout) await client.logout(); }
      catch { this.update({ state: 'error', error: 'LOGOUT_FAILED' }); }
      finally { try { await client.destroy(); } catch { this.update({ state: 'error', error: 'BROWSER_CLOSE_FAILED' }); } }
    }
    if (logout) { try { await this.clearSession(); this.update({ state: 'stopped' }); } catch { this.update({ state: 'error', error: 'SESSION_DELETE_FAILED' }); } }
  }
  async send(input: WhatsAppMessage) {
    if (this.status.state !== 'ready' || !this.client) throw new Error('NOT_READY');
    if (!/^\+[1-9]\d{7,14}$/.test(input.recipient)) throw new Error('INVALID_RECIPIENT');
    // A resolved sendMessage means the browser submitted the message, even if the model is undefined.
    // Missing model/ID is not proof of delivery; never fabricate an ID. Surface the gap explicitly.
    const message = await this.client.sendMessage(`${input.recipient.slice(1)}@c.us`, input.message);
    const messageId = message?.id?._serialized ?? null;
    return { delivery: 'submitted', messageId, actualOutbound: true, ...(messageId ? {} : { messageIdMissing: true }) };
  }
  async sendQr(input: WhatsAppMessage) {
    if (this.status.state !== 'ready' || !this.client) throw new Error('NOT_READY');
    if (!/^\+[1-9]\d{7,14}$/.test(input.recipient)) throw new Error('INVALID_RECIPIENT');
    let media: MessageMedia;
    try {
      const { default: library } = await import('whatsapp-web.js');
      media = library.MessageMedia.fromFilePath(fileURLToPath(new URL('../../../../../img/qr.jpeg', import.meta.url)));
    } catch { throw new QrPreparationError(); }
    const message = await this.client.sendMessage(`${input.recipient.slice(1)}@c.us`, media, { caption: input.message });
    const messageId = message?.id?._serialized ?? null;
    return { delivery: 'submitted', messageId, actualOutbound: true, ...(messageId ? {} : { messageIdMissing: true }) };
  }
}
export async function createBrowserClient(): Promise<BrowserClient> {
  const { mkdir, chmod } = await import('node:fs/promises');
  const root = authRoot;
  await mkdir(root, { recursive: true, mode: 0o700 }); await chmod(root, 0o700);
  const { default: library } = await import('whatsapp-web.js');
  const client = new library.Client({ authStrategy: new library.LocalAuth({ clientId: 'cicuci-owner', dataPath: root }), webVersionCache: { type: 'none' }, qrMaxRetries: 5, puppeteer: { headless: true, ...(process.env.WA_CHROME_PATH ? { executablePath: process.env.WA_CHROME_PATH } : {}) } });
  const send = client.sendMessage.bind(client);
  let busy = false;
  client.sendMessage = async (...args: Parameters<typeof send>) => {
    if (busy) throw new Error('SEND_PROBE_BUSY');
    busy = true;
    try {
      await client.pupPage!.evaluate(mediaCompatibilityScript());
      // ponytail: opt-in development probe for 1.34.7 internals; revisit on dependency upgrades.
      return process.env.NODE_ENV === 'development' && process.env.WA_SEND_PROBE === '1'
        ? await probedSend(client.pupPage!, () => send(...args)) : await send(...args);
    } finally { busy = false; }
  };
  return client;
}

export async function clearBrowserSession() { const { rm } = await import('node:fs/promises'); await rm(authRoot, { recursive: true, force: true }); }
export async function hasBrowserSession() {
  const { stat } = await import('node:fs/promises');
  try { return (await stat(`${authRoot}session-cicuci-owner`)).isDirectory(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
