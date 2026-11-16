<script setup lang="ts">
import { adminOrderStatus, orderStatusCode, orderStatusTone, handoverLabels } from '../services/domain';
import { completionDate } from '../services/domain';
import { computed, inject, onMounted, ref } from 'vue';
import { api, type User } from '../services/auth';
import { statusName, pricingName, pricingLabel, actionLabel, itemFee, date, label, localDate, money, nextActions, photoInput, terminal, trackingUrl, type Item, type Order, type Page, type Service } from '../services/domain';
import ShoeWorkflowDialog from './ShoeWorkflowDialog.vue';
import ActionDialog, { type Field } from './ActionDialog.vue';
const statusLabels = inject('statusLabels', ref<Record<string, string>>({}));
const newPresentation = inject('newPresentation', ref(false));
const props = defineProps<{ id: string; user: User; initialToken?: string }>();
defineEmits<{ back: [] }>();
const order = ref<Order>(); const error = ref(''); const busy = ref(false); const notice = ref('');
const token = ref(props.initialToken ?? '');
const services = ref<Service[]>([]); const people = ref<User[]>([]);
const admin = computed(() => props.user.role !== 'STAFF' && !order.value?.archivedAt);
const dialog = ref<{ title: string; description?: string; fields: Field[]; submit: (v: Record<string, string | number | boolean>) => Promise<void> }>();
async function load() {
  order.value = await api<Order>(`/orders/${props.id}`);
  if (props.user.role !== 'STAFF') {
    const access = await api<{ trackingToken?: string; publicOrigin: string }>(`/orders/${props.id}/tracking-token`);
    token.value = access.trackingToken ?? '';
    order.value.publicOrigin = access.publicOrigin;
  }
}
async function run(task: () => Promise<void>) { busy.value = true; error.value = ''; try { await task(); } catch (e) { error.value = e instanceof Error ? e.message : 'Permintaan gagal.'; } finally { busy.value = false; } }
onMounted(() => run(async () => { await load(); if (admin.value) { services.value = (await api<Page<Service>>('/services?limit=100&active=true')).data; if (props.user.role === 'OWNER') people.value = (await api<Page<User>>('/users?limit=100')).data; } }));
function action(title: string, fields: Field[], path: string, method = 'POST', transform: (v: Record<string, string | number | boolean>) => unknown = v => v, description?: string) {
  const key = crypto.randomUUID();
  dialog.value = { title, fields, description, submit: async v => {
    const result = await api<{ publicOrigin?: string; trackingToken?: string; approvalToken?: string; expiresAt?: string; consent?: { approvalToken: string; expiresAt: string } }>(path, method, transform(v), false, key);
    if (result.trackingToken) { token.value = result.trackingToken; if (order.value && result.publicOrigin) order.value.publicOrigin = result.publicOrigin; }
    if (path.endsWith('/revoke')) { token.value = ''; pendingConsent.value = undefined; }
    const consent = result.consent ?? (result.approvalToken ? { approvalToken: result.approvalToken, expiresAt: result.expiresAt ?? '' } : undefined);
    if (consent) pendingConsent.value = { ...consent, itemId: path.split('/')[2] };
    notice.value = 'Tindakan tersimpan.'; await load();
  } };
}
const pendingConsent = ref<{ approvalToken: string; expiresAt: string; itemId: string }>();
const shareUrl = computed(() => token.value ? trackingUrl(token.value, '', '', order.value?.publicOrigin) : '');
const feedbackUrl = computed(() => shareUrl.value ? new URL(`/feedback/${token.value}`, shareUrl.value).href : '');
function metadata() { if (!order.value) return; action('Ubah estimasi & pengambilan', [{ key: 'estimatedCompletionAt', label: 'Estimasi selesai', type: 'datetime-local', value: localDate(order.value.estimatedCompletionAt), required: true }, { key: 'pickupInstructions', label: 'Instruksi pengambilan', type: 'textarea', value: order.value.pickupInstructions }], `/orders/${props.id}`, 'PATCH', v => ({ ...v, estimatedCompletionAt: new Date(String(v.estimatedCompletionAt)).toISOString() })); }
function editHandover() { if (!order.value) return; action('Ubah penyerahan', [{ key: 'method', label: 'Metode', required: true, value: order.value.handoverMethod ?? 'STORE', options: Object.entries(handoverLabels).map(([value, label]) => ({ value, label })) }, { key: 'location', label: 'Lokasi (wajib selain di toko)', type: 'textarea', value: order.value.handoverLocation ?? '' }, { key: 'note', label: 'Catatan untuk pelanggan', type: 'textarea', value: order.value.handoverNote ?? '' }], `/orders/${props.id}`, 'PATCH', v => ({ handover: v })); }
function itemFields(item?: Item): Field[] { return [
  { key: 'serviceId', label: 'Layanan aktif', required: true, value: item?.serviceId, options: services.value.filter(s => !order.value?.pricing || s.id === order.value.pricing.serviceId).map(s => ({ value: s.id, label: `${s.name} · ${money(s.basePriceIdr)}` })) },
  ...(['brand', 'model', 'color'] as const).map((key, index) => ({ key, label: ['Merek', 'Model (opsional)', 'Warna (opsional)'][index], required: key === 'brand', value: item?.[key] })),
  { key: 'initialNotes', label: 'Catatan internal', type: 'textarea', value: item?.initialNotes ?? '' },
  { key: 'quotedPriceIdr', label: 'Penawaran (Rp)', type: 'number', min: 0, max: 100000000, value: item?.quotedPriceIdr ?? 0, required: true },
].filter(field => !order.value?.pricing || field.key !== 'quotedPriceIdr'); }
function editItem(item?: Item) { action(item ? 'Ubah sepatu' : 'Tambah sepatu', itemFields(item), item ? `/items/${item.id}` : `/orders/${props.id}/items`, item ? 'PATCH' : 'POST', v => order.value?.pricing ? { ...v, serviceId: order.value.pricing.serviceId } : ({ ...v, quotedPriceIdr: Number(v.quotedPriceIdr) })); }
function assign(item: Item) { action('Penugasan staf', [{ key: 'assignedUserId', label: 'Petugas', value: item.assignedUserId ?? '', options: props.user.role === 'OWNER' ? [{ value: 'unassigned', label: 'Tanpa petugas' }, ...people.value.filter(u => u.isActive !== false).map(u => ({ value: u.id, label: u.name }))] : undefined, help: props.user.role === 'OWNER' ? 'Daftar pengguna aktif, maksimum 100. ID petugas lain dapat dipakai lewat admin.' : 'Masukkan ID pengguna aktif; backend memvalidasi penugasan.' }], `/items/${item.id}/assignment`, 'POST', v => ({ assignedUserId: !v.assignedUserId || v.assignedUserId === 'unassigned' ? null : v.assignedUserId })); }
const workflow = ref<{ item: Item; mode: 'inspection' | 'ready' }>();
function inspect(item: Item) { workflow.value = { item, mode: 'inspection' }; }
async function workflowSaved(result: { consent?: { approvalToken: string; expiresAt: string } }) {
  if (result.consent && workflow.value) pendingConsent.value = { ...result.consent, itemId: workflow.value.item.id };
  notice.value = 'Tindakan tersimpan.'; await run(load);
}
function transition(item: Item, toStatus: string) {
  if (toStatus === 'READY_FOR_PICKUP' || (item.status === 'DRYING' && toStatus === 'PACKING')) { workflow.value = { item, mode: 'ready' }; return; }
  if (toStatus === 'REWORK') { action(actionLabel(toStatus), [{ key: 'reason', label: 'Alasan gagal QC', type: 'textarea', required: true }], `/items/${item.id}/transition`, 'POST', v => ({ ...v, toStatus, qcPassed: false })); return; }
  if (['HANDED_OVER', 'RETURNED'].includes(toStatus)) { action(actionLabel(toStatus), [], `/items/${item.id}/transition`, 'POST', v => ({ ...v, toStatus }), 'Konfirmasi penyerahan fisik. Status pembayaran tetap terpisah.'); return; }
  void run(async () => { await api(`/items/${item.id}/transition`, 'POST', { toStatus, reason: '' }); notice.value = 'Tindakan tersimpan.'; await load(); });
}
function ledger(refund = false) { if (!order.value) return; action(refund ? 'Catat pengembalian dana' : 'Catat pembayaran', [
  { key: 'amountIdr', label: 'Jumlah (Rp)', type: 'number', value: refund ? undefined : order.value.balanceIdr, required: true, min: 1, max: refund ? order.value.paidIdr : order.value.balanceIdr },
  { key: 'method', label: 'Metode', value: refund ? undefined : 'QRIS', required: true, options: ['QRIS', 'CASH', 'TRANSFER', 'EWALLET', 'OTHER'].map(value => ({ value, label: label(value) })) },
  { key: 'receivedAt', label: 'Waktu transaksi', type: 'datetime-local', value: localDate(new Date().toISOString()), required: true },
  { key: 'reference', label: 'Referensi', maxLength: 191 }, { key: 'reason', label: 'Alasan', type: 'textarea', required: refund },
], `/orders/${props.id}/${refund ? 'refunds' : 'payments'}`, 'POST', v => ({ ...v, amountIdr: Number(v.amountIdr), receivedAt: new Date(String(v.receivedAt)).toISOString() }), 'Catatan ledger permanen, bukan transfer uang atau pembayaran otomatis. Periksa jumlah sebelum konfirmasi.'); }
const uploads = ref<Record<string, { kind: string; visible: boolean }>>({});
function uploadChoice(item: Item) { return uploads.value[item.id] ??= { kind: ['RECEIVED', 'INSPECTION', 'QUEUED', 'AWAITING_CONSENT', 'RETURN_PENDING'].includes(item.status) ? 'BEFORE' : 'AFTER', visible: true }; }
async function upload(item: Item, event: Event) { const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file) return; await run(async () => { const choice = uploadChoice(item); await api(`/items/${item.id}/photos`, 'POST', { ...await photoInput(file), kind: choice.kind, customerVisible: choice.kind !== 'INSPECTION' && choice.visible }); await load(); notice.value = 'Foto tersimpan.'; }); input.value = ''; }
const copied = ref(false);
async function copy() { await run(async () => { await navigator.clipboard.writeText(shareUrl.value); copied.value = true; notice.value = 'Tautan disalin. Bagikan hanya kepada pelanggan terkait.'; }); }
const canPay = computed(() => (!order.value?.pricing || order.value.pricing.stage !== 'ESTIMATE') && order.value?.items.every(i => !['RECEIVED', 'INSPECTION', 'AWAITING_CONSENT'].includes(i.status)));
const canHandover = computed(() => !!canPay.value && !!order.value && order.value.items.length > 0 && order.value.items.every(item => ['READY_FOR_PICKUP', 'RETURN_PENDING'].includes(item.status)) && order.value.balanceIdr <= 0);
function handover() { action('Sudah diambil', [], `/orders/${props.id}/handover`, 'POST', v => v, 'Tandai semua sepatu selesai sebagai sudah diambil. Pesanan harus lunas.'); }
</script>
<template>
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
  </p><p
    v-if="busy"
    role="status"
  >
    Memuat…
  </p>
  <template v-if="order">
    <p
      v-if="order.archivedAt"
      role="status"
    >
      Data ini tidak tersedia untuk perubahan. Hubungi pemilik toko.
    </p>
    <header class="order-detail-heading">
      <div>
        <p class="eyebrow">
          Detail Pesanan
        </p><component :is="'h1'">
          {{ order.number }}
        </component><p
          v-if="order.customer"
          class="order-customer"
        >
          <strong>{{ order.customer.name }}</strong><span>{{ order.customer.whatsapp }}</span>
        </p>
      </div><div class="order-detail-status">
        <span
          class="badge order-status"
          :data-status="orderStatusCode(order)"
          :data-tone="orderStatusTone(orderStatusCode(order))"
        >{{ adminOrderStatus(order, statusLabels) }}</span>
        <p
          v-if="order.aggregateStatus === 'READY_FOR_PICKUP' && order.balanceIdr > 0"
          class="muted"
        >
          Perawatan selesai · Sisa {{ money(order.balanceIdr) }}
        </p>
      </div>
    </header>
    <div :class="{ 'order-detail-content': newPresentation }">
      <section
        class="order-detail-shoes"
        aria-label="Daftar Sepatu"
      >
        <div class="section-heading order-detail-shoes-heading">
          <h2>Sepatu ({{ order.items.length }})</h2><div class="actions">
            <button
              v-if="admin && order.aggregateStatus !== 'COMPLETED'"
              :disabled="busy || !canHandover"
              @click="handover"
            >
              Sudah Diambil
            </button><button
              v-if="admin"
              :disabled="(!!order.pricing && order.pricing.stage !== 'ESTIMATE') || !!order.payments?.length || order.aggregateStatus === 'COMPLETED' || order.items.length >= 50"
              @click="editItem()"
            >
              Tambah Sepatu
            </button>
          </div>
        </div>
        <article
          v-for="(item, index) in order.items"
          :key="item.id"
          class="panel shoe order-detail-shoe"
        >
          <div class="section-heading shoe-identity">
            <span
              class="shoe-number"
              aria-hidden="true"
            >{{ String(index + 1).padStart(2, '0') }}</span>
            <div class="shoe-identity-text">
              <p class="eyebrow">
                Sepatu {{ index + 1 }}
              </p><h2>{{ item.brand }} {{ item.model }}</h2><p class="shoe-service">
                {{ [item.color, item.serviceName].filter(Boolean).join(' · ') }}
              </p>
            </div><span
              class="badge order-status"
              :data-status="item.status"
            >{{ item.status === 'READY_FOR_PICKUP' ? 'Selesai Dikerjakan' : item.status === 'RETURN_PENDING' ? 'Menunggu Pengembalian Sepatu' : item.status === 'RETURNED' ? 'Sudah Dikembalikan' : statusName(statusLabels, 'admin', item.status) }}</span>
          </div>
          <dl class="shoe-facts">
            <div><dt>Penawaran</dt><dd>{{ money(item.quotedPriceIdr) }}</dd></div>
            <div><dt>Biaya</dt><dd>{{ itemFee(item) }}</dd></div>
            <div v-if="item.outcome">
              <dt>Hasil Pemeriksaan</dt><dd>{{ label(item.outcome) }}</dd>
            </div>
            <div><dt>Petugas (Opsional)</dt><dd>{{ people.find(p => p.id === item.assignedUserId)?.name ?? item.assignedUserId ?? 'Belum ditugaskan' }}</dd></div>
          </dl>
          <p
            v-if="item.initialNotes"
            class="preserve"
          >
            Catatan internal: {{ item.initialNotes }}
          </p>
          <div class="actions">
            <button
              v-if="admin && ['RECEIVED', 'INSPECTION'].includes(item.status)"
              :disabled="busy"
              @click="inspect(item)"
            >
              Periksa Sepatu
            </button>
            <button
              v-for="next in (order.archivedAt || (!admin && item.assignedUserId !== user.id) ? [] : nextActions(item, !admin))"
              :key="next"
              :disabled="busy || (next === 'WASHING' && order.pricing?.stage === 'ESTIMATE')"
              @click="transition(item, next)"
            >
              {{ actionLabel(next) }}
            </button>
            <button
              v-if="admin && !terminal(item)"
              class="secondary"
              @click="assign(item)"
            >
              Tugaskan (Opsional)
            </button>
          </div>
          <p
            v-if="order.pricing?.stage === 'ESTIMATE' && item.status === 'QUEUED'"
            class="muted"
          >
            Pengerjaan menunggu pemeriksaan lengkap dan persetujuan risiko.
          </p>
          <details class="shoe-details">
            <summary>Detail Lainnya</summary>
            <div class="shoe-detail-sections">
              <section
                v-if="admin && ['RECEIVED', 'INSPECTION'].includes(item.status)"
                class="shoe-settings"
              >
                <h3>Pengaturan Sepatu</h3>
                <div class="actions">
                  <button
                    class="secondary"
                    @click="editItem(item)"
                  >
                    Ubah Sepatu
                  </button>
                  <button
                    v-if="admin && order.pricing && !item.outcome && ['RECEIVED', 'INSPECTION'].includes(item.status)"
                    class="danger"
                    @click="action('Batalkan cuci pasangan', [{ key: 'reason', label: 'Alasan penolakan/pembatalan pelanggan', type: 'textarea', required: true }], `/items/${item.id}/decline-cleaning`, 'POST', v => v, 'Biaya pasangan menjadi nol. Harga pasangan lain yang telah disetujui tetap; kelebihan bayar harus dikembalikan lewat pencatatan refund nyata.')"
                  >
                    Batalkan Cuci Pasangan
                  </button>
                </div>
              </section>
              <details
                v-if="admin && !item.assignedUserId && !terminal(item)"
                class="assignment-info"
              >
                <summary>Ketentuan Penugasan</summary>
                <p class="muted">
                  Owner/Admin dapat memulai tanpa petugas. Staf hanya mengerjakan sepatu yang ditugaskan kepadanya.
                </p>
              </details>
              <details
                v-if="item.inspection"
                class="inspection-record"
              >
                <summary>Hasil Inspeksi Permanen</summary><p class="preserve">
                  {{ item.inspection.notes }}
                </p><p class="preserve">
                  Risiko: {{ item.inspection.risk || 'Tidak ada' }}
                </p>
              </details>
              <section
                v-if="item.consents.length"
                class="consent-records"
              >
                <h3>{{ newPresentation ? 'Persetujuan Risiko' : 'Persetujuan risiko' }}</h3><ul class="records">
                  <li
                    v-for="consent in item.consents"
                    :key="consent.id"
                  >
                    <p class="preserve">
                      {{ consent.risk }}
                    </p><p>{{ money(consent.quotedPriceIdr) }} · {{ consent.decision ? label(consent.decision) : new Date(consent.expiresAt) <= new Date() ? 'Kedaluwarsa, belum diputuskan' : 'Belum diputuskan' }} · {{ date(consent.expiresAt) }}</p>
                  </li>
                </ul>
              </section>
              <div
                v-if="admin && item.status === 'AWAITING_CONSENT'"
                class="actions"
              >
                <button
                  class="secondary"
                  @click="action('Terbitkan ulang persetujuan', [], `/items/${item.id}/consent/reissue`, 'POST', () => ({}), 'Token tindakan sebelumnya tidak berlaku. Bagikan URL baru secara aman.')"
                >
                  Terbitkan ulang persetujuan
                </button><button
                  class="danger"
                  @click="action('Kembalikan tanpa pencucian', [{ key: 'reason', label: 'Alasan pengembalian', type: 'textarea', required: true }], `/items/${item.id}/consent/return`, 'POST', v => v, 'Biaya cuci menjadi nol; semua persetujuan tertunda dibatalkan.')"
                >
                  Proses pengembalian
                </button>
              </div>
              <section class="shoe-documentation">
                <div class="documentation-heading">
                  <h3>{{ newPresentation ? 'Foto Dokumentasi' : 'Foto dokumentasi' }}</h3><span>{{ item.photos.length }}/20 Foto</span>
                </div>
                <p
                  v-if="!item.photos.length"
                  class="photo-empty"
                >
                  Belum ada foto dokumentasi.
                </p>
                <div
                  v-if="item.photos.length"
                  class="photos"
                >
                  <figure
                    v-for="photo in item.photos"
                    :key="photo.id"
                  >
                    <a
                      :href="`/api/v1/photos/${photo.id}`"
                      target="_blank"
                      rel="noopener noreferrer"
                    ><img
                      :src="`/api/v1/photos/${photo.id}`"
                      :alt="`${label(photo.kind)} ${item.brand} ${item.model}`"
                      loading="lazy"
                    ></a><figcaption>{{ label(photo.kind) }} · {{ photo.customerVisible ? 'Pelanggan' : 'Privat' }}</figcaption><button
                      v-if="admin && !terminal(item) && item.status !== 'READY_FOR_PICKUP' && !(item.inspection && ['BEFORE', 'INSPECTION'].includes(photo.kind))"
                      class="danger"
                      @click="action('Hapus foto permanen', [], `/photos/${photo.id}`, 'DELETE', () => ({}), 'Foto dihapus permanen. Bukti inspeksi dilindungi backend.')"
                    >
                      Hapus foto
                    </button>
                  </figure>
                </div>
                <div
                  v-if="!order.archivedAt && !terminal(item)"
                  class="upload"
                >
                  <label><input
                    v-model="uploadChoice(item).visible"
                    type="checkbox"
                  >Terlihat pelanggan</label>
                  <label :for="`file-${item.id}`">Unggah PNG/JPEG, maksimum 10 MiB</label><input
                    :id="`file-${item.id}`"
                    type="file"
                    accept="image/png,image/jpeg"
                    :disabled="busy || item.photos.length >= 20"
                    @change="upload(item, $event)"
                  >
                </div>
              </section>
              <details class="shoe-history">
                <summary>Riwayat Status</summary><ol class="timeline">
                  <li
                    v-for="history in item.history"
                    :key="history.id"
                  >
                    <strong>{{ history.toStatus === 'READY_FOR_PICKUP' ? 'Selesai Dikerjakan' : history.toStatus === 'RETURNED' ? 'Sudah Dikembalikan' : statusName(statusLabels, 'admin', history.toStatus) }}</strong><time>{{ date(history.createdAt) }}</time><p>{{ history.reason }}</p>
                  </li>
                </ol>
              </details>
            </div>
          </details>
        </article>
      </section>
      <aside
        class="order-detail-summary"
        aria-label="Ringkasan Pesanan"
      >
        <section class="panel order-detail-finance">
          <div class="summary-heading">
            <h2>Ringkasan Keuangan</h2>
            <span class="payment-state">{{ label(order.paymentStatus) }}</span>
          </div>
          <div
            v-if="order.pricing"
            class="order-detail-pricing"
          >
            <h2>{{ pricingLabel(order.pricing.stage) }}</h2>
            <p>{{ pricingName(order.pricing) }} · {{ order.pricing.pairs }} pasang · {{ money(order.totalIdr) }}</p>
            <p class="muted">
              Estimasi awal {{ money(order.pricing.initialTotalIdr) }}. Biaya sepatu ditolak/tidak menyetujui risiko: Rp0.
            </p>
            <details class="pricing-explanation">
              <summary>Ketentuan Harga dan Risiko</summary>
              <p>Harga final otomatis dari verifikasi staf, bukan persetujuan pelanggan. Persetujuan risiko tetap wajib.</p>
            </details>
            <p v-if="order.refundDueIdr">
              Kelebihan bayar / perlu pengembalian: {{ money(order.refundDueIdr) }}. Belum berarti dana dikembalikan.
            </p>
          </div>
          <div class="balance-highlight">
            <span>{{ order.pricing?.stage === 'ESTIMATE' ? 'Sisa Estimasi' : 'Sisa Tagihan' }}</span>
            <strong>{{ money(order.balanceIdr) }}</strong>
          </div>
          <dl class="finance-totals">
            <div><dt>Total{{ order.pricing?.stage === 'ESTIMATE' ? ' Estimasi' : '' }}</dt><dd>{{ order.pricing ? money(order.totalIdr) : canPay ? money(order.totalIdr) : 'Harga belum dikonfirmasi' }}</dd></div>
            <div><dt>Dibayar Bersih</dt><dd>{{ money(order.paidIdr) }}</dd></div>
          </dl>
          <p class="muted payment-note">
            {{ !canPay ? 'Pembayaran tersedia setelah pemeriksaan dan keputusan risiko selesai.' : 'Pembayaran tidak mengubah status cuci.' }}
          </p>
          <div
            v-if="admin"
            class="actions finance-actions"
          >
            <button
              :disabled="!canPay || order.balanceIdr <= 0"
              @click="ledger()"
            >
              Catat Pembayaran
            </button><button
              v-if="user.role === 'OWNER'"
              class="secondary"
              :disabled="order.paidIdr <= 0"
              @click="ledger(true)"
            >
              Pengembalian Dana
            </button>
          </div>
          <ul class="records">
            <li
              v-for="payment in order.payments"
              :key="payment.id"
            >
              <strong>{{ label(payment.kind) }} · {{ money(payment.amountIdr) }}</strong><p>{{ date(payment.receivedAt) }} · {{ label(payment.method) }}</p><p>{{ payment.reference }} {{ payment.reason }}</p>
            </li>
          </ul>
        </section>
        <section class="panel order-detail-estimate">
          <h2>{{ newPresentation ? 'Estimasi dan Pengambilan' : 'Estimasi & pengambilan' }}</h2>
          <dl class="handover-facts">
            <div class="completion-highlight">
              <dt>Estimasi Selesai</dt><dd>{{ completionDate(order.estimatedCompletionAt) }}</dd>
            </div>
            <div v-if="order.handoverMethod">
              <dt>Metode Penyerahan</dt><dd>{{ handoverLabels[order.handoverMethod] }}<span v-if="order.handoverLocation"> · {{ order.handoverLocation }}</span><span v-if="order.handoverNote"> · {{ order.handoverNote }}</span></dd>
            </div>
            <div>
              <dt>Instruksi Pengambilan</dt><dd class="preserve">
                {{ order.pickupInstructions || 'Belum ada instruksi.' }}
              </dd>
            </div>
          </dl>
          <div class="actions handover-actions">
            <button
              v-if="admin"
              class="secondary"
              @click="editHandover"
            >
              {{ newPresentation ? 'Ubah Penyerahan' : 'Ubah penyerahan' }}
            </button><button
              v-if="admin"
              class="secondary"
              @click="metadata"
            >
              {{ newPresentation ? 'Ubah Estimasi' : 'Ubah estimasi' }}
            </button>
          </div>
        </section>
      </aside>
      <section
        v-if="admin"
        class="panel order-detail-access"
      >
        <div class="access-heading">
          <div>
            <h2>{{ newPresentation ? 'Akses Pelanggan' : 'Akses pelanggan' }}</h2>
            <p class="muted">
              Bagikan tautan pelacakan hanya kepada pelanggan terkait.
            </p>
          </div>
          <span class="access-privacy">Tautan Privat</span>
        </div>
        <div
          v-if="shareUrl"
          class="access-share"
        >
          <label for="secure-link">Tautan Pelacakan Privat</label><input
            id="secure-link"
            :value="shareUrl"
            readonly
            @focus="($event.target as HTMLInputElement).select()"
          ><div class="actions access-share-actions">
            <button
              class="access-copy"
              @click="copy"
            >
              {{ copied ? 'Tautan Disalin' : 'Salin Tautan' }}
            </button><a
              class="access-open"
              :href="shareUrl"
              target="_blank"
              rel="noopener noreferrer"
              referrerpolicy="no-referrer"
            >Buka Pelacakan</a>
            <a
              class="access-open"
              :href="feedbackUrl"
              target="_blank"
              rel="noopener noreferrer"
              referrerpolicy="no-referrer"
            >Buka Ulasan</a>
          </div>
        </div>
        <details class="access-management">
          <summary>Kelola Akses Pelanggan</summary>
          <p class="muted">
            Tautan tetap sama sampai dicabut atau dirotasi. Persetujuan risiko memakai tautan tindakan sekali pakai dari toko.
          </p>
          <div class="actions order-detail-access-controls">
            <button
              v-if="!shareUrl"
              class="secondary"
              @click="action('Buat tautan pelacakan', [], `/orders/${id}/tracking-token/rotate`, 'POST', () => ({}), 'Tautan baru dapat dibagikan kepada pelanggan.')"
            >
              Buat tautan
            </button><button
              v-else
              class="secondary"
              @click="action('Rotasi tautan pelacakan', [], `/orders/${id}/tracking-token/rotate`, 'POST', () => ({}), 'Tautan lama langsung tidak berlaku. Simpan tautan baru secara aman.')"
            >
              Rotasi Tautan
            </button><button
              class="danger"
              @click="action('Cabut akses pelacakan', [], `/orders/${id}/tracking-token/revoke`, 'POST', () => ({}), 'Semua akses melalui tautan pelacakan saat ini berhenti, termasuk foto dan persetujuan.')"
            >
              Cabut Tautan
            </button>
          </div>
        </details>
        <p v-if="pendingConsent">
          Persetujuan kedaluwarsa {{ date(pendingConsent.expiresAt) }}.
        </p>
      </section>
    </div>
  </template>
  <ShoeWorkflowDialog
    v-if="workflow"
    :item="workflow.item"
    :mode="workflow.mode"
    :smart="!!order?.pricing"
    @close="workflow = undefined"
    @saved="workflowSaved"
  />
  <ActionDialog
    v-if="dialog"
    :key="dialog.title"
    v-bind="dialog"
    @close="dialog = undefined"
  />
</template>
