<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api } from '../services/auth';
import { handoverLabels, turnaroundText, type Customer, type Order, type Page, type RatePlan } from '../services/domain';
import PricingPreview from './PricingPreview.vue';
import { useUnsavedChanges } from '../services/unsaved';
const newPresentation = inject('newPresentation', ref(false));
const emit = defineEmits<{ created: [order: Order]; cancel: [] }>();
const customers = ref<Customer[]>([]); const query = ref(''); const cursor = ref<string | null>(null); const customerId = ref(''); const pickup = ref(''); const busy = ref(false); const error = ref('');
const handoverMethod = ref('STORE'); const handoverLocation = ref(''); const handoverNote = ref(''); const saveHandoverPreference = ref(false);
const mode = ref<'existing' | 'new'>('existing');
const searching = ref(false); const searchError = ref('');
const selectedCustomer = ref<Customer>();
watch(mode, () => { handoverMethod.value = 'STORE'; handoverLocation.value = ''; handoverNote.value = ''; saveHandoverPreference.value = false; });
const customerSearch = ref<HTMLInputElement>(); const customerError = ref('');
function chooseCustomer(customer: Customer) {
  if (searching.value || searchError.value || !customers.value.some(c => c.id === customer.id)) return;
  selectedCustomer.value = customer; customerId.value = customer.id; customerError.value = '';
  handoverMethod.value = customer.preferredHandoverMethod || 'STORE'; handoverLocation.value = customer.preferredHandoverLocation || ''; handoverNote.value = ''; saveHandoverPreference.value = false;
}
async function changeCustomer() {
  selectedCustomer.value = undefined; customerId.value = ''; query.value = '';
  handoverMethod.value = 'STORE'; handoverLocation.value = ''; handoverNote.value = ''; saveHandoverPreference.value = false;
  await nextTick(); customerSearch.value?.focus();
}
function searchEnter() {
  if (!searching.value && !searchError.value && customers.value.length === 1 && !cursor.value) chooseCustomer(customers.value[0]!);
  else { customerError.value = 'Pilih pelanggan dari hasil pencarian terlebih dahulu.'; }
}
function focusResult(event: KeyboardEvent, offset: number) {
  const buttons = Array.from(event.currentTarget instanceof HTMLElement ? event.currentTarget.closest('.customer-picker')!.querySelectorAll<HTMLButtonElement>('[data-customer-result]') : []);
  const index = buttons.indexOf(event.currentTarget as HTMLButtonElement);
  if (index + offset < 0) customerSearch.value?.focus();
  else buttons[Math.min(index + offset, buttons.length - 1)]?.focus();
}
const newCustomer = ref({ salutation: 'Kak', name: '', whatsapp: '', notes: '', notificationConsent: false });
const createdCustomerId = ref('');
const customerKey = crypto.randomUUID(); const orderKey = crypto.randomUUID();
let searchTimer: ReturnType<typeof setTimeout> | undefined; let searchSeq = 0;
function shoe() { return { brand: '', model: '', color: '', initialNotes: '', assignedUserId: '' }; }
const items = ref([shoe()]);
const dirty = computed(() => !!query.value || !!customerId.value || !!newCustomer.value.name || !!newCustomer.value.whatsapp || items.value.some(item => !!item.brand || !!item.model || !!item.initialNotes));
useUnsavedChanges(dirty);
function cancel() { if (!dirty.value || window.confirm('Batalkan pesanan baru? Input belum disimpan akan hilang.')) emit('cancel'); }
const plans = ref<RatePlan[]>([]); const ratePlanId = ref(''); const plansLoading = ref(true); const plansError = ref(''); const previewReady = ref(false);
const activePlans = computed(() => plans.value.filter(p => p.isActive));
const selectedPlan = computed(() => activePlans.value.find(p => p.id === ratePlanId.value));
const pricingReady = computed(() => !plansLoading.value && !plansError.value && !!selectedPlan.value && previewReady.value);
async function loadPlans() {
  plansLoading.value = true; plansError.value = ''; previewReady.value = false;
  try {
    plans.value = await api<RatePlan[]>('/pricing/plans');
    if (!activePlans.value.some(p => p.id === ratePlanId.value)) ratePlanId.value = '';
  } catch (e) { plans.value = []; ratePlanId.value = ''; plansError.value = e instanceof Error ? e.message : 'Tarif gagal dimuat.'; }
  finally { plansLoading.value = false; }
}
watch([ratePlanId, () => items.value.length], () => { previewReady.value = false; }, { flush: 'sync' });
onMounted(loadPlans);
async function search(next = false) {
  if (!query.value.trim()) return;
  const seq = ++searchSeq; searching.value = true; searchError.value = '';
  try {
    const result = await api<Page<Customer>>(`/customers?limit=25&q=${encodeURIComponent(query.value)}${next && cursor.value ? `&cursor=${cursor.value}` : ''}`);
    if (seq !== searchSeq) return;
    customers.value = next ? [...customers.value, ...result.data] : result.data; cursor.value = result.page.nextCursor;
  } catch (e) {
    if (seq !== searchSeq) return;
    searchError.value = e instanceof Error ? e.message : 'Pencarian pelanggan gagal.';
  } finally { if (seq === searchSeq) searching.value = false; }
}
watch(query, () => { if (selectedCustomer.value) { handoverMethod.value = 'STORE'; handoverLocation.value = ''; handoverNote.value = ''; saveHandoverPreference.value = false; } clearTimeout(searchTimer); ++searchSeq; customerId.value = ''; selectedCustomer.value = undefined; customerError.value = ''; customers.value = []; cursor.value = null; searching.value = !!query.value.trim(); searchError.value = ''; if (searching.value) searchTimer = setTimeout(() => search(), 250); }, { flush: 'sync' });
onBeforeUnmount(() => { clearTimeout(searchTimer); ++searchSeq; });
async function run(task: () => Promise<void>) { busy.value = true; error.value = ''; try { await task(); } catch (e) { error.value = e instanceof Error ? e.message : 'Permintaan gagal.'; } finally { busy.value = false; } }
async function save() {
  if (busy.value) return;
  if (!pricingReady.value) { error.value = 'Pilih tarif aktif dan tunggu estimasi server sebelum menyimpan.'; return; }
  if (mode.value === 'existing' && (!customerId.value || customerId.value !== selectedCustomer.value?.id)) { customerError.value = 'Pilih pelanggan dari hasil pencarian terlebih dahulu.'; customerSearch.value?.focus(); return; }
  if (handoverMethod.value !== 'STORE' && !handoverLocation.value.trim()) { error.value = 'Lokasi wajib diisi.'; return; }
  await run(async () => {
    let id = customerId.value;
    if (mode.value === 'new') {
      if (!createdCustomerId.value) {
        const created = await api<Customer>('/customers', 'POST', { salutation: newCustomer.value.salutation, name: newCustomer.value.name, whatsapp: newCustomer.value.whatsapp, notes: newCustomer.value.notes || null, notificationConsent: newCustomer.value.notificationConsent }, false, customerKey);
        createdCustomerId.value = created.id;
      }
      id = createdCustomerId.value;
    }
    const result = await api<Order>('/orders', 'POST', { customerId: id, pickupInstructions: pickup.value, saveHandoverPreference: saveHandoverPreference.value, handover: { method: handoverMethod.value, location: handoverMethod.value === 'STORE' ? '' : handoverLocation.value.trim(), note: handoverNote.value.trim() }, ratePlanId: ratePlanId.value, items: items.value.map(i => ({ brand: i.brand, model: i.model, color: i.color, initialNotes: i.initialNotes, assignedUserId: i.assignedUserId || null })) }, false, orderKey);
    emit('created', result);
  });
}
</script>
<template>
  <section class="panel create-order">
    <div
      v-if="!newPresentation"
      class="section-heading"
    >
      <h1>Pesanan Baru</h1>
    </div>
    <Teleport
      to="#create-order-actions"
      :disabled="!newPresentation"
    >
      <button
        class="danger cancel-order"
        :disabled="busy"
        @click="cancel"
      >
        Batal
      </button>
    </Teleport><p
      v-if="error"
      role="alert"
      class="error"
    >
      {{ error }}
    </p>
    <form
      :aria-busy="busy"
      @submit.prevent="save"
    >
      <fieldset
        class="customer-picker"
        :disabled="busy"
      >
        <legend>Pelanggan *</legend>
        <div
          class="mode-toggle"
          role="radiogroup"
          aria-label="Jenis pelanggan"
        >
          <label><input
            v-model="mode"
            name="customer-mode"
            type="radio"
            value="existing"
          > Pelanggan lama</label><label><input
            v-model="mode"
            name="customer-mode"
            type="radio"
            value="new"
          > Pelanggan Baru</label>
        </div>
        <template v-if="mode === 'existing'">
          <label for="customer-search">Cari pelanggan</label><input
            id="customer-search"
            ref="customerSearch"
            v-model="query"
            type="search"
            maxlength="100"
            autocomplete="off"
            :aria-invalid="!!customerError"
            aria-describedby="customer-feedback"
            placeholder="Nama atau nomor WhatsApp"
            @keydown.enter.prevent="searchEnter"
            @keydown.down.prevent="focusResult($event, 1)"
          >
          <div id="customer-feedback">
            <p
              v-if="customerError"
              role="alert"
              class="error"
            >
              {{ customerError }}
            </p>
            <p
              v-if="selectedCustomer"
              role="status"
              class="notice"
            >
              Pelanggan terpilih: <strong>{{ selectedCustomer.name }}</strong> · {{ selectedCustomer.whatsapp }}
              <button
                type="button"
                class="secondary"
                @click="changeCustomer"
              >
                Ganti pelanggan
              </button>
            </p>
            <p
              v-else-if="searching"
              role="status"
            >
              Mencari…
            </p>
            <p
              v-else-if="searchError"
              role="alert"
              class="error"
            >
              {{ searchError }}
            </p>
            <p
              v-else-if="query.trim() && !customers.length"
              role="status"
              class="muted"
            >
              Tidak ada pelanggan cocok. Pilih “Pelanggan baru” untuk menambahkan.
            </p>
            <p
              v-else-if="customers.length"
              role="status"
              class="sr-only"
            >
              {{ customers.length }} hasil pencarian.
            </p>
          </div>
          <ul
            v-if="!selectedCustomer && !searching && !searchError && customers.length"
            aria-label="Hasil pencarian pelanggan"
          >
            <li
              v-for="customer in customers"
              :key="customer.id"
            >
              <button
                type="button"
                class="secondary customer-result"
                data-customer-result
                @click="chooseCustomer(customer)"
                @keydown.down.prevent="focusResult($event, 1)"
                @keydown.up.prevent="focusResult($event, -1)"
              >
                {{ customer.name }} · {{ customer.whatsapp }}
              </button>
            </li>
          </ul>
          <button
            v-if="cursor && !selectedCustomer"
            type="button"
            class="secondary"
            :disabled="searching"
            @click="search(true)"
          >
            Muat lebih banyak
          </button>
          <button
            v-if="searchError"
            type="button"
            class="secondary"
            @click="search()"
          >
            Ulangi pencarian
          </button>
        </template>
        <template v-else>
          <p
            v-if="createdCustomerId"
            class="notice"
            role="status"
          >
            Pelanggan sudah tersimpan. Pesanan belum tersimpan; tekan “Buat pesanan” untuk mencoba lagi tanpa membuat pelanggan ganda.
          </p>
          <div class="form-grid">
            <label>Sapaan<select
              v-model="newCustomer.salutation"
              aria-label="Sapaan"
              :disabled="!!createdCustomerId"
            ><option>Kak</option><option>Pak</option><option>Bu</option><option>Om</option><option>Tante</option></select></label>
            <label>Nama *<input
              v-model="newCustomer.name"
              required
              maxlength="100"
              :disabled="!!createdCustomerId"
            ></label><label>Nomor WhatsApp *<input
              v-model="newCustomer.whatsapp"
              required
              maxlength="30"
              :disabled="!!createdCustomerId"
              placeholder="08…, 62… atau +62…"
            ></label><label class="checkbox"><input
              v-model="newCustomer.notificationConsent"
              type="checkbox"
              :disabled="!!createdCustomerId"
            > Pelanggan menyetujui notifikasi WhatsApp</label>
          </div>
          <p class="muted">
            Opt-in WhatsApp terpisah dari persetujuan risiko. Centang hanya dengan izin pelanggan.
          </p>
        </template>
      </fieldset>
      <fieldset :disabled="busy">
        <legend>Tarif dan estimasi</legend>
        <label>{{ newPresentation ? 'Tarif Pesanan' : 'Tarif pesanan' }}<select
          v-model="ratePlanId"
          required
          :disabled="plansLoading || !!plansError"
        ><option
          value=""
          disabled
        >Pilih tarif aktif</option><option
          v-for="plan in activePlans"
          :key="plan.id"
          :value="plan.id"
        >{{ plan.name }}</option></select></label>
        <p
          v-if="plansLoading"
          role="status"
        >
          Memuat tarif…
        </p>
        <p
          v-else-if="plansError"
          role="alert"
          class="error"
        >
          {{ plansError }}
        </p>
        <p
          v-else-if="!activePlans.length"
          role="alert"
        >
          Tidak ada tarif aktif. Hubungi pemilik.
        </p>
        <button
          type="button"
          class="secondary"
          :disabled="plansLoading"
          @click="loadPlans"
        >
          Muat ulang tarif
        </button>
        <p class="muted">
          {{ selectedPlan ? turnaroundText(selectedPlan.turnaroundPolicy) : 'Pilih tarif untuk melihat ketentuan estimasi selesai.' }}
        </p>
        <PricingPreview
          v-if="selectedPlan && !plansLoading && !plansError"
          :key="selectedPlan.id"
          :rules="selectedPlan.rules"
          :pairs="items.length"
          @ready="previewReady = $event"
        />
        <p class="muted">
          Estimasi mencakup semua pasangan. Harga final ditetapkan setelah pemeriksaan; risiko pencucian memerlukan persetujuan pelanggan. Sepatu ditolak: Rp0.
        </p>
        <p class="muted">
          {{ newPresentation ? 'Rincian tarif dan aturan paket tersedia di menu Tarif Pesanan.' : 'Rincian tarif dan aturan paket tersedia di menu Tarif pesanan.' }}
        </p>
      </fieldset>
      <fieldset
        v-for="(item, index) in items"
        :key="index"
      >
        <legend>Sepatu {{ index + 1 }}</legend><div class="form-grid">
          <label>Merek *<input
            v-model="item.brand"
            required
            maxlength="100"
          ></label><label>Model (opsional)<input
            v-model="item.model"
            maxlength="100"
          ></label><label>Warna (opsional)<input
            v-model="item.color"
            maxlength="100"
          ></label><label>ID petugas (opsional)<input
            v-model="item.assignedUserId"
            maxlength="50"
            pattern="[a-zA-Z0-9_-]+"
          ></label>
        </div><button
          v-if="items.length > 1"
          type="button"
          class="danger"
          @click="items.splice(index, 1)"
        >
          Hapus sepatu {{ index + 1 }}
        </button>
      </fieldset>
      <button
        type="button"
        class="secondary add-shoe"
        :disabled="items.length >= 50 || busy"
        @click="items.push(shoe())"
      >
        Tambah sepatu
      </button>
      <fieldset :disabled="busy">
        <legend>Metode penyerahan</legend>
        <label>Metode<select
          v-model="handoverMethod"
          required
        ><option value="STORE">Di toko</option><option value="PICKUP">Dijemput</option><option value="MEETUP">Janjian</option><option value="COURIER">Kurir</option></select></label>
        <label v-if="handoverMethod !== 'STORE'">Lokasi *<textarea
          v-model="handoverLocation"
          required
          maxlength="4000"
        /></label>
        <label>Catatan penyerahan (opsional)<textarea
          v-model="handoverNote"
          maxlength="4000"
        /></label>
        <label><input
          v-model="saveHandoverPreference"
          type="checkbox"
        > Simpan metode dan lokasi sebagai preferensi pelanggan</label>
        <p class="muted">
          Metode, lokasi dan catatan terlihat oleh pelanggan.
        </p>
      </fieldset>
      <label>Instruksi pengambilan (opsional)<textarea
        v-model="pickup"
        maxlength="4000"
      /></label>
      <div class="actions">
        <section
          class="order-review"
          aria-label="Ringkasan sebelum menyimpan"
        >
          <h3>Periksa Sebelum Menyimpan</h3><dl><div><dt>Pelanggan</dt><dd>{{ mode === 'new' ? newCustomer.name || 'Belum diisi' : selectedCustomer?.name || 'Belum dipilih' }}</dd></div><div><dt>Tarif</dt><dd>{{ selectedPlan?.name || 'Belum dipilih' }}</dd></div><div><dt>Sepatu</dt><dd>{{ items.length }} pasang</dd></div><div><dt>Penyerahan</dt><dd>{{ handoverLabels[handoverMethod] }}{{ handoverLocation ? ` · ${handoverLocation}` : '' }}</dd></div></dl><p class="muted">
            Periksa estimasi tarif di atas. Harga akhir mengikuti pemeriksaan sepatu.
          </p>
        </section>
        <span>{{ items.length }} pasang</span><button :disabled="busy || !pricingReady">
          {{ busy ? 'Menyimpan…' : 'Buat pesanan' }}
        </button>
      </div><p class="muted">
        Foto sebelum pencucian diunggah melalui detail setelah pesanan dibuat. Penawaran bukan biaya final.
      </p><p class="muted">
        Menyimpan pesanan tidak menjamin WhatsApp terkirim. Notifikasi memerlukan persetujuan pelanggan, koneksi siap, dan aktivasi pemilik. Hasil pencatatan notifikasi ditampilkan setelah pesanan disimpan.
      </p>
    </form>
  </section>
</template>

<style scoped>
.customer-result { width: 100%; text-align: left; white-space: normal; overflow-wrap: anywhere; margin-bottom: .5rem; }
button.cancel-order { background: #b91c1c; border-color: #b91c1c; color: #fff; font-weight: 700; }
button.cancel-order:hover:not(:disabled) { background: #991b1b; border-color: #991b1b; }
.create-order { max-width: 900px; }
.shoe-notes { grid-column: 1 / -1; }
.add-shoe { margin-bottom: 1rem; }
.order-review{flex-basis:100%;padding:18px;border:1px solid #d9e6f3;border-radius:12px;background:#f5f9ff}.order-review h3{font-size:15px;margin:0 0 12px}.order-review dl{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:0}.order-review dt{font-size:12px;color:#61758b}.order-review dd{margin:4px 0 0;font-size:14px;overflow-wrap:anywhere}.order-review p{font-size:12px}@media(max-width:600px){.order-review dl{grid-template-columns:1fr}}
@media (max-width: 700px) { .shoe-notes { grid-column: auto; } }
</style>
