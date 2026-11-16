<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { handoverLabels, type PricingPreview } from '../services/domain';
import logo from '../assets/logo.webp';
import { whatsappNumber, whatsappUrl } from '../services/contact';

const name = ref('');
const address = ref('');
const quantity = ref(1);
const notes = ref('');
const error = ref('');
type PublicPlan = { id: string; name: string; turnaroundPolicy: 'REGULAR' | 'FAST'; quotes: (PricingPreview & { pairs: number })[] };
const plans = ref<PublicPlan[]>([]);
const planId = ref('');
const method = ref('PICKUP');
const handoverInfo: Record<string, string> = {
  STORE: 'Kamu mengantar sepatu langsung ke toko. Minta alamat toko dan konfirmasi waktu kedatangan lewat WhatsApp sebelum berangkat.',
  PICKUP: 'Tim Cicuci Sepatu menjemput sepatu di alamat yang kamu isi. Jadwal penjemputan disepakati lewat WhatsApp.',
  MEETUP: 'Kamu dan tim Cicuci Sepatu bertemu di lokasi janjian untuk menyerahkan sepatu. Lokasi dan waktunya disepakati lewat WhatsApp.',
  COURIER: 'Sepatu diserahkan melalui kurir. Pengaturan kurir, alamat tujuan, dan jadwal dikonfirmasi lewat WhatsApp sebelum pengiriman.',
};
const loading = ref(true);
const catalogError = ref('');
const selectedPlan = computed(() => plans.value.find(plan => plan.id === planId.value));
const quote = computed(() => selectedPlan.value?.quotes.find(value => value.pairs === quantity.value));
const locationLabel = computed(() => method.value === 'PICKUP' ? 'Alamat Penjemputan' : method.value === 'MEETUP' ? 'Lokasi Janjian' : 'Alamat Pengambilan Kurir');
const pickupPolicy = 'Gratis penjemputan sekitar Lippo Karawaci. Cakupan alamat dikonfirmasi admin. Di luar area, biaya dikonfirmasi admin.';
const rupiah = (value: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
const tariffLines = computed(() => quote.value?.breakdown.map(line => `${line.quantity} × ${line.kind === 'PACKAGE' ? `paket ${line.pairs} pasang` : 'per pasang'} @ ${rupiah(line.priceIdr)} = ${rupiah(line.totalIdr)}`) ?? []);
async function loadCatalog() {
  loading.value = true;
  catalogError.value = '';
  try {
    const response = await fetch('/api/v1/public/catalog', { credentials: 'omit' });
    if (!response.ok) throw new Error('Tarif gagal dimuat. Silakan coba lagi.');
    const data = await response.json() as { plans: PublicPlan[] };
    plans.value = data.plans;
    planId.value = plans.value[0]?.id ?? '';
  } catch {
    catalogError.value = 'Tarif gagal dimuat. Silakan coba lagi.';
  } finally { loading.value = false; }
}
onMounted(loadCatalog);

function submit() {
  error.value = '';
  if (!name.value.trim() || (method.value !== 'STORE' && !address.value.trim()) || !Object.hasOwn(handoverLabels, method.value) || !Number.isSafeInteger(quantity.value) || quantity.value < 1 || quantity.value > 50 || !selectedPlan.value || !quote.value) {
    error.value = 'Isi nama, tarif, lokasi penyerahan, dan jumlah 1–50 pasang sepatu.';
    return;
  }
  const text = [
    'Halo Cicuci Sepatu, saya ingin pesan cuci sepatu.',
    '',
    `Nama: ${name.value.trim()}`,
    '',
    `Tarif: ${selectedPlan.value.name}`,
    `Pengerjaan: ${selectedPlan.value.turnaroundPolicy === 'FAST' ? 'Cepat' : 'Reguler'}`,
    `Jumlah sepatu: ${quantity.value} pasang`,
    '',
    ...tariffLines.value,
    `Estimasi biaya cuci: ${rupiah(quote.value.totalIdr)} (belum final)`,
    '',
    `Metode penyerahan: ${handoverLabels[method.value]}`,
    ...(method.value === 'STORE' ? [] : [`${locationLabel.value}: ${address.value.trim()}`]),
    ...(method.value === 'PICKUP' ? [pickupPolicy] : method.value === 'COURIER' ? ['Biaya kurir dikonfirmasi admin, belum termasuk estimasi biaya cuci.'] : []),
    '',
    `Catatan: ${notes.value.trim() || '-'}`,
    '',
    'Mohon konfirmasi layanan, biaya, dan waktu pengerjaannya. Terima kasih.',
  ].join('\n');
  // ponytail: Hanya menyiapkan chat, tanpa menyimpan pesanan; tambah API saat perlu pencatatan otomatis.
  window.location.assign(`https://api.whatsapp.com/send/?${new URLSearchParams({ phone: whatsappNumber, text })}`);
}
</script>

<template>
  <div class="order-page">
    <header>
      <a
        href="/"
        aria-label="Beranda Cicuci Sepatu"
      ><img
        :src="logo"
        alt="Cicuci Sepatu"
        width="112"
        height="64"
      ></a>
    </header>
    <main id="main-content">
      <div class="order-intro">
        <svg
          class="intro-shoe"
          viewBox="0 0 120 88"
          fill="none"
          aria-hidden="true"
        >
          <circle
            cx="60"
            cy="44"
            r="38"
            fill="#d5eaff"
          />
          <path
            d="M25 47l8-22 17 12 12-6c3 13 12 17 28 20 7 1 12 7 12 14H24c-6 0-8-12 1-18Z"
            fill="white"
            stroke="#28679e"
            stroke-width="2.5"
            stroke-linejoin="round"
          />
          <path
            d="M22 57h78M54 39l-7 7m16-2-6 7m15-3-5 6"
            stroke="#28679e"
            stroke-width="2.5"
            stroke-linecap="round"
          />
          <path
            d="M93 18v10m-5-5h10M18 19v6m-3-3h6"
            stroke="#5599d2"
            stroke-width="2.5"
            stroke-linecap="round"
          />
        </svg>
        <h1>Yuk, Cicuci-in Sepatumu!</h1>
        <p class="intro">
          Pilih tarif, isi detailnya, lalu lanjutkan lewat WhatsApp.
        </p>
      </div>
      <form @submit.prevent="submit">
        <fieldset class="form-section">
          <legend><span aria-hidden="true">1</span> Data Pemesan</legend>
          <label for="order-name">Nama Lengkap</label>
          <input
            id="order-name"
            v-model="name"
            autocomplete="name"
            required
            maxlength="100"
            placeholder="Nama kamu"
          >
        </fieldset>
        <fieldset class="form-section">
          <legend><span aria-hidden="true">2</span> Detail Cucian</legend>
          <p
            v-if="loading"
            role="status"
          >
            Memuat tarif…
          </p>
          <div
            v-else-if="catalogError"
            role="alert"
          >
            <p>{{ catalogError }}</p>
            <button
              type="button"
              @click="loadCatalog"
            >
              Coba lagi
            </button>
          </div>
          <p
            v-else-if="!plans.length"
            role="status"
          >
            Belum ada tarif aktif. Silakan hubungi <a :href="whatsappUrl">WhatsApp toko</a> untuk konsultasi.
          </p>
          <label for="order-plan">Pilihan Tarif</label>
          <select
            id="order-plan"
            v-model="planId"
            required
            :disabled="loading || !plans.length"
          >
            <option
              v-for="plan in plans"
              :key="plan.id"
              :value="plan.id"
            >
              {{ plan.name }} — {{ plan.turnaroundPolicy === 'FAST' ? 'Cepat' : 'Reguler' }}
            </option>
          </select>
          <label for="order-quantity">Jumlah Pasang Sepatu</label>
          <input
            id="order-quantity"
            v-model.number="quantity"
            type="number"
            inputmode="numeric"
            required
            min="1"
            max="50"
            step="1"
          >
          <section
            v-if="quote"
            class="estimate"
            aria-live="polite"
            aria-label="Estimasi biaya cuci"
          >
            <span class="estimate-label">Estimasi Biaya Cuci</span>
            <strong class="estimate-amount">{{ rupiah(quote.totalIdr) }}</strong>
            <ul>
              <li
                v-for="line in tariffLines"
                :key="line"
              >
                {{ line }}
              </li>
            </ul>
            <p class="hint">
              Harga akhir dikonfirmasi setelah pemeriksaan. Biaya penyerahan di luar ketentuan gratis belum termasuk.
            </p>
          </section>
        </fieldset>
        <fieldset class="form-section">
          <legend><span aria-hidden="true">3</span> Penyerahan Sepatu</legend>
          <label for="order-method">Metode Penyerahan</label>
          <select
            id="order-method"
            v-model="method"
            aria-describedby="handover-info"
          >
            <option
              v-for="(label, key) in handoverLabels"
              :key="key"
              :value="key"
            >
              {{ label }}
            </option>
          </select>
          <p
            id="handover-info"
            class="hint"
          >
            {{ handoverInfo[method] }}
          </p>
          <p
            v-if="method === 'PICKUP'"
            id="pickup-policy"
            class="hint"
          >
            {{ pickupPolicy }}
          </p>
          <p
            v-else-if="method === 'COURIER'"
            class="hint"
          >
            Biaya kurir dikonfirmasi admin, belum termasuk estimasi biaya cuci.
          </p>
          <template v-if="method !== 'STORE'">
            <label for="order-address">{{ locationLabel }}</label>
            <textarea
              id="order-address"
              v-model="address"
              autocomplete="street-address"
              required
              maxlength="500"
              rows="3"
              :placeholder="method === 'MEETUP' ? 'Nama tempat, titik temu, dan area/kota' : 'Jalan, nomor rumah, kelurahan, kecamatan, kota'"
              :aria-describedby="method === 'PICKUP' ? 'pickup-policy' : undefined"
            />
          </template>
        </fieldset>
        <label for="order-notes">Catatan <span>(opsional)</span></label>
        <textarea
          id="order-notes"
          v-model="notes"
          maxlength="1000"
          rows="3"
          placeholder="Contoh: 2 sneakers, noda membandel. Mau konsultasi layanan dulu."
        />
        <p
          v-if="error"
          role="alert"
        >
          {{ error }}
        </p>
        <button
          type="submit"
          :disabled="loading || !!catalogError || !quote"
        >
          Lanjut ke WhatsApp
        </button>
        <p class="submit-help">
          Detail form akan diteruskan ke WhatsApp. Tekan Kirim di sana untuk menghubungi admin; pesanan belum otomatis tercatat.
        </p>
      </form>
    </main>
    <footer>© {{ new Date().getFullYear() }} Cicuci Sepatu</footer>
  </div>
</template>

<style scoped>
.order-page{min-height:100dvh;background:linear-gradient(145deg,#f7fbff,#e5f2ff);color:#102f5c;padding:16px 20px 0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:15px;font-weight:400;line-height:1.6}
header{max-width:1040px;margin:auto;display:flex;align-items:center;justify-content:center;gap:16px;padding:12px 0}
header img{object-fit:contain}a{color:inherit;text-underline-offset:4px}
header{box-sizing:border-box;margin-top:0;padding:8px 16px;background:#ffffffd9;border:1px solid #d9e8fa;border-radius:18px;box-shadow:0 3px 16px #173c6806}header>a:first-child{display:flex;align-items:center;flex-shrink:0}header img{display:block}
main{max-width:620px;margin:24px auto 0;padding:clamp(20px,5vw,40px);background:white;border:1px solid #d9e8fa;border-radius:24px}
h1{font-size:clamp(26px,5vw,36px);line-height:1.2;margin:12px 0}p{line-height:1.6}.eyebrow{font-weight:700;font-size:14px;color:#415f7d}
form{display:grid;gap:12px;margin-top:28px}label{font-weight:600;font-size:14px;margin-top:8px}label span{font-weight:400}
input,textarea,select{box-sizing:border-box;width:100%;min-width:0;font:inherit;padding:12px;border:1px solid #91acc8;border-radius:10px;background:white;color:#102f5c}textarea{resize:vertical}
.estimate{padding:16px;background:#f3f9ff;border-radius:12px}.estimate ul{padding-left:20px}.estimate .hint{margin-bottom:0}button:disabled{opacity:.6;cursor:not-allowed}select:focus-visible{outline:3px solid #e18b00;outline-offset:3px}
.hint{font-size:14px;color:#415f7d}button{font:inherit;font-weight:500;min-height:48px;border:0;border-radius:12px;background:#102f5c;color:white;padding:14px;cursor:pointer}
button:hover{background:#19477f}[role=alert]{color:#a32020}a:focus-visible,input:focus-visible,textarea:focus-visible,button:focus-visible{outline:3px solid #e18b00;outline-offset:3px}
.intro{color:#415f7d;margin:0}h1{font-size:clamp(24px,5vw,32px);font-weight:750;line-height:1.3;letter-spacing:-.5px;margin:0 0 12px;text-wrap:balance}header{max-width:620px}header>a:last-child{font-size:13px}main{box-shadow:0 10px 36px #173c6810}.form-section{display:grid;gap:10px;min-width:0;padding:20px 0 24px;margin:0;border:0;border-bottom:1px solid #e2edf7;border-radius:0}.form-section legend{display:flex;align-items:center;gap:10px;padding:0;font-size:16px;font-weight:650}.form-section legend>span{display:grid;place-items:center;width:28px;height:28px;background:#e6f3ff;border-radius:9px;font-size:13px;color:#2873ad}.order-page :is(input,textarea,select){font-size:16px;min-height:48px;margin:0 0 6px;border-color:#c0d3e5;background:#fbfdff;line-height:1.5}.order-page :is(input,textarea,select):focus{background:#fff}.estimate{margin-top:8px;border:1px solid #d5e7f9;padding:18px}.estimate-label{font-size:13px;color:#415f7d}.estimate-amount{display:block;font-size:28px;font-weight:700;line-height:1.3;margin:6px 0 14px;letter-spacing:-.5px}.estimate ul{padding:12px 0 0;margin:0;border-top:1px solid #d5e7f9;list-style:none;font-size:13px;line-height:1.7}.estimate .hint{font-size:13px}.form-section>.hint{margin:0 0 6px;padding:12px 14px;border:1px solid #d9e8fa;border-radius:10px;background:#f3f9ff;font-size:13px}.submit-help{margin:0;text-align:center;color:#61758b;font-size:13px;line-height:1.6}form>button{margin-top:8px;font-size:15px}footer{text-align:center;color:#415f7d;font-size:13px;font-weight:500;padding:12px 0 24px}[role=alert]{padding:12px;border-radius:10px;background:#fff4f4}
h1,.form-section legend,.estimate-label{font-weight:700}.estimate-amount{font-weight:600;color:#185c95}button{font-weight:500}footer{font-weight:400}
.form-section legend{color:#264e73}.form-section legend>span{background:#dceeff;color:#21689f}.estimate{background:linear-gradient(120deg,#edf6ff,#f6fbff);border-color:#c5dff6}form>button{background:#174b78;box-shadow:0 4px 12px #174b781a}form>button:hover{background:#123e65}
.order-intro{position:relative;isolation:isolate;overflow:hidden;padding:24px;border:1px solid #d6e8f8;border-radius:20px;background:linear-gradient(125deg,#e8f4ff,#f5faff)}.intro-shoe{display:block;width:100px;height:74px;margin-bottom:12px}.order-intro h1{max-width:360px}.order-intro .intro{max-width:380px}.form-section{padding:16px 20px 20px;border:1px solid #e0eaf4;border-radius:16px;background:#fbfdff}.form-section legend{padding:0 8px;margin-left:-8px}.form-section legend>span{border:3px solid white;box-sizing:content-box}.order-page :is(input,textarea,select){background:white}.estimate{background:#eaf4ff}.order-intro::after{content:"";position:absolute;z-index:-1;width:180px;height:180px;right:-75px;top:-65px;border:24px solid #dcedfb;border-radius:50%;opacity:.7}
@media(max-width:480px){.order-page{padding-inline:16px}header img{width:99px;height:58px}main{margin-top:16px;padding:20px}.order-intro{padding:20px}.form-section{padding:14px 14px 20px}.estimate{padding:14px}}
</style>
