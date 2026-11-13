<script setup lang="ts">
import { inject, onMounted, ref } from 'vue';
import { api } from '../services/auth';
const newPresentation = inject('newPresentation', ref(false));
defineProps<{ owner: boolean }>();
type Template = { event: string; name: string; body: string };
const templates = ref<Template[]>([]); const selected = ref(''); const draft = ref<Template>();
const placeholders = ref<Record<string, string>>({}); const preview = ref(''); const error = ref(''); const notice = ref(''); const busy = ref(false); const localOnly = ref(false); const encryptionReady = ref(false);
function choose() { const item = templates.value.find(t => t.event === selected.value); draft.value = item ? { ...item } : undefined; preview.value = ''; notice.value = ''; error.value = ''; }
async function run(task: () => Promise<void>) { busy.value = true; error.value = ''; try { await task(); } catch (e) { error.value = e instanceof Error ? e.message : 'Permintaan gagal.'; } finally { busy.value = false; } }
onMounted(() => run(async () => {
  const data = await api<{ templates: Template[]; placeholders: Record<string, string>; localOnly: boolean; encryptionReady: boolean }>('/whatsapp-templates');
  // ponytail: hide intake and legacy-only stages; restore when exposed as normal workflow actions.
  templates.value = data.templates.filter(t => !['RECEIVED', 'INSPECTION', 'PACKING', 'QC'].includes(t.event)); placeholders.value = data.placeholders; localOnly.value = data.localOnly; encryptionReady.value = data.encryptionReady; selected.value = templates.value[0]?.event ?? ''; choose();
}));
function showPreview() { return run(async () => { if (!draft.value) return; const result = await api<{ message: string }>('/whatsapp-templates/preview', 'POST', draft.value); preview.value = result.message; }); }
function save() { return run(async () => { if (!draft.value) return; const result = await api<Template>('/whatsapp-templates', 'PATCH', draft.value); templates.value = templates.value.map(t => t.event === result.event ? result : t); notice.value = 'Template tersimpan. Berlaku hanya untuk event baru; tidak mengirim pesan atau mengaktifkan WhatsApp.'; }); }
</script>

<template>
  <section
    class="panel"
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
    <label>Peristiwa notifikasi<select
      v-model="selected"
      :disabled="busy"
      @change="choose"
    ><option
      v-for="item in templates"
      :key="item.event"
      :value="item.event"
    >{{ item.name }}</option></select></label>
    <form
      v-if="draft"
      @submit.prevent="save"
    >
      <label>Nama peristiwa<input
        v-model="draft.name"
        maxlength="80"
        required
        :readonly="!owner"
        :disabled="busy"
        @input="preview = ''; notice = ''"
      ></label>
      <p class="muted">
        Kode: {{ draft.event }}
      </p>
      <label>Isi pesan<textarea
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
        {{ draft.body.length }}/2000 karakter. Wajib memuat Cicuci Sepatu dan placeholder tautan tracking. URL literal, HTML, placeholder tidak dikenal ditolak.
      </p>
      <details>
        <summary>Bantuan placeholder</summary><dl>
          <template
            v-for="(help, name) in placeholders"
            :key="name"
          >
            <dt><code>{{ '{' + name + '}' }}</code></dt><dd>{{ help }}</dd>
          </template>
        </dl><p>Jumlah dan daftar mencakup seluruh pesanan. Sepatu terkait hanya menunjukkan item pada peristiwa ini. Catatan internal, rincian risiko, foto tidak disisipkan.</p>
      </details>
      <div class="actions">
        <button
          type="button"
          :disabled="busy"
          @click="showPreview"
        >
          Lihat pratinjau
        </button><button
          v-if="owner"
          class="primary"
          type="submit"
          :disabled="busy"
        >
          Simpan template
        </button>
      </div>
    </form>
    <section
      v-if="preview"
      aria-label="Pratinjau pesan"
    >
      <h4>Pratinjau — data contoh, bukan pelanggan nyata</h4><p class="preserve">
        {{ preview }}
      </p>
    </section>
  </section>
</template>
