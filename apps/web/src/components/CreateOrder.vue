<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api } from '../services/auth';
import { turnaroundText, type Customer, type Order, type Page, type RatePlan } from '../services/domain';
import PricingPreview from './PricingPreview.vue';
const newPresentation = inject('newPresentation', ref(false));
const emit = defineEmits<{ created: [order: Order]; cancel: [] }>();
const customers = ref<Customer[]>([]); const query = ref(''); const cursor = ref<string | null>(null); const customerId = ref(''); const pickup = ref(''); const busy = ref(false); const error = ref('');
const mode = ref<'existing' | 'new'>('existing');
const searching = ref(false); const searchError = ref('');
const selectedCustomer = ref<Customer>();
const customerSearch = ref<HTMLInputElement>(); const customerError = ref('');
function chooseCustomer(customer: Customer) {
  if (searching.value || searchError.value || !customers.value.some(c => c.id === customer.id)) return;
  selectedCustomer.value = customer; customerId.value = customer.id; customerError.value = '';
}
async function changeCustomer() {
  selectedCustomer.value = undefined; customerId.value = ''; query.value = '';
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
watch(query, () => { clearTimeout(searchTimer); ++searchSeq; customerId.value = ''; selectedCustomer.value = undefined; customerError.value = ''; customers.value = []; cursor.value = null; searching.value = !!query.value.trim(); searchError.value = ''; if (searching.value) searchTimer = setTimeout(() => search(), 250); }, { flush: 'sync' });
onBeforeUnmount(() => { clearTimeout(searchTimer); ++searchSeq; });
async function run(task: () => Promise<void>) { busy.value = true; error.value = ''; try { await task(); } catch (e) { error.value = e instanceof Error ? e.message : 'Permintaan gagal.'; } finally { busy.value = false; } }
async function save() {
  if (busy.value) return;
  if (!pricingReady.value) { error.value = 'Pilih tarif aktif dan tunggu estimasi server sebelum menyimpan.'; return; }
  if (mode.value === 'existing' && (!customerId.value || customerId.value !== selectedCustomer.value?.id)) { customerError.value = 'Pilih pelanggan dari hasil pencarian terlebih dahulu.'; customerSearch.value?.focus(); return; }
  await run(async () => {
    let id = customerId.value;
    if (mode.value === 'new') {
      if (!createdCustomerId.value) {
        const created = await api<Customer>('/customers', 'POST', { salutation: newCustomer.value.salutation, name: newCustomer.value.name, whatsapp: newCustomer.value.whatsapp, notes: newCustomer.value.notes || null, notificationConsent: newCustomer.value.notificationConsent }, false, customerKey);
        createdCustomerId.value = created.id;
      }
      id = createdCustomerId.value;
    }
    const result = await api<Order>('/orders', 'POST', { customerId: id, pickupInstructions: pickup.value, ratePlanId: ratePlanId.value, items: items.value.map(i => ({ brand: i.brand, model: i.model, color: i.color, initialNotes: i.initialNotes, assignedUserId: i.assignedUserId || null })) }, false, orderKey);
    emit('created', result);
  });
}
</script>
<template>
  <section class="panel">
    <div class="section-heading">
      <component :is="newPresentation ? 'h2' : 'h1'">
        {{ newPresentation ? 'Data Pesanan' : 'Pesanan baru' }}
      </component><button
        class="secondary"
        :disabled="busy"
        @click="emit('cancel')"
      >
        Batal
      </button>
    </div><p
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
          > Pelanggan baru</label>
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
            ><option>Kak</option><option>Pak</option><option>Bu</option></select></label>
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
            ></label><label>Catatan internal<textarea
              v-model="newCustomer.notes"
              maxlength="4000"
              :disabled="!!createdCustomerId"
            /></label><label class="checkbox"><input
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
      <div class="form-grid">
        <p class="muted">
          {{ selectedPlan ? turnaroundText(selectedPlan.turnaroundPolicy) : 'Pilih tarif untuk melihat ketentuan estimasi selesai.' }}
        </p><label>Instruksi pengambilan<textarea
          v-model="pickup"
          maxlength="4000"
        /></label>
      </div>
      <fieldset :disabled="busy">
        <legend>Harga paket otomatis · 1 item = 1 pasang</legend>
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
        <PricingPreview
          v-if="selectedPlan && !plansLoading && !plansError"
          :key="selectedPlan.id"
          :rules="selectedPlan.rules"
          :pairs="items.length"
          @ready="previewReady = $event"
        />
        <p>Layanan cuci sepatu otomatis. Total awal menghitung semua pasangan; final setelah pemeriksaan dan keputusan risiko. Harga wajib disetujui sebelum pengerjaan. Ditolak: Rp0.</p>
        <p>{{ newPresentation ? 'Rincian tarif dan aturan paket tersedia di menu Tarif Pesanan.' : 'Rincian tarif dan aturan paket tersedia di menu Tarif pesanan.' }}</p>
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
          ></label><label>Catatan internal<textarea
            v-model="item.initialNotes"
            maxlength="4000"
          /></label>
        </div><button
          v-if="items.length > 1"
          type="button"
          class="danger"
          @click="items.splice(index, 1)"
        >
          Hapus sepatu {{ index + 1 }}
        </button>
      </fieldset>
      <div class="actions">
        <button
          type="button"
          class="secondary"
          :disabled="items.length >= 50 || busy"
          @click="items.push(shoe())"
        >
          Tambah sepatu
        </button><button :disabled="busy || !pricingReady">
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
</style>
