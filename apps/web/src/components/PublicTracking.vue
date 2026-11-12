<script setup lang="ts">
import logo from '../assets/logo.webp';
import { computed, nextTick, onMounted, ref } from 'vue';
import { api } from '../services/auth';
import { statusName, trackingPrice, trackingPriceLines, trackingDuration, pricingName, labels, money, type Item, type Order } from '../services/domain';
import ActionDialog from './ActionDialog.vue';
const props = defineProps<{ token: string }>();
const order = ref<Order>(); const error = ref(''); const busy = ref(false); const notice = ref('');
const estimatedPrice = computed(() => order.value?.pricing ? order.value.pricing.stage === 'ESTIMATE' : order.value?.items.some(i => !i.outcome || i.status === 'AWAITING_CONSENT'));
const commonService = computed(() => order.value?.items.length && order.value.items.every(i => i.serviceName === order.value!.items[0]!.serviceName) ? order.value.items[0]!.serviceName : '');
const excluded = (item: Item) => ['REJECTED', 'DECLINED'].includes(item.outcome ?? '') || ['RETURN_PENDING', 'RETURNED'].includes(item.status);
const originalPrice = computed(() => {
  const pricing = order.value?.pricing;
  const total = pricing?.originalTotalIdr ?? pricing?.initialTotalIdr;
  const pairs = pricing?.originalPairs ?? order.value?.items.length;
  return Number.isSafeInteger(total) && total! >= 0 && Number.isSafeInteger(pairs) && pairs! > 0 ? { total: total!, pairs: pairs! } : undefined;
});
const cancellationReduction = computed(() => {
  const current = order.value, original = originalPrice.value;
  if (!current || !original || estimatedPrice.value || current.pricing?.totalIdr !== current.totalIdr) return;
  const cancelled = current.items.filter(excluded);
  const reduction = original.total - current.totalIdr;
  if (!cancelled.length || cancelled.some(item => item.finalPriceIdr !== 0) || !Number.isSafeInteger(current.totalIdr) || current.totalIdr < 0 || reduction <= 0) return;
  const lines = current.pricing.breakdown;
  // ponytail: only proven uniform singles imply waived per-pair fees; all other tariffs show net adjustment.
  const singles = lines?.length && current.pricing.calculationMatches === true && lines.every(line => (line.kind === 'PER_PAIR' || line.pairs === 1) && line.priceIdr === lines[0]!.priceIdr)
    && original.pairs === current.items.length && original.total === original.pairs * lines[0]!.priceIdr && reduction === cancelled.length * lines[0]!.priceIdr;
  return { amount: reduction, label: singles ? `${cancelled.length} Pasang Tidak Dicuci` : 'Penyesuaian Bersih' };
});
const priceDescription = computed(() => order.value ? trackingPrice(order.value) : '');
const priceLines = computed(() => order.value ? trackingPriceLines(order.value) : undefined);
const duration = computed(() => order.value ? trackingDuration(order.value) : '');
const orderDisplayStatus = computed(() => {
  const current = order.value;
  if (!current) return { label: '', tone: 'blue' };
  const done = current.items.every(item => ['READY_FOR_PICKUP', 'HANDED_OVER', 'RETURN_PENDING', 'RETURNED'].includes(item.status));
  if (current.items.length && current.paymentStatus === 'PAID' && current.items.every(item => ['HANDED_OVER', 'RETURNED'].includes(item.status))) return { label: 'Transaksi Selesai', tone: 'green' };
  if (done && current.paymentStatus === 'PAID' && current.items.some(item => ['READY_FOR_PICKUP', 'RETURN_PENDING'].includes(item.status))) return { label: 'Siap Diambil', tone: 'teal' };
  if (done) return { label: 'Selesai Dikerjakan', tone: 'green' };
  return current.items.every(item => item.status === 'RECEIVED') ? { label: 'Dalam Antrian', tone: 'amber' } : { label: 'Proses Pengerjaan', tone: 'blue' };
});
const activePairs = computed(() => order.value?.items.filter(item => !excluded(item) && !['READY_FOR_PICKUP', 'HANDED_OVER'].includes(item.status)).length ?? 0);
const progressCounts = computed(() => {
  const stages: Record<string, string> = { RECEIVED: 'menunggu pemeriksaan', INSPECTION: 'menunggu pemeriksaan', AWAITING_CONSENT: 'menunggu persetujuan customer', QUEUED: 'menunggu pencucian', WASHING: 'sedang dicuci', DRYING: 'sedang dikeringkan', PACKING: 'dalam pengemasan dan pemeriksaan mutu', FINISHING: 'dalam finishing', QC: 'dalam pemeriksaan mutu', REWORK: 'sedang dikerjakan ulang', READY_FOR_PICKUP: 'selesai dicuci', HANDED_OVER: 'selesai dicuci' };
  const counts = new Map<string, number>();
  for (const item of order.value?.items ?? []) {
    const name = excluded(item) ? `tidak dicuci${item.finalPriceIdr === 0 ? ' — tanpa biaya pencucian' : ''}` : stages[item.status] ?? 'status belum tersedia';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count }));
});
const shoeNotes = computed(() => (order.value?.items ?? []).map((item, index) => ({ item, index })).filter(({ item }) => item.status === 'AWAITING_CONSENT' || item.status === 'REWORK' || excluded(item) || item.risk?.trim() || item.findings?.trim() || item.customerNote?.trim()));
const decision = ref<'APPROVE' | 'DECLINE'>();
const consentItemId = ref('');
let consentTrigger: HTMLButtonElement | undefined;
function openConsent(event: MouseEvent, itemId: string, value: 'APPROVE' | 'DECLINE') { consentTrigger = event.currentTarget as HTMLButtonElement; consentItemId.value = itemId; decision.value = value; }
async function closeConsent() { decision.value = undefined; await nextTick(); if (consentTrigger?.isConnected) consentTrigger.focus(); else document.querySelector<HTMLButtonElement>('.tracking .refresh')?.focus(); }
async function load() { busy.value = true; error.value = ''; try { order.value = await api<Order>(`/track/${props.token}`, 'GET', undefined, true); } catch (e) { order.value = undefined; error.value = e instanceof Error ? e.message : 'Pelacakan gagal.'; } finally { busy.value = false; } }
onMounted(load);
async function consent() { if (!decision.value || !consentItemId.value) return; await api(`/track/${props.token}/consent`, 'POST', { itemId: consentItemId.value, decision: decision.value }, true); notice.value = 'Keputusan tersimpan.'; consentItemId.value = ''; decision.value = undefined; await load(); }
// Only presentation-owned labels: never title-case customer text or identifiers.
function label(value: string) {
  const overrides: Record<string, string> = { QUEUED: 'Pemeriksaan Selesai', APPROVED: 'Lolos Pemeriksaan Staf', REJECTED: 'Ditolak Pemeriksaan Staf', DECLINED: 'Risiko Ditolak Pelanggan', AWAITING_CONSENT: 'Menunggu Persetujuan Customer', REISSUED: 'Tautan Diganti' };
  return overrides[value] ?? labels[value]?.replace(/\p{L}[\p{L}\p{M}]*/gu, word => word[0]!.toLocaleUpperCase('id-ID') + word.slice(1)) ?? value;
}
function publicStatusName(context: string, status: string, fallback = label(status)) {
  const name = statusName(order.value?.statusLabels, context, status, fallback);
  if (status === 'AWAITING_CONSENT' && name === 'Menunggu Persetujuan Client') return label(status);
  if (status === 'REWORK' && name === 'Pengerjaan · Ulang') return 'Pengerjaan Ulang';
  if (context === 'shoe' && status === 'READY_FOR_PICKUP' && name === 'Selesai Dicuci') return 'Selesai Dikerjakan';
  return context === 'shoe' && status === 'RECEIVED' && (name === 'Waiting List' || !order.value?.statusLabels?.['shoe.RECEIVED']) ? 'Dalam Antrian' : name;
}
function customerDeclined(item: Item) { return item.consents.some(consent => consent.decision === 'DECLINE'); }
function shoeLabel(item: Item) {
  const overrides: Record<string, string> = { READY_FOR_PICKUP: 'Selesai Dikerjakan', RETURN_PENDING: 'Tidak Dicuci', RETURNED: 'Tidak Dicuci', REJECTED: 'Tidak Dicuci', DECLINED: 'Tidak Dicuci' };
  return publicStatusName('shoe', item.status, overrides[item.status] ?? label(item.status));
}
function historyLabel(item: Item, status: string) {
  if (status === 'RETURN_PENDING' && customerDeclined(item)) return 'Customer Menolak Untuk Dicuci';
  if (status === 'RETURN_PENDING' && item.outcome === 'REJECTED') return 'Pencucian Ditolak oleh Toko';
  const overrides: Record<string, string> = { RECEIVED: 'Sepatu Diterima', INSPECTION: 'Pemeriksaan Sepatu', WASHING: 'Dalam Proses Pencucian', DRYING: 'Dalam Proses Pengeringan', READY_FOR_PICKUP: 'Selesai Dikerjakan', RETURN_PENDING: 'Tidak Dicuci', RETURNED: 'Tidak Dicuci' };
  return publicStatusName('history', status, overrides[status] ?? label(status));
}
function rejectionReason(item: Item) {
  if (item.outcome === 'REJECTED') return 'Pencucian tidak dilanjutkan setelah pemeriksaan staf.';
  // DECLINED also covers operational returns; never infer customer intent from it alone.
  return item.consents.some(entry => entry.decision === 'DECLINE') && !item.consents.some(entry => entry.decision === 'CANCELLED')
    ? 'Pencucian tidak dilanjutkan karena customer tidak menyetujui risiko.'
    : 'Pencucian dibatalkan.';
}
function tone(status: string) {
  return ['AWAITING_CONSENT', 'NEEDS_CONSENT'].includes(status) ? 'amber' : ['RETURN_PENDING', 'RETURNED', 'REJECTED', 'DECLINED'].includes(status) ? 'red' : ['READY_FOR_PICKUP', 'HANDED_OVER', 'COMPLETED'].includes(status) ? 'green' : 'blue';
}
function date(value?: string | null) {
  if (!value) return 'Waktu Tidak Tersedia';
  const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  // Require an explicit offset for timestamps; a date alone never implies midnight.
  if (!dayOnly && !/T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return 'Waktu Tidak Tersedia';
  const parsed = new Date(dayOnly ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(parsed.getTime()) || (dayOnly && parsed.toISOString().slice(0, 10) !== value)) return 'Waktu Tidak Tersedia';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', ...(dayOnly ? {} : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const }) }).formatToParts(parsed).map(part => [part.type, part.value]));
  const formatted = `${parts.weekday}, ${parts.day} ${parts.month} ${parts.year}`;
  return dayOnly ? `${formatted} · Jam Tidak Tersedia` : `${formatted} | ${parts.hour}:${parts.minute} WIB.`;
}
const publicPhotos = (item: Item) => item.photos.filter(photo => ['BEFORE', 'AFTER'].includes(photo.kind) && photo.customerVisible !== false && photo.path);
const photoDialog = ref<HTMLDialogElement>();
const enlarged = ref<{ path: string; alt: string }>();
let photoTrigger: HTMLButtonElement | undefined;
async function openPhoto(event: MouseEvent, path: string, alt: string) {
  photoTrigger = event.currentTarget as HTMLButtonElement;
  enlarged.value = { path, alt };
  await nextTick(); photoDialog.value?.showModal();
}
function closePhoto() {
  photoDialog.value?.close(); enlarged.value = undefined;
  if (photoTrigger?.isConnected) photoTrigger.focus();
}
</script>
<template>
  <main
    id="main-content"
    class="tracking"
  >
    <header class="tracking-header">
      <a
        href="/"
        class="brand tracking-brand"
      ><img
        :src="logo"
        alt="Cicuci Sepatu"
        width="540"
        height="360"
      ></a><h1>Tracking Pesanan</h1>
    </header>
    <p
      v-if="error"
      class="error"
      role="alert"
    >
      {{ error }}
    </p><p
      v-if="notice"
      class="success"
      role="status"
    >
      {{ notice }}
    </p><p
      v-if="busy"
      role="status"
    >
      Memuat pesanan…
    </p>
    <div class="order-identity">
      <div v-if="order">
        <p class="order-number">
          {{ order.number }}
        </p>
      </div>
      <button
        class="secondary refresh"
        :disabled="busy"
        @click="load"
      >
        Perbarui Status
      </button>
    </div>
    <template v-if="order">
      <p
        v-if="order.archivedAt"
        role="status"
      >
        Data ini tidak tersedia untuk perubahan. Hubungi pemilik toko.
      </p>
      <section
        class="panel order-summary"
        aria-labelledby="order-summary-title"
      >
        <section
          class="summary-info"
          aria-labelledby="order-summary-title"
        >
          <div class="summary-heading">
            <h2 id="order-summary-title">
              Informasi Pesanan
            </h2>
            <span
              class="badge order-badge"
              :data-tone="orderDisplayStatus.tone"
              aria-label="Status Pesanan"
            >{{ orderDisplayStatus.label }}</span>
          </div>
          <p class="service-snapshot">
            Layanan — {{ order.pricing ? pricingName(order.pricing) : commonService || 'Campuran · sesuai rincian sepatu' }}
          </p>
          <div class="price-snapshot">
            <p
              v-if="priceLines"
              class="price-label"
            >
              {{ estimatedPrice ? 'Estimasi Harga:' : 'Harga:' }}
            </p>
            <ul
              v-if="priceLines"
              class="price-lines"
            >
              <li
                v-for="line in priceLines"
                :key="line"
              >
                {{ line }}
              </li>
            </ul>
            <template v-else>
              {{ estimatedPrice ? 'Estimasi Harga:' : 'Harga:' }} {{ priceDescription }}
            </template>
          </div>
          <div :class="['summary-eta', { inactive: !activePairs }]">
            <h3>
              Estimasi Selesai:{{ duration ? ` ${duration}` : '' }}
            </h3>
            <p class="completion">
              {{ date(order.estimatedCompletionAt) }}
            </p>
          </div>
          <h3 class="progress-title">
            Status Pengerjaan
          </h3>
          <ul class="progress-counts">
            <li
              v-for="entry in progressCounts"
              :key="entry.name"
            >
              {{ entry.count }} pasang sepatu {{ entry.name }}
            </li>
          </ul>
          <section
            v-if="shoeNotes.length"
            class="customer-notes"
            aria-labelledby="customer-notes-title"
          >
            <h3 id="customer-notes-title">
              Detail Sepatu
            </h3>
            <ul class="shoe-notes-list">
              <li
                v-for="{ item, index } in shoeNotes"
                :key="item.id"
              >
                <p>
                  <strong>Sepatu {{ index + 1 }} ({{ item.brand }})</strong><template v-if="excluded(item)">
                    — Tidak Dicuci
                  </template><template v-else-if="item.status === 'REWORK'">
                    — Pengerjaan Ulang
                  </template><template v-else-if="item.status === 'AWAITING_CONSENT'">
                    — Menunggu Persetujuan Customer
                  </template>
                </p>
                <p v-if="excluded(item)">
                  {{ rejectionReason(item) }}
                </p>
                <template v-if="item.status === 'AWAITING_CONSENT'">
                  <p>Detail risiko dan keputusan tersedia pada kartu sepatu di bawah.</p>
                </template>
                <template v-else>
                  <p
                    v-if="item.findings?.trim()"
                    class="preserve"
                  >
                    <strong>Temuan:</strong> {{ item.findings }}
                  </p>
                  <p
                    v-if="item.customerNote?.trim()"
                    class="preserve"
                  >
                    Catatan: {{ item.customerNote }}
                  </p>
                  <p
                    v-if="item.risk?.trim()"
                    class="preserve"
                  >
                    Risiko yang diinformasikan: {{ item.risk }}
                  </p>
                </template>
              </li>
            </ul>
          </section>
          <div
            v-if="order.pickupInstructions?.trim()"
            class="pickup-instructions"
          >
            <h3>Pengambilan</h3><p class="preserve">
              {{ order.pickupInstructions }}
            </p>
          </div>
        </section>
        <section
          class="summary-payment"
          aria-labelledby="payment-title"
        >
          <div class="payment-heading">
            <h2 id="payment-title">
              Pembayaran
            </h2>
            <span
              class="badge payment-badge"
              :data-tone="order.paymentStatus === 'PAID' ? 'green' : 'amber'"
              aria-label="Status Pembayaran"
            >{{ label(order.paymentStatus) }}</span>
          </div>
          <dl class="summary-total">
            <dt>{{ estimatedPrice ? 'Estimasi Biaya' : 'Total Akhir' }}</dt>
            <dd>{{ money(order.totalIdr) }}</dd>
          </dl>
          <dl class="summary-rows">
            <div v-if="originalPrice">
              <dt>Jumlah Sepatu Awal</dt><dd>{{ originalPrice.pairs }} pasang</dd>
            </div>
            <div v-if="originalPrice">
              <dt>Total Harga Awal</dt><dd>{{ money(originalPrice.total) }}</dd>
            </div>
            <div v-if="cancellationReduction">
              <dt>{{ cancellationReduction.label }}</dt><dd>- {{ money(cancellationReduction.amount) }}</dd>
            </div>
            <div class="summary-balance">
              <dt>Dibayar Bersih</dt><dd>{{ money(order.paidIdr) }}</dd>
            </div>
            <div
              v-if="order.refundDueIdr"
              class="summary-balance refund-due"
            >
              <dt>Perlu Pengembalian</dt><dd>{{ money(order.refundDueIdr) }}<small>Pengembalian belum dicatat.</small></dd>
            </div>
            <div
              v-else-if="!estimatedPrice"
              class="summary-balance"
            >
              <dt>Sisa Pembayaran</dt><dd>{{ money(order.balanceIdr) }}</dd>
            </div>
          </dl>
          <p
            v-if="order.pricing?.basis === 'CANCELLATION'"
            class="muted summary-note"
          >
            Kelayakan paket/promo dihitung ulang memakai tarif tersimpan untuk sepatu tersisa, bukan harga rata-rata.
          </p>
          <p
            v-if="order.pricing?.calculationMatches === false"
            class="muted summary-note"
          >
            Total mengikuti alokasi historis tersimpan; bukan penawaran paket baru.
          </p>
          <p
            v-if="order.pricing?.staffVerified"
            class="muted summary-note"
          >
            Harga diverifikasi staf.
          </p>
          <p class="muted online-note">
            Ini bukan halaman pembayaran online.
          </p>
        </section>
      </section>
      <article
        v-for="(item, index) in order.items"
        :key="item.id"
        class="panel"
      >
        <div class="section-heading">
          <div>
            <h2>{{ item.brand }} {{ item.model }}</h2><p class="eyebrow">
              Sepatu {{ index + 1 }}<template v-if="!commonService && item.serviceName">
                · {{ item.serviceName }}
              </template>
            </p><p v-if="item.color">
              {{ item.color }}
            </p>
          </div><span
            class="badge"
            :data-tone="tone(item.status)"
          >{{ shoeLabel(item) }}</span>
        </div><p
          v-if="item.outcome === 'REJECTED' || item.outcome === 'DECLINED'"
          class="rejection"
        >
          <strong><em>{{ item.finalPriceIdr === 0 ? 'Sepatu Tidak Dicuci dan Tidak Ada Biaya Cuci' : `${rejectionReason(item)} Biaya cuci ${money(item.finalPriceIdr)}.` }}</em></strong>
        </p>
        <section
          v-if="item.status === 'AWAITING_CONSENT'"
          class="notice"
        >
          <h3>Menunggu Persetujuan Customer</h3><p class="consent-intro">
            Pencucian dilanjutkan setelah Anda menyetujui risiko berikut.
          </p><ul class="records">
            <li
              v-for="entry in item.consents"
              :key="entry.id"
            >
              <p v-if="entry.decision">
                {{ label(entry.decision) }}
              </p>
              <template v-if="entry.findings">
                <p class="preserve">
                  <strong>Temuan</strong><span>{{ entry.findings }}</span>
                </p>
                <p class="preserve">
                  <strong>Risiko Pencucian</strong><span>{{ entry.risk }}</span>
                </p>
                <p
                  v-if="entry.customerNote?.trim()"
                  class="preserve"
                >
                  <strong>Catatan dari Toko</strong><span>{{ entry.customerNote }}</span>
                </p>
              </template>
              <p
                v-else
                class="preserve"
              >
                <strong>Deskripsi risiko (legacy)</strong><span>{{ entry.risk }}</span>
              </p>
              <p class="preserve">
                <strong>Batas Konfirmasi</strong><span>{{ date(entry.expiresAt) }}</span>
              </p>
            </li>
          </ul>
          <div class="consent-footer">
            <template v-if="!order.archivedAt && item.consents.some(c => !c.decision && !c.expired)">
              <p>Dengan menyetujui, Anda menerima risiko pencucian di atas. Menolak berarti sepatu dikembalikan tanpa biaya cuci.</p><div class="actions">
                <button
                  :disabled="busy"
                  @click="openConsent($event, item.id, 'APPROVE')"
                >
                  Setujui Risiko & Lanjutkan
                </button><button
                  class="danger"
                  :disabled="busy"
                  @click="openConsent($event, item.id, 'DECLINE')"
                >
                  Tolak Pencucian
                </button>
              </div>
            </template><p v-else-if="item.consents.some(c => !c.decision && c.expired) && !item.consents.some(c => !c.decision && !c.expired)">
              Persetujuan sudah kedaluwarsa. Hubungi toko. Pencucian tetap menunggu persetujuan Anda.
            </p><p v-else>
              Keputusan sudah tersimpan.
            </p>
          </div>
        </section>
        <div class="shoe-content">
          <section
            v-if="publicPhotos(item).length"
            class="shoe-photos"
            :aria-labelledby="`shoe-photos-${index}`"
          >
            <h3 :id="`shoe-photos-${index}`">
              Foto Sepatu {{ index + 1 }} ({{ item.brand }})
            </h3>
            <div class="photos">
              <figure
                v-for="photo in publicPhotos(item)"
                :key="photo.id"
              >
                <button
                  type="button"
                  :aria-label="`Perbesar ${item.brand} - Foto ${label(photo.kind)}`"
                  @click="openPhoto($event, photo.path!, `${item.brand} - Foto ${label(photo.kind)}`)"
                >
                  <img
                    :src="photo.path"
                    :alt="`${item.brand} - Foto ${label(photo.kind)}`"
                    loading="lazy"
                    referrerpolicy="no-referrer"
                  >
                </button><figcaption>{{ label(photo.kind) }}</figcaption>
              </figure>
            </div>
          </section>
          <section class="shoe-history">
            <h3>Riwayat Pengerjaan</h3><ol class="timeline">
              <li
                v-for="(event, n) in item.timeline"
                :key="n"
                :class="{ latest: n === item.timeline!.length - 1 }"
                :aria-current="n === item.timeline!.length - 1 ? 'step' : undefined"
              >
                <strong>{{ historyLabel(item, event.status) }}</strong><time>{{ date(event.at) }}</time>
              </li>
            </ol>
          </section>
        </div>
      </article>
    </template>
    <dialog
      ref="photoDialog"
      class="photo-dialog"
      aria-labelledby="photo-title"
      @cancel.prevent="closePhoto"
    >
      <template v-if="enlarged">
        <div class="photo-dialog-heading">
          <h2 id="photo-title">
            {{ enlarged.alt }}
          </h2><button
            type="button"
            class="secondary"
            autofocus
            @click="closePhoto"
          >
            Tutup Foto
          </button>
        </div>
        <img
          :src="enlarged.path"
          :alt="enlarged.alt"
          referrerpolicy="no-referrer"
        >
      </template>
    </dialog>
    <ActionDialog
      v-if="decision"
      :title="decision === 'APPROVE' ? 'Konfirmasi Persetujuan Risiko' : 'Konfirmasi Penolakan Pencucian'"
      description="Keputusan satu kali, tidak dapat dibatalkan melalui tautan ini. Pastikan sepatu dan risiko sudah diperiksa."
      :fields="[]"
      :submit="consent"
      @close="closeConsent"
    />
  </main>
</template>

<style scoped>
/* Isolated public presentation, including child dialogs; rem preserves text zoom. */
.tracking, .tracking :deep(*) { font-size: .875rem; line-height: 1.5; letter-spacing: normal; text-transform: none; }
.tracking h1 { font-size: 1.5rem; }
.tracking h2, .tracking h3, .tracking :deep(dialog h2), .tracking :deep(dialog h3) { font-size: 1.125rem; }
.tracking .summary-total dd { font-size: 1.75rem; }
.tracking { --brand: #1768ba; --ink: #182c49; --muted: #56677e; --line: #dce3ec; width: 100%; min-height: 100dvh; margin: 0; padding: 1rem max(1rem, calc((100% - 900px) / 2)); background: #f4f6fa; color: var(--ink); overflow-wrap: anywhere; line-height: 1.5; }
.tracking-header { display: flex; align-items: center; gap: 1rem; padding: .5rem 1rem; margin: 0 0 .5rem; border-bottom: 1px solid var(--line); background: #fff; color: #152b49; }
.tracking-brand { display: block; width: 96px; flex-shrink: 0; padding: 0; border: 0; border-radius: 0; background: transparent; }
.tracking-brand img { display: block; width: 100%; height: auto; object-fit: contain; }
.tracking .tracking-header h1 { margin: 0; letter-spacing: normal; }
.tracking .order-identity { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .75rem; margin-bottom: 1rem; }
.tracking .order-identity > div { min-width: 0; flex: 1 1 180px; }
.tracking .order-number { margin: 0 0 .35rem; font-size: 1.5rem; font-weight: 700; }
.tracking .panel.order-summary { display: grid; grid-template-columns: minmax(0, 1fr); min-width: 0; margin: 0 0 1rem; padding: 0; overflow: hidden; }
.tracking .order-summary > section { min-width: 0; padding: 1rem; }
.tracking .summary-info { background: #fff; }
.tracking .summary-payment { display: flex; flex-direction: column; background: #fff; border-top: 1px solid var(--line); }
.tracking .summary-total { margin: 0; }
.tracking .summary-total dt { color: var(--muted); }
.tracking .summary-total dd { margin: .15rem 0 0; font-weight: 750; font-variant-numeric: tabular-nums; }
.tracking .summary-heading, .tracking .payment-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem .75rem; margin-bottom: .75rem; }
.tracking .order-summary .summary-heading h2, .tracking .order-summary .payment-heading h2 { margin: 0; }
.tracking .service-snapshot { margin: .75rem 0; font-size: .9375rem; font-weight: 700; }
.tracking .order-badge, .tracking .payment-badge { margin-left: auto; font-weight: 700; }
.tracking .order-summary h2 { margin: 0 0 .75rem; }
.tracking .progress-counts { list-style: disc; padding-left: 1.25rem; margin: .25rem 0 .75rem; }
.tracking .progress-title { margin-top: .75rem; }
.tracking .customer-notes { margin-top: .75rem; }
.tracking .shoe-notes-list { list-style: disc; padding-left: 1.25rem; margin: .25rem 0; }
.tracking .customer-notes p { margin: .25rem 0; color: var(--muted); }
.tracking .customer-notes strong { color: var(--ink); }
.tracking .progress-counts li { color: var(--muted); font-weight: 400; }
.tracking .summary-eta { margin: .75rem 0; }
.tracking .order-summary h3 { margin: 0; font-size: .9375rem; }
.tracking .summary-note { margin: .4rem 0; }
.tracking .pickup-instructions { margin-top: .75rem; }
.tracking .pickup-instructions p { margin: .25rem 0 0; }
.tracking .online-note { margin: auto 0 0; padding-top: 1rem; text-align: right; font-size: .75rem; font-style: italic; }
.tracking .section-heading { align-items: flex-start; gap: .75rem; }
.tracking .section-heading > div { flex: 1 1 240px; min-width: 0; }
.tracking h1 { margin: .25rem 0; }
.tracking .eyebrow, .tracking .muted, .tracking time { color: var(--muted); }
.tracking .eyebrow { text-transform: none; letter-spacing: normal; }
.tracking .panel, .tracking > details { padding: 1rem; border: 1px solid var(--line); border-radius: .75rem; background: #fff; box-shadow: 0 1px 3px #182c4908; }
.tracking .badge { max-width: 100%; color: #214d7c; background: #edf4fd; border-color: #c9dbef; border-radius: .4rem; }
.tracking .notice { background: #fff8e7; border-color: #dfce9a; color: #70531a; }
.tracking .notice h3, .tracking .notice p { margin: 0; }
.tracking .notice .consent-intro { margin-top: 8px; }
.tracking .notice .records { margin: 12px 0 0; padding: 0; }
.tracking .notice .records > li { display: grid; gap: 12px; margin: 0; padding: 0; border: 0; }
.tracking .notice .records > li + li { margin-top: 12px; }
.tracking .notice .preserve { display: grid; gap: 4px; white-space: normal; }
.tracking .notice .preserve > span { white-space: pre-wrap; }
.tracking .notice .consent-footer { margin-top: 12px; padding-top: 12px; border-top: 1px solid #dfce9a; }
.tracking .notice .actions { margin: 12px 0 0; }
.tracking .success { background: #edf4fd; border-color: #c9dbef; color: #214d7c; }
.tracking button, .tracking :deep(dialog button) { min-height: 44px; max-width: 100%; white-space: normal; overflow-wrap: anywhere; background: var(--brand); border-radius: .4rem; }
.tracking button:hover:not(:disabled), .tracking :deep(dialog button:hover:not(:disabled)) { background: #105497; }
.tracking button.secondary, .tracking :deep(dialog button.secondary) { background: #fff; border-color: #a9b8cb; color: var(--ink); }
.tracking button.secondary:hover:not(:disabled), .tracking :deep(dialog button.secondary:hover:not(:disabled)) { background: #eaf0f7; }
.tracking button.danger { background: #fff; color: #a32626; border-color: #ddb2b2; }
.tracking button.danger:hover:not(:disabled) { background: #fff0ef; }
.tracking :deep(:focus-visible) { outline: 3px solid #087aa3; outline-offset: 3px; }
.tracking input:not([type=checkbox]), .tracking select { min-width: 0; max-width: 100%; border-color: #acbacd; color: var(--ink); }
.tracking input[type=checkbox] { flex-shrink: 0; accent-color: var(--brand); }
.tracking form > label:has(input[type=checkbox]) { display: flex; align-items: center; gap: .5rem; min-height: 44px; margin: .75rem 0; cursor: pointer; }
.tracking .price-snapshot, .tracking .completion { color: var(--muted); }
.tracking .price-snapshot p { margin: 0; }
.tracking .price-lines { list-style: disc; padding-left: 1.25rem; margin: .25rem 0 0; }
.tracking .completion { margin: .25rem 0; font-weight: 400; }
.tracking .summary-rows { margin: .75rem 0; }
.tracking .summary-rows > div { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, max-content); gap: .35rem .75rem; padding: .3rem 0; }
.tracking .summary-rows dt { color: var(--muted); }
.tracking .summary-rows dd { min-width: 0; margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
.tracking .summary-rows small { display: block; }
.tracking .summary-rows > .summary-balance { border-top: 1px solid var(--line); margin-top: .4rem; padding-top: .65rem; }
.tracking .summary-balance dd { font-weight: 700; }
.tracking .summary-rows small { font-weight: 400; }
.tracking .refund-due { color: #79520b; }
.tracking summary { min-height: 44px; color: #214d7c; }
.tracking article .section-heading { margin: 0 0 .5rem; }
.tracking article .section-heading > div { flex-basis: 180px; }
.tracking article h2, .tracking article .section-heading p { margin: .25rem 0; }
.tracking .shoe-photos, .tracking .shoe-history { border-top: 1px solid var(--line); }
.tracking .actions { align-items: stretch; }
.tracking .actions > button { flex: 1 1 180px; }
.tracking .shoe-content { display: grid; gap: 1rem; margin-top: 1rem; }
.tracking .shoe-content > section { min-width: 0; padding-top: 1rem; }
.tracking .shoe-content h3 { margin: 0; }
.tracking .photos { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem; margin: .75rem 0 0; }
.tracking .photos figure { min-width: 0; }
.tracking .photos button { display: block; width: 100%; padding: 0; border: 1px solid var(--line); overflow: hidden; background: #f4f7fb; }
.tracking .photos img { display: block; width: 100%; height: auto; aspect-ratio: 1; object-fit: contain; background: #f4f7fb; border: 0; border-radius: 0; }
.tracking .photos figcaption { margin-top: .4rem; color: var(--muted); text-align: center; }
.tracking .badge[data-tone=amber] { color: #79520b; background: #fff5db; border-color: #e8d39d; }
.tracking .badge[data-tone=green] { color: #176044; background: #eaf7ef; border-color: #b7dac5; }
.tracking .badge[data-tone=teal] { color: #075d64; background: #d9f3f2; border-color: #8accc9; }
.tracking .badge[data-tone=gray] { color: #4f6075; background: #f0f3f6; border-color: #cdd6e0; }
.tracking .badge[data-tone=red], .tracking .rejection { color: #9b3030; }
.tracking .badge[data-tone=red] { background: #fff0ef; border-color: #e8c2be; }
.tracking .timeline { border-color: var(--line); margin: .9rem .35rem 0; padding-left: 1rem; }
.tracking .timeline li { position: relative; margin: 0 0 1rem; }
.tracking .timeline li::before { content: ''; position: absolute; left: -1.4rem; top: .45rem; width: .65rem; height: .65rem; border-radius: 50%; background: #a9b8cb; border: 2px solid #fff; }
.tracking .timeline li.latest::before { background: var(--brand); box-shadow: 0 0 0 3px #dceafb; }
.tracking .timeline strong, .tracking .timeline time { display: block; }
.tracking .timeline time { white-space: normal; }
.tracking .photo-dialog { width: min(900px, calc(100% - 2rem)); }
.tracking .photo-dialog-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: .75rem; margin-bottom: 1rem; }
.tracking .photo-dialog-heading h2 { margin: 0; min-width: 0; }
.tracking .photo-dialog-heading button { flex-shrink: 0; }
.tracking .photo-dialog > img { display: block; width: 100%; max-height: 65dvh; object-fit: contain; }
@media (min-width: 768px) {
  .tracking .panel.order-summary { grid-template-columns: minmax(0, 55fr) minmax(0, 45fr); }
  .tracking .summary-payment { border-top: 0; border-left: 1px solid var(--line); }
  .tracking .shoe-content { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 1.5rem; }
  .tracking .photos { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
.tracking .records > li { border-color: #dfce9a; }
.tracking :deep(dialog) { color: var(--ink); border: 1px solid var(--line); padding: 1rem; overflow-wrap: anywhere; }
.tracking :deep(dialog::backdrop) { background: #152b49aa; }
.tracking :deep(dialog .muted) { color: var(--muted); }
@media (min-width: 600px) {
  .tracking { padding-top: 2rem; padding-bottom: 2rem; }
  .tracking-header { padding: .5rem 1.5rem; }
  .tracking .panel, .tracking .order-summary > section { padding: 1.5rem; }
}
</style>
