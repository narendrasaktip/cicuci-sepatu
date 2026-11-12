<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watchPostEffect } from 'vue';
import { api, type User } from '../services/auth';
import { money, turnaroundText, type TurnaroundPolicy, type RatePlan, type RateRule } from '../services/domain';
import PricingPreview from './PricingPreview.vue';
import OutlineIcon from './OutlineIcon.vue';
const newPresentation = inject('newPresentation', ref(false));
const props = defineProps<{ role: User['role'] }>();
async function deletePlan(plan: RatePlan) {
  if (busy.value || props.role !== 'OWNER') return;
  busy.value = true; error.value = '';
  try {
    await api(`/pricing/plans/${plan.id}`, 'DELETE', { confirmed: true, confirmation: 'HAPUS' });
    draft.value = undefined; await load();
  } catch (e) { error.value = e instanceof Error ? e.message : 'Tarif gagal dihapus.'; }
  finally { busy.value = false; }
}
const plans = ref<RatePlan[]>([]); const loading = ref(false); const busy = ref(false); const error = ref('');
const draft = ref<{ name: string; isActive: boolean; turnaroundPolicy: TurnaroundPolicy; rules: RateRule[] }>(); const editing = ref<RatePlan>(); const pairs = ref(1);
const editor = ref<HTMLDialogElement | HTMLDivElement>();
let opener: HTMLElement | null = null;
function trapEditorFocus(event: KeyboardEvent) {
  if (!newPresentation.value || event.key !== 'Tab') return;
  const controls = editor.value?.querySelectorAll<HTMLElement>('input:enabled, select:enabled, button:enabled, textarea:enabled, [tabindex="0"]');
  const first = controls?.[0], last = controls?.[controls.length - 1];
  if (!first || !last) { event.preventDefault(); return; }
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
watchPostEffect(() => {
  if (newPresentation.value && draft.value && editor.value instanceof HTMLDialogElement && !editor.value.open) editor.value.showModal();
});
onBeforeUnmount(() => { if (editor.value instanceof HTMLDialogElement) editor.value.close(); });
function closeEditor() {
  if (busy.value) return;
  if (editor.value instanceof HTMLDialogElement) editor.value.close();
  draft.value = undefined;
}
const validation = computed(() => {
  if (!draft.value) return '';
  if (!draft.value.name.trim() || !draft.value.rules.length) return 'Nama dan minimal satu aturan wajib diisi.';
  for (const rule of draft.value.rules) {
    if (!Number.isSafeInteger(rule.minPairs) || rule.minPairs < 1 || !Number.isSafeInteger(rule.priceIdr) || rule.priceIdr < 1 || rule.priceIdr > 100000000 || (rule.maxPairs !== null && (!Number.isSafeInteger(rule.maxPairs) || rule.maxPairs < rule.minPairs)) || (rule.kind === 'PACKAGE' && rule.maxPairs !== rule.minPairs)) return 'Jumlah paket harus tetap; rentang per pasang harus valid. Gunakan bilangan bulat rupiah positif 1–100000000.';
  }
  return '';
});
async function load() {
  loading.value = true; error.value = '';
  try { plans.value = await api<RatePlan[]>('/pricing/plans'); }
  catch (e) { error.value = e instanceof Error ? e.message : 'Tarif gagal dimuat.'; }
  finally { loading.value = false; }
}
function edit(plan?: RatePlan) {
  if (props.role !== 'OWNER' || busy.value) return;
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  editing.value = plan; error.value = '';
  draft.value = plan ? { name: plan.name, isActive: plan.isActive, turnaroundPolicy: plan.turnaroundPolicy ?? 'REGULAR', rules: plan.rules.map(r => ({ ...r })) } : { name: '', isActive: true, turnaroundPolicy: 'REGULAR', rules: [{ kind: 'PACKAGE', minPairs: 1, maxPairs: 1, priceIdr: 1 }] };
}
function changeKind(rule: RateRule) { rule.maxPairs = rule.kind === 'PACKAGE' ? rule.minPairs : null; }
async function save() {
  if (props.role !== 'OWNER' || busy.value || !draft.value || validation.value) return;
  busy.value = true; error.value = '';
  try {
    await api(editing.value ? `/pricing/plans/${encodeURIComponent(editing.value.id)}` : '/pricing/plans', editing.value ? 'PATCH' : 'POST', { ...draft.value, name: draft.value.name.trim(), ...(editing.value ? { revision: editing.value.revision } : {}) });
    const modal = editor.value instanceof HTMLDialogElement;
    if (modal) (editor.value as HTMLDialogElement).close();
    draft.value = undefined; await load();
    if (modal) { busy.value = false; await nextTick(); opener?.focus(); }
  } catch (e) { error.value = e instanceof Error ? e.message : 'Tarif gagal disimpan.'; }
  finally { busy.value = false; }
}
onMounted(load);
</script>
<template>
  <section aria-label="Daftar tarif bernama">
    <div
      :class="newPresentation ? 'rate-toolbar' : undefined"
      :style="newPresentation ? undefined : { display: 'contents' }"
    >
      <div
        v-if="newPresentation"
        class="rate-intro"
      >
        <p>Harga berlaku per pasang atau per paket sesuai aturan tarif.</p>
        <details>
          <summary>Ketentuan tarif & pesanan lama</summary>
          <p>Satu item berarti satu pasang sepatu. Pilih satu tarif aktif untuk seluruh pesanan. Perubahan tarif tidak mengubah harga dan aturan yang tersimpan pada pesanan lama. Paket memakai jumlah pasang tetap dan harga total paket; per pasang memakai harga satuan pada rentang yang tertera. Kombinasi harga dihitung server.</p>
        </details>
      </div>
      <p v-else>
        Tarif pesanan · 1 item = 1 pasang. Pilih satu tarif aktif untuk seluruh pesanan. Perubahan tidak mengubah snapshot pesanan lama.
      </p>
      <div class="actions">
        <button
          type="button"
          class="secondary"
          :disabled="loading || busy"
          @click="load"
        >
          {{ newPresentation ? 'Muat Ulang' : 'Muat ulang tarif' }}
        </button>
        <button
          v-if="role === 'OWNER' && (newPresentation || !draft)"
          type="button"
          @click="edit()"
        >
          {{ newPresentation ? 'Tambah Tarif' : 'Tambah tarif' }}
        </button>
      </div>
    </div>
    <p
      v-if="error"
      role="alert"
      class="error"
    >
      {{ error }}
    </p>
    <p
      v-if="loading"
      role="status"
    >
      Memuat tarif…
    </p>
    <div
      v-if="newPresentation && plans.length"
      class="table-wrap panel rate-table"
      role="region"
      aria-label="Daftar tarif, geser untuk kolom lainnya"
      :aria-busy="loading"
      tabindex="0"
    >
      <table>
        <caption class="sr-only">
          Perbandingan tarif pesanan
        </caption>
        <thead>
          <tr>
            <th scope="col">
              Nama Tarif
            </th><th scope="col">
              Status
            </th><th scope="col">
              Estimasi
            </th><th scope="col">
              Rincian Harga
            </th><th
              v-if="role === 'OWNER'"
              scope="col"
            >
              Aksi
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="plan in plans"
            :key="plan.id"
          >
            <th scope="row">
              <h3>{{ plan.name }}</h3>
            </th>
            <td>
              <span
                class="badge"
                :class="plan.isActive ? 'rate-active' : 'rate-inactive'"
              >{{ plan.isActive ? 'Aktif' : 'Nonaktif' }}</span>
            </td>
            <td>
              <p class="rate-estimate">
                {{ plan.turnaroundPolicy === 'FAST' ? 'Fast · batas masuk 17:00 WIB' : 'Reguler · 5 hari kalender' }}
              </p>
              <details>
                <summary :aria-label="`Detail estimasi ${plan.name}`">
                  Detail estimasi
                </summary>
                <p>{{ turnaroundText(plan.turnaroundPolicy) }}</p>
              </details>
            </td>
            <td>
              <table
                class="rate-rules"
                :aria-label="`Rincian harga ${plan.name}`"
              >
                <thead>
                  <tr>
                    <th scope="col">
                      Aturan
                    </th><th scope="col">
                      Jumlah pasang
                    </th><th scope="col">
                      Harga
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(rule, index) in plan.rules"
                    :key="index"
                  >
                    <th scope="row">
                      {{ rule.kind === 'PACKAGE' ? 'Paket' : 'Per pasang' }}
                    </th>
                    <td>{{ rule.kind === 'PACKAGE' ? rule.minPairs : `${rule.minPairs}–${rule.maxPairs ?? 'tanpa batas'}` }}</td>
                    <td>{{ money(rule.priceIdr) }}<small>{{ rule.kind === 'PACKAGE' ? 'total / paket' : '/ pasang' }}</small></td>
                  </tr>
                </tbody>
              </table>
            </td>
            <td v-if="role === 'OWNER'">
              <div class="actions">
                <button
                  type="button"
                  class="secondary"
                  :aria-label="`Ubah tarif ${plan.name}`"
                  :disabled="busy"
                  @click="edit(plan)"
                >
                  Ubah
                </button>
                <button
                  type="button"
                  class="danger icon-delete"
                  :title="`Hapus tarif ${plan.name}`"
                  :aria-label="`Hapus tarif ${plan.name}`"
                  :disabled="busy"
                  @click="deletePlan(plan)"
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
      v-else-if="!newPresentation"
      class="cards"
    >
      <article
        v-for="plan in plans"
        :key="plan.id"
        class="panel"
      >
        <button
          v-if="role === 'OWNER' && !newPresentation"
          type="button"
          class="danger"
          :disabled="busy"
          @click="deletePlan(plan)"
        >
          Hapus tarif
        </button>
        <h3>{{ plan.name }}</h3><p>{{ plan.isActive ? 'Aktif' : 'Nonaktif' }}</p>
        <p>{{ turnaroundText(plan.turnaroundPolicy) }}</p>
        <ul>
          <li
            v-for="(rule, index) in plan.rules"
            :key="index"
          >
            {{ rule.kind === 'PACKAGE' ? `Paket ${rule.minPairs} pasang · harga total paket` : `Per pasang · ${rule.minPairs}–${rule.maxPairs ?? 'tanpa batas'} pasang` }}: {{ money(rule.priceIdr) }}{{ rule.kind === 'PER_PAIR' ? ' / pasang' : '' }}
          </li>
        </ul>
        <div
          :class="{ actions: newPresentation }"
          :style="newPresentation ? undefined : { display: 'contents' }"
        >
          <button
            v-if="role === 'OWNER'"
            type="button"
            class="secondary"
            :disabled="busy"
            @click="edit(plan)"
          >
            {{ newPresentation ? 'Ubah tarif' : 'Ubah tarif / keaktifan' }}
          </button><button
            v-if="newPresentation && role === 'OWNER'"
            type="button"
            class="danger icon-delete"
            :title="`Hapus tarif ${plan.name}`"
            :aria-label="`Hapus tarif ${plan.name}`"
            :disabled="busy"
            @click="deletePlan(plan)"
          >
            <OutlineIcon name="trash" />
          </button>
        </div>
      </article>
    </div>
    <p v-if="!loading && !error && !plans.length">
      Belum ada tarif.
    </p>
    <component
      :is="newPresentation ? 'dialog' : 'div'"
      v-if="draft && role === 'OWNER'"
      ref="editor"
      :class="newPresentation ? 'rate-editor-dialog' : undefined"
      :aria-labelledby="newPresentation ? 'rate-editor-title' : undefined"
      @cancel.prevent="closeEditor"
      @keydown="trapEditorFocus"
    >
      <form
        aria-label="Editor tarif"
        :aria-busy="busy"
        :class="newPresentation ? undefined : 'panel'"
        @submit.prevent="save"
      >
        <h3 id="rate-editor-title">
          {{ newPresentation ? (editing ? `Ubah Tarif ${editing.name}` : 'Tambah Tarif') : editing ? 'Ubah tarif' : 'Tarif baru' }}
        </h3>
        <p
          v-if="newPresentation && error"
          role="alert"
          class="error"
        >
          {{ error }}
        </p>
        <fieldset :disabled="busy">
          <label>Nama tarif *<input
            v-model="draft.name"
            required
            :autofocus="newPresentation"
            maxlength="100"
          ></label>
          <label>Waktu penyelesaian<select v-model="draft.turnaroundPolicy"><option value="REGULAR">Reguler · 5 hari kalender, batas 12:00 WIB</option><option value="FAST">Fast · besok 17:00 WIB, batas masuk 17:00 WIB</option></select></label>
          <p>{{ turnaroundText(draft.turnaroundPolicy) }}</p>
          <label class="checkbox"><input
            v-model="draft.isActive"
            type="checkbox"
          > Tarif aktif untuk pesanan baru</label>
          <p>Paket: jumlah pasangan tetap, harga total satu paket. Per pasang: harga satuan untuk rentang jumlah pasangan; batas atas kosong berarti tanpa batas. Perhitungan kombinasi ditentukan server.</p>
          <fieldset
            v-for="(rule, index) in draft.rules"
            :key="index"
          >
            <legend>Aturan {{ index + 1 }}</legend>
            <div class="form-grid">
              <label>Jenis aturan<select
                v-model="rule.kind"
                @change="changeKind(rule)"
              ><option value="PACKAGE">Paket · harga total paket</option><option value="PER_PAIR">Per pasang · harga satuan</option></select></label>
              <label>{{ rule.kind === 'PACKAGE' ? 'Jumlah pasang dalam paket' : 'Minimal pasang' }}<input
                v-model.number="rule.minPairs"
                type="number"
                min="1"
                step="1"
                required
                @input="rule.kind === 'PACKAGE' && (rule.maxPairs = rule.minPairs)"
              ></label>
              <label v-if="rule.kind === 'PER_PAIR'">Maksimal pasang (kosong = tanpa batas)<input
                :value="rule.maxPairs"
                type="number"
                :min="rule.minPairs"
                step="1"
                @input="rule.maxPairs = ($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value)"
              ></label>
              <label>{{ rule.kind === 'PACKAGE' ? 'Harga total paket (Rp)' : 'Harga per pasang (Rp)' }}<input
                v-model.number="rule.priceIdr"
                type="number"
                min="1"
                max="100000000"
                step="1"
                required
              ></label>
            </div>
            <button
              type="button"
              class="danger"
              @click="draft.rules.splice(index, 1)"
            >
              Hapus aturan {{ index + 1 }}
            </button>
          </fieldset>
          <button
            type="button"
            class="secondary"
            @click="draft.rules.push({ kind: 'PER_PAIR', minPairs: 1, maxPairs: null, priceIdr: 1 })"
          >
            Tambah aturan
          </button>
          <p
            v-if="validation"
            role="status"
          >
            {{ validation }}
          </p>
          <label>Jumlah pasang pratinjau<input
            v-model.number="pairs"
            type="number"
            min="1"
            max="50"
            step="1"
            required
          ></label>
          <PricingPreview
            v-if="!validation && Number.isInteger(pairs) && pairs > 0 && pairs <= 50"
            :rules="draft.rules"
            :pairs="pairs"
          />
          <div class="actions">
            <button :disabled="!!validation">
              {{ busy ? 'Menyimpan…' : newPresentation ? 'Simpan' : 'Simpan tarif' }}
            </button><button
              type="button"
              class="secondary"
              @click="closeEditor"
            >
              {{ newPresentation ? 'Batal' : 'Batal edit' }}
            </button>
          </div>
        </fieldset>
      </form>
    </component>
  </section>
</template>
