<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, ApiError } from '../services/auth';
import { photoInput, type Item } from '../services/domain';
const props = defineProps<{ item: Item; mode: 'inspection' | 'ready'; smart?: boolean }>();
const emit = defineEmits<{ close: []; saved: [result: { consent?: { approvalToken: string; expiresAt: string } }] }>();
const dialog = ref<HTMLDialogElement>();
const findings = ref(''); const customerNote = ref('');
const outcome = ref('APPROVED'); const notes = ref(''); const risk = ref(''); const price = ref(props.item.quotedPriceIdr);
const dry = ref(false); const finishing = ref(false); const qc = ref(false); const busy = ref(false); const error = ref('');
const files = ref<Record<string, File | undefined>>({});
const uploads = new Map<File, { key: ReturnType<typeof crypto.randomUUID>; saved: boolean }>();
let finalRequest: { signature: string; key: ReturnType<typeof crypto.randomUUID> } | undefined;
const inspection = computed(() => props.mode === 'inspection');
const kinds = computed(() => inspection.value ? ['BEFORE', ...(outcome.value === 'NEEDS_CONSENT' ? ['INSPECTION'] : [])] : ['AFTER']);
function hasPhoto(kind: string) { return props.item.photos.some(p => p.kind === kind && (kind !== 'AFTER' || p.customerVisible)); }
function select(kind: string, event: Event) { files.value[kind] = (event.target as HTMLInputElement).files?.[0]; }
const activationWarning = ref('');
async function checkCapability() {
  const unsupported = 'Inspeksi terstruktur belum aktif. Deployment diperlukan: minta owner mengotorisasi migrasi dan aktivasi API baru. Isian tetap di form; belum ada unggahan atau pemeriksaan yang dikirim.';
  try {
    activationWarning.value = (await api<{ structuredRiskConsent?: boolean }>('/settings/inspection-capabilities')).structuredRiskConsent === true ? '' : unsupported;
  } catch (e) {
    activationWarning.value = e instanceof ApiError && e.status === 404 ? unsupported : `Gagal memeriksa dukungan inspeksi: ${e instanceof Error ? e.message : 'Permintaan gagal.'} Belum ada unggahan atau pemeriksaan yang dikirim. Isian tetap di form; coba simpan lagi setelah masalah diperbaiki.`;
  }
  return !activationWarning.value;
}
onMounted(() => { dialog.value?.showModal(); if (inspection.value) void checkCapability(); });
async function save() {
  if (busy.value) return;
  busy.value = true; error.value = '';
  try {
    if (inspection.value && outcome.value === 'NEEDS_CONSENT' && [findings.value, risk.value].some(v => v.trim().length < 3 || !/[\p{L}\p{N}]/u.test(v))) throw new Error('Isi Temuan dan Risiko, minimal 3 karakter bermakna.');
    if (inspection.value && !await checkCapability()) return;
    if (!inspection.value && !(dry.value && finishing.value && qc.value)) throw new Error('Konfirmasi kering, finishing selesai, dan QC lulus.');
    for (const kind of kinds.value) if (kind !== 'INSPECTION' && !hasPhoto(kind) && !files.value[kind]) throw new Error('Lengkapi foto wajib.');
    for (const kind of kinds.value) {
      const file = files.value[kind]; if (!file) continue;
      let upload = uploads.get(file);
      if (!upload) { upload = { key: crypto.randomUUID(), saved: false }; uploads.set(file, upload); }
      if (!upload.saved) {
        await api(`/items/${props.item.id}/photos`, 'POST', { ...await photoInput(file), kind, customerVisible: kind !== 'INSPECTION' }, false, upload.key);
        upload.saved = true;
      }
    }
    const payload = inspection.value ? { outcome: outcome.value, notes: notes.value, findings: findings.value.trim(), customerNote: customerNote.value.trim(), risk: outcome.value === 'NEEDS_CONSENT' ? risk.value : '', ...(props.smart ? {} : { quotedPriceIdr: price.value }) } : { toStatus: 'READY_FOR_PICKUP', reason: notes.value, qcPassed: qc.value, dryConfirmed: dry.value, finishingConfirmed: finishing.value };
    const signature = JSON.stringify(payload);
    if (finalRequest?.signature !== signature) finalRequest = { signature, key: crypto.randomUUID() };
    const result = await api<{ consent?: { approvalToken: string; expiresAt: string } }>(`/items/${props.item.id}/${inspection.value ? 'inspection' : 'transition'}`, 'POST', payload, false, finalRequest.key);
    emit('saved', result); emit('close');
  } catch (e) { error.value = e instanceof Error ? e.message : 'Penyimpanan gagal. Coba lagi; foto tersimpan tidak diunggah ulang.'; }
  finally { busy.value = false; }
}
</script>
<template>
  <dialog
    ref="dialog"
    aria-labelledby="workflow-title"
    @cancel="busy ? $event.preventDefault() : emit('close')"
  >
    <form
      :aria-busy="busy"
      @submit.prevent="save"
    >
      <h2 id="workflow-title">
        {{ inspection ? 'Pemeriksaan sepatu' : 'Siap diambil' }}
      </h2>
      <p>{{ item.brand }} {{ item.model }} · {{ item.color }}</p>
      <p
        v-if="error"
        role="alert"
        class="error"
      >
        {{ error }}
      </p>
      <fieldset :disabled="busy">
        <template v-if="inspection">
          <label for="workflow-outcome">Hasil pemeriksaan</label>
          <select
            id="workflow-outcome"
            v-model="outcome"
            required
          >
            <option value="APPROVED">
              Aman dikerjakan
            </option><option value="NEEDS_CONSENT">
              Perlu persetujuan risiko
            </option><option value="REJECTED">
              Ditolak · biaya cuci nol
            </option>
          </select>
          <p v-if="smart">
            Harga otomatis dari paket pesanan. Ditolak/tidak menyetujui risiko: Rp0. Total final menunggu semua keputusan.
          </p>
          <template v-else>
            <label for="workflow-price">Penawaran (Rp)</label><input
              id="workflow-price"
              v-model.number="price"
              type="number"
              min="0"
              max="100000000"
              step="1"
              required
            >
          </template>
          <template v-if="outcome === 'NEEDS_CONSENT'">
            <label for="workflow-findings">Temuan untuk Customer</label><textarea
              id="workflow-findings"
              v-model="findings"
              required
              minlength="3"
              maxlength="3000"
            />
            <label for="workflow-risk">Risiko untuk Customer</label><textarea
              id="workflow-risk"
              v-model="risk"
              minlength="3"
              required
              maxlength="3000"
            />
          </template>
          <label for="workflow-customer-note">Catatan untuk Customer (Opsional)</label><textarea
            id="workflow-customer-note"
            v-model="customerNote"
            maxlength="3000"
          />
        </template>
        <div
          v-for="kind in kinds"
          :key="kind"
          class="field"
        >
          <label :for="`workflow-${kind}`">{{ kind === 'BEFORE' ? 'Foto sebelum pengerjaan' : kind === 'INSPECTION' ? 'Foto risiko · privat (opsional)' : 'Foto sesudah pengerjaan' }} · PNG/JPEG maksimum 10 MiB</label>
          <p
            v-if="hasPhoto(kind)"
            class="muted"
          >
            Foto tersimpan tersedia. Tambahan opsional.
          </p>
          <input
            :id="`workflow-${kind}`"
            type="file"
            accept="image/png,image/jpeg"
            :required="kind !== 'INSPECTION' && !hasPhoto(kind) && !files[kind]"
            @change="select(kind, $event)"
          >
        </div>
        <label for="workflow-notes">Catatan {{ inspection ? 'pemeriksaan internal (opsional)' : 'penyelesaian' }}</label><textarea
          id="workflow-notes"
          v-model="notes"
          maxlength="4000"
        />
        <template v-if="!inspection">
          <label><input
            v-model="dry"
            type="checkbox"
            required
          >Sepatu sudah kering</label>
          <label><input
            v-model="finishing"
            type="checkbox"
            required
          >Finishing selesai</label>
          <label><input
            v-model="qc"
            type="checkbox"
            required
          >Lulus pemeriksaan mutu (QC)</label>
        </template>
      </fieldset>
      <p class="muted">
        Foto disimpan dahulu. Gagal unggah tidak mengubah status. Hasil pemeriksaan permanen; pembayaran terpisah.
      </p>
      <p
        v-if="activationWarning"
        role="alert"
        class="error"
      >
        {{ activationWarning }}
      </p>
      <div class="actions">
        <button
          type="button"
          class="secondary"
          :disabled="busy"
          @click="emit('close')"
        >
          Batal
        </button><button :disabled="busy">
          {{ busy ? 'Menyimpan…' : inspection ? 'Simpan pemeriksaan' : 'Konfirmasi siap diambil' }}
        </button>
      </div>
    </form>
  </dialog>
</template>
