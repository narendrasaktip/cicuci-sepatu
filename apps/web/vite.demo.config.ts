import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const customers = ['Ayu Lestari', 'Bima Pratama', 'Citra Maharani', 'Dimas Saputra', 'Nadia Putri', 'Rizky Ramadhan'].map((name, i) => ({ id: `demo-customer-${i}`, salutation: 'Kak', name, whatsapp: `628000000000${i}`, notificationConsentAt: null, notes: 'Data contoh' }));
const statuses = ['WAITING_INSPECTION', 'AWAITING_CONSENT', 'IN_PROGRESS', 'READY_FOR_PICKUP', 'COMPLETED', 'IN_PROGRESS'];
const orders = customers.map((customer, i) => ({ id: `demo-order-${i}`, number: `CS-DEMO-00${i + 1}`, customer, aggregateStatus: statuses[i], createdAt: `2026-11-${String(13 - i).padStart(2, '0')}T04:30:00Z`, estimatedCompletionAt: `2026-11-${18 - i}T16:59:00Z`, totalIdr: (i + 1) * 45000, balanceIdr: i % 2 ? 0 : 45000, paymentStatus: i % 2 ? 'PAID' : 'PARTIAL', itemCount: i % 3 + 1 }));
const rules = [{ kind: 'PACKAGE', minPairs: 1, maxPairs: 1, priceIdr: 45000 }, { kind: 'PACKAGE', minPairs: 3, maxPairs: 3, priceIdr: 120000 }, { kind: 'PACKAGE', minPairs: 5, maxPairs: 5, priceIdr: 190000 }, { kind: 'PER_PAIR', minPairs: 6, maxPairs: 9, priceIdr: 38000 }, { kind: 'PER_PAIR', minPairs: 10, maxPairs: null, priceIdr: 35000 }];
const plans = [{ id: 'demo-fast', name: 'Fast', isActive: true, revision: 1, turnaroundPolicy: 'FAST', rules: [{ kind: 'PACKAGE', minPairs: 1, maxPairs: 1, priceIdr: 80000 }] }, { id: 'demo-normal', name: 'Normal', isActive: true, revision: 1, turnaroundPolicy: 'REGULAR', rules }, { id: 'demo-promo', name: 'Promo', isActive: true, revision: 1, turnaroundPolicy: 'REGULAR', rules }];
const fixtures: Record<string, unknown> = {
  '/api/v1/auth/me': { user: { id: 'fixture-user', name: 'Operator Contoh', email: 'fixture@example.invalid', role: 'OWNER' }, csrfToken: 'fixture-only' },
  '/api/v1/display-settings': { statusLabels: {} },
  '/api/v1/dashboard': { activeOrders: 12, waitingInspection: 4, awaitingConsent: 1, inProgress: 5, readyForPickup: 2, overdue: 0, revenueIdr: 1250000 },
  '/api/v1/orders': { data: orders, page: { nextCursor: null } },
  '/api/v1/pricing/plans': plans,
  '/api/v1/services': { data: [], page: { nextCursor: null } },
  '/api/v1/customers': { data: customers, page: { nextCursor: null } },
  '/api/v1/notifications': { data: [], page: { nextCursor: null } },
  '/api/v1/whatsapp/status': { state: 'stopped', provider: 'whatsapp-web.js', ready: false, realSendEnabled: false },
  '/api/v1/whatsapp-templates': { templates: [], placeholders: {}, localOnly: true, encryptionReady: false },
};

export default defineConfig({
  plugins: [vue(), {
    name: 'isolated-demo',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = new URL(req.url ?? '/', 'http://demo.invalid').pathname;
        if (!/^\/api(?:\/|$)/i.test(path)) return next();
        const allowed = req.method === 'GET' && Object.hasOwn(fixtures, path);
        res.writeHead(allowed ? 200 : 403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(allowed ? fixtures[path] : { error: { code: 'DEMO_BLOCKED', message: 'Tidak tersedia di demo.' } }));
      });
    },
    transformIndexHtml(html) {
      return html.replace('<head>', `<head><script>if (!crypto.randomUUID) crypto.randomUUID = () => { const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128; const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join(''); return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20); };</script>`);
    },
  }],
  server: { host: '192.168.1.17', port: 5176, strictPort: true },
});
