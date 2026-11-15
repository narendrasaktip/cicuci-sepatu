<script setup lang="ts">
import { defaultTrackingStages, handoverLabels, statusName } from '../services/domain';
import logo from '../assets/logo.webp';
import { computed, nextTick, onMounted, onUnmounted, provide, ref, watch } from 'vue';
import thirdPartyNotices from '../assets/THIRD_PARTY_NOTICES.txt?url';
import { api, type User } from '../services/auth';
import { auditAction, auditContext, date, label, money, orderNotificationFeedback, type AuditLog, type Customer, type Notification, type Order, type Page, type Service } from '../services/domain';
import ActionDialog, { type Field } from './ActionDialog.vue';
import CreateOrder from './CreateOrder.vue';
import NamedPlans from './NamedPlans.vue';
import WhatsAppTemplates from './WhatsAppTemplates.vue';
import WhatsAppBroadcast from './WhatsAppBroadcast.vue';
import WhatsAppConnection from './WhatsAppConnection.vue';
import OrderDetail from './OrderDetail.vue';
import OutlineIcon from './OutlineIcon.vue';
import '../new-theme.css';
const props = defineProps<{ user: User }>(); const emit = defineEmits<{ logout: [] }>();
const menuOpen = ref(false);
const waConnection = ref<'unknown' | 'connected' | 'disconnected'>('unknown');
let waTimer: ReturnType<typeof setTimeout> | undefined; let waDisposed = false;
async function pollWhatsApp() {
  try { const result = await api<{ state: string; ready: boolean }>('/whatsapp/status'); if (!waDisposed) waConnection.value = result.state === 'ready' && result.ready ? 'connected' : 'disconnected'; }
  catch { if (!waDisposed) waConnection.value = 'unknown'; }
  if (!waDisposed) waTimer = setTimeout(() => { void pollWhatsApp(); }, 3000);
}
onMounted(() => { if (props.user.role === 'OWNER') void pollWhatsApp(); });
onUnmounted(() => { waDisposed = true; clearTimeout(waTimer); });
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
  notifications: 'Periksa koneksi dan kelola template pesan.', audit: 'Telusuri aktivitas sistem dan pengguna. Detail teknis tersedia di setiap catatan.',
};
const tabs = computed(() => (Object.keys(names) as Tab[]).filter(t => props.user.role === 'OWNER' || !['users', 'settings', 'audit'].includes(t)).filter(t => props.user.role !== 'STAFF' || ['dashboard', 'orders', 'services'].includes(t)));
const historyOpen = ref(false);
const waTab = ref<'connection' | 'templates' | 'broadcast' | 'history'>(props.user.role === 'OWNER' ? 'connection' : 'templates');
const waTemplates = ref<InstanceType<typeof WhatsAppTemplates>>();
function switchWaTab(value: typeof waTab.value) { waTab.value = value; historyOpen.value = value === 'history'; if (historyOpen.value) { cursors.value = []; void run(() => load()); } }
const legacyServicesOpen = ref(false);
const tab = ref<Tab>('dashboard'); const busy = ref(false); const error = ref(''); const notice = ref(''); const q = ref(''); const appliedCustomerQuery = ref(''); const status = ref(''); const appliedOrderFilter = ref(false); const cursor = ref<string | null>(null); const cursors = ref<string[]>([]);
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
const orderSort = ref<OrderSort>('createdAt'); const orderDirection = ref<'asc' | 'desc'>('desc');
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
  if (key === 'outcome' && item.action === 'LOGIN_SUCCEEDED') return 'SUCCESS';
  if (key === 'outcome' && item.action === 'LOGIN_FAILED') return 'FAILED';
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
  const params = new URLSearchParams({ limit: '25' }); if (pageCursor) params.set('cursor', pageCursor); const query = tab.value === 'customers' ? appliedCustomerQuery.value : q.value; if (query && tab.value !== 'audit') params.set('q', query);
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
  if (route === 'orders') { orders.value = await list<Order>(); appliedOrderFilter.value = !!(q.value || status.value); }
  if (route === 'customers') customers.value = await list<Customer>();
  if (route === 'services' && legacyServicesOpen.value) services.value = await list<Service>();
  if (route === 'users') users.value = await list<User>();
  if (route === 'notifications' && historyOpen.value) notifications.value = await list<Notification>();
  if (route === 'audit') audit.value = await list<(typeof audit.value)[number]>();
}
function navigate(value: Tab) { if (tab.value === 'notifications' && value !== tab.value && waTemplates.value?.dirty && !window.confirm('Perubahan template belum disimpan. Tinggalkan halaman?')) return; const focusContent = menuOpen.value; menuOpen.value = false; tab.value = value; q.value = ''; appliedCustomerQuery.value = ''; status.value = ''; cursors.value = []; selected.value = ''; creating.value = false; customer.value = undefined; auditFilters.value = { ...emptyAuditFilters }; appliedAuditFilters.value = { ...emptyAuditFilters }; run(() => load()); if (focusContent) nextTick(() => document.getElementById('main-content')?.focus()); }
function search() {
  if (tab.value === 'audit') {
    if (auditFilters.value.from && auditFilters.value.to && new Date(auditFilters.value.from) > new Date(auditFilters.value.to)) { error.value = 'Waktu mulai harus sebelum waktu akhir.'; return; }
    appliedAuditFilters.value = { ...auditFilters.value };
  }
  if (tab.value === 'customers') appliedCustomerQuery.value = q.value.trim();
  cursors.value = []; run(() => load());
}
function resetOrderFilters() { q.value = ''; status.value = ''; search(); }
function next() { const value = cursor.value; if (!value) return; run(async () => { await load(value); cursors.value.push(value); }); }
function previous() { run(async () => { await load(cursors.value.at(-2)); cursors.value.pop(); }); }
onMounted(async () => { await run(async () => { statusLabels.value = (await api<{ statusLabels: Record<string, string> }>('/display-settings')).statusLabels; }); const displayError = error.value; await run(() => load()); if (displayError && !error.value) error.value = displayError; });
function mutation(title: string, fields: Field[], path: string, method = 'POST', transform: (v: Record<string, string | number | boolean>) => unknown = v => v, description?: string) {
  const key = crypto.randomUUID(); dialog.value = { title, fields, description, submit: async v => { await api(path, method, transform(v), false, key); if (method === 'DELETE' || path.endsWith('/archive')) customer.value = undefined; notice.value = 'Perubahan tersimpan.'; await load(cursors.value.at(-1)); if (customer.value) await detail(customer.value.id); } };
}
function editCustomer(c?: Customer) { mutation(c ? 'Ubah Pelanggan' : 'Pelanggan Baru', [
  { key: 'salutation', label: 'Sapaan', value: c?.salutation ?? 'Kak', required: true, options: ['Kak', 'Pak', 'Bu', 'Om', 'Tante'].map(value => ({ value, label: value })) }, { key: 'name', label: 'Nama', value: c?.name, required: true }, { key: 'whatsapp', label: 'Nomor WhatsApp', value: c?.whatsapp, required: true, maxLength: 30, help: 'Gunakan 08…, 62… atau format internasional +62….' }, { key: 'notes', label: 'Catatan Internal', type: 'textarea', value: c?.notes ?? '' }, { key: 'notificationConsent', label: 'Pelanggan menyetujui notifikasi WhatsApp', type: 'checkbox', value: !!c?.notificationConsentAt },
  ...(c && c.preferredHandoverMethod !== undefined ? [
    { key: 'preferredMethod', label: 'Preferensi Penyerahan', value: c.preferredHandoverMethod ?? '', options: [{ value: '', label: 'Tidak ada preferensi' }, { value: 'STORE', label: 'Di toko' }, { value: 'PICKUP', label: 'Dijemput' }, { value: 'MEETUP', label: 'Janjian' }, { value: 'COURIER', label: 'Kurir' }] },
    { key: 'preferredLocation', label: 'Lokasi Preferensi', value: c.preferredHandoverLocation ?? '', maxLength: 4000, help: 'Wajib diisi kecuali Di toko. Tidak mengubah pesanan sebelumnya.' },
  ] : []),
], c ? `/customers/${c.id}` : '/customers', c ? 'PATCH' : 'POST', v => {
  const { preferredMethod, preferredLocation, ...fields } = v;
  if (preferredMethod === undefined || (preferredMethod === (c?.preferredHandoverMethod ?? '') && preferredLocation === (c?.preferredHandoverLocation ?? ''))) return fields;
  const location = String(preferredLocation ?? '').trim();
  if (preferredMethod && preferredMethod !== 'STORE' && !location) throw new Error('Lokasi wajib diisi.');
  return { ...fields, handoverPreference: preferredMethod ? { method: preferredMethod, location } : null };
}, 'Opt-in WhatsApp terpisah dari persetujuan risiko. Centang hanya dengan izin pelanggan.'); }
function deleteEntity(path: string, name: string) {
  if (busy.value || props.user.role !== 'OWNER') return;
  mutation(`Hapus ${name}`, [{ key: 'confirmation', label: 'Ketik HAPUS untuk konfirmasi', required: true }], path, 'DELETE', v => {
    if (v.confirmation !== 'HAPUS') throw new Error('Ketik HAPUS untuk konfirmasi.');
    return { confirmed: true, confirmation: 'HAPUS' };
  }, 'Penghapusan permanen tidak dapat dibatalkan.');
}
function deleteCustomer(id: string) {
  if (busy.value || props.user.role !== 'OWNER') return;
  mutation('Hapus permanen pelanggan dan semua pesanan', [{ key: 'confirmation', label: 'Ketik HAPUS untuk konfirmasi', required: true }], `/customers/${id}`, 'DELETE', v => {
    if (v.confirmation !== 'HAPUS') throw new Error('Ketik HAPUS untuk konfirmasi.');
    return { confirmed: true, confirmation: 'HAPUS' };
  }, 'Pelanggan, seluruh pesanan, foto, riwayat operasional dan tautan pelacakan dihapus permanen. Ledger pembayaran, audit dan bukti notifikasi tetap tersimpan; ini bukan pengembalian dana. Penerimaan dashboard tidak lagi mencakup pesanan terhapus. Penghapusan ditolak bila notifikasi masih berjalan atau hasil pengiriman tidak pasti.');
}
const customerDialog = ref<HTMLDialogElement>();
let customerTrigger: HTMLElement | null = null;
function openCustomer(id: string, event: Event) { customerTrigger = event.currentTarget as HTMLElement; void run(() => detail(id)); }
function closeCustomer() { customerDialog.value?.close(); customer.value = undefined; customerTrigger?.focus(); }
watch(customer, async value => { if (value) { await nextTick(); if (customerDialog.value && !customerDialog.value.open) customerDialog.value.showModal(); } });
async function detail(id: string) { const [record, result] = await Promise.all([api<Customer>(`/customers/${id}`), api<Page<Order>>(`/orders?customerId=${id}&limit=25`)]); customer.value = record; customerOrders.value = result.data; customerCursor.value = result.page.nextCursor; }
async function moreCustomerOrders() { if (!customer.value || !customerCursor.value) return; const result = await api<Page<Order>>(`/orders?customerId=${customer.value.id}&limit=25&cursor=${customerCursor.value}`); customerOrders.value.push(...result.data); customerCursor.value = result.page.nextCursor; }
function editService(s?: Service) { mutation(s ? 'Ubah layanan' : 'Layanan baru', [{ key: 'name', label: 'Nama', value: s?.name, required: true }, { key: 'basePriceIdr', label: 'Harga dasar (Rp)', type: 'number', min: 0, max: 100000000, value: s?.basePriceIdr ?? 0, required: true }, { key: 'isActive', label: 'Layanan aktif', type: 'checkbox', value: s?.isActive ?? true }], s ? `/services/${s.id}` : '/services', s ? 'PATCH' : 'POST', v => ({ ...v, basePriceIdr: Number(v.basePriceIdr) }), 'Menonaktifkan layanan tidak mengubah snapshot harga pesanan lama.'); }
function editUser(u?: User) { mutation(u ? 'Ubah Pengguna' : 'Pengguna Baru', [{ key: 'name', label: 'Nama', value: u?.name, required: true }, ...(!u ? [{ key: 'email', label: 'Email', type: 'email', required: true, maxLength: 191 }] : []), { key: 'password', label: u ? 'Password Baru (kosongkan untuk mempertahankan)' : 'Password', type: 'password', required: !u, help: '12–128 karakter. Perubahan password, peran atau penonaktifan mencabut sesi pengguna.' }, { key: 'role', label: 'Peran', value: u?.role ?? 'STAFF', required: true, options: ['OWNER', 'ADMIN', 'STAFF'].map(value => ({ value, label: label(value) })) }, { key: 'isActive', label: 'Akun aktif', type: 'checkbox', value: u?.isActive ?? true }], u ? `/users/${u.id}` : '/users', u ? 'PATCH' : 'POST', v => { const data = { ...v }; if (!data.password) delete data.password; else if (String(data.password).length < 12) throw new Error('Password minimal 12 karakter.'); return data; }, 'Periksa peran dan status akun. Pemilik aktif terakhir dilindungi backend.'); }
function saveSettings() { if (!settingsAvailable.value) return; mutation('Simpan pengaturan toko', [], '/settings', 'PATCH', () => ({ name: settings.value.name, pickupInstructions: settings.value.pickupInstructions, consentHours: Number(settings.value.consentHours), publicOrigin: settings.value.publicOrigin }), 'Perubahan masa persetujuan berlaku untuk token baru, bukan token lama.'); }
const orderFeedback = ref<{ id: string; text: string }>();
function created(order: Order) { notice.value = 'Pesanan tersimpan.'; orderFeedback.value = { id: order.id, text: orderNotificationFeedback(order.notification) }; creating.value = false; selected.value = order.id; initialToken.value = order.trackingToken ?? ''; }
function openOrder(id: string) { customer.value = undefined; initialToken.value = ''; selected.value = id; }
const metricNames: Record<string, string> = { activeOrders: 'Pesanan aktif', waitingInspection: 'Sepatu menunggu inspeksi', awaitingConsent: 'Sepatu perlu persetujuan', inProgress: 'Sepatu diproses', readyForPickup: 'Sepatu siap diambil', overdue: 'Pesanan terlambat', revenueIdr: 'Penerimaan bersih' };
const orderStatuses = ['WAITING_INSPECTION', 'AWAITING_CONSENT', 'QUEUED', 'IN_PROGRESS', 'READY_FOR_PICKUP', 'RETURN_PENDING', 'COMPLETED'];
</script>
<template>
  <div
    class="app-shell"
    :class="{ 'theme-new': true, 'menu-open': menuOpen }"
  >
    <div
      v-if="waConnection !== 'connected' && user.role === 'OWNER'"
      role="status"
      style="position: fixed; z-index: 1000; bottom: 0; left: 0; right: 0; background: #b91c1c; color: white; padding: 0.75rem; text-align: center;"
    >
      {{ waConnection === 'disconnected' ? 'WhatsApp tidak terhubung. Periksa menu WhatsApp; pengiriman terpisah dari koneksi.' : 'Status WhatsApp tidak tersedia. Periksa worker dan koneksi.' }}
    </div>
    <aside class="sidebar">
      <a
        class="brand sidebar-brand"
        href="/"
      ><img
        :src="logo"
        alt="Cicuci Sepatu"
        width="540"
        height="360"
      ></a><button
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
      :class="{ 'orders-workspace': ['dashboard', 'orders', 'customers', 'users', 'services', 'settings'].includes(tab) || creating || selected }"
      :tabindex="newPresentation ? -1 : undefined"
    >
      <header
        v-if="!newPresentation || !selected"
        class="topbar"
        :class="{ 'orders-topbar': newPresentation && !selected && (['dashboard', 'orders', 'customers', 'users', 'services', 'notifications', 'settings'].includes(tab) || creating) }"
      >
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
        </div><div class="topbar-actions">
          <span class="badge">Data langsung</span>
          <div
            v-if="newPresentation && tab === 'services' && !selected && !creating"
            id="rate-header-actions"
          />
          <div
            v-if="newPresentation && creating"
            id="create-order-actions"
          />
          <button
            v-if="newPresentation && tab === 'orders' && !selected && !creating && user.role !== 'STAFF'"
            @click="creating = true"
          >
            <OutlineIcon name="plus" />Pesanan Baru
          </button><button
            v-if="newPresentation && tab === 'customers' && !selected && !creating"
            @click="editCustomer()"
          >
            <OutlineIcon name="plus" />Pelanggan Baru
          </button><button
            v-if="newPresentation && tab === 'users' && !selected && !creating"
            @click="editUser()"
          >
            <OutlineIcon name="plus" />Pengguna Baru
          </button>
        </div>
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
            {{ newPresentation ? 'Terapkan Periode' : 'Terapkan periode' }}
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
            :class="{ 'metric-revenue': key === 'revenueIdr' }"
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
            <h2>{{ newPresentation ? 'Identitas Toko' : 'Identitas toko' }}</h2><label>{{ newPresentation ? 'Nama Toko' : 'Nama toko' }}<input
              v-model="settings.name"
              required
              maxlength="100"
            ></label><label>{{ newPresentation ? 'Instruksi Pengambilan' : 'Instruksi pengambilan' }}<textarea
              v-model="settings.pickupInstructions"
              maxlength="4000"
            /></label><label>{{ newPresentation ? 'Masa Persetujuan (Jam)' : 'Masa persetujuan (jam)' }}<input
              v-model.number="settings.consentHours"
              type="number"
              required
              min="1"
              max="168"
              step="1"
            ></label>
            <label>{{ newPresentation ? 'Domain Website Publik' : 'Domain website publik' }}<input
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
              {{ newPresentation ? 'Simpan Pengaturan' : 'Simpan pengaturan' }}
            </button>
          </form>
        </template>
        <template v-else>
          <nav
            v-if="tab === 'notifications'"
            class="actions"
            aria-label="Bagian WhatsApp"
          >
            <button
              v-if="user.role === 'OWNER'"
              type="button"
              :class="{ secondary: waTab !== 'connection' }"
              :aria-current="waTab === 'connection' ? 'page' : undefined"
              @click="switchWaTab('connection')"
            >
              Koneksi
            </button>
            <button
              type="button"
              :class="{ secondary: waTab !== 'templates' }"
              :aria-current="waTab === 'templates' ? 'page' : undefined"
              @click="switchWaTab('templates')"
            >
              Template Pesan
            </button>
            <button
              v-if="user.role === 'OWNER'"
              type="button"
              :class="{ secondary: waTab !== 'broadcast' }"
              :aria-current="waTab === 'broadcast' ? 'page' : undefined"
              @click="switchWaTab('broadcast')"
            >
              Pesan Custom
            </button>
          </nav>
          <WhatsAppBroadcast v-if="tab === 'notifications' && user.role === 'OWNER' && waTab === 'broadcast'" />
          <WhatsAppConnection v-if="tab === 'notifications' && user.role === 'OWNER' && waTab === 'connection'" />
          <p
            v-if="tab === 'notifications' && user.role !== 'OWNER'"
            class="notice"
          >
            Koneksi dan aktivasi WhatsApp hanya untuk owner. SIMULATED bukan pesan nyata; SENT bukan bukti dibaca pelanggan.
          </p>
          <div
            v-if="tab !== 'notifications' && (!newPresentation || !['orders', 'customers', 'users', 'services'].includes(tab))"
            class="section-heading"
          >
            <h2>{{ newPresentation ? (tab === 'dashboard' ? 'Pesanan Terbaru' : tab === 'services' ? 'Daftar Tarif' : tab === 'audit' ? 'Catatan Aktivitas' : 'Daftar ' + newNames[tab]) : tab === 'dashboard' ? 'Daftar pesanan' : names[tab] }}</h2><div class="actions">
              <button
                v-if="['dashboard', 'orders'].includes(tab) && user.role !== 'STAFF'"
                @click="creating = true"
              >
                <OutlineIcon
                  v-if="newPresentation"
                  name="plus"
                />Pesanan Baru
              </button><button
                v-if="tab === 'customers'"
                @click="editCustomer()"
              >
                Pelanggan Baru
              </button><button
                v-if="tab === 'users'"
                @click="editUser()"
              >
                Pengguna Baru
              </button>
            </div>
          </div>
          <form
            v-if="tab !== 'audit' && (tab !== 'services' || legacyServicesOpen) && (tab !== 'notifications' || historyOpen)"
            class="panel filters"
            :class="{ 'order-filters': ['orders', 'dashboard'].includes(tab) }"
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
            ><option value="">Semua Status</option><option
              v-for="value in tab === 'notifications' ? ['PENDING', 'PROCESSING', 'SIMULATED', 'FAILED', 'SKIPPED', 'SENT'] : orderStatuses"
              :key="value"
              :value="value"
            >{{ statusName(statusLabels, 'admin', value) }}</option><option
              v-if="['orders', 'dashboard'].includes(tab)"
              value="OVERDUE"
            >Hanya Terlambat</option></select></label><button :disabled="busy">
              {{ busy ? 'Memuat…' : newPresentation && ['customers', 'users', 'orders', 'dashboard'].includes(tab) ? 'Cari' : 'Terapkan / muat ulang' }}
            </button><button
              v-if="(['orders', 'dashboard'].includes(tab) && (q || status || appliedOrderFilter)) || (tab === 'customers' && (q || appliedCustomerQuery))"
              type="button"
              class="secondary"
              :disabled="busy"
              @click="resetOrderFilters"
            >
              Reset
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
            class="table-wrap panel order-table"
            :tabindex="newPresentation ? 0 : undefined"
            :role="newPresentation ? 'region' : undefined"
            :aria-label="newPresentation ? 'Daftar pesanan' : undefined"
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
                  class="order-row"
                >
                  <td>
                    <button
                      class="link"
                      @click="openOrder(order.id)"
                    >
                      {{ order.number }}
                    </button><p>{{ order.itemCount }} Sepatu<br>Dibuat: {{ order.createdAt ? date(order.createdAt) : '-' }}</p><button
                      v-if="user.role === 'OWNER' && !newPresentation"
                      class="danger"
                      @click="deleteEntity(`/orders/${order.id}`, order.number)"
                    >
                      Hapus pesanan
                    </button>
                  </td><td data-label="Pelanggan">
                    {{ order.customer?.name ?? 'Penugasan saya' }}
                  </td><td data-label="Status">
                    <span
                      class="badge order-status"
                      :data-status="order.aggregateStatus"
                    >{{ (statusName(statusLabels, 'admin', order.aggregateStatus) === 'Pemeriksaan · disetujui' ? 'Pemeriksaan Selesai' : statusName(statusLabels, 'admin', order.aggregateStatus).replaceAll(' · ', ' ')) }}</span>
                  </td><td data-label="Estimasi">
                    {{ date(order.estimatedCompletionAt) }}<p
                      v-if="order.aggregateStatus !== 'COMPLETED' && new Date(order.estimatedCompletionAt) < new Date()"
                      class="danger-text"
                    >
                      Terlambat
                    </p>
                  </td><td data-label="Keuangan">
                    {{ money(order.totalIdr) }}<p>{{ label(order.paymentStatus) }}<br>Sisa {{ money(order.balanceIdr) }}</p>
                  </td>
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
            <dialog
              v-if="customer"
              ref="customerDialog"
              class="customer-detail"
              aria-labelledby="customer-detail-title"
              @cancel.prevent="closeCustomer"
            >
              <header class="customer-detail-header">
                <div>
                  <p class="customer-detail-eyebrow">
                    Detail Pelanggan
                  </p>
                  <h2 id="customer-detail-title">
                    {{ customer.salutation ?? 'Kak' }} {{ customer.name }}
                  </h2>
                </div>
                <div class="customer-detail-actions">
                  <button
                    v-if="!customer.archivedAt"
                    class="secondary"
                    @click="editCustomer(customer)"
                  >
                    Ubah Pelanggan
                  </button>
                  <button
                    class="secondary"
                    @click="closeCustomer"
                  >
                    Tutup Detail
                  </button>
                </div>
              </header>
              <dl class="customer-detail-info">
                <div class="customer-detail-contact">
                  <dt><OutlineIcon name="message-circle" /> Nomor WhatsApp</dt><dd>{{ customer.whatsapp }}</dd>
                </div>
                <div class="customer-detail-contact">
                  <dt><OutlineIcon name="history" /> Opt-in Notifikasi</dt><dd>
                    <span
                      class="customer-consent-badge"
                      :class="{ 'is-active': customer.notificationConsentAt }"
                    >{{ customer.notificationConsentAt ? 'Aktif' : 'Tidak aktif' }}</span><span
                      v-if="customer.notificationConsentAt"
                      class="customer-consent-date"
                    >Sejak {{ date(customer.notificationConsentAt) }}</span>
                  </dd>
                </div>
                <div class="customer-detail-handover">
                  <dt>Preferensi Penyerahan</dt><dd>{{ customer.preferredHandoverMethod === undefined ? 'Tidak tersedia pada API ini.' : customer.preferredHandoverMethod ? (handoverLabels[customer.preferredHandoverMethod] ?? customer.preferredHandoverMethod) : 'Belum diatur. Gunakan Ubah Pelanggan untuk menambah.' }}</dd>
                  <template v-if="customer.preferredHandoverMethod && customer.preferredHandoverLocation">
                    <dt>Lokasi Preferensi</dt><dd class="preserve">
                      {{ customer.preferredHandoverLocation }}
                    </dd>
                  </template>
                </div>
                <div class="customer-detail-notes">
                  <dt>Catatan Internal</dt><dd class="preserve">
                    {{ customer.notes || 'Tidak ada catatan.' }}
                  </dd>
                </div>
              </dl>
              <p v-if="customer.archivedAt">
                Data ini tidak tersedia untuk perubahan. Hubungi pemilik toko.
              </p>
              <section
                aria-labelledby="customer-orders-title"
                class="customer-detail-history"
              >
                <h3 id="customer-orders-title">
                  Pesanan Pelanggan
                </h3>
                <ul
                  v-if="customerOrders.length"
                  class="customer-order-list"
                >
                  <li
                    v-for="order in customerOrders"
                    :key="order.id"
                  >
                    <button
                      class="link"
                      @click="openOrder(order.id)"
                    >
                      {{ order.number }}
                    </button>
                    <span
                      class="badge order-status customer-order-status"
                      :data-status="order.aggregateStatus"
                    >{{ statusName(statusLabels, 'admin', order.aggregateStatus) }}</span>
                  </li>
                </ul>
                <p
                  v-else
                  class="customer-order-empty"
                >
                  Belum ada pesanan.
                </p>
                <button
                  v-if="customerCursor"
                  class="secondary"
                  @click="run(moreCustomerOrders)"
                >
                  Pesanan Berikutnya
                </button>
              </section>
            </dialog><div
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
                          :aria-label="`Detail Pelanggan ${item.name}`"
                          :disabled="busy"
                          @click="openCustomer(item.id, $event)"
                        >
                          Detail
                        </button>
                        <button
                          class="secondary"
                          :aria-label="`Ubah Pelanggan ${item.name}`"
                          @click="editCustomer(item)"
                        >
                          Ubah
                        </button>
                        <button
                          v-if="user.role === 'OWNER'"
                          class="danger icon-delete"
                          :title="`Hapus permanen pelanggan ${item.name}`"
                          :aria-label="`Hapus permanen pelanggan ${item.name}`"
                          @click="deleteCustomer(item.id)"
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
                    @click="openCustomer(item.id, $event)"
                  >
                    Detail Pelanggan
                  </button><button
                    class="secondary"
                    @click="editCustomer(item)"
                  >
                    Ubah
                  </button><button
                    v-if="user.role === 'OWNER'"
                    class="danger icon-delete"
                    :title="`Hapus permanen pelanggan ${item.name}`"
                    :aria-label="`Hapus permanen pelanggan ${item.name}`"
                    @click="deleteCustomer(item.id)"
                  >
                    <OutlineIcon name="trash" />
                  </button>
                </div>
              </article>
            </div><p
              v-if="!customers.length && !busy"
              role="status"
            >
              {{ appliedCustomerQuery ? 'Tidak ada pelanggan sesuai pencarian.' : 'Tidak ada pelanggan.' }}
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
                    <td>
                      <span
                        :title="item.id"
                        :aria-label="`ID lengkap: ${item.id}`"
                      >{{ item.id.length > 4 ? '…' + item.id.slice(-4) : item.id }}</span>
                    </td>
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
            <WhatsAppTemplates
              v-show="waTab === 'templates'"
              ref="waTemplates"
              :owner="user.role === 'OWNER'"
            />
            <section
              v-if="historyOpen"
              class="panel technical-details"
              aria-label="Riwayat pengiriman"
            >
              <h2>Riwayat pengiriman</h2>
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
                </div><p>Provider: {{ item.provider }}</p><p>{{ item.status === 'SIMULATED' ? 'Riwayat simulasi; bukan pengiriman nyata.' : item.status === 'SENT' && item.provider === 'whatsapp-web.js' ? 'Diajukan ke browser; penerimaan dan pembacaan tidak diketahui.' : item.status === 'FAILED' ? 'Pengiriman gagal atau tidak pasti; periksa percobaan sebelum mengulang.' : item.status === 'SKIPPED' ? 'Dilewati; periksa alasan pada percobaan.' : 'Hasil penerimaan pelanggan tidak diketahui.' }}</p><p>Penerima: {{ item.recipient }} · {{ date(item.createdAt) }}</p><details
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
              </article><p v-if="!notifications.length && !busy && !error">
                Tidak ada event notifikasi.
              </p>
            </section>
          </template>
          <template v-if="tab === 'audit'">
            <form
              class="panel filters audit-filters"
              @submit.prevent="search"
            >
              <label>Cari aksi / entitas / ID<input
                v-model="auditFilters.q"
                type="search"
                maxlength="100"
              ></label>
              <label>Hasil<select
                v-model="auditFilters.outcome"
                aria-label="Hasil"
              ><option value="">Semua hasil</option><option value="SUCCESS">Berhasil</option><option value="FAILED">Gagal</option></select></label>
              <label>Dari<input
                v-model="auditFilters.from"
                type="datetime-local"
              ></label>
              <label>Sampai<input
                v-model="auditFilters.to"
                type="datetime-local"
              ></label>
              <details class="audit-advanced">
                <summary>Filter lanjutan</summary>
                <div class="audit-advanced-fields">
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
                  <label>ID permintaan<input
                    v-model="auditFilters.requestId"
                    maxlength="160"
                  ></label>
                </div>
              </details>
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
                    <span class="audit-actor">{{ item.action === 'LOGIN_FAILED' ? 'Belum terautentikasi' : item.actorUser?.name ?? (item.actorUserId ? 'Pengguna lama' : 'Sistem') }}</span>
                    <div class="audit-activity">
                      <strong>{{ auditAction(item.action) }}</strong>
                      <p v-if="item.action === 'LOGIN_FAILED' && auditText(item, 'attemptedIdentity')">
                        Identitas yang dicoba: {{ auditText(item, 'attemptedIdentity') }}
                      </p>
                      <p class="muted">
                        {{ auditContext(item) }}
                      </p>
                      <p
                        v-if="auditText(item, 'errorCode')"
                        class="danger-text"
                      >
                        Kesalahan: {{ auditText(item, 'errorCode') }}
                      </p>
                      <details class="audit-details">
                        <summary>Detail teknis</summary>
                        <dl>
                          <div><dt>Kode aksi</dt><dd>{{ item.action }}</dd></div>
                          <div><dt>ID audit</dt><dd>{{ item.id }}</dd></div>
                          <div v-if="item.actorUserId">
                            <dt>{{ item.action === 'LOGIN_FAILED' ? 'ID akun terkait (historis, tidak terautentikasi)' : 'ID pelaku' }}</dt><dd>{{ item.actorUserId }}</dd>
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
                    </div>
                    <span
                      class="badge audit-outcome"
                      :class="{ 'audit-failed': auditText(item, 'outcome') === 'FAILED', 'audit-unknown': !['SUCCESS', 'FAILED'].includes(auditText(item, 'outcome')) }"
                    >{{ auditText(item, 'outcome') === 'SUCCESS' ? 'Berhasil' : auditText(item, 'outcome') === 'FAILED' ? 'Gagal' : 'Tidak tercatat' }}</span>
                  </div>
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
.customer-detail { width: min(680px, calc(100% - 2rem)); max-height: 90dvh; overflow-y: auto; overflow-wrap: anywhere; }
.customer-detail-header { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 1rem; padding-bottom: 1rem; border-bottom: 1px solid #dce7e2; }
.customer-detail-header > div:first-child { flex: 1 1 220px; min-width: 0; }
.customer-detail-header h2 { margin: .3rem 0 0; color: #182c49; font-size: clamp(1.4rem, 3vw, 1.8rem); line-height: 1.2; font-weight: 750; }
.customer-detail-eyebrow { margin: 0; color: #56677e; font-size: .8rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
.customer-detail-actions { display: flex; flex-wrap: wrap; gap: .5rem; }
.customer-detail-info { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; margin: 1.25rem 0; }
.customer-detail-info dt { color: #475569; font-size: .8rem; font-weight: 700; }
.customer-detail-info dd { margin: .35rem 0 0; }
.customer-detail-contact { min-width: 0; }
.customer-detail-contact dt { display: flex; align-items: center; gap: .35rem; }
.customer-detail-contact dd { display: flex; align-items: center; flex-wrap: wrap; gap: .4rem .6rem; min-height: 1.75rem; }
.customer-detail-contact :deep(svg) { width: 16px; height: 16px; flex: none; }
.customer-consent-badge { display: inline-block; border-radius: 999px; padding: .2rem .55rem; background: #e2e8f0; color: #334155; font-size: .8rem; font-weight: 700; }
.customer-consent-badge.is-active { background: #dcfce7; color: #166534; }
.customer-consent-date { color: #475569; font-size: .875rem; }
.customer-detail-handover, .customer-detail-notes { grid-column: 1 / -1; padding: .85rem 1rem; border-radius: .65rem; }
.customer-detail-handover { background: #eff6ff; border: 1px solid #bfdbfe; border-left: 4px solid #2563eb; }
.customer-detail-handover dt:not(:first-child) { margin-top: .75rem; }
.customer-detail-notes { background: #f1f5f9; border: 1px solid #e2e8f0; }
.customer-detail-history h3 { margin: 1.25rem 0 .75rem; }
.customer-order-list { list-style: none; margin: 0 0 1rem; padding: 0; border: 1px solid #dce7e2; border-radius: .75rem; }
.customer-order-list li { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: .5rem; padding: .75rem 1rem; }
.customer-order-list li + li { border-top: 1px solid #dce7e2; }
.customer-order-status { border-radius: 999px; padding: .25rem .65rem; font-size: .8rem; font-weight: 600; }
.customer-order-empty { padding: 1rem; border: 1px dashed #b7cbc0; border-radius: .75rem; color: #526a60; }
@media (max-width: 480px) { .customer-detail { padding: 1rem; } .customer-detail-info { grid-template-columns: 1fr; } }
.stage-editor { padding-left: 1.5rem; }
.stage-editor li { padding: 1rem 0; border-bottom: 1px solid #cbd5e1; }
.stage-editor input:not([type="checkbox"]), .stage-editor select { width: 100%; min-width: 0; }
.stage-controls { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .5rem; }
</style>
