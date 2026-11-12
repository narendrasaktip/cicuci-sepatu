import { fileURLToPath } from 'node:url';
const authRoot = fileURLToPath(new URL('../../../../../var/whatsapp/', import.meta.url));
import type { WhatsAppMessage } from './types.js';
import { initializationCause, initializationDiagnostic, type InitializationDiagnostic } from './diagnostics.js';
export type WebState = { state: 'stopped' | 'starting' | 'qr' | 'authenticated' | 'ready' | 'disconnected' | 'error'; qr?: string; qrExpiresAt?: number; error?: string; diagnostic?: InitializationDiagnostic };
export type BrowserClient = {
  on(event: string, listener: (...args: string[]) => void): unknown;
  initialize(): Promise<void>; destroy(): Promise<void>; logout(): Promise<void>;
  // whatsapp-web.js resolves undefined when the send committed but the returned model was falsy.
  sendMessage(to: string, text: string): Promise<{ id?: { _serialized?: string } } | undefined>;
};
export class WhatsAppWeb {
  private client?: BrowserClient;
  private value: WebState = { state: 'stopped' };
  private expiry?: ReturnType<typeof setTimeout>;
  private generation = 0;
  constructor(private factory: () => Promise<BrowserClient>, private changed: (state: WebState) => void = () => {}, private clearSession: () => Promise<void> = async () => {}) {}
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
      client.on('ready', () => { if (live()) this.update({ state: 'ready' }); });
      client.on('auth_failure', () => { if (live()) { this.update({ state: 'error', error: 'AUTH_FAILED' }); void this.stop(false); } });
      client.on('disconnected', () => { if (live()) { this.update({ state: 'disconnected' }); void this.stop(false); } });
      void client.initialize().catch(async error => { if (live()) { this.update({ state: 'error', error: initializationCause(error), diagnostic: initializationDiagnostic(error, 'initialize') }); await this.stop(false); } }).catch(() => { console.error('WHATSAPP_BROWSER_CLEANUP_FAILED'); });
    } catch (error) {
      if (generation !== this.generation) { console.error('WHATSAPP_CANCELLED_START_FAILED'); return; }
      this.update({ state: 'error', error: initializationCause(error), diagnostic: initializationDiagnostic(error, 'factory') }); await this.stop(false);
    }
  }
  async stop(logout = false) {
    ++this.generation;
    const client = this.client; this.client = undefined; clearTimeout(this.expiry);
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
}
export async function createBrowserClient(): Promise<BrowserClient> {
  const { mkdir, chmod } = await import('node:fs/promises');
  const root = authRoot;
  await mkdir(root, { recursive: true, mode: 0o700 }); await chmod(root, 0o700);
  const { default: library } = await import('whatsapp-web.js');
  return new library.Client({ authStrategy: new library.LocalAuth({ clientId: 'cicuci-owner', dataPath: root }), webVersionCache: { type: 'none' }, qrMaxRetries: 5, puppeteer: { headless: true, ...(process.env.WA_CHROME_PATH ? { executablePath: process.env.WA_CHROME_PATH } : {}) } });
}

export async function clearBrowserSession() { const { rm } = await import('node:fs/promises'); await rm(authRoot, { recursive: true, force: true }); }
