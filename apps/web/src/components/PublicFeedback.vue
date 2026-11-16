<script setup lang="ts">
import { onMounted, ref } from 'vue';
import logo from '../assets/logo.webp';
import { api, ApiError } from '../services/auth';
import { date, type Feedback, type TrackingOrder } from '../services/domain';
const props = defineProps<{ token: string }>();
const order = ref<TrackingOrder>(); const error = ref(''); const busy = ref(false);
const rating = ref(0); const review = ref(''); const feedbackBusy = ref(false); const feedbackError = ref(''); const feedbackDuplicate = ref(false);
const ratingLabels = ['Sangat Kurang', 'Kurang Puas', 'Cukup Puas', 'Puas', 'Sangat Puas'];
const publicationConsent = ref(false);
async function submitFeedback() {
  if (feedbackBusy.value || busy.value || !order.value?.feedbackEligible || order.value.feedback || feedbackDuplicate.value) return;
  const text = review.value.trim();
  feedbackError.value = '';
  if (!Number.isInteger(rating.value) || rating.value < 1 || rating.value > 5 || !text || text.length > 1000) { feedbackError.value = 'Pilih nilai 1–5 dan isi ulasan 1–1000 karakter.'; return; }
  feedbackBusy.value = true;
  try {
    const feedback = await api<Feedback>(`/track/${props.token}/feedback`, 'POST', { rating: rating.value, review: text, publicationConsent: publicationConsent.value }, true);
    order.value.feedback = feedback; order.value.feedbackEligible = false;
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      feedbackDuplicate.value = true;
      feedbackError.value = 'Ulasan pesanan ini sudah tersimpan. Muat ulang halaman untuk melihatnya.';
    } else feedbackError.value = e instanceof Error ? e.message : 'Ulasan gagal dikirim.';
  } finally { feedbackBusy.value = false; }
}
async function load() {
  busy.value = true; error.value = '';
  try { order.value = await api<TrackingOrder>(`/track/${props.token}`, 'GET', undefined, true); feedbackDuplicate.value = false; feedbackError.value = ''; }
  catch (e) { order.value = undefined; error.value = e instanceof Error ? e.message : 'Pesanan gagal dimuat.'; }
  finally { busy.value = false; }
}
onMounted(load);
</script>
<template>
  <div class="feedback-page">
    <header class="feedback-header">
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
    <main
      id="main-content"
      class="public-feedback"
      :class="{ 'feedback-complete': order?.feedback }"
    >
      <div
        v-if="order?.feedback"
        class="success-mark"
        aria-hidden="true"
      >
        ✓
      </div>
      <h1>{{ order?.feedback ? 'Ulasan Terkirim' : 'Gimana Hasil Cuci Sepatumu?' }}</h1>
      <p class="feedback-intro">
        {{ order?.feedback ? 'Terima kasih! Masukanmu membantu kami memberikan perawatan yang lebih baik.' : 'Penilaianmu membantu kami jadi lebih baik.' }}
      </p>
      <p
        v-if="order?.feedback"
        class="sr-only"
        role="status"
      >
        Ulasan berhasil disimpan.
      </p>
      <p
        v-if="error"
        class="error"
        role="alert"
      >
        {{ error }}
      </p>
      <p
        v-if="busy"
        role="status"
      >
        Memuat…
      </p>
      <template v-if="order">
        <p class="order-number">
          <span>Nomor Pesanan</span><strong>{{ order.number }}</strong>
        </p>
        <section
          v-if="order.feedback || order.feedbackEligible === true"
          class="panel feedback"
          aria-label="Form dan hasil ulasan"
        >
          <template v-if="order.feedback">
            <p
              class="saved-rating"
              :aria-label="`Nilai: ${order.feedback.rating} dari 5 bintang`"
            >
              <span aria-hidden="true">{{ '★'.repeat(order.feedback.rating) }}<span class="empty-stars">{{ '☆'.repeat(5 - order.feedback.rating) }}</span></span>
              <strong>{{ ratingLabels[order.feedback.rating - 1] }}</strong>
            </p>
            <p class="feedback-review">
              {{ order.feedback.review }}
            </p>
            <p class="feedback-date">
              Dikirim {{ date(order.feedback.createdAt) }}
            </p>
          </template>
          <form
            v-else
            :aria-busy="feedbackBusy"
            @submit.prevent="submitFeedback"
          >
            <fieldset
              class="rating-picker"
              :disabled="feedbackBusy || feedbackDuplicate"
              aria-describedby="rating-description"
            >
              <legend>Seberapa Puas Kamu?</legend>
              <div class="rating-stars">
                <label
                  v-for="value in 5"
                  :key="value"
                  class="star-choice"
                  :class="{ selected: value <= rating }"
                >
                  <input
                    v-model.number="rating"
                    type="radio"
                    name="feedback-rating"
                    :value="value"
                    :aria-label="`${value} bintang — ${ratingLabels[value - 1]}`"
                    required
                  >
                  <span aria-hidden="true">★</span>
                </label>
              </div>
              <p
                id="rating-description"
                aria-live="polite"
              >
                {{ rating ? ratingLabels[rating - 1] : 'Ketuk bintang untuk memberi nilai' }}
              </p>
            </fieldset>
            <label for="feedback-review">Ulasan Singkat</label>
            <textarea
              id="feedback-review"
              v-model="review"
              required
              maxlength="1000"
              rows="5"
              placeholder="Apa yang kamu suka? Apa yang perlu kami perbaiki?"
              aria-describedby="feedback-help"
              :disabled="feedbackBusy || feedbackDuplicate"
            />
            <p id="feedback-help">
              <span>Ceritakan dengan jujur, ya.</span><span>{{ review.length }} / 1000</span>
            </p>
            <p
              v-if="feedbackError"
              class="error"
              role="alert"
            >
              {{ feedbackError }}
            </p>
            <label class="publication-consent">
              <input
                v-model="publicationConsent"
                type="checkbox"
                :disabled="feedbackBusy || feedbackDuplicate"
              >
              <span>Saya mengizinkan rating dan ulasan ini ditampilkan di website dengan nama disamarkan. Publikasi tetap menunggu persetujuan admin. Jangan sertakan nomor telepon, alamat, atau data pribadi dalam ulasan. <span class="consent-optional">Opsional, tidak memengaruhi layanan.</span></span>
            </label>
            <button :disabled="feedbackBusy || busy || feedbackDuplicate">
              {{ feedbackBusy ? 'Mengirim…' : 'Kirim Ulasan' }}
            </button>
            <p class="submit-note">
              Pastikan sudah sesuai. Ulasan hanya bisa dikirim sekali, tidak dapat diubah.
            </p>
          </form>
        </section>
        <p
          v-if="!order.feedback && order.feedbackEligible !== true"
          role="status"
        >
          Ulasan tersedia setelah seluruh sepatu diserahkan atau dikembalikan.
        </p>
      </template>
    </main>
    <footer>© {{ new Date().getFullYear() }} Cicuci Sepatu</footer>
  </div>
</template>
<style scoped>
.feedback-page{min-height:100dvh;padding:0 20px;background:linear-gradient(145deg,#f7fbff,#e5f2ff);color:#102f5c;font-family:ui-rounded,"Arial Rounded MT Bold",Nunito,system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;-webkit-text-size-adjust:100%;text-size-adjust:100%}
.feedback-header{max-width:620px;margin:auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:28px 0 0}
.feedback-header img{display:block;object-fit:contain}.feedback-page a{color:#102f5c;text-underline-offset:4px}.feedback-header>a:last-child{font-size:14px;font-weight:600}
.public-feedback{max-width:620px;margin:24px auto 0;padding:clamp(20px,5vw,40px);border:1px solid #d9e8fa;border-radius:24px;background:#fff;box-shadow:0 10px 36px #173c6810}
h1{font-size:clamp(24px,5vw,32px);font-weight:750;line-height:1.3;letter-spacing:-.5px;margin:0 0 14px;word-break:normal;overflow-wrap:normal;text-wrap:balance}h2{font-size:18px;font-weight:700;line-height:1.4;letter-spacing:-.2px;margin:0 0 18px}p{line-height:1.65}.feedback-intro{color:#415f7d;margin:0 0 20px;font-size:15px;text-wrap:pretty}
.feedback-page button{font:inherit;font-weight:700;border:1px solid transparent;border-radius:12px;min-height:48px;padding:12px 18px;background:#102f5c;color:white;cursor:pointer}.feedback-page button:hover:not(:disabled){background:#19477f}.feedback-page button:disabled{opacity:.55;cursor:not-allowed}
.order-number{display:grid;gap:5px;margin:20px 0 0;padding:14px 16px;background:#f3f9ff;border-radius:12px;overflow-wrap:anywhere}.order-number span{font-size:14px;color:#61758b}.order-number strong{font-size:16px;font-weight:600;color:#102f5c;letter-spacing:.02em}
.feedback{margin:24px 0 0;padding:24px 0 0;border:0;border-top:1px solid #d9e8fa;border-radius:0;background:transparent;box-shadow:none}.feedback form{display:grid;gap:10px}.feedback form>p:first-child{margin:0 0 8px;color:#415f7d;font-size:14px}
label{font-weight:700;font-size:14px}.feedback select,.feedback textarea{box-sizing:border-box;width:100%;min-width:0;margin:0 0 10px;padding:12px 14px;border:1px solid #91acc8;border-radius:10px;background:white;color:#102f5c;font:inherit;min-height:48px}.feedback textarea{resize:vertical}.feedback #feedback-help{margin:-12px 0 8px;font-size:13px;color:#415f7d}
.feedback-review{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f9ff;padding:16px;border-radius:12px}.saved-rating{font-weight:700;color:#102f5c}.tracking-link{margin:24px 0 0;text-align:center;font-size:14px;font-weight:600}.error{color:#a32020;background:#fff4f4;padding:12px 14px;border-radius:10px}.feedback-page :focus-visible{outline:3px solid #e18b00;outline-offset:3px}footer{max-width:620px;margin:0 auto;padding:24px 0 32px;text-align:center;font-size:12px;line-height:1.6;color:#415f7d}
.rating-picker{min-width:0;margin:0 0 16px;padding:22px 12px 16px;border:1px solid #d9e8fa;border-radius:18px;background:#f5faff;text-align:center}.rating-picker legend{padding:0 10px;font-size:15px;font-weight:700}.rating-stars{display:flex;justify-content:center;gap:clamp(4px,2vw,12px)}.star-choice{position:relative;display:grid;place-items:center;width:48px;height:52px;cursor:pointer;color:#b3c5d7}.star-choice input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}.star-choice>span{font-size:44px;line-height:1;transition:color .15s,transform .15s;pointer-events:none}.star-choice.selected{color:#d58a00}.star-choice:hover>span{transform:scale(1.12)}.star-choice:has(input:focus-visible){outline:3px solid #e18b00;outline-offset:3px;border-radius:8px}.star-choice:has(input:disabled){cursor:not-allowed;opacity:.6}.rating-picker p{min-height:24px;margin:10px 0 0;font-size:14px;color:#415f7d}.feedback #feedback-help{display:flex;justify-content:space-between;gap:12px;font-size:12px}.submit-note{margin:0;text-align:center;color:#61758b;font-size:12px;line-height:1.6}.saved-rating>span{display:block;color:#d58a00;font-size:36px;letter-spacing:4px}.saved-rating strong{display:block;margin-top:6px;font-size:15px}.empty-stars{color:#b3c5d7}.feedback textarea{border-color:#c0d3e5;background:#fbfdff}.feedback textarea:focus{background:#fff}.feedback-intro{max-width:48ch}
.feedback-intro{max-width:none;text-wrap:pretty}
.feedback textarea{font-size:16px;line-height:1.6}.feedback textarea::placeholder{color:#687e94;opacity:1}.feedback form>button{font-size:15px}.feedback #feedback-help,.submit-note,footer{font-size:13px}.feedback-eyebrow{letter-spacing:.02em;text-transform:none}.feedback-header>a:last-child{font-size:14px}.feedback #feedback-help{flex-wrap:wrap}
@media(max-width:480px){.feedback-page{padding:0 16px}.public-feedback{margin-top:20px}.feedback-header img{width:99px;height:58px}.feedback-header>a:last-child{font-size:13px}}
@media(max-width:360px){.rating-picker{padding-inline:8px}.rating-stars{gap:0}.star-choice{flex:0 0 44px}.star-choice>span{font-size:38px}}
.tracking-link a{display:inline-flex;align-items:center;min-height:44px}.feedback-header a{border-radius:8px}.feedback textarea{scroll-margin-block:24px}
.success-mark{display:grid;place-items:center;width:56px;height:56px;margin:0 auto 20px;background:#e6f3ff;border:1px solid #c8e3fa;border-radius:50%;color:#19477f;font-size:28px;font-weight:700}.feedback-complete h1,.feedback-complete .feedback-intro{text-align:center}.feedback-complete .feedback-intro{max-width:38ch;margin-inline:auto}.feedback-complete .saved-rating{text-align:center;margin:0 0 20px}.feedback-complete .feedback-review{margin:0;padding:18px;font-size:16px;line-height:1.7;border:1px solid #e0edf8}.feedback-date{margin:12px 0 0;text-align:center;font-size:13px;color:#61758b}
.publication-consent{display:flex;align-items:flex-start;gap:10px;padding:12px 0;font-size:13px;font-weight:400;line-height:1.6;color:#415f7d}.publication-consent input{flex-shrink:0;margin:3px 0 0;accent-color:#102f5c}.consent-optional{display:block;margin-top:4px;color:#61758b}
footer{padding:12px 0 24px;font-weight:500}
@media(prefers-reduced-motion:reduce){.star-choice>span{transition:none}.star-choice:hover>span{transform:none}}
</style>
