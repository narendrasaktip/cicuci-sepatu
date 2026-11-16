// ponytail: Kontak publik tetap; pindahkan ke pengaturan publik saat perlu diubah lewat admin.
export const whatsappNumber = '6285179963343';
export const whatsappUrl = `https://api.whatsapp.com/send/?${new URLSearchParams({ phone: whatsappNumber, text: 'Halo Admin Cicuci Sepatu!\n\nSaya mau konsultasi cuci sepatu. Boleh info layanan dan tarifnya?' })}`;
