<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { api, ApiError } from '../services/auth';
import { useUnsavedChanges } from '../services/unsaved';
type Preview = { id: string; message: string; expiresAt: number; recipients: { id: string; name: string; whatsapp: string; message?: string }[] };
type Report = { id: string; recipients: { id: string; recipient: string; status: string; attempts: { attemptNo: number; status: string; response: unknown }[] }[] };
const message = ref(''); const preview = ref<Preview>(); const confirmed = ref(false); const busy = ref(false); const error = ref('');
const report = ref<Report>(); const campaigns = ref<{ id: string; createdAt: string }[]>([]);
const editor = ref<HTMLTextAreaElement>();
const sentMessage = ref('');
useUnsavedChanges(computed(() => !!message.value.trim() && message.value !== sentMessage.value));
function insert(token: string, wrap = false) {
  const field = editor.value; if (!field || busy.value) return;
  const start = field.selectionStart; const end = field.selectionEnd;
  const replacement = wrap ? token + message.value.slice(start, end) + token : token;
  if (message.value.length - (end - start) + replacement.length > 4000) return;
  message.value = message.value.slice(0, start) + replacement + message.value.slice(end);
  void nextTick(() => { field.focus(); field.setSelectionRange(start + token.length, wrap ? end + token.length : start + token.length); });
}
const simulation = computed(() => message.value.replaceAll('{customer_name}', 'Dina'));
function formatChat(text: string): string {
  const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
  // ponytail: Format toolbar saja; tambah parser lengkap saat mendukung format WhatsApp lain.
  const pattern = /```([\s\S]+?)```|\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~/g;
  let html = ''; let end = 0;
  for (const match of text.matchAll(pattern)) {
    html += escape(text.slice(end, match.index));
    const tag = match[1] !== undefined ? 'code' : match[2] !== undefined ? 'strong' : match[3] !== undefined ? 'em' : 's';
    const content = match[1] ?? match[2] ?? match[3] ?? match[4]!;
    html += `<${tag}>${tag === 'code' ? escape(content) : formatChat(content)}</${tag}>`;
    end = match.index + match[0].length;
  }
  return html + escape(text.slice(end));
}
const simulationHtml = computed(() => formatChat(simulation.value));
const statusSummary = computed(() => {
  const counts: Record<string, number> = {};
  for (const recipient of report.value?.recipients ?? []) counts[recipient.status] = (counts[recipient.status] ?? 0) + 1;
  return Object.entries(counts).map(([status, count]) => ({ status, count }));
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
  sentMessage.value = message.value; preview.value = undefined; confirmed.value = false;
  report.value = await api(`/whatsapp-broadcasts/${result.id}`); await loadCampaigns();
}); }
function refresh(id: string) { void run(async () => { report.value = await api(`/whatsapp-broadcasts/${id}`); }); }
</script>

<template>
  <section
    class="broadcast-panel panel"
    aria-label="Pesan Custom"
  >
    <div class="broadcast-heading">
      <div>
        <p class="broadcast-kicker">
          WHATSAPP PELANGGAN
        </p><h2>Pesan Custom</h2>
        <p>Kirim informasi layanan sebagai chat pribadi ke pelanggan yang sudah memberi izin.</p>
      </div>
      <span class="service-badge">Informasi Layanan</span>
    </div>
    <p class="service-warning">
      Izin tersimpan hanya untuk informasi layanan, bukan promosi. Promosi memerlukan izin terpisah.
    </p>
    <p
      v-if="error"
      role="alert"
    >
      {{ error }}
    </p>
    <div class="composer">
      <form @submit.prevent="prepare">
        <div class="editor-heading">
          <span class="step-tag">01</span><div><h3>Susun Pesan</h3><p>Mulai dari sapaan, lalu informasi yang ingin disampaikan.</p></div>
        </div>
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
          placeholder="Halo {customer_name}, ada informasi terbaru dari Cicuci Sepatu…"
          aria-describedby="broadcast-count broadcast-help"
          :disabled="busy"
        />
        <small
          id="broadcast-count"
          class="character-count"
        >{{ message.length }}/4000 karakter</small>
        <small id="broadcast-help">Nama pelanggan diisi otomatis lewat {customer_name}. Pilih teks untuk menerapkan format.</small>
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
        <div class="simulation-heading">
          <span
            class="chat-avatar"
            aria-hidden="true"
          >D</span><div><h3>Dina</h3><small>Contoh pelanggan · simulasi chat</small></div><span class="preview-badge">Preview</span>
        </div>
        <div class="chat-surface">
          <!-- formatChat escapes all text before adding fixed formatting tags. -->
          <!-- eslint-disable vue/no-v-html -->
          <p
            v-if="message"
            class="chat-bubble"
            v-html="simulationHtml"
          />
          <!-- eslint-enable vue/no-v-html -->
          <p
            v-else
            class="empty-state"
          >
            Tulis pesan untuk melihat simulasi di sini.
          </p>
        </div>
        <small class="simulation-note">Belum ada pesan terkirim. Format akhir mengikuti WhatsApp; penerima asli diperiksa di langkah berikutnya.</small>
      </section>
    </div>
    <details class="terms">
      <summary>Ketentuan dan kesiapan pengiriman</summary>
      <p>Maksimal 500 penerima; pratinjau berlaku 10 menit. Izin dan nomor diperiksa lagi sebelum antrean dan pengiriman. Hanya {customer_name} didukung; data pesanan tidak tersedia.</p>
      <p>Pratinjau belum mengirim pesan dan tersedia tanpa koneksi atau izin pengiriman aktif. Konfirmasi antrean memerlukan izin pengiriman Owner dan worker WhatsApp terhubung yang mendukung Pesan Custom.</p>
    </details>
    <section
      v-if="preview"
      class="preview-panel"
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
      <label class="send-confirmation"><input
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
    <div class="section-heading history-heading">
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
        :class="{ 'campaign-active': report?.id === campaign.id }"
      >
        <div class="section-heading">
          <div class="campaign-identity">
            <span
              class="campaign-icon"
              aria-hidden="true"
            ><svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linejoin="round"
            ><path d="m21 3-7 18-4-7-7-4 18-7ZM10 14 21 3" /></svg></span><div>
              <p class="campaign-title">
                Pengiriman Pesan Custom
              </p><time :datetime="campaign.createdAt">{{ dateLabel(campaign.createdAt) }}</time>
            </div>
          </div>
          <button
            class="outline"
            type="button"
            :disabled="busy"
            :aria-pressed="report?.id === campaign.id"
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
      class="report-panel"
      aria-label="Laporan Pesan Custom"
    >
      <div class="section-heading report-heading">
        <div><h3>Laporan Pesan Custom</h3><p>{{ report.recipients.length }} penerima dalam pengiriman ini</p></div>
        <button
          class="outline"
          :disabled="busy"
          type="button"
          @click="refresh(report.id)"
        >
          Perbarui Laporan
        </button>
      </div>
      <div class="report-stats">
        <div
          v-for="item in statusSummary"
          :key="item.status"
          class="report-stat"
        >
          <span>{{ item.status }}</span><strong>{{ item.count }}</strong>
        </div>
      </div>
      <details><summary>Detail laporan</summary>ID: {{ report.id }}</details>
      <p class="report-notice">
        SENT berarti diajukan ke browser, bukan bukti diterima atau dibaca. Kegagalan ambigu tidak dicoba ulang otomatis. PROCESSING yang menetap perlu diperiksa; jangan antrekan pesan pengganti sebelum hasil dipastikan.
      </p>
      <ul class="recipient-report">
        <li
          v-for="recipient in report.recipients"
          :key="recipient.id"
        >
          <div class="recipient-heading">
            <div>
              <p class="recipient-number">
                {{ recipient.recipient }}
              </p><small>{{ recipient.attempts.length }} percobaan</small>
            </div><span
              class="recipient-status"
              :data-status="recipient.status"
            >{{ recipient.status }}</span>
          </div><details><summary>Detail percobaan</summary><pre>{{ JSON.stringify(recipient.attempts, null, 2) }}</pre></details>
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
.broadcast-panel{gap:1rem;color:#253f5c}.broadcast-panel h2{font-size:20px;font-weight:650}.broadcast-panel h3{font-size:15px;font-weight:600;line-height:1.5}.broadcast-panel p{font-size:14px;line-height:1.7}.broadcast-panel small{font-size:12px;line-height:1.65}.service-warning{padding:12px 16px;border-radius:10px;font-size:13px!important}.terms{padding:12px 16px;border:1px solid #e0e8f1;border-radius:12px;background:#f8fafd}.terms summary{min-height:24px;color:#52677e}.composer{gap:20px;margin-top:4px;align-items:stretch}.composer form,.simulation{padding:20px;border:1px solid #dce6f0;border-radius:16px;background:#fff;gap:12px}.composer label{font-size:14px;font-weight:600}.toolbar{padding:8px;border:1px solid #e1e9f2;border-radius:10px;background:#f5f8fc;gap:6px}.broadcast-panel .toolbar button{border-color:transparent;background:#fff;border-radius:8px;font-size:12px;padding:8px 10px;min-width:44px}.toolbar button:last-child{color:#23659c;border-color:#d5e5f5}.composer textarea{min-height:220px;padding:14px;border:1px solid #bdcfe1;border-radius:12px;color:#253f5c;background:#fbfdff;font-size:14px;line-height:1.75}.composer textarea:focus-visible{outline:2px solid #4791cd;outline-offset:2px}.character-count{margin-top:-6px}.broadcast-panel button{border-radius:10px;font-size:13px;font-weight:500}.composer form>button{margin-top:4px}.simulation{background:#f8fbff;grid-template-rows:auto auto 1fr}.chat-surface{min-height:220px;border:1px solid #dce8e3;border-radius:12px;background:linear-gradient(140deg,#eff5f1,#e5eeea);padding:18px;display:flex;flex-direction:column;align-items:flex-end}.chat-bubble{max-width:100%;padding:14px 16px;background:#e1f5d8;border-color:#cce4c1;border-radius:12px 12px 3px 12px;box-shadow:0 2px 5px #20332308}.chat-surface .empty-state{margin:auto;text-align:center;font-size:13px;color:#61776b}.history-heading{margin-top:12px;padding-top:24px;border-top:1px solid #e3eaf2;gap:12px}.broadcast-panel>.empty-state{padding:28px 16px;border:1px dashed #cddce9;border-radius:12px;background:#f8fbff;text-align:center}.campaign-list{gap:10px}.campaign-list li{padding:16px;border-color:#dce6f0;border-radius:12px}.campaign-list time{font-size:13px;color:#52677e}.campaign-list details{margin-top:10px;font-size:12px;color:#61758b}.preview-panel,.report-panel{display:grid;gap:14px;padding:20px;border:1px solid #d5e4f3;border-radius:16px;background:#f8fbff}.broadcast-recipients{padding:0;list-style:none;display:grid;gap:10px}.broadcast-recipients li{padding:14px;background:#fff;border:1px solid #e0e8f1;border-radius:10px;font-size:13px}.broadcast-panel pre{font:inherit;font-size:13px;line-height:1.7}.send-confirmation{display:flex;align-items:flex-start;gap:10px;padding:14px;border:1px solid #dce6f0;border-radius:10px;background:white;font-size:13px;line-height:1.7}.send-confirmation input{flex-shrink:0;width:20px;height:20px;margin:2px 0 0}.broadcast-panel [role=alert]{padding:12px 16px;border-radius:10px;background:#fff3f2;color:#9b3731}.report-panel>ul{padding-left:20px;font-size:13px;line-height:1.7}
.broadcast-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding-bottom:8px}.broadcast-heading .broadcast-kicker{color:#6e8299;font-size:11px;letter-spacing:.12em;font-weight:600;margin-bottom:8px}.broadcast-heading h2{font-size:clamp(22px,2.5vw,28px);letter-spacing:-.6px;line-height:1.3;margin-bottom:8px}.broadcast-heading p:last-child{color:#65788d;max-width:580px}.service-badge,.preview-badge{flex-shrink:0;padding:6px 10px;border-radius:6px;background:#edf4fb;color:#476b90;font-size:11px;font-weight:500}.broadcast-panel .service-warning{border:0;border-radius:8px;background:#fff8ec;color:#826236;padding:10px 14px;font-size:12px!important}.composer{grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:0;border:1px solid #dce6f0;border-radius:16px;overflow:hidden}.composer form{padding:24px;border:0;border-radius:0;gap:14px}.editor-heading{display:flex;align-items:flex-start;gap:12px;margin-bottom:6px}.step-tag{font-size:12px;color:#477eae;background:#edf5fd;padding:7px 9px;border-radius:8px}.editor-heading h3{font-size:16px}.editor-heading p{font-size:12px;color:#75869a;margin-top:3px}.composer label{font-size:12px;color:#60758c;font-weight:500}.toolbar{padding:0 0 10px;border:0;border-bottom:1px solid #e6edf5;background:none;border-radius:0}.broadcast-panel .toolbar button{background:#f4f7fb;font-size:12px;min-height:40px}.toolbar button:last-child{margin-left:auto}.composer textarea{min-height:260px;border:0;background:#fff;padding:4px 0;border-radius:0;font-size:15px}.composer textarea::placeholder{color:#94a3b4}.composer textarea:focus-visible{outline-offset:4px}.composer form>button{min-height:48px;background:#163d65;border-radius:10px}.simulation{padding:0;border:0;border-left:1px solid #dce6f0;border-radius:0;background:#f0f5f6;gap:0;grid-template-rows:auto 1fr auto}.simulation-heading{display:flex;align-items:center;gap:10px;padding:18px;background:#fff;border-bottom:1px solid #e3ebee}.chat-avatar{display:grid;place-items:center;width:38px;height:38px;background:#e3eff4;border-radius:50%;color:#476b80;font-size:15px}.simulation-heading h3{font-size:14px}.simulation-heading small{font-size:11px}.preview-badge{margin-left:auto;background:#f0f5f6;color:#6a7f89}.chat-surface{min-height:300px;border:0;border-radius:0;background:radial-gradient(#becfcb66 .7px,transparent .7px) 0 0/16px 16px,#eff4f1;padding:24px 18px}.chat-bubble{background:#fff;border:1px solid #dce7e0;border-radius:12px 12px 3px 12px;box-shadow:0 2px 4px #20332308;align-self:flex-end;width:fit-content}.simulation-note{padding:14px 18px;border-top:1px solid #dfe8e4;background:#f8faf9;color:#7a8b85;font-size:11px!important}.terms{border:0;background:none;padding:4px 0;color:#6d7f92}.terms summary{font-size:12px;min-height:36px;align-content:center}.history-heading{margin-top:8px;padding-top:20px}.history-heading h3{font-size:16px}.broadcast-panel .history-heading button{border:0;background:#f2f6fb;font-size:12px}.broadcast-panel>.empty-state{background:none;padding:36px 16px;border:1px dashed #dce5ee;color:#8292a4;font-size:13px}
@media (max-width: 800px) { .composer { grid-template-columns: minmax(0, 1fr); }.simulation{border-left:0;border-top:1px solid #dce6f0}.broadcast-heading{flex-direction:column;gap:12px} }
@media(max-width:480px){.composer form,.simulation,.preview-panel,.report-panel{padding:14px}.composer textarea{font-size:16px}.toolbar button:last-child{flex-basis:100%}.history-heading{align-items:flex-start;flex-direction:column}.history-heading button{width:100%}.chat-surface{min-height:180px}}
.campaign-list{gap:0;border:1px solid #dce6f0;border-radius:14px;overflow:hidden}.campaign-list li{border:0;border-bottom:1px solid #e8eef5;border-radius:0;padding:18px 20px;background:#fff}.campaign-list li:last-child{border-bottom:0}.campaign-list .campaign-active{background:#f0f7ff;box-shadow:inset 3px 0 #397db6}.campaign-identity{display:flex;align-items:center;gap:12px;min-width:0}.campaign-icon{display:grid;place-items:center;flex-shrink:0;width:40px;height:40px;border-radius:12px;background:#eaf2fc;color:#487cad}.campaign-icon svg{width:20px;height:20px}.broadcast-panel .campaign-title{font-size:13px;font-weight:600;color:#304f70}.campaign-list time{font-size:12px}.campaign-list details{padding-left:52px;color:#7a8ba0}.campaign-list button[aria-pressed=true]{background:#dcecff;border-color:#b6d2ec}.report-panel{background:#fff;border:1px solid #dce6f0;padding:22px;border-radius:16px;gap:18px}.report-heading p{font-size:12px;color:#73869b;margin-top:4px}.report-panel>details{order:1;border-top:1px solid #e8eef5;padding-top:12px;color:#788a9d;font-size:12px}.report-stats{display:flex;flex-wrap:wrap;gap:10px}.report-stat{flex:1 1 110px;padding:14px 16px;border:1px solid #e1eaf3;border-radius:12px;background:#f6f9fd;display:flex;flex-direction:column;gap:6px}.report-stat span{font-size:11px;letter-spacing:.04em;color:#687d94;overflow-wrap:anywhere}.report-stat strong{font-size:26px;line-height:1.2;font-weight:600;color:#244c74}.broadcast-panel .report-notice{padding:12px 14px;border-radius:10px;background:#fff8ec;color:#806238;font-size:12px;line-height:1.7}.report-panel>.recipient-report{list-style:none;padding:0;display:grid;gap:10px}.recipient-report>li{padding:14px 16px;border:1px solid #e2eaf2;border-radius:12px}.recipient-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.broadcast-panel .recipient-number{font-size:14px;font-weight:600;overflow-wrap:anywhere}.recipient-status{font-size:11px;padding:5px 9px;border-radius:6px;background:#edf2f8;color:#526d88}.recipient-status[data-status=SENT]{background:#eaf6ee;color:#357048}.recipient-status[data-status=FAILED]{background:#fff0ee;color:#a34e42}.recipient-status[data-status=PROCESSING]{background:#fff5df;color:#88672c}.recipient-report details{margin-top:10px;color:#7a8b9d;font-size:12px}.recipient-report pre{max-height:240px;overflow:auto;padding:12px;background:#f5f8fc;border-radius:8px}
@media(max-width:480px){.campaign-list li,.report-panel{padding:16px}.campaign-list .section-heading{align-items:flex-start}.campaign-list .section-heading>button{margin-left:52px}.report-heading{align-items:flex-start}.report-heading>button{width:100%}.report-stat{flex-basis:90px}.recipient-report>li{padding:12px}}
</style>
