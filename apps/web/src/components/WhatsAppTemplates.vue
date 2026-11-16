<script setup lang="ts">
import { computed, inject, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { api } from '../services/auth';
import logo from '../assets/logo.webp';
const newPresentation = inject('newPresentation', ref(false));
defineProps<{ owner: boolean }>();
type Template = { event: string; name: string; body: string };
const templates = ref<Template[]>([]); const selected = ref(''); const draft = ref<Template>();
const placeholders = ref<Record<string, string>>({}); const preview = ref(''); const error = ref(''); const notice = ref(''); const busy = ref(false); const localOnly = ref(false); const encryptionReady = ref(false);
const groups = [{ name: 'Pesanan', events: ['ORDER_RECEIVED'] }, { name: 'Pengerjaan dan persetujuan', events: ['QUEUED', 'AWAITING_CONSENT', 'CONSENT_REQUEST', 'WASHING', 'DRYING', 'FINISHING', 'REWORK'] }, { name: 'Pengambilan dan pengembalian', events: ['READY_FOR_PICKUP', 'HANDED_OVER', 'ORDER_HANDED_OVER', 'RETURN_PENDING', 'RETURNED', 'PICKUP_BILL_UNPAID', 'PICKUP_BILL_PAID'] }];
const dirty = computed(() => { const saved = templates.value.find(t => t.event === draft.value?.event); return !!saved && !!draft.value && (saved.name !== draft.value.name || saved.body !== draft.value.body); });
// ponytail: single-line bold and italic only; add nested formatting when needed.
const previewParts = computed(() => preview.value.split(/(\*[^*\n]+\*|_[^_\n]+_)/g).map(text => ({ text: /^[*_]/.test(text) && text.length > 2 && text.endsWith(text[0]!) ? text.slice(1, -1) : text, format: /^\*[^*\n]+\*$/.test(text) ? 'bold' : /^_[^_\n]+_$/.test(text) ? 'italic' : '' })));
defineExpose({ dirty });
const editor = ref<HTMLTextAreaElement>();
function beforeUnload(event: BeforeUnloadEvent) { if (dirty.value) { event.preventDefault(); event.returnValue = ''; } }
onMounted(() => window.addEventListener('beforeunload', beforeUnload));
onUnmounted(() => window.removeEventListener('beforeunload', beforeUnload));
function choose() { if (dirty.value && !window.confirm('Perubahan template belum disimpan. Ganti peristiwa?')) { selected.value = draft.value?.event ?? ''; return; } const item = templates.value.find(t => t.event === selected.value); draft.value = item ? { ...item } : undefined; preview.value = ''; notice.value = ''; error.value = ''; }
function insertPlaceholder(name: string) { if (!draft.value || !editor.value) return; const field = editor.value; const start = field.selectionStart; const end = field.selectionEnd; const token = `{${name}}`; draft.value.body = draft.value.body.slice(0, start) + token + draft.value.body.slice(end); preview.value = ''; notice.value = ''; void nextTick(() => { field.focus(); field.setSelectionRange(start + token.length, start + token.length); }); }
async function run(task: () => Promise<void>) { busy.value = true; error.value = ''; try { await task(); } catch (e) { error.value = e instanceof Error ? e.message : 'Permintaan gagal.'; } finally { busy.value = false; } }
onMounted(() => run(async () => {
  const data = await api<{ templates: Template[]; placeholders: Record<string, string>; localOnly: boolean; encryptionReady: boolean }>('/whatsapp-templates');
  // ponytail: hide intake and legacy-only stages; restore when exposed as normal workflow actions.
  templates.value = data.templates.filter(t => !['RECEIVED', 'INSPECTION', 'PACKING', 'QC', 'HANDED_OVER'].includes(t.event)); placeholders.value = data.placeholders; localOnly.value = data.localOnly; encryptionReady.value = data.encryptionReady; selected.value = templates.value[0]?.event ?? ''; choose();
}));
let previewRequest = 0;
watch(() => [draft.value?.event, draft.value?.name, draft.value?.body], (_value, _old, onCleanup) => {
  const request = ++previewRequest;
  const current = draft.value && { ...draft.value };
  preview.value = '';
  if (!current) return;
  const timer = setTimeout(async () => {
    try {
      const result = await api<{ message: string }>('/whatsapp-templates/preview', 'POST', current);
      if (request === previewRequest) { preview.value = result.message; error.value = ''; }
    } catch (e) {
      if (request === previewRequest) error.value = e instanceof Error ? e.message : 'Pratinjau gagal.';
    }
  }, 400);
  onCleanup(() => { clearTimeout(timer); if (request === previewRequest) previewRequest++; });
}, { immediate: true });
function save() { return run(async () => { if (!draft.value) return; const result = await api<Template>('/whatsapp-templates', 'PATCH', draft.value); templates.value = templates.value.map(t => t.event === result.event ? result : t); draft.value = { ...result }; notice.value = 'Template tersimpan. Berlaku hanya untuk event baru; tidak mengirim pesan atau mengaktifkan WhatsApp.'; }); }
</script>

<template>
  <section
    class="panel wa-templates"
    :class="{ 'new-wa': newPresentation }"
    aria-labelledby="wa-templates-heading"
    :aria-busy="busy"
  >
    <h3 id="wa-templates-heading">
      {{ newPresentation ? 'Template Pesan Pelanggan' : 'Template pesan pelanggan' }}
    </h3>
    <p>Pesan otomatis memakai identitas Cicuci Sepatu, daftar sepatu, dan tautan privat. Simpan atau pratinjau tidak mengirim pesan.</p>
    <p
      v-if="!owner"
      class="notice"
    >
      Hanya owner yang dapat mengubah template. Anda dapat membaca dan melihat pratinjau.
    </p>
    <p
      v-if="localOnly"
      class="notice"
    >
      Alamat tracking masih localhost: hanya dapat dibuka di perangkat lokal. Atur origin publik sebelum pengiriman operasional.
    </p>
    <p
      v-if="!encryptionReady"
      class="notice"
    >
      Kunci enkripsi pesan belum tersedia. Event baru tidak akan dikirim sampai konfigurasi aman tersedia.
    </p>
    <p
      v-if="error"
      class="error"
      role="alert"
    >
      {{ error }}
    </p>
    <p
      v-if="notice"
      class="success"
      role="status"
    >
      {{ notice }}
    </p>
    <div class="template-workspace">
      <form @submit.prevent="save">
        <h4 class="workspace-heading">
          Editor Template
        </h4>
        <div class="template-fields">
          <label>Peristiwa Notifikasi<select
            v-model="selected"
            :disabled="busy"
            @change="choose"
          ><optgroup
            v-for="group in groups"
            :key="group.name"
            :label="group.name"
          ><option
            v-for="item in templates.filter(t => group.events.includes(t.event))"
            :key="item.event"
            :value="item.event"
          >{{ item.name }}</option></optgroup><optgroup label="Lainnya"><option
            v-for="item in templates.filter(t => !groups.some(g => g.events.includes(t.event)))"
            :key="item.event"
            :value="item.event"
          >{{ item.name }}</option></optgroup></select></label>
          <label v-if="draft">Nama Peristiwa<input
            v-model="draft.name"
            maxlength="80"
            required
            :readonly="!owner"
            :disabled="busy"
            @input="preview = ''; notice = ''"
          ></label>
        </div>
        <p
          v-if="dirty"
          role="status"
          class="notice"
        >
          Perubahan belum disimpan.
        </p>
        <template v-if="draft">
          <p class="muted">
            Kode: {{ draft.event }}
          </p>
          <div class="editor-layout">
            <div class="editor-content">
              <label>Isi Pesan<textarea
                ref="editor"
                v-model="draft.body"
                rows="12"
                maxlength="2000"
                minlength="20"
                required
                :readonly="!owner"
                :disabled="busy"
                @input="preview = ''; notice = ''"
              /></label>
              <p class="muted">
                {{ draft.body.length }}/2000 karakter. Wajib memuat Cicuci Sepatu dan {{ selected === 'ORDER_HANDED_OVER' ? '{url_ulasan} atau {url_tracking}' : '{url_tracking}' }}. URL literal, HTML, placeholder tidak dikenal ditolak.
              </p>
              <p
                v-if="selected === 'ORDER_HANDED_OVER'"
                class="notice"
              >
                Gunakan {url_ulasan} untuk tautan rating dan ulasan privat pelanggan. Tersedia setelah seluruh sepatu diserahkan, bukan pada Pesan Custom.
              </p>
              <p
                v-if="draft.event === 'PICKUP_BILL_UNPAID' || draft.event === 'PICKUP_BILL_PAID'"
                class="notice"
              >
                Pesan dibuat saat pesanan siap diambil atau saldo berubah antara lunas dan belum lunas. Pengiriman mengikuti persetujuan pelanggan dan kesiapan WhatsApp; saldo diperiksa kembali saat pesan diproses. {{ draft.event === 'PICKUP_BILL_UNPAID' ? 'Wajib memuat {sisa_pembayaran}; QR pembayaran disertakan.' : 'Jangan gunakan {sisa_pembayaran} untuk pesan lunas.' }}
              </p>
            </div>
          </div>
          <div class="actions">
            <button
              v-if="owner"
              class="primary"
              type="submit"
              :disabled="busy"
            >
              Simpan Template
            </button>
          </div>
        </template>
      </form>
      <section
        class="preview-panel"
        aria-label="Pratinjau pesan"
      >
        <h4 class="workspace-heading">
          Preview WhatsApp <span>Simulasi</span>
        </h4>
        <div class="preview-phone">
          <div class="preview-header">
            <img
              :src="logo"
              alt=""
              class="preview-avatar"
            >
            <div>Cicuci Sepatu <small>Akun bisnis</small></div>
          </div>
          <p
            v-if="preview"
            class="preview-message preserve"
          >
            <template
              v-for="(part, index) in previewParts"
              :key="index"
            >
              <strong v-if="part.format === 'bold'">{{ part.text }}</strong><em v-else-if="part.format === 'italic'">{{ part.text }}</em><template v-else>
                {{ part.text }}
              </template>
            </template>
          </p>
          <p
            v-else
            class="preview-empty"
          >
            Pratinjau muncul otomatis saat template valid.
          </p>
        </div>
        <p class="preview-note">
          Pratinjau menggunakan data contoh, bukan pesan sebenarnya.
        </p>
      </section>
      <aside
        class="editor-help"
        aria-label="Bantuan penulisan pesan"
      >
        <details open>
          <summary>Daftar Placeholder <span>Lihat variabel yang tersedia</span></summary>
          <p>Placeholder adalah penanda yang diganti otomatis dengan data pesanan. {{ owner ? 'Letakkan kursor di isi pesan, lalu pilih penanda untuk menyisipkannya.' : 'Penanda berikut tersedia untuk peristiwa ini.' }}</p>
          <dl
            class="placeholder-list"
            role="region"
            aria-label="Daftar placeholder"
          >
            <template
              v-for="(help, name) in Object.fromEntries(Object.entries(placeholders).filter(([key]) => (key !== 'url_ulasan' || selected === 'ORDER_HANDED_OVER') && (key !== 'sisa_pembayaran' || selected === 'PICKUP_BILL_UNPAID') && (!['layanan_tarif', 'estimasi_total', 'estimasi_selesai'].includes(key) || selected === 'ORDER_RECEIVED') && (key !== 'detail_sepatu' || ['ORDER_RECEIVED', 'PICKUP_BILL_UNPAID', 'PICKUP_BILL_PAID'].includes(selected))))"
              :key="name"
            >
              <dt>
                <button
                  v-if="owner"
                  type="button"
                  class="secondary"
                  :disabled="busy"
                  :aria-label="`Sisipkan ${name}`"
                  @click="insertPlaceholder(String(name))"
                >
                  {{ '{' + name + '}' }}
                </button><code v-else>{{ '{' + name + '}' }}</code>
              </dt><dd>{{ help }}</dd>
            </template>
          </dl><p>Jumlah dan daftar mencakup seluruh pesanan. Sepatu terkait hanya menunjukkan item pada peristiwa ini. Catatan internal, rincian risiko, foto tidak disisipkan.</p>
        </details>
        <details
          class="format-help"
          open
        >
          <summary>Format Teks WhatsApp <span>Panduan tebal, miring, dan coret</span></summary>
          <p>Apit teks dengan tanda berikut. Gunakan satu tanda di setiap sisi, tanpa spasi di antara tanda dan teks.</p>
          <ul>
            <li><code>*teks*</code> — <strong>tebal</strong> (bukan dua tanda bintang)</li>
            <li><code>_teks_</code> — <em>miring</em></li>
            <li><code>~teks~</code> — <s>dicoret</s></li>
          </ul>
          <p>Pratinjau menampilkan tanda format sebagai teks; tampilan akhir mengikuti WhatsApp.</p>
        </details>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.wa-templates { max-width: 90rem; }
.template-workspace { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr); gap: .75rem; align-items: start; }
.template-workspace > form, .preview-panel { min-width: 0; border: 1px solid #d6e0ef; border-radius: .65rem; padding: .85rem; background: #fff; }
.workspace-heading { margin: -.85rem -.85rem .25rem; padding: .55rem .85rem; border-bottom: 1px solid #d6e0ef; background: #f4f7fc; color: #172b4d; font-size: .95rem; }
.workspace-heading span { float: right; padding: .15rem .5rem; border-radius: 999px; background: #e5edff; color: #285fc0; font-size: .75rem; }
.preview-phone { overflow: hidden; border-radius: .5rem; background-color: #eee9df; background-image: radial-gradient(#d9d1c3 1px, transparent 1px); background-size: 18px 18px; min-height: 19rem; }
.preview-header { display: flex; align-items: center; gap: .65rem; padding: .6rem .85rem; background: #124c43; color: white; font-weight: 700; }
.preview-avatar { width: 2.4rem; height: 2.4rem; object-fit: contain; border-radius: 50%; background: white; }
.preview-header small { display: block; color: #d4e8e2; font-weight: 400; }
.preview-message, .preview-empty { width: fit-content; max-width: calc(100% - 2rem); margin: 1rem; padding: .75rem .9rem; border-radius: .2rem .7rem .7rem .7rem; background: white; color: #172b4d; line-height: 1.55; overflow-wrap: anywhere; box-shadow: 0 1px 3px #172b4d1a; }
.preview-note { margin: .75rem 0 0; color: #52688a; font-size: .8rem; text-align: center; font-style: italic; }
.wa-templates summary span { float: right; color: #52688a; font-size: .75rem; font-weight: 400; }
.wa-templates .editor-help details { container-type: inline-size; }
@container (max-width: 27rem) { .wa-templates summary span { display: none; } }
@media (max-width: 800px) { .template-workspace { grid-template-columns: minmax(0, 1fr); } .wa-templates summary span { display: none; } }
.wa-templates > h3 { margin: 0 0 .35rem; color: #172b4d; }
.wa-templates > p { line-height: 1.55; }
.wa-templates > h3 + p { margin: 0 0 1rem; }
.wa-templates .template-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
.wa-templates .template-fields label, .wa-templates .editor-content label { min-width: 0; }
.wa-templates .editor-layout { display: grid; gap: 1rem; }
.wa-templates .editor-content, .wa-templates .editor-help { min-width: 0; display: grid; gap: .75rem; }
.wa-templates .editor-help { grid-column: 1 / -1; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; }
@media (max-width: 800px) { .wa-templates .editor-help { grid-template-columns: minmax(0, 1fr); } }
.wa-templates .editor-content p { margin: 0; line-height: 1.5; }
.wa-templates .editor-content textarea { min-height: 19rem; }
@media (max-width: 800px) {
  .wa-templates .template-fields, .wa-templates .editor-layout { grid-template-columns: minmax(0, 1fr); }
}
.wa-templates form { display: grid; gap: 1rem; }
.wa-templates form > p { margin: 0; }
.wa-templates textarea { line-height: 1.6; resize: vertical; }
.wa-templates details { border: 1px solid #cbd8e9; border-radius: 12px; padding: .5rem .75rem; background: #f4f7fc; color: #172b4d; min-width: 0; }
.wa-templates summary { cursor: pointer; font-weight: 700; }
.wa-templates summary:focus-visible, .placeholder-list button:focus-visible { outline: 3px solid #3673b9; outline-offset: 2px; }
.wa-templates details p { line-height: 1.5; margin: .6rem 0; }
.placeholder-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr)); gap: .8rem 1rem; margin: .75rem 0; }
.placeholder-list dt { min-width: 0; }
.placeholder-list dt button { max-width: 100%; padding: .35rem .65rem; border: 1px solid #b9cce5; border-radius: 999px; background: #e7f0fc; color: #173c69; overflow-wrap: anywhere; text-align: left; }
.placeholder-list dd { margin: .35rem 0 0; line-height: 1.4; }
.format-help ul { display: flex; flex-direction: column; gap: .35rem; padding-left: 1.2rem; margin: .5rem 0; }
.format-help li { margin: 0; }
.wa-templates.new-wa { color: var(--ink); }
.wa-templates.new-wa > p { color: var(--muted); }
.wa-templates.new-wa > .notice, .wa-templates.new-wa > .error, .wa-templates.new-wa > .success { color: inherit; }
.wa-templates.new-wa form { gap: .75rem; }
.wa-templates.new-wa input, .wa-templates.new-wa select, .wa-templates.new-wa textarea { font: inherit; font-weight: 400; margin-bottom: 0; }
.wa-templates.new-wa textarea { font-size: 1rem; }
.wa-templates.new-wa form > .muted { font-size: .875rem; }
.wa-templates.new-wa details { margin: 0; border-color: #cbd8e9; border-radius: .5rem; background: #f4f7fc; }
.wa-templates.new-wa details > summary { font-size: .875rem; font-weight: 600; padding: 0; display: list-item; }
.new-wa .placeholder-list { margin: 1rem 0; }
.new-wa .placeholder-list dd { color: var(--muted); font-size: .875rem; }
.wa-templates.new-wa .actions { margin: .25rem 0 0; }
/* ponytail: scoped dashboard scale; use shared tokens when available. */
.wa-templates { font-size: .875rem; line-height: 1.5; }
.wa-templates :is(input, select, textarea, button, code) { font-family: inherit; font-size: .875rem; }
.wa-templates .workspace-heading { font-size: .875rem; }
.wa-templates .preview-header { font-size: .875rem; }
.wa-templates label { font-size: .875rem; }
.wa-templates > h3 { font-size: 1.125rem; }
.wa-templates :is(.muted, .preview-note, .preview-header small, .workspace-heading span, summary span, .placeholder-list dd, details p, .format-help li) { font-size: .8125rem; }
.wa-templates.new-wa summary { font-size: .875rem; }
.wa-templates.new-wa :is(.placeholder-list dd, form > .muted) { font-size: .8125rem; }
.wa-templates .placeholder-list dt button { padding: .25rem .5rem; font-size: .8125rem; }
.wa-templates.new-wa :is(input, select, textarea) { font-size: .875rem; }
@media (max-width: 800px) { .wa-templates.new-wa :is(input, select, textarea) { font-size: 1rem; } }
</style>
