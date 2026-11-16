<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref } from 'vue';
import { ApiError, api } from '../services/auth';
import { whatsappReason } from '../services/domain';
const newPresentation = inject('newPresentation', ref(false));
type Status = { state: string; provider: string; ready: boolean; realSendEnabled: boolean; qrImage?: string; qrExpiresAt?: number; error?: string; lastCommand?: { command: string; status: string; error?: string } };
const status = ref<Status>(); const error = ref(''); const busy = ref(false); const commandNotice = ref('');
const loading = ref(true);
let timer: ReturnType<typeof setTimeout> | undefined; let disposed = false; let request = 0;
const connected = computed(() => status.value?.state === 'ready' && status.value.ready);
function connectionReason(code: string) {
  const reasons: Record<string, string> = {
    BROWSER_PROFILE_LOCKED: 'Sesi browser sedang dipakai proses lain. Minta pengelola memeriksa proses; jangan hapus sesi secara paksa.',
    BROWSER_PERMISSION_DENIED: 'Browser tidak memiliki izin akses. Minta pengelola memeriksa izin browser dan penyimpanan sesi.',
    BROWSER_NOT_FOUND: 'Browser tidak ditemukan. Minta pengelola memeriksa pemasangan dan konfigurasi browser.',
    BROWSER_SANDBOX_FAILED: 'Perlindungan sandbox browser gagal. Minta pengelola memperbaiki lingkungan; jangan nonaktifkan perlindungan.',
    WHATSAPP_NETWORK_FAILED: 'Jaringan WhatsApp bermasalah. Minta pengelola memeriksa koneksi, proxy dan sertifikat.',
    INITIALIZATION_TIMEOUT: 'Penyiapan koneksi melewati batas waktu. Periksa jaringan dan worker sebelum menghubungkan kembali.',
    BROWSER_LAUNCH_FAILED: 'Browser gagal berjalan atau tertutup. Minta pengelola memeriksa browser dan worker.',
    INVALID_COMMAND: 'Perintah tidak dikenali. Muat ulang halaman sebelum mencoba kembali.',
    FORBIDDEN: 'Perintah tidak diizinkan. Gunakan akun pemilik yang berwenang.',
  };
  return reasons[code] ?? whatsappReason(code);
}
const connection = computed(() => ({ offline: 'Worker tidak tersedia. Minta pengelola memeriksa worker, lalu periksa status.', stopped: 'Belum terhubung. Tekan Hubungkan WhatsApp untuk memulai.', starting: 'Menyiapkan koneksi. Tunggu QR atau status berikutnya.', qr: 'Pindai QR melalui WhatsApp ponsel toko.', authenticated: 'Akun tertaut. Menunggu koneksi siap; belum dapat mengirim.', ready: connected.value ? 'WhatsApp terhubung.' : 'Koneksi belum siap. Periksa status kembali.', disconnected: 'Koneksi terputus. Hubungkan kembali; pengiriman perlu diaktifkan ulang.', error: 'Koneksi bermasalah. Periksa penjelasan di bawah.' })[status.value?.state ?? ''] ?? 'Status koneksi belum dikenali. Periksa diagnostik; jangan anggap terhubung.');
const commandResult = computed(() => {
  const last = status.value?.lastCommand;
  if (!last) return '';
  if (last.status === 'completed') return 'Perintah selesai diproses. Koneksi dan izin kirim mengikuti status di atas, bukan hasil perintah.';
  if (last.status.startsWith('failed')) return `Perintah gagal. ${last.error ? connectionReason(last.error) : 'Periksa koneksi dan diagnostik sebelum mencoba tindakan baru.'}`;
  return 'Perintah belum selesai. Tunggu pembaruan status.';
});
async function refresh() {
  const current = ++request; loading.value = true;
  try { const result = await api<Status>('/whatsapp/status'); if (!disposed && current === request) { status.value = result; error.value = ''; } }
  catch (e) { if (!disposed && current === request) { status.value = undefined; error.value = e instanceof Error ? e.message : 'Status tidak tersedia. Periksa jaringan lalu coba lagi.'; } }
  finally { if (!disposed && current === request) loading.value = false; }
}
async function command(name: string) {
  if (name === 'activate' && !connected.value) return;
  if (name === 'activate' && !window.confirm('Aktifkan pengiriman WhatsApp nyata untuk event baru dengan persetujuan pelanggan? Risiko pembatasan akun tetap ada.')) return;
  if (name === 'disconnect' && !window.confirm('Putuskan WhatsApp dan hapus sesi toko? Pengiriman dinonaktifkan. Anda perlu menautkan ulang dengan QR.')) return;
  busy.value = true; error.value = ''; commandNotice.value = '';
  try {
    await api(`/whatsapp/${name}`, 'POST', name === 'activate' ? { acknowledgeRisk: true } : {});
    commandNotice.value = 'Permintaan masuk antrean. Tunggu pembaruan status; belum berarti terhubung atau izin kirim berubah.';
    await refresh();
  } catch (e) { error.value = e instanceof ApiError ? connectionReason(e.code) : e instanceof Error ? e.message : 'Perintah gagal. Periksa status sebelum mencoba lagi.'; }
  finally { busy.value = false; }
}
async function poll() { await refresh(); if (!disposed) timer = setTimeout(() => { void poll(); }, 2000); }
onMounted(() => { void poll(); });
onUnmounted(() => { disposed = true; clearTimeout(timer); status.value = undefined; });
</script>
<template>
  <section
    class="panel wa-panel"
    aria-labelledby="wa-heading"
    :aria-busy="busy || loading"
  >
    <header class="wa-header">
      <div>
        <h2 id="wa-heading">
          {{ newPresentation ? 'WhatsApp Toko' : 'WhatsApp toko' }}
        </h2>
        <p>Pantau koneksi perangkat dan izin pengiriman pesan pelanggan.</p>
      </div>
      <button
        class="secondary"
        :disabled="busy"
        @click="refresh"
      >
        Periksa Status WhatsApp
      </button>
    </header>
    <p
      v-if="error"
      role="alert"
      class="error"
    >
      {{ error }}
    </p>
    <p
      v-if="!status && loading"
      role="status"
    >
      Memeriksa status WhatsApp…
    </p>
    <p
      v-else-if="!status"
      role="status"
    >
      Status WhatsApp belum tersedia. Jangan anggap terputus atau terhubung; periksa kembali.
    </p>
    <template v-if="status">
      <div class="wa-status-grid">
        <article
          class="wa-status-card"
          :class="connected ? 'wa-good' : 'wa-attention'"
        >
          <div class="wa-card-heading">
            <span
              class="wa-icon"
              aria-hidden="true"
            >◉</span><strong>Koneksi Perangkat</strong>
          </div>
          <p
            class="wa-card-value"
            role="status"
          >
            {{ connection }}
          </p>
          <p class="wa-card-help">
            Koneksi perangkat terpisah dari izin pengiriman.
          </p>
        </article>
        <article
          class="wa-status-card"
          :class="typeof status.realSendEnabled !== 'boolean' ? 'wa-unknown' : status.realSendEnabled ? 'wa-good' : 'wa-attention'"
        >
          <div class="wa-card-heading">
            <span
              class="wa-icon"
              aria-hidden="true"
            >✉</span><strong>Izin Pengiriman</strong>
          </div>
          <p
            class="wa-card-value"
            role="status"
          >
            {{ typeof status.realSendEnabled !== 'boolean' ? 'Tidak diketahui. Periksa status kembali.' : status.realSendEnabled ? 'Pengiriman aktif untuk event baru dengan persetujuan pelanggan; koneksi tetap harus siap.' : 'Pengiriman nonaktif. Pesanan tetap dapat disimpan; pesan tidak dikirim.' }}
          </p>
          <p class="wa-card-help">
            Hanya berlaku untuk event baru dengan persetujuan pelanggan.
          </p>
        </article>
      </div>
      <p
        v-if="loading"
        class="wa-updating"
        role="status"
      >
        Memperbarui status; informasi di atas mungkin sudah berubah.
      </p>
      <p
        v-if="status.error"
        role="alert"
        class="notice"
      >
        {{ connectionReason(status.error) }}
      </p>
      <figure
        v-if="status.state === 'qr' && status.qrImage && (status.qrExpiresAt ?? 0) > Date.now()"
        class="wa-qr"
      >
        <img
          :src="status.qrImage"
          alt="QR rahasia untuk menautkan akun WhatsApp toko"
          width="300"
          height="300"
        >
        <figcaption>WhatsApp ponsel: Perangkat tertaut → Tautkan perangkat. Jangan bagikan QR. Jika kedaluwarsa, tunggu pembaruan QR.</figcaption>
      </figure>
      <div class="actions">
        <button
          v-if="!connected"
          :disabled="busy || ['offline', 'starting', 'qr', 'authenticated'].includes(status.state)"
          @click="command('start')"
        >
          Hubungkan WhatsApp
        </button>
        <button
          v-if="status.realSendEnabled"
          class="secondary"
          :disabled="busy"
          @click="command('deactivate')"
        >
          Nonaktifkan Pengiriman
        </button>
      </div>
      <template v-if="connected && status.realSendEnabled === false">
        <p class="notice">
          Integrasi tidak resmi (whatsapp-web.js), bukan layanan resmi Meta. Akun dapat dibatasi atau diblokir; koneksi dapat terputus. Gunakan nomor khusus bisnis. Menautkan akun tidak mengaktifkan pengiriman.
        </p>
        <button
          :disabled="busy"
          @click="command('activate')"
        >
          Aktifkan Pengiriman
        </button>
      </template>
      <p class="wa-reminder">
        <strong>Perlu Diketahui</strong><br>Pesan yang dilewati tidak dikirim ulang setelah aktivasi. Setelah worker dimulai ulang atau koneksi terputus, periksa status dan aktifkan kembali secara manual.
      </p>
      <p
        v-if="commandNotice"
        role="status"
        class="notice"
      >
        {{ commandNotice }}
      </p>
      <p
        v-if="commandResult"
        role="status"
      >
        {{ commandResult }}
      </p>
      <section
        class="wa-diagnostics"
        aria-labelledby="wa-diagnostics-heading"
      >
        <h3 id="wa-diagnostics-heading">
          Diagnostik dan Pengelolaan Sesi
        </h3>
        <p>Provider: {{ status.provider || 'tidak diketahui' }} · Status: {{ status.state || 'tidak diketahui' }} · Browser siap: {{ typeof status.ready !== 'boolean' ? 'tidak diketahui' : status.ready ? 'ya' : 'tidak' }} · Izin kirim: {{ typeof status.realSendEnabled !== 'boolean' ? 'tidak diketahui' : status.realSendEnabled ? 'aktif' : 'nonaktif' }}</p>
        <p v-if="status.error">
          Kode: {{ status.error }}
        </p>
        <p v-if="status.lastCommand">
          Perintah: {{ status.lastCommand.command }} · {{ status.lastCommand.status }}
        </p>
        <p>QR dan sesi rahasia. SENT hanya berarti pengajuan ke browser, bukan bukti pesan diterima atau dibaca. Kegagalan ambigu perlu ditinjau manual; jangan langsung kirim ulang.</p>
        <button
          class="danger"
          :disabled="busy || status.state === 'offline'"
          @click="command('disconnect')"
        >
          Putuskan dan Hapus Sesi
        </button>
      </section>
    </template>
  </section>
</template>

<style scoped>
.wa-panel { color: #203750; }
.wa-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding-bottom: 1.25rem; border-bottom: 1px solid #dce6ed; }
.wa-header h2 { margin: .25rem 0; }
.wa-header p { margin: 0; color: #607386; font-size: .9rem; }
.wa-status-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; margin: 1.25rem 0; }
.wa-status-card { min-width: 0; padding: 1.15rem; border: 1px solid #dce6ed; border-radius: .8rem; background: #f8fafc; }
.wa-card-heading { display: flex; align-items: center; gap: .65rem; font-size: .86rem; }
.wa-icon { display: grid; place-items: center; width: 2.2rem; height: 2.2rem; border-radius: .65rem; background: #e8eef3; color: #536c7c; font-size: 1.1rem; }
.wa-good .wa-icon { background: #dcf3e8; color: #187750; }
.wa-attention .wa-icon { background: #fff0d7; color: #98631b; }
.wa-status-card .wa-card-value { margin: .9rem 0 .35rem; padding: 0; color: #203750; font-weight: 700; line-height: 1.45; }
.wa-card-help { margin: 0; color: #647789; font-size: .82rem; line-height: 1.5; }
.wa-updating { font-size: .8rem; }
.wa-reminder { padding: 1rem 1.1rem; border-left: 3px solid #8aafc0; background: #f1f7f9; border-radius: .4rem; font-size: .88rem; line-height: 1.55; }
.wa-qr { display: flex; align-items: center; flex-wrap: wrap; gap: 1rem; margin: 1rem 0; padding: 1rem; border: 1px solid #dce6ed; border-radius: .8rem; }
.wa-qr img { max-width: min(100%, 300px); height: auto; }
.wa-qr figcaption { flex: 1 1 200px; font-size: .88rem; }
.wa-diagnostics { margin-top: 1.25rem; padding: 1rem; border: 1px solid #e8c4c4; border-radius: .7rem; background: #fff8f8; overflow-wrap: anywhere; }
.wa-diagnostics h3 { margin: 0 0 .75rem; color: #9c2525; font-size: 1rem; }
.wa-diagnostics p { font-size: .86rem; line-height: 1.5; }
/* ponytail: scoped dashboard typography; replace with shared tokens when available. */
.wa-panel { font-size: .875rem; line-height: 1.5; }
.wa-panel .wa-header h2 { font-size: 1.125rem; }
.wa-panel :is(button, .wa-header p, .wa-card-heading, .wa-card-value, .wa-reminder, .wa-qr figcaption) { font-size: .875rem; }
.wa-panel :is(.wa-card-help, .wa-updating, .wa-diagnostics p) { font-size: .8125rem; }
@media (max-width: 600px) {
  .wa-header { align-items: stretch; flex-direction: column; }
  .wa-status-grid { grid-template-columns: 1fr; }
  .wa-header button { width: 100%; }
}
</style>
