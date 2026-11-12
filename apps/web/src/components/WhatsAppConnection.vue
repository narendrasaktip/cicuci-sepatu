<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref } from 'vue';
import { ApiError, api } from '../services/auth';
import { whatsappReason } from '../services/domain';
const newPresentation = inject('newPresentation', ref(false));
type Status = { state: string; provider: string; ready: boolean; realSendEnabled: boolean; qrImage?: string; qrExpiresAt?: number; error?: string; lastCommand?: { command: string; status: string; error?: string } };
const status = ref<Status>(); const error = ref(''); const busy = ref(false); const risk = ref(false); const commandNotice = ref('');
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
  if (name === 'activate' && (!risk.value || !connected.value)) return;
  if (name === 'disconnect' && !window.confirm('Putuskan WhatsApp dan hapus sesi toko? Pengiriman dinonaktifkan. Anda perlu menautkan ulang dengan QR.')) return;
  busy.value = true; error.value = ''; commandNotice.value = '';
  try {
    await api(`/whatsapp/${name}`, 'POST', name === 'activate' ? { acknowledgeRisk: true } : {});
    commandNotice.value = 'Permintaan masuk antrean. Tunggu pembaruan status; belum berarti terhubung atau izin kirim berubah.';
    if (name === 'activate' || name === 'disconnect') risk.value = false;
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
    class="panel"
    aria-labelledby="wa-heading"
    :aria-busy="busy || loading"
  >
    <h2 id="wa-heading">
      {{ newPresentation ? 'WhatsApp Toko' : 'WhatsApp toko' }}
    </h2>
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
      <p role="status">
        <strong>{{ connection }}</strong>
      </p>
      <p role="status">
        {{ connected && status.realSendEnabled ? 'Pengiriman aktif untuk event baru dengan persetujuan pelanggan.' : 'Pengiriman nonaktif. Pesanan tetap dapat disimpan; pesan tidak dikirim.' }}
      </p>
      <p
        v-if="status.error"
        role="alert"
        class="notice"
      >
        {{ connectionReason(status.error) }}
      </p>
      <figure v-if="status.state === 'qr' && status.qrImage && (status.qrExpiresAt ?? 0) > Date.now()">
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
          Nonaktifkan pengiriman
        </button>
      </div>
      <template v-if="connected && !status.realSendEnabled">
        <p class="notice">
          Integrasi tidak resmi (whatsapp-web.js), bukan layanan resmi Meta. Akun dapat dibatasi atau diblokir; koneksi dapat terputus. Gunakan nomor khusus bisnis. Menautkan akun tidak mengaktifkan pengiriman.
        </p>
        <label class="check"><input
          v-model="risk"
          type="checkbox"
        >Saya memahami risiko dan mengizinkan pesan nyata untuk event baru dengan persetujuan pelanggan.</label>
        <button
          :disabled="busy || !risk"
          @click="command('activate')"
        >
          Aktifkan pengiriman
        </button>
      </template>
      <p>Pesan yang dilewati tidak dikirim ulang setelah aktivasi. Setelah worker dimulai ulang atau koneksi terputus, periksa status dan aktifkan kembali secara manual.</p>
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
      <details>
        <summary>Diagnostik dan pengelolaan sesi</summary>
        <p>Provider: {{ status.provider }} · Status: {{ status.state }} · Browser siap: {{ status.ready ? 'ya' : 'tidak' }} · Izin kirim: {{ status.realSendEnabled ? 'aktif' : 'nonaktif' }}</p>
        <p v-if="status.error">
          Kode: {{ status.error }}
        </p>
        <p v-if="status.lastCommand">
          Perintah: {{ status.lastCommand.command }} · {{ status.lastCommand.status }}
        </p>
        <p>QR dan sesi rahasia. SENT hanya berarti pengajuan ke browser, bukan bukti pesan diterima atau dibaca. Kegagalan ambigu perlu ditinjau manual; jangan langsung kirim ulang.</p>
        <button
          class="secondary"
          :disabled="busy || status.state === 'offline'"
          @click="command('disconnect')"
        >
          Putuskan dan hapus sesi
        </button>
      </details>
    </template>
    <button
      class="secondary"
      :disabled="busy"
      @click="refresh"
    >
      Periksa status WhatsApp
    </button>
  </section>
</template>
