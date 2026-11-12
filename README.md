# Cicuci Sepatu — MVP operasional

Vue 3 + Express strict TypeScript, Prisma/MySQL, Redis/BullMQ. UI operasional Bahasa Indonesia; pelacakan pelanggan tanpa akun. Tidak ada pengiriman WhatsApp nyata.

## Setup lokal

Prasyarat: Node.js 20.19+, npm, MySQL 8 (validasi lokal juga memakai MariaDB 10.4 XAMPP), Redis 7+.

1. Jalankan `npm install`.
2. Salin `.env.example` ke `.env` hanya pada instalasi baru; jangan timpa konfigurasi lokal yang sudah bekerja. Ganti password contoh, isi kredensial database serta `OWNER_EMAIL` dan `OWNER_PASSWORD` minimal 12 karakter.
3. Sediakan database **cicuci_sepatu_dev** dan Redis. Docker opsional: `docker compose up -d`. Jangan menjalankan MySQL Docker pada port yang sudah dipakai XAMPP. Kredensial dan nama database harus cocok dengan environment. URL socket XAMPP dapat dipakai tanpa mengubah database lain.
4. Jalankan `npm run db:generate`, `npm run db:deploy`, `npm run db:seed`. Deployment sengaja menolak database selain `cicuci_sepatu_dev`; migrasi hanya forward, tanpa reset/drop. Target produksi membutuhkan perubahan guard yang ditinjau terpisah.
5. Hapus `OWNER_PASSWORD` dari `.env` setelah bootstrap; seed tidak menimpa owner yang ada. Jangan bagikan `.env`.
6. Jalankan tiga terminal: `npm run dev:api`, `npm run dev:web`, `npm run worker`. Redis/MySQL harus tetap aktif.
7. Buka http://127.0.0.1:5173. Origin harus persis sama dengan `APP_BASE_URL`; alias localhost berbeda ditolak saat login.

Lingkungan validasi: API 3000, Vite 5173, Redis 6379 loopback. Redis lokal dijalankan dengan persistence nonaktif; outbox MySQL tetap durable. Ini bukan konfigurasi produksi atau service otomatis setelah reboot.

## Cakupan

- Pelanggan: pencarian, create/edit/detail, normalisasi WhatsApp, opt-in terpisah dari persetujuan risiko.
- Katalog layanan, pengguna OWNER/ADMIN/STAFF, profil merek/instruksi pengambilan/masa berlaku persetujuan, audit.
- Pesanan 1–50 sepatu independen: harga snapshot, penugasan, estimasi, inspeksi, foto privat BEFORE/INSPECTION/AFTER, timeline.
- Persetujuan risiko satu kali, kedaluwarsa, terbit ulang; kedaluwarsa tidak otomatis menolak. Penolakan menghasilkan biaya cuci nol dan alur pengembalian.
- Transisi terkunci dalam transaksi, tanpa melewati pengeringan; QC pass tersimpan, foto AFTER publik wajib sebelum siap, QC gagal/rework beralasan. Status pesanan diturunkan dari item.
- Ledger pembayaran/refund manual, batas nominal integer, status pembayaran independen dari pengerjaan. Refund mencatat uang yang dikembalikan di luar aplikasi, bukan transfer otomatis.
- Dashboard aktual, pencarian/filter/paginasi, antrean pekerjaan staf sesuai penugasan.
- Tracking token acak tersimpan hash, rotasi/pencabutan, tampilan publik tersaring, akses foto sesuai pesanan. Token mentah hanya diberikan saat penerbitan; bagikan secara privat.
- Outbox atomik, deduplikasi, worker BullMQ, backoff/retry, opt-in dan state terbaru diperiksa, log percobaan. WhatsApp Web satu-satunya provider operasional. Tanpa aktivasi/koneksi: **SKIPPED** dengan alasan; **SIMULATED** hanya riwayat lama.
- Session HttpOnly, CSRF, Origin check, Argon2id, RBAC, Zod, rate limit, idempotency mutation.

Kontrak runtime: [apps/api/API.md](apps/api/API.md). Desain awal dalam `docs/` tidak menggantikan kontrak implementasi. Upload aktual JSON/base64 PNG/JPEG maksimal 10 MiB, bukan multipart. Koreksi pembayaran memakai refund, bukan void.

## WhatsApp Web

Owner-only pairing/status/disconnect dan aktivasi terpisah tersedia. Tanpa aktivasi owner tidak ada pengiriman; backlog historis tidak dikirim ulang. Integrasi tidak resmi dapat terputus atau menyebabkan pembatasan akun. [Panduan pairing, konfigurasi, keamanan dan batas delivery](docs/WHATSAPP.md).

Node >=22.12 (Node 24 disarankan) diperlukan oleh browser dependency yang dipatch. Worker tunggal memakai LocalAuth privat; jangan gunakan ulang sesi bot lama. QR Chromium telah diuji tanpa scan; pengiriman nyata belum diuji.

## Pemeriksaan

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:integration -w apps/api
RUN_QUEUE_TESTS=1 node --env-file=.env --import tsx --test apps/api/test/queue.test.ts
npx playwright install chromium
npm run test:browser -w apps/web
npm audit --omit=dev
```

Tes integrasi membutuhkan API/Vite/MySQL berjalan; tes queue membutuhkan Redis/worker. Tes membuat fixture acak di `cicuci_sepatu_dev`, membersihkan hanya ID fixture yang dicatat. Jangan jalankan terhadap produksi. Laporan browser dapat mengandung token/kredensial fixture; jangan publikasikan.

### Hasil validasi 2026-11-11

- Typecheck, lint, build root: lulus.
- Unit/HTTP: 3 lulus; 2 tes live dilewati secara default, dijalankan terpisah.
- Integrasi MySQL melalui proxy HTTP: 1 suite lulus; Redis/BullMQ: 1 lulus.
- Chromium: 2 tes lulus, termasuk workflow owner nyata, tiga sepatu berbeda hasil inspeksi, persetujuan pelanggan, QC/rework/foto, ledger/refund, rotasi/pencabutan tracking; smoke mobile/keyboard/error publik.
- Guard backend diuji: cuci diblokir sebelum consent; reject/decline nol; siap boleh belum lunas; concurrency, expiry/single-use consent, foto privat/isolation, RBAC/CSRF, dedupe, outage provider tidak membatalkan status, opt-out/retry.
- Audit dependency produksi: 0 kerentanan. Tidak menyatakan semua dependency development bebas kerentanan.
- Migrasi live selesai hanya di database target; tidak ada reset/drop/truncate. Fixture pengujian dibersihkan.

## Batas dan deployment

- Belum production-ready: sediakan TLS/reverse proxy, backup database + upload privat, service supervision, monitoring, rotasi secrets, retensi idempotency/audit/foto, dan Redis persistence.
- SPA hosting harus rewrite `/track/*` ke entry web serta proxy `/api`. Jangan expose upload sebagai static directory. Mount direktori upload privat yang sama pada proses terkait.
- Validasi foto memeriksa signature/struktur/ukuran, belum decode/re-encode penuh; tambahkan image sanitization sebelum akses publik produksi.
- Rate limit process-local; dashboard agregasi masih dalam memori. Gunakan Redis limiter/SQL aggregate saat scale-out/volume meningkat.
- Pembatasan pilihan 100 record pada beberapa layar owner; admin assignment memakai user ID tervalidasi. Tidak ada scheduler reminder, editor template, payment gateway atau jaminan delivery WhatsApp produksi.
- Browser Chromium diuji; belum audit screen-reader menyeluruh, Firefox/WebKit, load test atau deployment produksi. Cakupan negatif/RBAC mendalam berada pada suite backend, bukan seluruhnya browser.
- Workspace bukan repository Git; pemeriksaan diff Git tidak tersedia.

Panduan frontend dan batas UI: [apps/web/README.md](apps/web/README.md).

Permanent Owner deletion and salutation deployment boundary: see docs/API_SPEC.md, Permanent deletion. Migration011 pending; no valid backup, not deployed.
