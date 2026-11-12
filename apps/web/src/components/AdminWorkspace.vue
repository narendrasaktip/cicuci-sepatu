<script setup lang="ts">
import { defaultTrackingStages, statusName } from '../services/domain';
import logo from '../assets/logo.webp';
import { computed, nextTick, onMounted, provide, ref, watch } from 'vue';
import thirdPartyNotices from '../assets/THIRD_PARTY_NOTICES.txt?url';
import { api, type User } from '../services/auth';
import { auditAction, auditContext, date, label, money, orderNotificationFeedback, type AuditLog, type Customer, type Notification, type Order, type Page, type Service } from '../services/domain';
import ActionDialog, { type Field } from './ActionDialog.vue';
import CreateOrder from './CreateOrder.vue';
import NamedPlans from './NamedPlans.vue';
import WhatsAppTemplates from './WhatsAppTemplates.vue';
import WhatsAppConnection from './WhatsAppConnection.vue';
import OrderDetail from './OrderDetail.vue';
import OutlineIcon from './OutlineIcon.vue';
import '../new-theme.css';
const props = defineProps<{ user: User }>(); const emit = defineEmits<{ logout: [] }>();
const menuOpen = ref(false);
// ponytail: sole admin presentation; retain ref contract/old branches until component cleanup.
const newPresentation = computed(() => true);
provide('newPresentation', newPresentation);
const icons = { dashboard: 'layout-dashboard', orders: 'clipboard-list', customers: 'users', services: 'coins', users: 'user-cog', settings: 'settings', notifications: 'message-circle', audit: 'history' } as const;
type Tab = 'dashboard' | 'orders' | 'customers' | 'services' | 'users' | 'settings' | 'notifications' | 'audit';
const names: Record<Tab, string> = { dashboard: 'Ringkasan', orders: 'Pesanan', customers: 'Pelanggan', services: 'Tarif pesanan', users: 'Pengguna', settings: 'Pengaturan', notifications: 'WhatsApp', audit: 'Audit' };
const newNames: Record<Tab, string> = { ...names, dashboard: 'Dashboard', services: 'Tarif Pesanan' };
const descriptions: Record<Tab, string> = {
  dashboard: 'Ringkasan operasional dan pesanan terbaru.', orders: 'Pantau progres, estimasi, dan pembayaran setiap pesanan.',
  customers: 'Kelola kontak, izin notifikasi, dan riwayat pesanan pelanggan.', services: 'Atur tarif, aturan paket, dan waktu penyelesaian pesanan.',
  users: 'Kelola akses tim sesuai peran dan tanggung jawab.', settings: 'Identitas toko, instruksi pengambilan, dan masa persetujuan risiko.',
  notifications: 'Periksa koneksi, kelola template, dan tinjau riwayat pengiriman.', audit: 'Telusuri aktivitas sistem dan pengguna. Detail teknis tersedia di setiap catatan.',
};
const tabs = computed(() => (Object.keys(names) as Tab[]).filter(t => props.user.role === 'OWNER' || !['users', 'settings', 'audit'].includes(t)).filter(t => props.user.role !== 'STAFF' || ['dashboard', 'orders', 'services'].includes(t)));
const historyOpen = ref(false);
const legacyServicesOpen = ref(false);
const tab = ref<Tab>('dashboard'); const busy = ref(false); const error = ref(''); const notice = ref(''); const q = ref(''); const status = ref(''); const cursor = ref<string | null>(null); const cursors = ref<string[]>([]);
watch(notice, (value, _previous, onCleanup) => {
  if (!value) return;
  const timer = window.setTimeout(() => { notice.value = ''; }, 5000);
  onCleanup(() => window.clearTimeout(timer));
});
watch(error, value => { if (value) notice.value = ''; });
const selected = ref(''); const initialToken = ref(''); const creating = ref(false); const customer = ref<Customer>(); const customerOrders = ref<Order[]>([]); const customerCursor = ref<string | null>(null);
const orders = ref<Order[]>([]); const customers = ref<Customer[]>([]); const services = ref<Service[]>([]); const users = ref<User[]>([]); const notifications = ref<Notification[]>([]); const audit = ref<AuditLog[]>([]);
const orderColumns = [{ key: 'createdAt', title: 'Pesanan' }, { key: 'customer', title: 'Pelanggan' }, { key: 'status', title: 'Status' }, { key: 'estimatedCompletionAt', title: 'Estimasi' }] as const;
type OrderSort = typeof orderColumns[number]['key'];
const orderSort = ref<OrderSort>(); const orderDirection = ref<'asc' | 'desc'>('asc');
function sortOrders(key: OrderSort) {
  if (busy.value) return;
  orderDirection.value = orderSort.value === key && orderDirection.value === 'asc' ? 'desc' : 'asc';
  orderSort.value = key; search();
}
const emptyAuditFilters = { q: '', action: '', entityType: '', outcome: '', requestId: '', from: '', to: '' };
const auditFilters = ref({ ...emptyAuditFilters }); const appliedAuditFilters = ref({ ...emptyAuditFilters });
function auditText(item: AuditLog, key: string) {
  const value = item.metadata?.[key];
  if (typeof value === 'string') return value;
  // Historical lifecycle entries lack outcome; derive display only, never rewrite history.
  if (key === 'outcome' && item.action === 'WA_STATE_CHANGED') return ['error', 'disconnected'].includes(String(item.metadata?.state)) ? 'FAILED' : item.metadata?.state === 'ready' ? 'SUCCESS' : '';
  // Notification records lack outcome; show honest category, never blanket success.
  if (key === 'outcome' && item.action.startsWith('NOTIFICATION_')) {
    if (item.action === 'NOTIFICATION_SENT') return 'SUCCESS';
    if (['NOTIFICATION_FAILED', 'NOTIFICATION_ATTEMPT_FAILED', 'NOTIFICATION_JOB_FAILED', 'NOTIFICATION_RECOVERY_FAILED', 'NOTIFICATION_PERSIST_FAILED'].includes(item.action)) return 'FAILED';
    if (item.action === 'NOTIFICATION_ATTEMPT') return 'PENDING';
    if (item.action === 'NOTIFICATION_SKIPPED') return 'SKIPPED';
  }
  return '';
}
function correlate(requestId: string) { auditFilters.value = { ...emptyAuditFilters, requestId }; search(); }
function resetAudit() { auditFilters.value = { ...emptyAuditFilters }; search(); }
const metrics = ref<Record<string, number>>({}); const from = ref(''); const to = ref(''); const settings = ref({ name: '', pickupInstructions: '', consentHours: 48, publicOrigin: 'http://127.0.0.1:5173', statusLabels: {} as Record<string, string>, defaultStatusLabels: {} as Record<string, string>, trackingStages: structuredClone(defaultTrackingStages), trackingStagesVersion: 0 });
const settingsAvailable = ref(false);
const statusLabels = ref<Record<string, string>>({});
provide('statusLabels', statusLabels);
const dialog = ref<{ title: string; description?: string; fields: Field[]; submit: (v: Record<string, string | number | boolean>) => Promise<void> }>();
async function run(task: () => Promise<void>) { busy.value = true; error.value = ''; notice.value = ''; try { await task(); } catch (e) { error.value = e instanceof Error ? e.message : 'Permintaan gagal.'; } finally { busy.value = false; } }
async function load(pageCursor = '') {
  const params = new URLSearchParams({ limit: '25' }); if (pageCursor) params.set('cursor', pageCursor); if (q.value && tab.value !== 'audit') params.set('q', q.value);
  if (tab.value === 'dashboard') { metrics.value = {}; const range = new URLSearchParams(); if (from.value) range.set('from', new Date(from.value).toISOString()); if (to.value) range.set('to', new Date(to.value).toISOString()); metrics.value = await api(`/dashboard?${range}`); }
  const route = tab.value === 'dashboard' ? 'orders' : tab.value;
  if (route === 'settings') {
    settingsAvailable.value = false;
    const saved = await api<Partial<typeof settings.value>>('/settings');
    settings.value = { ...settings.value, ...saved, trackingStages: Array.isArray(saved.trackingStages) ? saved.trackingStages : structuredClone(defaultTrackingStages), trackingStagesVersion: saved.trackingStagesVersion ?? 0 };
    settingsAvailable.value = saved.trackingStagesVersion === 1 && Array.isArray(saved.trackingStages);
    statusLabels.value = settings.value.statusLabels; return;
  }
  if (route === 'orders') { if (status.value === 'OVERDUE') params.set('overdue', 'true'); else if (status.value) params.set('status', status.value); if (orderSort.value) { params.set('sort', orderSort.value); params.set('direction', orderDirection.value); } }
  if (route === 'notifications' && status.value) params.set('status', status.value);
  if (route === 'audit') {
    audit.value = []; cursor.value = null;
    for (const [key, value] of Object.entries(appliedAuditFilters.value)) {
      if (value.trim()) params.set(key, key === 'from' || key === 'to' ? new Date(value).toISOString() : value.trim());
    }
  }
  async function list<T>() { const result = await api<Page<T>>(`/${route}?${params}`); cursor.value = result.page.nextCursor; return result.data; }
  if (route === 'orders') orders.value = await list<Order>();
  if (route === 'customers') customers.value = await list<Customer>();
  if (route === 'services' && legacyServicesOpen.value) services.value = await list<Service>();
  if (route === 'users') users.value = await list<User>();
  if (route === 'notifications' && historyOpen.value) notifications.value = await list<Notification>();
  if (route === 'audit') audit.value = await list<(typeof audit.value)[number]>();
}
function navigate(value: Tab) { const focusContent = menuOpen.value; menuOpen.value = false; tab.value = value; q.value = ''; status.value = ''; cursors.value = []; selected.value = ''; creating.value = false; customer.value = undefined; auditFilters.value = { ...emptyAuditFilters }; appliedAuditFilters.value = { ...emptyAuditFilters }; run(() => load()); if (focusContent) nextTick(() => document.getElementById('main-content')?.focus()); }
function search() {
  if (tab.value === 'audit') {
    if (auditFilters.value.from && auditFilters.value.to && new Date(auditFilters.value.from) > new Date(auditFilters.value.to)) { error.value = 'Waktu mulai harus sebelum waktu akhir.'; return; }
    appliedAuditFilters.value = { ...auditFilters.value };
  }
  cursors.value = []; run(() => load());
}
function next() { const value = cursor.value; if (!value) return; run(async () => { await load(value); cursors.value.push(value); }); }
function previous() { run(async () => { await load(cursors.value.at(-2)); cursors.value.pop(); }); }
onMounted(async () => { await run(async () => { statusLabels.value = (await api<{ statusLabels: Record<string, string> }>('/display-settings')).statusLabels; }); const displayError = error.value; await run(() => load()); if (displayError && !error.value) error.value = displayError; });
function mutation(title: string, fields: Field[], path: string, method = 'POST', transform: (v: Record<string, string | number | boolean>) => unknown = v => v, description?: string) {
  const key = crypto.randomUUID(); dialog.value = { title, fields, description, submit: async v => { await api(path, method, transform(v), false, key); if (method === 'DELETE') customer.value = undefined; notice.value = 'Perubahan tersimpan.'; await load(cursors.value.at(-1)); if (customer.value) await detail(customer.value.id); } };
}
function editCustomer(c?: Customer) { mutation(c ? 'Ubah pelanggan' : 'Pelanggan baru', [
  { key: 'salutation', label: 'Sapaan', value: c?.salutation ?? 'Kak', required: true, options: ['Kak', 'Pak', 'Bu'].map(value => ({ value, label: value })) }, { key: 'name', label: 'Nama', value: c?.name, required: true }, { key: 'whatsapp', label: 'Nomor WhatsApp', value: c?.whatsapp, required: true, maxLength: 30, help: 'Gunakan 08…, 62… atau format internasional +62….' }, { key: 'notes', label: 'Catatan internal', type: 'textarea', value: c?.notes ?? '' }, { key: 'notificationConsent', label: 'Pelanggan menyetujui notifikasi WhatsApp', type: 'checkbox', value: !!c?.notificationConsentAt },
], c ? `/customers/${c.id}` : '/customers', c ? 'PATCH' : 'POST', v => v, 'Opt-in WhatsApp terpisah dari persetujuan risiko. Centang hanya dengan izin pelanggan.'); }
function deleteEntity(path: string, name: string) {
  if (busy.value || props.user.role !== 'OWNER') return;
  run(async () => {
    await api(path, 'DELETE', { confirmed: true, confirmation: 'HAPUS' });
    customer.value = undefined; notice.value = name + ' dihapus permanen.';
    await load(cursors.value.at(-1));
  });
}
async function detail(id: string) { customer.value = await api<Customer>(`/customers/${id}`); const result = await api<Page<Order>>(`/orders?customerId=${id}&limit=25`); customerOrders.value = result.data; customerCursor.value = result.page.nextCursor; }
async function moreCustomerOrders() { if (!customer.value || !customerCursor.value) return; const result = await api<Page<Order>>(`/orders?customerId=${customer.value.id}&limit=25&cursor=${customerCursor.value}`); customerOrders.value.push(...result.data); customerCursor.value = result.page.nextCursor; }
function editService(s?: Service) { mutation(s ? 'Ubah layanan' : 'Layanan baru', [{ key: 'name', label: 'Nama', value: s?.name, required: true }, { key: 'basePriceIdr', label: 'Harga dasar (Rp)', type: 'number', min: 0, max: 100000000, value: s?.basePriceIdr ?? 0, required: true }, { key: 'isActive', label: 'Layanan aktif', type: 'checkbox', value: s?.isActive ?? true }], s ? `/services/${s.id}` : '/services', s ? 'PATCH' : 'POST', v => ({ ...v, basePriceIdr: Number(v.basePriceIdr) }), 'Menonaktifkan layanan tidak mengubah snapshot harga pesanan lama.'); }
function editUser(u?: User) { mutation(u ? 'Ubah pengguna' : 'Pengguna baru', [{ key: 'name', label: 'Nama', value: u?.name, required: true }, ...(!u ? [{ key: 'email', label: 'Email', type: 'email', required: true, maxLength: 191 }] : []), { key: 'password', label: u ? 'Password baru (kosongkan untuk mempertahankan)' : 'Password', type: 'password', required: !u, help: '12–128 karakter. Perubahan password, peran atau penonaktifan mencabut sesi pengguna.' }, { key: 'role', label: 'Peran', value: u?.role ?? 'STAFF', required: true, options: ['OWNER', 'ADMIN', 'STAFF'].map(value => ({ value, label: label(value) })) }, { key: 'isActive', label: 'Akun aktif', type: 'checkbox', value: u?.isActive ?? true }], u ? `/users/${u.id}` : '/users', u ? 'PATCH' : 'POST', v => { const data = { ...v }; if (!data.password) delete data.password; else if (String(data.password).length < 12) throw new Error('Password minimal 12 karakter.'); return data; }, 'Periksa peran dan status akun. Pemilik aktif terakhir dilindungi backend.'); }
function saveSettings() { if (!settingsAvailable.value) return; mutation('Simpan pengaturan toko', [], '/settings', 'PATCH', () => ({ name: settings.value.name, pickupInstructions: settings.value.pickupInstructions, consentHours: Number(settings.value.consentHours), publicOrigin: settings.value.publicOrigin }), 'Perubahan masa persetujuan berlaku untuk token baru, bukan token lama.'); }
const orderFeedback = ref<{ id: string; text: string }>();
function created(order: Order) { notice.value = 'Pesanan tersimpan.'; orderFeedback.value = { id: order.id, text: orderNotificationFeedback(order.notification) }; creating.value = false; selected.value = order.id; initialToken.value = order.trackingToken ?? ''; }
function openOrder(id: string) { initialToken.value = ''; selected.value = id; }
const metricNames: Record<string, string> = { activeOrders: 'Pesanan aktif', waitingInspection: 'Sepatu menunggu inspeksi', awaitingConsent: 'Sepatu perlu persetujuan', inProgress: 'Sepatu diproses', readyForPickup: 'Sepatu siap diambil', overdue: 'Pesanan terlambat', revenueIdr: 'Penerimaan bersih' };
const orderStatuses = ['WAITING_INSPECTION', 'AWAITING_CONSENT', 'QUEUED', 'IN_PROGRESS', 'READY_FOR_PICKUP', 'RETURN_PENDING', 'COMPLETED'];
</script>
<template>
  <div
    class="app-shell"
    :class="{ 'theme-new': true, 'menu-open': menuOpen }"
  >
    <aside class="sidebar">
      <a
        class="brand sidebar-brand"
        href="/"
      ><img
        :src="logo"
        alt="Cicuci Sepatu"
        width="540"
        height="360"
      ></a><p class="eyebrow">
        Ruang operasional
      </p><button
        v-if="newPresentation"
        class="mobile-menu secondary"
        :aria-expanded="menuOpen"
        aria-controls="workspace-navigation"
        @click="menuOpen = !menuOpen"
      >
        <OutlineIcon name="menu-2" /> Menu
      </button><nav
        id="workspace-navigation"
        aria-label="Navigasi utama"
        @keydown.esc="menuOpen = false; ($event.currentTarget as HTMLElement).parentElement?.querySelector<HTMLButtonElement>('.mobile-menu')?.focus()"
      >
        <button
          v-for="item in tabs"
          :key="item"
          :class="{ active: tab === item }"
          :aria-current="tab === item ? 'page' : undefined"
          @click="navigate(item)"
        >
          <OutlineIcon
            v-if="newPresentation"
            :name="icons[item]"
          />{{ newPresentation ? newNames[item] : names[item] }}
        </button>
      </nav><div class="account">
        <strong>{{ user.name }}</strong><p>{{ label(user.role) }}</p><button
          class="secondary"
          @click="emit('logout')"
        >
          Keluar
        </button><a
          v-if="newPresentation"
          class="theme-attribution"
          :href="thirdPartyNotices"
          target="_blank"
          rel="noopener"
        >Lisensi desain dan ikon</a>
      </div>
    </aside>
    <main
      id="main-content"
      class="workspace"
      :tabindex="newPresentation ? -1 : undefined"
    >
      <header class="topbar">
        <div>
          <p class="eyebrow">
            Cicuci Admin
          </p><h1>{{ newPresentation ? (selected ? 'Detail Pesanan' : creating ? 'Pesanan Baru' : newNames[tab]) : names[tab] }}</h1>
          <p
            v-if="newPresentation"
            class="page-description"
          >
            {{ selected ? 'Rincian sepatu, harga, pembayaran, dan dokumentasi pesanan.' : creating ? 'Pilih pelanggan dan tarif, lalu tambahkan setiap pasangan sepatu.' : descriptions[tab] }}
          </p>
        </div><span class="badge">Data langsung</span>
      </header>
      <p
        v-if="error"
        role="alert"
        class="error"
      >
        {{ error }}
      </p><p
        v-if="notice"
        role="status"
        class="success"
      >
        {{ notice }}
      </p>
      <p
        v-if="orderFeedback && selected === orderFeedback.id"
        role="status"
        class="notice"
      >
        {{ orderFeedback.text }}
      </p>
      <OrderDetail
        v-if="selected"
        :id="selected"
        :key="selected"
        :user="user"
        :initial-token="initialToken"
        @back="selected = ''; initialToken = ''; run(() => load())"
      />
      <CreateOrder
        v-else-if="creating"
        @created="created"
        @cancel="creating = false"
      />
      <template v-else>
        <form
          v-if="tab === 'dashboard'"
          class="panel inline-form"
          @submit.prevent="search"
        >
          <label>Dari (penerimaan ledger)<input
            v-model="from"
            type="datetime-local"
          ></label><label>Sampai<input
            v-model="to"
            type="datetime-local"
          ></label><button :disabled="busy">
            Terapkan periode
          </button>
        </form>
        <section
          v-if="tab === 'dashboard'"
          class="metrics"
          aria-label="Metrik operasional"
        >
          <div
            v-for="(value, key) in metrics"
            :key="key"
          >
            <span>{{ metricNames[key] ?? key }}</span><strong>{{ key === 'revenueIdr' ? money(value) : value }}</strong>
            <small v-if="key === 'revenueIdr'">Pembayaran dikurangi refund dari pesanan yang masih ada.</small>
          </div>
        </section>
        <template v-if="tab === 'settings'">
          <form
            class="panel"
            @submit.prevent="saveSettings"
          >
            <h2>{{ newPresentation ? 'Identitas Toko' : 'Identitas toko' }}</h2><label>Nama toko<input
              v-model="settings.name"
              required
              maxlength="100"
            ></label><label>Instruksi pengambilan<textarea
              v-model="settings.pickupInstructions"
              maxlength="4000"
            /></label><label>Masa persetujuan (jam)<input
              v-model.number="settings.consentHours"
              type="number"
              required
              min="1"
              max="168"
              step="1"
            ></label>
            <label>Domain website publik<input
              v-model="settings.publicOrigin"
              type="url"
              required
              maxlength="300"
            ></label>
            <p class="muted">
              Origin saja, contoh https://tracking.example.com. HTTP hanya localhost/127.0.0.1/[::1]. Tidak mengubah DNS, hosting, CORS atau cookie. Berlaku untuk tautan baru; pesan WhatsApp lama tetap.
            </p>
            <p
              v-if="!settingsAvailable"
              role="status"
            >
              Pengaturan belum tersedia di API ini / perlu aktivasi. Penyimpanan dinonaktifkan.
            </p>
            <button :disabled="busy || !settingsAvailable">
              Simpan pengaturan
            </button>
          </form>
        </template>
        <template v-else>
          <WhatsAppConnection v-if="tab === 'notifications' && user.role === 'OWNER'" />
          <p
            v-if="tab === 'notifications' && user.role !== 'OWNER'"
            class="notice"
          >
            Koneksi dan aktivasi WhatsApp hanya untuk owner. SIMULATED bukan pesan nyata; SENT bukan bukti dibaca pelanggan.
          </p>
          <div class="section-heading">
            <h2>{{ newPresentation ? (tab === 'dashboard' ? 'Pesanan Terbaru' : tab === 'notifications' ? 'Pesan Pelanggan' : tab === 'services' ? 'Daftar Tarif' : tab === 'audit' ? 'Catatan Aktivitas' : 'Daftar ' + newNames[tab]) : tab === 'dashboard' ? 'Daftar pesanan' : names[tab] }}</h2><div class="actions">
              <button
                v-if="['dashboard', 'orders'].includes(tab) && user.role !== 'STAFF'"
                @click="creating = true"
              >
                <OutlineIcon
                  v-if="newPresentation"
                  name="plus"
                />Pesanan baru
              </button><button
                v-if="tab === 'customers'"
                @click="editCustomer()"
              >
                Pelanggan baru
              </button><button
                v-if="tab === 'users'"
                @click="editUser()"
              >
                Pengguna baru
              </button>
            </div>
          </div>
          <form
            v-if="tab !== 'audit' && (tab !== 'services' || legacyServicesOpen) && (tab !== 'notifications' || historyOpen)"
            class="panel filters"
            @submit.prevent="search"
          >
            <label>{{ newPresentation && tab === 'users' ? 'Cari Pengguna' : newPresentation && tab === 'customers' ? 'Cari Pelanggan' : 'Cari' }}<input
              v-model="q"
              type="search"
              maxlength="100"
              :placeholder="newPresentation && tab === 'users' ? 'Nama / email' : newPresentation && tab === 'customers' ? 'Nama / nomor WhatsApp' : ['orders', 'dashboard'].includes(tab) ? 'Nomor / nama / WhatsApp' : 'Cari data'"
            ></label><label v-if="['orders', 'dashboard', 'notifications'].includes(tab)">Status<select
              v-model="status"
              aria-label="Status"
            ><option value="">Semua status</option><option
              v-for="value in tab === 'notifications' ? ['PENDING', 'PROCESSING', 'SIMULATED', 'FAILED', 'SKIPPED', 'SENT'] : orderStatuses"
              :key="value"
              :value="value"
            >{{ statusName(statusLabels, 'admin', value) }}</option><option
              v-if="['orders', 'dashboard'].includes(tab)"
              value="OVERDUE"
            >Hanya terlambat</option></select></label><button :disabled="busy">
              {{ busy ? 'Memuat…' : newPresentation && ['customers', 'users'].includes(tab) ? 'Cari' : 'Terapkan / muat ulang' }}
            </button>
          </form>
          <p
            v-if="busy"
            role="status"
          >
            Memuat data…
          </p>
          <div
            v-if="['orders', 'dashboard'].includes(tab)"
            class="table-wrap panel"
            :tabindex="newPresentation ? 0 : undefined"
            :role="newPresentation ? 'region' : undefined"
            :aria-label="newPresentation ? 'Daftar pesanan, geser untuk kolom lainnya' : undefined"
            :aria-busy="busy"
          >
            <table>
              <caption>Pesanan, maksimum 25 per halaman</caption><thead>
                <tr>
                  <th
                    v-for="column in orderColumns"
                    :key="column.key"
                    scope="col"
                    :aria-sort="orderSort === column.key ? (orderDirection === 'asc' ? 'ascending' : 'descending') : 'none'"
                  >
                    <button
                      type="button"
                      class="sort-header"
                      :disabled="busy"
                      @click="sortOrders(column.key)"
                    >
                      {{ column.title }} <span aria-hidden="true">{{ orderSort === column.key ? (orderDirection === 'asc' ? '↑' : '↓') : '↕' }}</span>
                    </button>
                  </th><th scope="col">
                    Keuangan
                  </th><th
                    v-if="newPresentation && user.role === 'OWNER'"
                    scope="col"
                    class="delete-cell"
                  >
                    Aksi
                  </th>
                </tr>
              </thead><tbody>
                <tr
                  v-for="order in orders"
                  :key="order.id"
                >
                  <td>
                    <button
                      class="link"
                      @click="openOrder(order.id)"
                    >
                      {{ order.number }}
                    </button><p>{{ order.itemCount }} sepatu</p><button
                      v-if="user.role === 'OWNER' && !newPresentation"
                      class="danger"
                      @click="deleteEntity(`/orders/${order.id}`, order.number)"
                    >
                      Hapus pesanan
                    </button>
                  </td><td>{{ order.customer?.name ?? 'Penugasan saya' }}</td><td><span class="badge">{{ statusName(statusLabels, 'admin', order.aggregateStatus) }}</span></td><td>
                    {{ date(order.estimatedCompletionAt) }}<p
                      v-if="order.aggregateStatus !== 'COMPLETED' && new Date(order.estimatedCompletionAt) < new Date()"
                      class="danger-text"
                    >
                      Terlambat
                    </p>
                  </td><td>{{ money(order.totalIdr) }}<p>{{ label(order.paymentStatus) }} · sisa {{ money(order.balanceIdr) }}</p></td>
                  <td
                    v-if="newPresentation && user.role === 'OWNER'"
                    class="delete-cell"
                  >
                    <button
                      class="danger icon-delete"
                      :title="`Hapus pesanan ${order.number}`"
                      :aria-label="`Hapus pesanan ${order.number}`"
                      @click="deleteEntity(`/orders/${order.id}`, order.number)"
                    >
                      <OutlineIcon name="trash" />
                    </button>
                  </td>
                </tr><tr v-if="!orders.length && !busy">
                  <td :colspan="newPresentation && user.role === 'OWNER' ? 6 : 5">
                    <div
                      v-if="newPresentation"
                      class="empty-state"
                    >
                      <OutlineIcon
                        v-if="newPresentation"
                        name="clipboard-list"
                      />
                      <p>Tidak ada pesanan sesuai filter.</p>
                      <p
                        v-if="newPresentation"
                        class="muted"
                      >
                        Ubah pencarian atau status, lalu terapkan kembali.
                      </p>
                    </div>
                    <template v-else>
                      Tidak ada pesanan sesuai filter.
                    </template>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <template v-if="tab === 'customers'">
            <section
              v-if="customer"
              class="panel"
            >
              <div class="section-heading">
                <h2>{{ customer.salutation ?? 'Kak' }} {{ customer.name }}</h2><button
                  class="secondary"
                  @click="customer = undefined"
                >
                  Tutup detail
                </button>
              </div><p>{{ customer.whatsapp }}</p><p class="preserve">
                {{ customer.notes || 'Tidak ada catatan.' }}
              </p><p>Opt-in: {{ customer.notificationConsentAt ? date(customer.notificationConsentAt) : 'Tidak aktif' }}</p><p v-if="customer.archivedAt">
                Data ini tidak tersedia untuk perubahan. Hubungi pemilik toko.
              </p><button
                v-if="!customer.archivedAt"
                class="secondary"
                @click="editCustomer(customer)"
              >
                Ubah pelanggan
              </button><h3>Pesanan pelanggan</h3><ul class="records">
                <li
                  v-for="order in customerOrders"
                  :key="order.id"
                >
                  <button
                    class="link"
                    @click="openOrder(order.id)"
                  >
                    {{ order.number }}
                  </button> · {{ statusName(statusLabels, 'admin', order.aggregateStatus) }}
                </li>
              </ul><p v-if="!customerOrders.length">
                Belum ada pesanan.
              </p><button
                v-if="customerCursor"
                class="secondary"
                @click="run(moreCustomerOrders)"
              >
                Pesanan berikutnya
              </button>
            </section><div
              v-if="newPresentation"
              class="table-wrap panel customer-table"
              tabindex="0"
              role="region"
              aria-label="Daftar pelanggan, geser untuk kolom lainnya"
              :aria-busy="busy"
            >
              <table>
                <caption>Pelanggan, maksimum 25 per halaman</caption>
                <thead>
                  <tr>
                    <th scope="col">
                      Pelanggan
                    </th>
                    <th scope="col">
                      Nomor WhatsApp
                    </th>
                    <th scope="col">
                      Notifikasi
                    </th>
                    <th scope="col">
                      Aksi
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="item in customers"
                    :key="item.id"
                  >
                    <th scope="row">
                      {{ item.salutation ?? 'Kak' }} {{ item.name }}
                    </th>
                    <td>{{ item.whatsapp }}</td>
                    <td>
                      <span
                        class="badge"
                        :class="item.notificationConsentAt ? 'consent-yes' : 'consent-no'"
                      >{{ item.notificationConsentAt ? 'Diizinkan' : 'Tidak diizinkan' }}</span>
                    </td>
                    <td>
                      <div class="actions">
                        <button
                          class="secondary"
                          :aria-label="`Detail pelanggan ${item.name}`"
                          @click="run(() => detail(item.id))"
                        >
                          Detail
                        </button>
                        <button
                          class="secondary"
                          :aria-label="`Ubah pelanggan ${item.name}`"
                          @click="editCustomer(item)"
                        >
                          Ubah
                        </button>
                        <button
                          v-if="user.role === 'OWNER'"
                          class="danger icon-delete"
                          :title="`Hapus pelanggan ${item.name}`"
                          :aria-label="`Hapus pelanggan ${item.name}`"
                          @click="deleteEntity(`/customers/${item.id}`, item.name)"
                        >
                          <OutlineIcon name="trash" />
                        </button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div><div
              v-else
              class="cards"
            >
              <article
                v-for="item in customers"
                :key="item.id"
                class="panel"
              >
                <h3>{{ item.salutation ?? 'Kak' }} {{ item.name }}</h3><p>{{ item.whatsapp }}</p><p>{{ item.notificationConsentAt ? 'WhatsApp opt-in' : 'WhatsApp tidak diizinkan' }}</p><div class="actions">
                  <button
                    class="secondary"
                    @click="run(() => detail(item.id))"
                  >
                    Detail pelanggan
                  </button><button
                    class="secondary"
                    @click="editCustomer(item)"
                  >
                    Ubah
                  </button><button
                    v-if="user.role === 'OWNER'"
                    class="danger"
                    :class="{ 'icon-delete': newPresentation }"
                    :title="newPresentation ? `Hapus pelanggan ${item.name}` : undefined"
                    :aria-label="newPresentation ? `Hapus pelanggan ${item.name}` : undefined"
                    @click="deleteEntity(`/customers/${item.id}`, item.name)"
                  >
                    <OutlineIcon
                      v-if="newPresentation"
                      name="trash"
                    /><template v-else>
                      Hapus pelanggan
                    </template>
                  </button>
                </div>
              </article>
            </div><p v-if="!customers.length && !busy">
              Tidak ada pelanggan.
            </p>
          </template>
          <template v-if="tab === 'services'">
            <NamedPlans :role="user.role" />
            <details
              class="panel technical-details"
              @toggle="legacyServicesOpen = ($event.target as HTMLDetailsElement).open; if (legacyServicesOpen) run(() => load())"
            >
              <summary>Lanjutan: layanan lama</summary>
              <p>Harga dasar katalog lama bukan tarif paket saat ini. Perubahan tidak mengubah snapshot pesanan lama. Layanan internal tidak dapat diedit.</p>
              <button
                v-if="user.role === 'OWNER'"
                @click="editService()"
              >
                Layanan baru
              </button>
              <div class="cards">
                <article
                  v-for="item in services"
                  :key="item.id"
                  class="panel"
                >
                  <h3>{{ item.name }}</h3><strong>{{ item.id === 'cicuci-cleaning-v1' ? 'Internal · tarif otomatis' : money(item.basePriceIdr) }}</strong><p>{{ item.isActive ? 'Aktif' : 'Nonaktif' }}</p>
                  <button
                    v-if="user.role === 'OWNER' && item.id !== 'cicuci-cleaning-v1'"
                    class="secondary"
                    @click="editService(item)"
                  >
                    Ubah layanan / keaktifan
                  </button>
                </article>
              </div><p v-if="!services.length && !busy">
                Tidak ada layanan.
              </p>
            </details>
          </template>
          <template v-if="tab === 'users'">
            <div
              v-if="newPresentation"
              class="table-wrap panel customer-table user-table"
              tabindex="0"
              role="region"
              aria-label="Daftar pengguna, geser untuk kolom lainnya"
              :aria-busy="busy"
            >
              <table>
                <caption>Pengguna, maksimum 25 per halaman</caption>
                <thead>
                  <tr>
                    <th scope="col">
                      ID
                    </th>
                    <th scope="col">
                      Nama
                    </th>
                    <th scope="col">
                      Email
                    </th>
                    <th scope="col">
                      Peran
                    </th>
                    <th scope="col">
                      Status
                    </th>
                    <th scope="col">
                      Aksi
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="item in users"
                    :key="item.id"
                  >
                    <td>{{ item.id }}</td>
                    <th scope="row">
                      {{ item.name }}
                    </th>
                    <td>{{ item.email }}</td>
                    <td>{{ label(item.role) }}</td>
                    <td>
                      <span
                        class="badge"
                        :class="item.isActive ? 'consent-yes' : 'consent-no'"
                      >{{ item.isActive ? 'Aktif' : 'Nonaktif' }}</span>
                    </td>
                    <td>
                      <div class="actions">
                        <span
                          v-if="item.id === user.id"
                          class="badge"
                        >Akun Anda</span>
                        <button
                          class="secondary"
                          :aria-label="`Ubah pengguna ${item.name}`"
                          @click="editUser(item)"
                        >
                          Ubah
                        </button>
                        <button
                          v-if="user.role === 'OWNER' && item.id !== user.id"
                          class="danger icon-delete"
                          :title="`Hapus pengguna ${item.name}`"
                          :aria-label="`Hapus pengguna ${item.name}`"
                          @click="deleteEntity(`/users/${item.id}`, item.name)"
                        >
                          <OutlineIcon name="trash" />
                        </button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div
              v-else
              class="cards"
            >
              <article
                v-for="item in users"
                :key="item.id"
                class="panel"
              >
                <h3>{{ item.name }}</h3><p>{{ item.email }} · {{ label(item.role) }}</p><p>{{ item.isActive ? 'Aktif' : 'Nonaktif' }}{{ newPresentation && item.id === user.id ? ' · Akun Anda' : '' }}</p><details
                  v-if="newPresentation"
                  class="technical-details"
                >
                  <summary>Detail teknis</summary><p class="muted">
                    ID: {{ item.id }}
                  </p>
                </details><p
                  v-else
                  class="muted"
                >
                  ID: {{ item.id }}
                </p><div
                  :class="{ actions: newPresentation }"
                  :style="newPresentation ? undefined : { display: 'contents' }"
                >
                  <button
                    class="secondary"
                    @click="editUser(item)"
                  >
                    Ubah akun / peran / password
                  </button><button
                    v-if="user.role === 'OWNER' && item.id !== user.id"
                    class="danger"
                    :class="{ 'icon-delete': newPresentation }"
                    :title="newPresentation ? `Hapus pengguna ${item.name}` : undefined"
                    :aria-label="newPresentation ? `Hapus pengguna ${item.name}` : undefined"
                    @click="deleteEntity(`/users/${item.id}`, item.name)"
                  >
                    <OutlineIcon
                      v-if="newPresentation"
                      name="trash"
                    /><template v-else>
                      Hapus pengguna
                    </template>
                  </button>
                </div>
              </article>
            </div><p v-if="!users.length && !busy">
              Tidak ada pengguna.
            </p>
          </template>
          <template v-if="tab === 'notifications'">
            <WhatsAppTemplates :owner="user.role === 'OWNER'" />
            <details
              class="panel technical-details"
              @toggle="historyOpen = ($event.target as HTMLDetailsElement).open; historyOpen && run(() => load())"
            >
              <summary>Riwayat pengiriman</summary>
              <p class="muted">
                Riwayat lama dan simulasi tetap tersimpan. Tidak ada pengiriman ulang otomatis.
              </p>
              <article
                v-for="item in notifications"
                :key="item.id"
                class="panel"
              >
                <div class="section-heading">
                  <h3>{{ label(item.template) }}</h3><span class="badge">{{ label(item.status) }}</span>
                </div><p>Provider: {{ item.provider }} · {{ item.status === 'SIMULATED' ? 'Riwayat simulasi; tidak pernah dikirim nyata.' : '' }}</p><p>{{ item.recipient }} · {{ date(item.createdAt) }}</p><details
                  v-if="newPresentation"
                  class="technical-details"
                >
                  <summary>Identitas notifikasi</summary><p class="muted">
                    {{ item.eventKey }}
                  </p>
                </details><p
                  v-else
                  class="muted"
                >
                  {{ item.eventKey }}
                </p><p
                  v-if="item.lastError"
                  class="error"
                >
                  {{ item.lastError }}
                </p><details>
                  <summary>Percobaan ({{ item.attempts.length }})</summary><ol class="records">
                    <li
                      v-for="attempt in item.attempts"
                      :key="attempt.id"
                    >
                      <p>#{{ attempt.attemptNo }} · {{ date(attempt.attemptedAt) }} · {{ attempt.status ? label(attempt.status) : '' }}</p><p>{{ attempt.error }}</p><pre>{{ JSON.stringify(attempt.response, null, 2) }}</pre>
                    </li>
                  </ol><p v-if="!item.attempts.length">
                    Belum ada percobaan worker.
                  </p>
                </details>
              </article><p v-if="!notifications.length && !busy">
                Tidak ada event notifikasi.
              </p>
            </details>
          </template>
          <template v-if="tab === 'audit'">
            <form
              class="panel filters"
              @submit.prevent="search"
            >
              <label>Cari aksi / entitas / ID<input
                v-model="auditFilters.q"
                type="search"
                maxlength="100"
              ></label>
              <label>Aksi<input
                v-model="auditFilters.action"
                maxlength="100"
                placeholder="Contoh: HTTP_REQUEST"
              ></label>
              <label>Jenis entitas<input
                v-model="auditFilters.entityType"
                maxlength="100"
                placeholder="Contoh: Order"
              ></label>
              <label>Hasil<select
                v-model="auditFilters.outcome"
                aria-label="Hasil"
              ><option value="">Semua hasil</option><option value="SUCCESS">Berhasil</option><option value="FAILED">Gagal</option></select></label>
              <label>ID permintaan<input
                v-model="auditFilters.requestId"
                maxlength="160"
              ></label>
              <label>Dari<input
                v-model="auditFilters.from"
                type="datetime-local"
              ></label>
              <label>Sampai<input
                v-model="auditFilters.to"
                type="datetime-local"
              ></label>
              <button :disabled="busy">
                {{ busy ? 'Memuat…' : 'Terapkan / muat ulang' }}
              </button>
              <button
                type="button"
                class="secondary"
                :disabled="busy"
                @click="resetAudit"
              >
                Reset filter
              </button>
            </form>
            <p class="muted">
              Waktu catatan dalam WIB. Filter waktu mengikuti zona waktu perangkat.
            </p>
            <div class="panel audit-panel">
              <div
                class="audit-columns"
                aria-hidden="true"
              >
                <span>Waktu</span><span>Pelaku</span><span>Aktivitas / konteks</span><span>Hasil</span>
              </div>
              <ul
                class="audit-records"
                aria-label="Catatan audit"
                :aria-busy="busy"
              >
                <li
                  v-for="item in audit"
                  :key="item.id"
                >
                  <div class="audit-row">
                    <time :datetime="item.createdAt">{{ date(item.createdAt) }} WIB</time>
                    <span class="audit-actor">{{ item.actorUser?.name ?? (item.actorUserId ? 'Pengguna lama' : 'Sistem') }}</span>
                    <div class="audit-activity">
                      <strong>{{ auditAction(item.action) }}</strong>
                      <p class="muted">
                        {{ auditContext(item) }}
                      </p>
                      <p
                        v-if="auditText(item, 'errorCode')"
                        class="danger-text"
                      >
                        Kesalahan: {{ auditText(item, 'errorCode') }}
                      </p>
                    </div>
                    <span
                      class="badge audit-outcome"
                      :class="{ 'audit-failed': auditText(item, 'outcome') === 'FAILED' }"
                    >{{ auditText(item, 'outcome') === 'SUCCESS' ? 'Berhasil' : auditText(item, 'outcome') === 'FAILED' ? 'Gagal' : 'Tidak tercatat' }}</span>
                  </div>
                  <details class="audit-details">
                    <summary>Detail teknis</summary>
                    <dl>
                      <div><dt>Kode aksi</dt><dd>{{ item.action }}</dd></div>
                      <div><dt>ID audit</dt><dd>{{ item.id }}</dd></div>
                      <div v-if="item.actorUserId">
                        <dt>ID pelaku</dt><dd>{{ item.actorUserId }}</dd>
                      </div>
                      <div v-if="item.entityType">
                        <dt>Jenis entitas</dt><dd>{{ item.entityType }}</dd>
                      </div>
                      <div v-if="item.entityId">
                        <dt>ID entitas</dt><dd>{{ item.entityId }}</dd>
                      </div>
                      <div v-if="auditText(item, 'requestId')">
                        <dt>ID permintaan</dt><dd>{{ auditText(item, 'requestId') }}</dd>
                      </div>
                    </dl>
                    <button
                      v-if="auditText(item, 'requestId')"
                      class="secondary"
                      :disabled="busy"
                      @click="correlate(auditText(item, 'requestId'))"
                    >
                      Lihat aktivitas terkait
                    </button>
                    <pre v-if="item.metadata && Object.keys(item.metadata).length">{{ JSON.stringify(item.metadata, null, 2) }}</pre>
                    <p
                      v-else
                      class="muted"
                    >
                      Tidak ada metadata.
                    </p>
                  </details>
                </li>
              </ul>
            </div><p v-if="!audit.length && !busy && !error">
              Tidak ada catatan audit.
            </p>
          </template>
          <nav
            v-if="!['services', 'notifications'].includes(tab) || (tab === 'services' && legacyServicesOpen) || (tab === 'notifications' && historyOpen)"
            class="pagination"
            :class="{ 'audit-pagination': tab === 'audit' }"
            aria-label="Halaman data"
          >
            <button
              class="secondary"
              :disabled="busy || !cursors.length"
              @click="previous"
            >
              Sebelumnya
            </button><span>Halaman {{ cursors.length + 1 }}</span><button
              class="secondary"
              :disabled="busy || !cursor"
              @click="next"
            >
              Berikutnya
            </button>
          </nav>
        </template>
      </template>
    </main>
    <ActionDialog
      v-if="dialog"
      :key="dialog.title"
      v-bind="dialog"
      @close="dialog = undefined"
    />
  </div>
</template>

<style scoped>
.stage-editor { padding-left: 1.5rem; }
.stage-editor li { padding: 1rem 0; border-bottom: 1px solid #cbd5e1; }
.stage-editor input:not([type="checkbox"]), .stage-editor select { width: 100%; min-width: 0; }
.stage-controls { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .5rem; }
</style>
