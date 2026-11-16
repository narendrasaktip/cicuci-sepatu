# Kesiapan release — 16 November 2026

Status: **BLOCKED; belum deploy, belum mengubah produksi**.

## Cakupan
- Frontend, API, layanan notifikasi, Prisma dan tiga migrasi Feedback; bukan frontend-only.
- Pertahankan data produksi, environment, secrets, profil WhatsApp dan ledger. Tidak ada fitur Hapus Semua/Force Delete pada kode release saat ini.
- Rincian struktur tambahan: `DATABASE.md`; prosedur/gate: `PANDUAN_RELEASE.md`.

## Verifikasi lokal
- Build seluruh workspace lulus.
- Suite API dengan Node 25.2.1 dan endpoint fixture terisolasi: 104 lulus, 0 gagal; 4 tes integrasi digate secara default.
- Keempat tes gated sudah dijalankan terpisah: **4 lulus, 0 gagal, 0 dilewati** — workflow DB/HTTP, WhatsApp fake-send, BullMQ worker, Chromium QR. QR memakai profil sementara, tidak memutus/menghapus sesi WhatsApp pengguna.
- Lint dan typecheck workspace lulus. Regresi browser lengkap masih berjalan; belum dinyatakan lulus.
- Koreksi mencakup fixture consent/audit/tracking, alur PACKING/QC dan pembayaran sebelum handover, pagination filter turunan, kontrak signed worker snapshot. Tes QR menemukan kebocoran Chromium: whatsapp-web.js memanggil API Puppeteer yang dihapus; penutupan browser eksplisit ditambahkan.
- Tes bukan dijalankan terhadap produksi. Tidak ada pengiriman WhatsApp nyata dari verifikasi ini.
- Verifikasi browser lanjutan: workflow MVP operasional lulus; 12 tes sapaan/penghapusan lulus; 26 tes informasi tracking lulus. Suite 81 tes terakhir: 79 lulus, dua kegagalan label status aktif sudah dikoreksi dan lolos rerun terarah. Suite lengkap tetap belum lulus.
- Penghapusan tarif kini meminta konfirmasi eksplisit `HAPUS` sebelum request DELETE; tes mencakup input salah, batal dan konfirmasi benar.
- Verifikasi ulang API: 104 lulus, 0 gagal; keempat integrasi eksplisit kembali lulus, 0 skip (`release-api-final.log`, `release-gated-final.log`).
- Riwayat pengiriman WhatsApp kembali dapat diakses melalui navigasi khusus; tanpa pengiriman ulang otomatis. Fixture browser diperbarui mengikuti navigasi permanen baru, agregat/ledger dan konfirmasi penghapusan; gate browser masih terbuka.
- Rerun terarah terbaru: menu 10/10, structured consent 29/29, penugasan opsional 6/6, layout detail 3/3 lulus. Guard UI memblokir mulai pengerjaan selama harga ESTIMATE; validasi API tidak dilonggarkan. Suite browser lengkap dijalankan ulang di `release-full8.log`; hasil belum dinyatakan lulus.
- `release-full8.log`: 422 lulus, 7 gagal. Perbaikan berikutnya: Teleport editor tarif menggunakan `defer` agar mount saat reload tidak mendahului target; halaman publik memakai WebP bersama tanpa PNG besar dalam bundle. Tarif dan branding 24/24 lulus (`release-rates9.log`); build, lint dan `git diff --check` lulus. Suite lengkap baru berjalan di `release-full10.log`; belum dinyatakan lulus.
- `release-full10.log`: 425 lulus, 4 gagal; seluruh kegagalan pada referensi landing yang masih membandingkan PNG lama. Referensi kini memeriksa byte WebP bersama menggunakan `Buffer.equals` agar kegagalan tidak mencetak diff biner besar. Rerun lengkap `release-full11.log` masih menunggu hasil.
- Hasil final `release-full11.log`: **429 lulus, 0 gagal, 0 dilewati** (3,8 menit). Gate browser lokal selesai; gate audit produksi, backup/restore, rehearsal MySQL 8 dan provenance release tetap belum selesai.
- Health publik `https://sepatu.cicuci.com/api/v1/health` diperiksa ulang: HTTP berhasil, respons `{"status":"ok"}`. Ini bukan audit SSH/database atau bukti kompatibilitas release. PATH lokal masih tidak menyediakan Docker, mysql atau mysqldump; rehearsal MySQL 8 dan backup/restore produksi belum terverifikasi. Tidak ada koneksi SSH, penulisan produksi, commit, push atau deployment pada tahap ini.

## Gate belum terpenuhi
- Rekonsiliasi tes gagal/dilewati dan regresi browser yang relevan.
- Identifikasi release produksi terkini, checksum, migrasi yang sudah terpasang, drift dan kompatibilitas.
- Backup DB/foto terkini terenkripsi, restore terisolasi MySQL 8, rehearsal migrasi baru dan rollback terverifikasi.
- Release commit/artefak yang ditinjau; workspace masih memuat banyak perubahan lokal/untracked.

Jangan menghentikan layanan produksi atau menerapkan migrasi sebelum gate di atas terpenuhi.
