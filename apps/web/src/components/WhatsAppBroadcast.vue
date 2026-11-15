<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { api, ApiError } from '../services/auth';
type Preview = { id: string; message: string; expiresAt: number; recipients: { id: string; name: string; whatsapp: string; message?: string }[] };
type Report = { id: string; recipients: { id: string; recipient: string; status: string; attempts: { attemptNo: number; status: string; response: unknown }[] }[] };
const message = ref(''); const preview = ref<Preview>(); const confirmed = ref(false); const busy = ref(false); const error = ref('');
const report = ref<Report>(); const campaigns = ref<{ id: string; createdAt: string }[]>([]);
const editor = ref<HTMLTextAreaElement>();
function insert(token: string, wrap = false) {
  const field = editor.value; if (!field || busy.value) return;
  const start = field.selectionStart; const end = field.selectionEnd;
  const replacement = wrap ? token + message.value.slice(start, end) + token : token;
  if (message.value.length - (end - start) + replacement.length > 4000) return;
  message.value = message.value.slice(0, start) + replacement + message.value.slice(end);
  void nextTick(() => { field.focus(); field.setSelectionRange(start + token.length, wrap ? end + token.length : start + token.length); });
}
const simulation = computed(() => message.value.replaceAll('{customer_name}', 'Dina'));
const statusSummary = computed(() => {
  const counts: Record<string, number> = {};
  for (const recipient of report.value?.recipients ?? []) counts[recipient.status] = (counts[recipient.status] ?? 0) + 1;
  return Object.entries(counts).map(([status, count]) => `${status}: ${count}`).join(' · ');
});
const dateLabel = (value: string) => new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }) + ' WIB';
let confirmKey = crypto.randomUUID();
watch(message, () => { preview.value = undefined; confirmed.value = false; });
async function run(action: () => Promise<void>) { busy.value = true; error.value = ''; try { await action(); } catch (e) { error.value = e instanceof Error ? e.message : 'Permintaan gagal.'; } finally { busy.value = false; } }
async function loadCampaigns() { campaigns.value = await api('/whatsapp-broadcasts'); }
onMounted(() => { void run(loadCampaigns); });
function prepare() { void run(async () => { preview.value = await api('/whatsapp-broadcasts/preview', 'POST', { message: message.value, scope: 'SERVICE_INFORMATION' }); confirmed.value = false; confirmKey = crypto.randomUUID(); }); }
function send() { void run(async () => {
  if (!preview.value || !confirmed.value || preview.value.recipients.some(r => typeof r.message !== 'string')) return;
  let result: { id: string };
  try { result = await api<{ id: string }>('/whatsapp-broadcasts/confirm', 'POST', { previewId: preview.value.id, confirmed: true, serviceOnly: true }, false, confirmKey); }
  catch (e) {
    if (e instanceof ApiError && e.code === 'NOT_ENABLED') throw new Error('Pesan belum diantrekan. Izin pengiriman belum aktif; buka Koneksi > Izin Pengiriman. (NOT_ENABLED)');
    throw e;
  }
  preview.value = undefined; confirmed.value = false;
  report.value = await api(`/whatsapp-broadcasts/${result.id}`); await loadCampaigns();
}); }
function refresh(id: string) { void run(async () => { report.value = await api(`/whatsapp-broadcasts/${id}`); }); }
</script>

<template>
  <section
    class="broadcast-panel panel"
    aria-label="Pesan Custom"
  >
    <h2>Pesan Custom</h2>
    <p>Satu pesan, dikirim sebagai chat pribadi satu per satu ke pelanggan berizin melalui antrean WhatsApp.</p>
    <p class="service-warning">
      Izin tersimpan hanya untuk informasi layanan, bukan promosi. Promosi memerlukan izin terpisah.
    </p>
    <details class="terms">
      <summary>Ketentuan dan kesiapan pengiriman</summary>
      <p>Maksimal 500 penerima; pratinjau berlaku 10 menit. Izin dan nomor diperiksa lagi sebelum antrean dan pengiriman.</p>
      <p>Pratinjau belum mengirim pesan dan tersedia tanpa koneksi atau izin pengiriman aktif. Konfirmasi antrean memerlukan izin pengiriman Owner dan worker WhatsApp terhubung yang mendukung Pesan Custom.</p>
    </details>
    <p
      v-if="error"
      role="alert"
    >
      {{ error }}
    </p>
    <div class="composer">
      <form @submit.prevent="prepare">
        <label for="broadcast-message">Pesan informasi layanan</label>
        <div
          class="toolbar"
          role="group"
          aria-label="Format pesan"
        >
          <button
            type="button"
            class="outline"
            aria-label="Tebal"
            :disabled="busy"
            @click="insert('*', true)"
          >
            <strong>B</strong>
          </button>
          <button
            type="button"
            class="outline"
            aria-label="Miring"
            :disabled="busy"
            @click="insert('_', true)"
          >
            <em>I</em>
          </button>
          <button
            type="button"
            class="outline"
            aria-label="Coret"
            :disabled="busy"
            @click="insert('~', true)"
          >
            <s>S</s>
          </button>
          <button
            type="button"
            class="outline"
            aria-label="Monospace"
            :disabled="busy"
            @click="insert('```', true)"
          >
            Monospace
          </button>
          <button
            type="button"
            class="outline"
            :disabled="busy"
            @click="insert('{customer_name}')"
          >
            Sisipkan nama pelanggan
          </button>
        </div>
        <textarea
          id="broadcast-message"
          ref="editor"
          v-model="message"
          required
          maxlength="4000"
          rows="8"
          aria-describedby="broadcast-count broadcast-help"
          :disabled="busy"
        />
        <small
          id="broadcast-count"
          class="character-count"
        >{{ message.length }}/4000 karakter</small>
        <small id="broadcast-help">Format membungkus teks terpilih atau disisipkan di kursor. Hanya {customer_name} didukung; data pesanan tidak tersedia.</small>
        <button
          :disabled="busy || !message.trim()"
          type="submit"
        >
          Pratinjau Penerima
        </button>
      </form>
      <section
        class="simulation"
        aria-label="Simulasi chat"
      >
        <h3>Simulasi chat · bukan pesan terkirim</h3>
        <small>Contoh nama: Dina. Teks biasa; WhatsApp menentukan tampilan format akhirnya. Penerima sebenarnya diperiksa melalui Pratinjau Penerima.</small>
        <div class="chat-surface">
          <p
            v-if="message"
            class="chat-bubble"
          >
            {{ simulation }}
          </p>
          <p
            v-else
            class="empty-state"
          >
            Tulis pesan untuk melihat simulasi di sini.
          </p>
        </div>
      </section>
    </div>
    <section
      v-if="preview"
      aria-label="Pratinjau Pesan Custom"
    >
      <h3>{{ preview.recipients.length }} penerima berizin</h3>
      <p>Isi berikut adalah pesan sebenarnya untuk setiap penerima, bukan simulasi format WhatsApp. Nama dibekukan saat pratinjau.</p>
      <p
        v-if="preview.recipients.some(r => typeof r.message !== 'string')"
        role="alert"
      >
        API belum mendukung pratinjau personalisasi. Konfirmasi dinonaktifkan sampai API diperbarui.
      </p>
      <ul class="broadcast-recipients">
        <li
          v-for="recipient in preview.recipients"
          :key="recipient.id"
        >
          {{ recipient.name }} · {{ recipient.whatsapp }}
          <pre v-if="recipient.message !== undefined">{{ recipient.message }}</pre>
        </li>
      </ul>
      <label><input
        v-model="confirmed"
        type="checkbox"
        :disabled="busy"
      > Pesan dan penerima sudah saya periksa. Pesan Custom ini informasi layanan, bukan promosi. Saya setuju mengirim chat pribadi ke setiap penerima.</label>
      <button
        :disabled="busy || !confirmed || preview.recipients.some(r => typeof r.message !== 'string')"
        type="button"
        @click="send"
      >
        Konfirmasi dan Antrekan Pesan Custom
      </button>
    </section>
    <div class="section-heading">
      <h3>Riwayat Pesan Custom</h3>
      <button
        class="outline"
        :disabled="busy"
        type="button"
        @click="run(loadCampaigns)"
      >
        Muat Ulang Riwayat
      </button>
    </div>
    <p
      v-if="!campaigns.length"
      class="empty-state"
    >
      Belum ada riwayat Pesan Custom.
    </p>
    <ul
      v-else
      class="campaign-list"
    >
      <li
        v-for="campaign in campaigns"
        :key="campaign.id"
      >
        <div class="section-heading">
          <time :datetime="campaign.createdAt">{{ dateLabel(campaign.createdAt) }}</time>
          <button
            class="outline"
            type="button"
            :disabled="busy"
            @click="refresh(campaign.id)"
          >
            Lihat laporan
          </button>
        </div>
        <details><summary>Detail riwayat</summary>ID: {{ campaign.id }}</details>
      </li>
    </ul>
    <section
      v-if="report"
      aria-label="Laporan Pesan Custom"
    >
      <h3>Laporan Pesan Custom</h3>
      <p>{{ report.recipients.length }} penerima<span v-if="statusSummary"> · {{ statusSummary }}</span></p>
      <details><summary>Detail laporan</summary>ID: {{ report.id }}</details>
      <p>SENT berarti diajukan ke browser, bukan bukti diterima atau dibaca. Kegagalan ambigu tidak dicoba ulang otomatis. PROCESSING yang menetap perlu diperiksa; jangan antrekan pesan pengganti sebelum hasil dipastikan.</p>
      <button
        class="outline"
        :disabled="busy"
        type="button"
        @click="refresh(report.id)"
      >
        Perbarui Laporan
      </button>
      <ul>
        <li
          v-for="recipient in report.recipients"
          :key="recipient.id"
        >
          {{ recipient.recipient }} · {{ recipient.status }} · {{ recipient.attempts.length }} percobaan<details><summary>Detail percobaan</summary><pre>{{ JSON.stringify(recipient.attempts, null, 2) }}</pre></details>
        </li>
      </ul>
    </section>
  </section>
</template>

<style scoped>
.broadcast-panel { display: grid; gap: .75rem; min-width: 0; }
.broadcast-panel :is(h2, h3, p, ul) { margin: 0; }
.broadcast-panel :is(form, section, details, li) { min-width: 0; }
form { display: grid; gap: .5rem; align-content: start; }
textarea { width: 100%; box-sizing: border-box; font: inherit; resize: vertical; }
pre, .chat-bubble { white-space: pre-wrap; overflow-wrap: anywhere; }
.broadcast-recipients { max-height: 24rem; overflow-y: auto; padding-left: 1.25rem; }
.broadcast-panel :is(li, button, details) { overflow-wrap: anywhere; }
.composer { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 1rem; }
.toolbar, .section-heading { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; }
.section-heading { justify-content: space-between; }
.broadcast-panel button { margin: 0; min-height: 44px; }
.broadcast-panel button.outline { background: transparent; color: #214d7c; border: 1px solid #acbacd; padding: .4rem .65rem; }
.broadcast-panel button.outline:hover:not(:disabled) { background: #eaf2fd; }
.broadcast-panel :is(button, summary):focus-visible { outline: 2px solid #135fa9; outline-offset: 2px; }
summary { cursor: pointer; }
small, .empty-state { color: #526176; }
.character-count { text-align: right; }
.service-warning { border-left: 3px solid #ad6a12; padding: .5rem .75rem; background: #fff7e8; color: #73470d; }
.terms { font-size: .875rem; }
.terms p { padding-top: .5rem; }
.simulation { display: grid; gap: .5rem; align-content: start; }
.chat-surface { min-height: 12rem; padding: 1rem; background: #edf2ee; border-radius: .5rem; }
.chat-bubble { padding: .75rem; background: #dcf8c6; border: 1px solid #bbd6a7; border-radius: .5rem .5rem 0 .5rem; color: #203323; }
.campaign-list { list-style: none; padding: 0; display: grid; gap: .5rem; }
.campaign-list li { border: 1px solid #d5dbe3; border-radius: .5rem; padding: .65rem; }
@media (max-width: 800px) { .composer { grid-template-columns: minmax(0, 1fr); } }
</style>
