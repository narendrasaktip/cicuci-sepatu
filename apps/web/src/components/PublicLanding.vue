<script setup lang="ts">
import { onMounted, ref } from 'vue';
import logo from '../assets/logo.webp';
import { whatsappUrl } from '../services/contact';
const menuOpen = ref(false);
const year = new Date().getFullYear();
const reviews = ref<{ name: string; rating: number; review: string }[]>([]);
const reviewTrack = ref<HTMLDivElement>();
const nextReviewCursor = ref<string | null>(null);
const reviewsBusy = ref(false);
const reviewsError = ref('');
async function loadReviews() {
  if (reviewsBusy.value) return false;
  reviewsBusy.value = true; reviewsError.value = '';
  try {
    const query = nextReviewCursor.value ? `?${new URLSearchParams({ cursor: nextReviewCursor.value })}` : '';
    const response = await fetch(`/api/v1/public/feedback${query}`, { credentials: 'omit' });
    if (!response.ok) throw new Error();
    const result = await response.json();
    reviews.value.push(...result.data); nextReviewCursor.value = result.nextCursor ?? null;
    return true;
  } catch { reviewsError.value = 'Ulasan berikutnya gagal dimuat. Coba lagi.'; return false; }
  finally { reviewsBusy.value = false; }
}
async function moveReviews(direction: number) {
  const track = reviewTrack.value;
  if (!track || reviewsBusy.value) return;
  if (direction > 0 && track.scrollLeft + track.clientWidth >= track.scrollWidth - 4 && nextReviewCursor.value && !await loadReviews()) return;
  requestAnimationFrame(() => {
    const end = track.scrollWidth - track.clientWidth;
    const left = direction > 0 && track.scrollLeft >= end - 4 ? 0 : direction < 0 && track.scrollLeft <= 4 ? end : track.scrollLeft + direction * ((track.firstElementChild?.getBoundingClientRect().width ?? track.clientWidth) + 16);
    track.scrollTo({ left, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  });
}
let reviewTouchX = 0;
let reviewTouchAtEnd = false;
function reviewTouchStart(event: TouchEvent) {
  reviewTouchX = event.touches[0]?.clientX ?? 0;
  const track = reviewTrack.value;
  reviewTouchAtEnd = !!track && track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
}
function reviewTouchEnd(event: TouchEvent) {
  if (reviewTouchAtEnd && reviewTouchX - (event.changedTouches[0]?.clientX ?? reviewTouchX) > 40) void moveReviews(1);
}
function reviewScrollEnd() {
  const track = reviewTrack.value;
  if (track && track.scrollLeft > 0 && track.scrollLeft + track.clientWidth >= track.scrollWidth - 4 && nextReviewCursor.value) void loadReviews();
}
const sampleReviews = import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === 'ulasan';
onMounted(async () => {
  if (sampleReviews) {
    reviews.value = [
      { name: 'A***', rating: 5, review: 'Contoh tampilan: sepatu bersih, pelayanan ramah. Ini bukan ulasan pelanggan asli.' },
      { name: 'B***', rating: 4, review: 'Contoh tampilan: prosesnya jelas, bisa pantau progres lewat tracking.' },
      { name: 'C***', rating: 5, review: 'Contoh tampilan: terbantu layanan jemput sekitar Lippo Karawaci.' },
      { name: 'D***', rating: 4, review: 'Contoh tampilan ulasan lebih panjang untuk mengecek kenyamanan baca dan geser kartu pada layar handphone.' },
    ];
    return;
  }
  await loadReviews();
});
</script>

<template>
  <div class="site">
    <header class="header">
      <div class="wrap nav">
        <a
          class="brand"
          href="#beranda"
          aria-label="Cicuci Sepatu"
        ><img
          :src="logo"
          alt="Logo Cicuci Sepatu"
        ></a><nav class="navlinks">
          <a href="#beranda">Beranda</a><a href="#layanan">Layanan</a><a href="#cara-kerja">Cara Pesan</a><a
            v-if="reviews.length"
            href="#ulasan"
          >Ulasan</a><a href="#faq">FAQ</a>
        </nav><a
          class="navcta"
          href="/pesan"
        >Pesan Sekarang</a><button
          class="hamburger"
          type="button"
          :aria-expanded="menuOpen"
          aria-controls="mobileMenu"
          :aria-label="menuOpen ? 'Tutup menu' : 'Buka menu'"
          @click="menuOpen = !menuOpen"
        >
          <svg
            viewBox="0 0 24 24"
            width="24"
            height="24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path
              v-if="menuOpen"
              d="m6 6 12 12M18 6 6 18"
            />
            <path
              v-else
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
        </button>
      </div><nav
        id="mobileMenu"
        class="mobile-menu"
        :class="{ open: menuOpen }"
        aria-label="Navigasi seluler"
        @click="menuOpen = false"
      >
        <a href="#beranda">Beranda</a><a href="#layanan">Layanan</a><a href="#cara-kerja">Cara Pesan</a><a
          v-if="reviews.length"
          href="#ulasan"
        >Ulasan</a><a href="#faq">FAQ</a><a href="/pesan">Pesan Sekarang</a><a href="#kontak">Kontak</a>
      </nav>
    </header>
    <main id="main-content">
      <section
        id="beranda"
        class="hero"
      >
        <div class="wrap hero-grid">
          <div class="hero-copy">
            <h1>Sepatu Kotor?<br><span class="hero-highlight">Cicuci-in Aja!</span></h1><p>Sepatu kesayanganmu butuh perawatan? Kenali layanan Cicuci Sepatu dan konsultasikan kondisinya dengan kami.</p><div class="hero-actions">
              <a
                class="btn primary"
                href="/pesan"
              >Pesan Sekarang <span>→</span></a><a
                class="btn"
                href="#tracking"
              >Cara Melacak Pesanan</a>
            </div>
            <p class="pickup-promise">
              Gratis jemput sekitar Lippo Karawaci. <span>Cakupan dikonfirmasi admin.</span>
            </p>
          </div><div class="hero-art">
            <img
              :src="logo"
              alt="Logo Cicuci Sepatu dengan karakter dan tulisan Cicuci Sepatu"
            >
          </div>
        </div>
      </section>
      <div class="wrap">
        <div class="trust">
          <div><span class="ico">♢</span><span>Perawatan<br>sesuai material</span></div><div><span class="ico">ϟ</span><span>Proses<br>terpantau</span></div><div><span class="ico">✧</span><span>Sepatu<br>lebih terawat</span></div>
        </div>
      </div>
      <section
        id="layanan"
        class="content"
      >
        <div class="wrap">
          <h2 class="section-title">
            Layanan Cicuci Sepatu
          </h2><div class="services">
            <article class="service">
              <span class="shoe">👟</span><h3>Pemeriksaan Kondisi</h3><p>Material, noda, dan risiko diperiksa agar penanganan sesuai kondisi sepatu.</p>
            </article><article class="service">
              <span class="shoe">🥾</span><h3>Pencucian Sepatu</h3><p>Sepatu yang dapat ditangani masuk proses pencucian.</p>
            </article><article class="service">
              <span class="shoe">👞</span><h3>Pemeriksaan Hasil</h3><p>Hasil pencucian diperiksa sebelum sepatu siap dikembalikan.</p>
            </article>
          </div>
        </div>
      </section>
      <section
        id="cara-kerja"
        class="content"
      >
        <div class="wrap">
          <h2 class="section-title">
            Cara Pesan
          </h2><div class="steps">
            <div class="step">
              <span class="step-icon">📋</span>1. Pesan &<br>Konsultasi
            </div><div class="step">
              <span class="step-icon">🔎</span>2. Serahkan &<br>Periksa Sepatu
            </div><div class="step">
              <span class="step-icon">🫧</span>3. Cuci &<br>Perawatan
            </div><div class="step">
              <span class="step-icon">✅</span>4. Sepatu Siap<br>Diserahkan
            </div>
          </div>
        </div>
      </section>
      <section class="content">
        <div class="wrap">
          <h2 class="section-title">
            Kenapa Cicuci Sepatu?
          </h2><div class="why">
            <div><b>♢</b> Kondisi sepatu diperiksa</div><div><b>◷</b> Proses terpantau</div><div><b>◇</b> Konfirmasi Sebelum Pengerjaan</div><div><b>☆</b> Perawatan sesuai kebutuhan</div>
          </div><div
            id="tracking"
            class="notice"
          >
            <strong>📦 Tracking Pesanan</strong><p>Gunakan tautan tracking pribadi yang diberikan setelah pesanan dicatat. Simpan tautan tersebut agar tidak diakses orang lain.</p>
          </div>
        </div>
      </section>
      <section
        id="faq"
        class="content"
      >
        <div class="wrap">
          <h2 class="section-title">
            Pertanyaan Umum (FAQ)
          </h2><div class="faq">
            <details><summary>Berapa lama proses pencucian?</summary><p>Waktu pengerjaan bergantung pada jenis layanan dan kondisi sepatu. Estimasi tersedia pada pesanan. Harga akhir ditentukan setelah pemeriksaan; pencucian berisiko memerlukan persetujuanmu.</p></details><details><summary>Apakah semua jenis sepatu bisa dicuci?</summary><p>Tidak selalu. Kondisi dan material sepatu diperiksa terlebih dahulu. Jika tidak memungkinkan untuk dicuci, admin akan menginformasikannya.</p></details><details><summary>Bagaimana jika hasil cuci tidak maksimal?</summary><p>Kami akan menginformasikan potensi keterbatasan hasil berdasarkan kondisi sepatu sebelum proses dilanjutkan.</p></details>
          </div>
          <div class="faq">
            <details><summary>Apakah ada layanan jemput sepatu?</summary><p>Gratis penjemputan sekitar Lippo Karawaci. Cakupan alamat dikonfirmasi admin. Untuk luar area, biaya dikonfirmasi sebelum penjemputan. Pilih metode Dijemput saat mengisi form pemesanan.</p></details>
          </div>
        </div>
      </section>
      <section
        v-if="reviews.length"
        id="ulasan"
        class="content customer-reviews"
        aria-labelledby="reviews-title"
      >
        <div class="wrap">
          <h2
            id="reviews-title"
            class="section-title"
          >
            Kata Pelanggan
          </h2>
          <p class="reviews-intro">
            {{ sampleReviews ? 'PREVIEW — Data contoh, bukan ulasan pelanggan asli.' : 'Pengalaman langsung dari pelanggan Cicuci Sepatu.' }}
          </p>
          <p
            v-if="reviews.length > 1"
            class="reviews-swipe-hint"
          >
            Geser untuk ulasan lainnya
          </p>
          <div
            ref="reviewTrack"
            class="reviews-grid"
            tabindex="0"
            role="region"
            aria-label="Ulasan pelanggan, geser untuk melihat lainnya"
            @scrollend="reviewScrollEnd"
            @touchstart.passive="reviewTouchStart"
            @touchend.passive="reviewTouchEnd"
            @keydown.right.prevent="moveReviews(1)"
            @keydown.left.prevent="moveReviews(-1)"
          >
            <article
              v-for="(review, index) in reviews"
              :key="index"
              class="review-card"
            >
              <h3>{{ review.name }}</h3>
              <p
                class="review-stars"
                :aria-label="`${review.rating} dari 5 bintang`"
              >
                <span aria-hidden="true">{{ '★'.repeat(review.rating) }}<span class="review-empty-stars">{{ '☆'.repeat(5 - review.rating) }}</span></span>
              </p>
              <p class="review-comment">
                {{ review.review }}
              </p>
            </article>
          </div>
          <p
            v-if="reviewsBusy"
            role="status"
          >
            Memuat ulasan…
          </p>
          <p
            v-if="reviewsError"
            role="alert"
          >
            {{ reviewsError }}
          </p>
        </div>
      </section>
      <section
        id="kontak"
        class="content"
      >
        <div class="wrap">
          <div
            class="notice"
            style="text-align:center;margin-top:0"
          >
            <h2 style="margin:0 0 8px;color:#102f5c">
              Yuk, Cicuci-in Sepatumu!
            </h2><p>Pilih tarif dan cek estimasi di form pemesanan, atau konsultasikan kondisi sepatumu lewat WhatsApp.</p>
            <div class="contact-actions">
              <a
                class="btn primary"
                href="/pesan"
              >Pesan Sekarang</a>
              <a
                class="btn"
                :href="whatsappUrl"
              >Chat WhatsApp</a>
            </div>
          </div>
        </div>
      </section>
    </main>
    <footer class="landing-copyright">
      © {{ year }} Cicuci Sepatu
    </footer>
    <div class="bottom">
      <a href="/pesan"><span class="symbol">☏</span><span>Pesan Sekarang<small>Pilih Tarif & Isi Form</small></span></a><a href="#tracking"><span class="symbol">▣</span><span>Cara Melacak<small>Info tracking pesanan</small></span></a>
    </div>
  </div>
</template>

<style scoped>
.landing-copyright{padding:20px 16px 28px;text-align:center;color:#415f7d;font:700 13px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;background:transparent}@media(max-width:700px){.landing-copyright{padding-bottom:calc(112px + env(safe-area-inset-bottom))}}
.reviews-intro{text-align:center;color:#415f7d;margin:-6px 0 24px;font-size:15px}.reviews-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.review-card{min-width:0;padding:22px;border:1px solid #d9e8fa;border-radius:20px;background:#f7fbff}.review-card h3{margin:0;font-size:16px;color:#102f5c}.review-stars{margin:8px 0 14px;color:#b57400;font-size:22px;letter-spacing:2px}.review-empty-stars{color:#91a5ba}.review-comment{margin:0;font-size:15px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;color:#415f7d}@media(max-width:700px){.reviews-grid{grid-template-columns:1fr}.review-card{padding:20px}}

.site{--navy:#102f5c;--navy2:#0b2347;--blue:#75b9f5;--sky:#d8ecff;--pale:#f3f9ff;--ink:#152f55;--shadow:0 7px 20px #173c681c}*{box-sizing:border-box}.site{margin:0;background:#eaf2fb;color:var(--ink);font-family:ui-rounded,"Arial Rounded MT Bold",Nunito,system-ui,-apple-system,Segoe UI,sans-serif}button,a{font:inherit}a{text-decoration:none;color:inherit}button{cursor:pointer}.site{max-width:1180px;margin:auto;background:#fff;min-height:100vh;overflow:hidden;position:relative}.wrap{width:min(100% - 36px,1040px);margin:auto}.header{position:relative;z-index:10;background:linear-gradient(110deg,#f9fbff,#e8f4ff);border-bottom:1px solid #d9e8fa}.nav{height:78px;display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{display:flex;align-items:center;gap:10px;flex-shrink:0}.brand img{width:57px;height:57px;object-fit:cover;object-position:50% 22%;border-radius:15px}.brand span{font-size:24px;line-height:.83;font-weight:1000;letter-spacing:-1.5px;color:var(--navy)}.brand small{display:block;font-size:21px;letter-spacing:0}.navlinks{display:flex;gap:23px;font-size:14px;font-weight:800}.navlinks a:hover{color:#398ac8}.navcta{background:var(--navy);color:white;border-radius:30px;padding:13px 19px;font-size:14px;font-weight:800}.hamburger{display:none;border:0;background:#dcecff;color:var(--navy);border-radius:14px;width:46px;height:46px;font-size:26px}.hero{background:linear-gradient(130deg,#f7fbff 0%,#f4f9ff 50%,#cce8ff 100%);position:relative;padding:60px 0 68px}.hero:after{content:"";position:absolute;bottom:-1px;left:0;width:100%;height:52px;background:#fff;clip-path:polygon(0 58%,13% 84%,27% 62%,43% 92%,60% 66%,78% 82%,100% 35%,100% 100%,0 100%)}.hero-grid{display:grid;grid-template-columns:1fr 1fr;align-items:center;gap:10px}.hero-copy{position:relative;z-index:2}.eyebrow{display:inline-flex;gap:8px;align-items:center;background:#d7ebff;border-radius:40px;padding:9px 15px;font-weight:900;font-size:13px}.hero h1{font-size:clamp(38px,5vw,66px);letter-spacing:-2.5px;line-height:1.06;color:var(--navy2);margin:17px 0}.underline{box-shadow:inset 0 -10px 0 #a9d8ff}.hero p{max-width:410px;font-size:17px;line-height:1.5;color:#4c5e79;margin:0 0 24px}.hero-actions{display:flex;flex-wrap:wrap;gap:12px}.btn{min-height:50px;padding:12px 22px;border-radius:30px;display:inline-flex;align-items:center;justify-content:center;gap:10px;font-weight:900;border:1px solid #c6d9ee;background:#fff;box-shadow:var(--shadow)}.btn.primary{background:var(--navy);color:#fff;border-color:var(--navy)}.btn[aria-disabled="true"]{opacity:.8}.hero-art{position:relative;min-height:420px;display:flex;justify-content:center;align-items:center}.hero-art img{width:min(100%,500px);position:relative;z-index:1;filter:drop-shadow(0 14px 13px #31618a19)}.bubble{position:absolute;border:5px solid #7bbcf6;border-radius:50%;background:radial-gradient(circle at 35% 28%,#fff 0 14%,#e7f6ff 35%,#b8e3ff 75%);box-shadow:inset -3px -4px 0 #8cc5f4;opacity:.9}.b1{width:66px;height:66px;top:15%;left:6%}.b2{width:40px;height:40px;right:6%;top:28%}.b3{width:24px;height:24px;left:12%;bottom:22%}.star{position:absolute;color:var(--navy);font-size:45px;right:11%;top:9%}.trust{position:relative;z-index:3;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;background:#fff;border:1px solid #e0eafa;border-radius:25px;padding:18px 12px;box-shadow:var(--shadow);margin-top:-40px}.trust div{display:flex;align-items:center;justify-content:center;gap:12px;font-size:13px;font-weight:900}.trust div+div{border-left:1px solid #d4e1f2}.trust .ico{font-size:29px;color:var(--navy)}section.content{padding:48px 0 10px}.section-title{text-align:center;color:var(--navy2);font-weight:1000;letter-spacing:-1px;font-size:clamp(25px,3.3vw,35px);margin:0 0 25px}.section-title:before,.section-title:after{content:'✦';font-size:18px;color:#ffb900;vertical-align:middle;margin:0 12px}.services{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.service{background:linear-gradient(#e5f2ff,#fff 67%);border:1px solid #e4edf9;border-radius:23px;box-shadow:var(--shadow);text-align:center;padding:22px 16px 24px}.shoe{font-size:76px;line-height:1.15;display:block;filter:drop-shadow(0 7px 4px #163c6420)}.service h3{font-size:20px;margin:12px 0 7px;color:var(--navy2)}.service p{font-size:14px;line-height:1.5;color:#50617a;margin:0}.steps{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.step{text-align:center;background:#e3f1ff;border-radius:22px;padding:19px 9px;font-weight:900;font-size:14px;line-height:1.35}.step-icon{display:block;font-size:35px;margin-bottom:8px}.why{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.why div{display:flex;align-items:center;gap:10px;font-size:14px;font-weight:850}.why b{font-size:28px}.notice{background:linear-gradient(120deg,#e4f2ff,#f7fbff,#d5ecff);border:2px solid white;border-radius:26px;box-shadow:var(--shadow);padding:24px;margin-top:36px}.notice strong{color:var(--navy)}.notice p{margin:8px 0 0;line-height:1.6}.faq{max-width:760px;margin:auto}.faq details{background:#fff;border:1px solid #e1e9f5;border-radius:17px;box-shadow:var(--shadow);margin-bottom:9px;padding:0 17px}.faq summary{cursor:pointer;list-style:none;font-weight:900;padding:17px 4px;display:flex;justify-content:space-between;gap:12px}.faq summary:after{content:'⌄';font-size:22px;color:#637a96}.faq details[open] summary:after{content:'⌃'}.faq p{margin:0 0 17px;font-size:14px;line-height:1.6;color:#53637b}.footer{padding:40px 0 120px;text-align:center;color:#60718a;font-size:13px}.bottom{display:none}.mobile-menu{display:none}
@media(max-width:700px){.site{background:#fff}.wrap{width:calc(100% - 30px)}.nav{height:72px}.brand img{width:49px;height:49px}.brand span{font-size:22px}.brand small{font-size:19px}.navlinks,.navcta{display:none}.hamburger{display:block}.mobile-menu{display:none;position:absolute;top:71px;left:0;right:0;background:#f6fbff;box-shadow:0 12px 18px #123c6226;padding:15px 22px;flex-direction:column;gap:15px;font-weight:800}.mobile-menu.open{display:flex}.hero{padding:25px 0 60px}.hero-grid{display:block;position:relative;min-height:425px}.hero-copy{width:100%}.eyebrow{font-size:11px;padding:8px 12px}.hero h1{font-size:clamp(34px,9vw,49px);line-height:1.05;letter-spacing:-1.5px;max-width:310px;margin:15px 0}.hero p{font-size:14px;line-height:1.45;max-width:205px;margin-bottom:16px}.hero-actions{display:flex;flex-direction:column;align-items:flex-start;gap:9px}.hero-actions .btn{width:205px;min-height:46px;padding:10px 8px;font-size:13px}.hero-art{position:absolute;right:-50px;top:40px;width:67%;min-height:0;height:300px;align-items:center}.hero-art img{width:100%;max-width:300px}.b1{width:36px;height:36px;left:0;top:22%}.b2{width:24px;height:24px;right:15%;top:8%}.b3{display:none}.star{font-size:28px;top:6%}.trust{margin-top:-36px;padding:14px 6px;border-radius:20px;gap:4px}.trust div{font-size:9px;gap:5px;line-height:1.3}.trust .ico{font-size:19px}.trust div+div{padding-left:5px}section.content{padding:30px 0 8px}.section-title{font-size:24px;margin-bottom:18px}.section-title:before,.section-title:after{font-size:12px;margin:0 5px}.services{gap:8px}.service{padding:12px 6px 16px;border-radius:17px}.shoe{font-size:45px}.service h3{font-size:13px;line-height:1.2;margin:10px 0 5px}.service p{font-size:11px;line-height:1.35}.steps{gap:7px}.step{border-radius:15px;padding:12px 4px;font-size:10px}.step-icon{font-size:27px}.why{gap:8px;grid-template-columns:repeat(2,1fr)}.why div{font-size:12px}.why b{font-size:24px}.notice{margin-top:25px;padding:17px}.notice p{font-size:13px}.faq summary{font-size:13px;padding:14px 0}.footer{padding:30px 0 120px}.bottom{position:fixed;display:grid;grid-template-columns:1fr 1fr;bottom:0;left:0;right:0;z-index:30;background:var(--navy);color:#fff;border-radius:22px 22px 0 0;box-shadow:0 -4px 20px #17385a3a;padding:12px max(12px,env(safe-area-inset-right)) calc(12px + env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left));max-width:700px;margin:auto}.bottom a,.bottom button{display:flex;align-items:center;justify-content:center;gap:8px;background:none;border:0;color:white;font-weight:900;font-size:12px;text-align:left;min-height:46px}.bottom a+button{border-left:1px solid #8fa7c7}.bottom .symbol{font-size:25px}.bottom small{display:block;font-size:10px;font-weight:500;margin-top:3px;color:#e1eeff}}
@media(max-width:380px){.hero-grid{min-height:420px}.hero h1{font-size:34px;max-width:270px}.hero-art{width:67%;right:-62px;top:55px}.hero p{max-width:180px}.hero-actions .btn{width:188px}.service h3{font-size:12px}.service p{font-size:10px}}
@media(min-width:701px) and (max-width:900px){.navlinks{gap:11px}.hero-art{min-height:340px}}

.site .notice { color: #415f7d; font-weight: 400; }
.site a { transition: color .2s ease, background-color .2s ease, box-shadow .2s ease; }
.site a:hover { text-decoration: none; }
.site .navlinks a:hover, .site .mobile-menu a:hover, .site .notice a:hover { color: #2873ad; }
.site .notice a { text-decoration: underline; text-underline-offset: .2em; }
.site .navcta:hover, .site .btn.primary:hover { background-color: #19477f; box-shadow: 0 8px 20px #102f5c38; }
.site .btn:not(.primary):hover, .site .bottom a:hover { background-color: #d8ecff; }
.site a:focus-visible, .site button:focus-visible, .site summary:focus-visible { outline: 3px solid #e18b00; outline-offset: 3px; }
.brand img { object-fit: contain; object-position: center; }
/* Layout refinement: no overlapping copy, illustration, or floating cards */
.hero{padding:36px 0 76px}
.hero-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:clamp(28px,5vw,72px);align-items:center}
.hero-copy{min-width:0}
.hero h1{font-size:clamp(38px,4.7vw,60px);line-height:1.16;letter-spacing:-1.9px;margin:0 0 18px;overflow-wrap:normal}
.hero h1 .hero-highlight{color:#2873ad;text-decoration:none;box-shadow:none}
.hero p{max-width:440px;margin-bottom:26px}
.hero-art{min-width:0;min-height:0;aspect-ratio:1.12;isolation:isolate}
.hero-art img{width:100%;height:auto;max-width:510px;object-fit:contain}
.trust{margin-top:-47px}
@media(max-width:700px){
 .hero{padding:20px 0 68px}
 .hero-grid{display:flex;flex-direction:column;align-items:stretch;gap:18px;min-height:0}
 .hero-copy{width:100%}
 .hero h1{font-size:clamp(36px,9.3vw,52px);line-height:1.14;letter-spacing:-1.3px;margin:0 0 16px;max-width:none}
 .hero p{font-size:15px;line-height:1.6;max-width:480px;margin-bottom:20px}
 .hero-actions{flex-direction:row;align-items:stretch;gap:10px}
 .hero-actions .btn{width:auto;flex:1 1 160px;min-height:50px;padding:12px 10px;font-size:12px;text-align:center}
 .hero-art{position:relative;top:auto;right:auto;width:min(100%,440px);height:auto;min-height:0;aspect-ratio:1.2;margin:0 auto}
 .hero-art img{max-width:100%;height:100%;object-fit:contain}
 .trust{margin-top:-47px}
}
@media(max-width:420px){
 .hero h1{font-size:clamp(34px,9vw,39px)}
 .hero-actions{flex-direction:column}
 .hero-actions .btn{flex:auto;width:100%;font-size:13px}
 .hero-art{width:min(100%,360px)}
}
@media(min-width:701px) and (max-width:950px){
 .hero-grid{gap:24px}
 .hero h1{font-size:clamp(36px,4.5vw,48px)}
 .hero-art{aspect-ratio:1.1}
}
/* Original transparent logo: no square, background, frame or extra effects */
.brand{gap:0;min-width:0}.brand img{width:112px;height:64px;object-fit:contain;object-position:center;border-radius:0;background:transparent;display:block}
.hero-art{aspect-ratio:auto;min-height:0;height:auto;background:none;border:0;box-shadow:none;overflow:visible;padding:0}
.hero-art img{display:block;width:100%;max-width:540px;height:auto;object-fit:contain;filter:none;background:transparent;border:0;box-shadow:none}
@media(max-width:700px){.brand img{width:99px;height:58px}.hero-art{aspect-ratio:auto;height:auto;width:min(100%,430px);margin:0 auto}.hero-art img{width:100%;height:auto}.hero-grid{gap:14px}.hero{padding-bottom:76px}}
@media(max-width:420px){.hero-art{width:min(100%,350px)}}

.contact-actions{display:flex;justify-content:center;flex-wrap:wrap;gap:12px;margin-top:20px}.site .notice .contact-actions a{text-decoration:none}.site .hero .pickup-promise{max-width:440px;font-size:14px;font-weight:700;line-height:1.6;margin:18px 0 0}.pickup-promise span{font-weight:400}.faq+.faq{margin-top:12px}
@media(max-width:700px){.trust{gap:10px;padding:16px 12px}.trust div{font-size:13px;flex-direction:column;text-align:center;gap:6px}.trust div+div{padding-left:0}.services{grid-template-columns:1fr;gap:12px}.service{padding:20px}.service h3{font-size:17px}.service p{font-size:14px;line-height:1.6}.shoe{font-size:40px}.steps{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.step{font-size:14px;padding:18px 10px;line-height:1.5}.why div{font-size:14px}.hero-actions .btn{font-size:14px}.contact-actions .btn{flex:1 1 180px}.footer{font-size:13px}}
.site .section-title{font-size:clamp(24px,3vw,32px);font-weight:750}.site .btn,.site .navcta,.site .navlinks,.site .mobile-menu{font-weight:700}.site .btn,.site .hero-actions .btn{font-size:15px}.site .trust div,.site .step,.site .why div{font-weight:600}.site .eyebrow{font-weight:700}.site .faq summary{font-size:16px;font-weight:600}.site .bottom a{font-weight:600}.site .bottom small{font-weight:400}.site .footer{font-weight:500}
@media(max-width:700px){.site .faq summary{font-size:15px}.site .notice p{font-size:14px}.site .bottom a{font-size:13px}}
@media(max-width:700px){.site .hamburger{display:grid;place-items:center;padding:0;line-height:1;flex-shrink:0}.hamburger svg{display:block}}
.site .hamburger{background:#dcecff;color:#102f5c;-webkit-tap-highlight-color:transparent}.site .hamburger:hover,.site .hamburger:active,.site .hamburger[aria-expanded="true"]{background:#c8e3fa;color:#102f5c}
.reviews-swipe-hint{display:none}@media(max-width:700px){.reviews-grid{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;gap:14px;padding:4px 2px 16px}.review-card{flex:0 0 86%;scroll-snap-align:start}.reviews-swipe-hint{display:block;font-size:13px;color:#415f7d;margin:0 0 8px}}
.reviews-grid{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;gap:16px;padding:4px 2px 16px}.review-card{flex:0 0 calc((100% - 32px)/3);scroll-snap-align:start}.review-controls{display:flex;align-items:center;justify-content:center;gap:16px;margin-top:12px}.review-controls span{font-size:13px;color:#415f7d}.review-controls button{display:grid;place-items:center;min-width:44px;min-height:44px;padding:8px;border:1px solid #c8def2;border-radius:50%;background:#e6f3ff;color:#102f5c}.review-controls button:hover:not(:disabled){background:#c8e3fa}.review-controls button:disabled{opacity:.5}@media(max-width:700px){.review-card{flex-basis:86%}}
</style>
