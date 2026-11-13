import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';

export const eventNames = {
  ORDER_RECEIVED: 'Pesanan diterima', RECEIVED: 'Sepatu diterima', INSPECTION: 'Pemeriksaan dimulai',
  QUEUED: 'Siap masuk antrean', AWAITING_CONSENT: 'Menunggu persetujuan', CONSENT_REQUEST: 'Permintaan persetujuan',
  WASHING: 'Pencucian dimulai', DRYING: 'Pengeringan', PACKING: 'Pengemasan dan pemeriksaan mutu', FINISHING: 'Penyelesaian akhir', QC: 'Pemeriksaan kualitas',
  REWORK: 'Perawatan ulang', READY_FOR_PICKUP: 'Siap diambil', HANDED_OVER: 'Sepatu diserahkan',
  RETURN_PENDING: 'Menunggu pengembalian', RETURNED: 'Sepatu dikembalikan',
} as const;
export const placeholderHelp = {
  sapaan: 'Sapaan pelanggan (Kak/Pak/Bu)', nama_pelanggan: 'Nama pelanggan', total_sepatu: 'Jumlah seluruh sepatu pada pesanan',
  detail_sepatu: 'Daftar seluruh sepatu (tanpa catatan internal)', nomor_pesanan: 'Nomor pesanan',
  url_tracking: 'Tautan privat; permintaan persetujuan menyertakan aksi sekali pakai',
  sepatu: 'Sepatu terkait event; seluruh sepatu untuk penerimaan pesanan',
} as const;
const updates: Record<keyof typeof eventNames, string> = {
  ORDER_RECEIVED: '{total_sepatu} pasang sepatu pada pesanan {nomor_pesanan} sudah kami terima.',
  RECEIVED: '{sepatu} sudah kami terima.', INSPECTION: 'Pemeriksaan {sepatu} sudah dimulai.',
  QUEUED: '{sepatu} sudah disetujui untuk perawatan dan masuk antrean.',
  AWAITING_CONSENT: '{sepatu} memerlukan persetujuan sebelum perawatan. Permintaan persetujuan dikirim terpisah; pencucian belum dimulai.',
  CONSENT_REQUEST: 'Mohon tinjau hasil pemeriksaan, risiko, dan biaya {sepatu} melalui tautan privat berikut. Pilih setuju atau tolak pada halaman tersebut. Pencucian tidak dimulai tanpa persetujuan Anda.',
  WASHING: 'Pencucian {sepatu} sudah dimulai.', DRYING: '{sepatu} sedang dikeringkan.', PACKING: '{sepatu} sedang dikemas dan diperiksa kualitasnya.',
  FINISHING: '{sepatu} sedang dalam penyelesaian akhir.', QC: '{sepatu} sedang diperiksa kualitasnya.',
  REWORK: '{sepatu} memerlukan perawatan ulang agar hasilnya sesuai standar kami.',
  READY_FOR_PICKUP: '{sepatu} selesai dikerjakan. Sepatu lain pada pesanan dapat memiliki progres berbeda; silakan cek kesiapan pesanan melalui tautan berikut.',
  HANDED_OVER: '{sepatu} sudah diserahkan. Terima kasih telah mempercayakan perawatan sepatu kepada kami.',
  RETURN_PENDING: '{sepatu} akan dikembalikan tanpa pencucian. Biaya pencucian sepatu tersebut Rp0.',
  RETURNED: '{sepatu} sudah dikembalikan tanpa pencucian. Biaya pencucian sepatu tersebut Rp0.',
};
export const defaults = Object.entries(eventNames).map(([event, name]) => ({ event, name, body: event === 'ORDER_RECEIVED' ? `Halo {sapaan} {nama_pelanggan},\n\nTerima kasih sudah mempercayakan sepatu Anda kepada Cicuci Sepatu. Pesanan Anda sudah kami terima.\n\n*Rincian pesanan*\nNomor pesanan: {nomor_pesanan}\nJumlah: {total_sepatu} pasang\n\n{detail_sepatu}\n\nKami akan memeriksa kondisi sepatu sebelum pengerjaan.\n\n*Pantau pesanan Anda:*\n{url_tracking}\n\n_Terima kasih telah memilih Cicuci Sepatu._` : `Halo {sapaan} {nama_pelanggan},\n\n${updates[event as keyof typeof updates]}\n\n{detail_sepatu}\n\nPantau pesanan: {url_tracking}\n\nCicuci Sepatu` }));
// Reject control characters at the message trust boundary.
// eslint-disable-next-line no-control-regex
const cleanText = (value: string) => !/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value);
export const templateBody = z.string().trim().min(20).max(2000).refine(cleanText, 'Karakter kontrol tidak diizinkan.').refine(value => {
  const rest = value.replace(/\{([a-z_]+)\}/g, (match, key: string) => Object.hasOwn(placeholderHelp, key) ? '' : match);
  return !/[{}]/.test(rest);
}, 'Placeholder tidak dikenal atau kurung tidak lengkap.').refine(value => value.includes('{url_tracking}') && value.includes('Cicuci Sepatu'), 'Wajib menyertakan {url_tracking} dan Cicuci Sepatu.').refine(value => !/(?:https?:|www\.|<[^>]*>)/i.test(value), 'Gunakan {url_tracking}; URL literal dan HTML tidak diizinkan.');
export const templateWrite = z.object({ event: z.enum(Object.keys(eventNames) as [keyof typeof eventNames, ...(keyof typeof eventNames)[]]), name: z.string().trim().min(1).max(80).refine(v => cleanText(v) && !/[{}<>\r\n]|https?:|www\./i.test(v), 'Nama tidak valid.'), body: templateBody }).strict();
export type Template = z.infer<typeof templateWrite>;
export type Values = Record<keyof typeof placeholderHelp, string>;
export function renderTemplate(body: string, values: Values) {
  const message = templateBody.parse(body).replace(/\{([a-z_]+)\}/g, (_match, key: keyof Values) => values[key]);
  return z.string().max(12000).parse(message);
}
// eslint-disable-next-line no-control-regex
export function customerText(value: string) { return value.replace(/[\r\n\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu, ' ').slice(0, 300); }
export function encryptionReady() { return /^[a-f0-9]{64}$/i.test(process.env.WA_MESSAGE_KEY ?? ''); }
function key() { if (!encryptionReady()) throw new Error('MESSAGE_KEY_UNAVAILABLE'); return Buffer.from(process.env.WA_MESSAGE_KEY!, 'hex'); }
export function seal(value: unknown) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(v => v.toString('base64url')).join('.');
}
export function unseal(value: string): unknown {
  const parts = value.split('.'); if (parts.length !== 3) throw new Error('MESSAGE_PAYLOAD_INVALID');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(parts[0]!, 'base64url'));
  decipher.setAuthTag(Buffer.from(parts[1]!, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(parts[2]!, 'base64url')), decipher.final()]).toString());
}
export const deliveryPayload = z.object({ message: z.string().min(1).max(12000), trackingHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export function trackingLink(origin: string, token: string, approval = '', itemId = '') {
  z.string().regex(/^(?:[a-f0-9]{64}|[A-Za-z0-9_-]{22})$/).parse(token);
  const base = new URL(origin);
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/' || (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))) throw new Error('PUBLIC_ORIGIN_INVALID');
  const url = new URL(`/track/${token}`, base);
  if (approval) { z.string().regex(/^[a-f0-9]{64}$/).parse(approval); url.hash = new URLSearchParams({ approval, item: itemId }).toString(); }
  return url.href;
}
export const previewValues: Values = { sapaan: 'Kak', nama_pelanggan: 'Dina (contoh)', total_sepatu: '2', detail_sepatu: '• Sepatu Contoh Biru\n• Sepatu Contoh Putih', nomor_pesanan: 'CONTOH-001', sepatu: 'Sepatu Contoh Biru', url_tracking: '[tautan privat pelanggan — contoh, tidak aktif]' };
