import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { pricingSnapshot, publicPricing } from './pricing.js';

export const eventNames = {
  ORDER_RECEIVED: 'Pesanan diterima', RECEIVED: 'Sepatu diterima', INSPECTION: 'Pemeriksaan dimulai',
  QUEUED: 'Siap masuk antrean', AWAITING_CONSENT: 'Menunggu persetujuan', CONSENT_REQUEST: 'Permintaan persetujuan',
  WASHING: 'Pencucian dimulai', DRYING: 'Pengeringan', PACKING: 'Pengemasan dan pemeriksaan mutu', FINISHING: 'Penyelesaian akhir', QC: 'Pemeriksaan kualitas',
  REWORK: 'Perawatan ulang', READY_FOR_PICKUP: 'Siap diambil', ITEM_READY_FOR_PICKUP: 'Sepatu selesai QC dan pengemasan', HANDED_OVER: 'Sepatu diserahkan',
  RETURN_PENDING: 'Menunggu pengembalian', RETURNED: 'Sepatu dikembalikan',
  PICKUP_BILL_UNPAID: 'Tagihan siap ambil', PICKUP_BILL_PAID: 'Siap ambil — lunas',
} as const;
export const placeholderHelp = {
  sapaan: 'Sapaan pelanggan (Kak/Pak/Bu)', nama_pelanggan: 'Nama pelanggan', total_sepatu: 'Jumlah seluruh sepatu pada pesanan',
  detail_sepatu: 'Daftar seluruh sepatu; hanya template tingkat pesanan', nomor_pesanan: 'Nomor pesanan',
  url_tracking: 'Tautan privat; permintaan persetujuan menyertakan aksi sekali pakai',
  sepatu: 'Sepatu terkait event; seluruh sepatu untuk penerimaan pesanan',
  sisa_pembayaran: 'Sisa pembayaran dalam rupiah; hanya untuk template tagihan siap ambil',
  layanan_tarif: 'Nama layanan dan tarif tersimpan; hanya penerimaan pesanan',
  estimasi_total: 'Total tersimpan beserta status estimasi atau final; hanya penerimaan pesanan',
  rincian_harga: 'Rincian paket atau tarif per pasang tersimpan; hanya penerimaan pesanan',
  estimasi_selesai: 'Perkiraan selesai dalam WIB; hanya penerimaan pesanan',
  metode_penyerahan: 'Metode penyerahan tersimpan pada pesanan', lokasi_penyerahan: 'Lokasi penyerahan pada pesanan', catatan_penyerahan: 'Catatan penyerahan untuk pelanggan pada pesanan',
} as const;
const updates: Record<keyof typeof eventNames, string> = {
  ORDER_RECEIVED: '{total_sepatu} pasang sepatu pada pesanan {nomor_pesanan} sudah kami terima.',
  RECEIVED: '{sepatu} sudah kami terima.', INSPECTION: 'Pemeriksaan {sepatu} sudah dimulai.',
  QUEUED: '{sepatu} sudah disetujui untuk perawatan dan masuk antrean.',
  AWAITING_CONSENT: 'Mohon tinjau hasil pemeriksaan dan risiko {sepatu} melalui tautan privat berikut. Pilih setuju atau tolak pada halaman tersebut. Pencucian tidak dimulai tanpa persetujuan Anda.',
  CONSENT_REQUEST: 'Pengingat: persetujuan perawatan {sepatu} masih menunggu. Mohon tinjau hasil pemeriksaan dan pilih setuju atau tolak melalui tautan berikut.',
  WASHING: 'Pencucian {sepatu} sudah dimulai.', DRYING: '{sepatu} sedang dikeringkan.', PACKING: '{sepatu} sedang dikemas dan diperiksa kualitasnya.',
  FINISHING: '{sepatu} sedang dalam penyelesaian akhir.', QC: '{sepatu} sedang diperiksa kualitasnya.',
  REWORK: '{sepatu} memerlukan perawatan ulang agar hasilnya sesuai standar kami.',
  READY_FOR_PICKUP: '{sepatu} selesai dikerjakan. Sepatu lain pada pesanan dapat memiliki progres berbeda; silakan cek kesiapan pesanan melalui tautan berikut.',
  ITEM_READY_FOR_PICKUP: '{sepatu} telah selesai QC dan pengemasan, siap diambil. Sepatu lain pada pesanan dapat memiliki progres berbeda; cek kesiapan pesanan melalui tautan berikut.',
  HANDED_OVER: '{sepatu} sudah diserahkan. Terima kasih telah mempercayakan perawatan sepatu kepada kami.',
  RETURN_PENDING: '{sepatu} akan dikembalikan tanpa pencucian. Biaya pencucian sepatu tersebut Rp0.',
  RETURNED: '{sepatu} sudah dikembalikan tanpa pencucian. Biaya pencucian sepatu tersebut Rp0.',
  PICKUP_BILL_UNPAID: 'Sepatu yang dapat dikerjakan pada pesanan {nomor_pesanan} sudah selesai. Sisa pembayaran: {sisa_pembayaran}. Silakan bayar menggunakan QR terlampir. Pembayaran dikonfirmasi secara manual oleh toko, tidak secara real-time.',
  PICKUP_BILL_PAID: 'Sepatu yang dapat dikerjakan pada pesanan {nomor_pesanan} sudah selesai. Pembayaran sudah lunas.',
};
export const routineEvents = ['RECEIVED', 'INSPECTION', 'QUEUED', 'WASHING', 'DRYING', 'PACKING', 'FINISHING', 'QC', 'REWORK'] as const;
export const defaults = Object.entries(eventNames).map(([event, name]) => ({ event, name, body: event === 'ORDER_RECEIVED' ? `Halo {sapaan} {nama_pelanggan},\n\nTerima kasih sudah mempercayakan sepatu Anda kepada Cicuci Sepatu. Pesanan Anda sudah kami terima.\n\n*Rincian pesanan*\nNomor pesanan: {nomor_pesanan}\nJumlah: {total_sepatu} pasang\nLayanan/tarif: {layanan_tarif}\nBiaya: {estimasi_total}\nPerkiraan selesai: {estimasi_selesai}\n\n{detail_sepatu}\n\nKami akan memeriksa kondisi sepatu sebelum pengerjaan.\n\n*Pantau pesanan Anda:*\n{url_tracking}\n\n_Terima kasih telah memilih Cicuci Sepatu._` : (routineEvents as readonly string[]).includes(event) ? `Halo {sapaan} {nama_pelanggan},\n\n${updates[event as keyof typeof updates]}\n\nNomor pesanan: {nomor_pesanan}\nPantau: {url_tracking}\n\n_Salam hangat,_\n*Cicuci Sepatu*` : `Halo {sapaan} {nama_pelanggan},\n\n${updates[event as keyof typeof updates]}${event.startsWith('PICKUP_BILL_') ? '\n\n{detail_sepatu}' : ''}\n\nPantau pesanan: {url_tracking}\n\nCicuci Sepatu` }));
// Reject control characters at the message trust boundary.
// eslint-disable-next-line no-control-regex
const cleanText = (value: string) => !/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value);
export const templateBody = z.string().trim().min(20).max(2000).refine(cleanText, 'Karakter kontrol tidak diizinkan.').refine(value => {
  const rest = value.replace(/\{([a-z_]+)\}/g, (match, key: string) => Object.hasOwn(placeholderHelp, key) ? '' : match);
  return !/[{}]/.test(rest);
}, 'Placeholder tidak dikenal atau kurung tidak lengkap.').refine(value => value.includes('{url_tracking}') && value.includes('Cicuci Sepatu'), 'Wajib menyertakan {url_tracking} dan Cicuci Sepatu.').refine(value => !/(?:https?:|www\.|<[^>]*>)/i.test(value), 'Gunakan {url_tracking}; URL literal dan HTML tidak diizinkan.');
export const templateWrite = z.object({ event: z.enum(Object.keys(eventNames) as [keyof typeof eventNames, ...(keyof typeof eventNames)[]]), name: z.string().trim().min(1).max(80).refine(v => cleanText(v) && !/[{}<>\r\n]|https?:|www\./i.test(v), 'Nama tidak valid.'), body: templateBody }).strict().refine(v => v.event === 'PICKUP_BILL_UNPAID' ? v.body.includes('{sisa_pembayaran}') : !v.body.includes('{sisa_pembayaran}'), { path: ['body'], message: '{sisa_pembayaran} wajib untuk tagihan siap ambil dan tidak tersedia untuk peristiwa lain.' }).refine(v => v.event === 'ORDER_RECEIVED' || !/\{(?:layanan_tarif|estimasi_total|estimasi_selesai|rincian_harga)\}/.test(v.body), { path: ['body'], message: 'Placeholder estimasi hanya tersedia untuk penerimaan pesanan.' }).refine(v => v.event === 'ORDER_RECEIVED' || v.event.startsWith('PICKUP_BILL_') || !v.body.includes('{detail_sepatu}'), { path: ['body'], message: '{detail_sepatu} hanya tersedia untuk template tingkat pesanan.' });
export type Template = z.infer<typeof templateWrite>;
export type Values = Record<Exclude<keyof typeof placeholderHelp, 'sisa_pembayaran' | 'layanan_tarif' | 'estimasi_total' | 'estimasi_selesai' | 'rincian_harga' | 'metode_penyerahan' | 'lokasi_penyerahan' | 'catatan_penyerahan'>, string> & Partial<Record<'sisa_pembayaran' | 'layanan_tarif' | 'estimasi_total' | 'estimasi_selesai' | 'rincian_harga' | 'metode_penyerahan' | 'lokasi_penyerahan' | 'catatan_penyerahan', string>>;
export function renderTemplate(body: string, values: Values) {
  const message = templateBody.parse(body).replace(/\{([a-z_]+)\}/g, (_match, key: keyof Values) => z.string().parse(values[key]));
  return z.string().max(12000).parse(message);
}
// eslint-disable-next-line no-control-regex
export function customerText(value: string) { return value.replace(/[\r\n\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu, ' ').slice(0, 300); }
export function handoverValues(order: { handoverMethod?: string | null; handoverLocation?: string | null; handoverNote?: string | null }) {
  const methods: Record<string, string> = { STORE: 'Di toko', PICKUP: 'Dijemput', MEETUP: 'Janjian', COURIER: 'Kurir' };
  const method = order.handoverMethod && Object.hasOwn(methods, order.handoverMethod) ? methods[order.handoverMethod] : undefined;
  const text = (value?: string | null) => typeof value === 'string' ? customerText(value).trim() : '';
  return { metode_penyerahan: method || 'Belum tersedia', lokasi_penyerahan: method ? text(order.handoverLocation) || 'Tidak ada' : 'Belum tersedia', catatan_penyerahan: method ? text(order.handoverNote) || 'Tidak ada' : 'Belum tersedia' };
}
export function receiptValues(order: { pricing: unknown; estimatedCompletionAt: Date | null; items: { id: string; outcome: string | null; status: string; serviceName: string }[] }) {
  const parsed = pricingSnapshot.safeParse(order.pricing);
  const pricing = parsed.success && parsed.data.totalIdr >= 0 ? parsed.data : null;
  const services = [...new Set(order.items.map(i => customerText(i.serviceName ?? '').trim()).filter(Boolean))];
  const tariff = pricing ? customerText(pricing.version === 2 ? pricing.name : pricing.mode === 'PROMO' ? 'Promo' : 'Normal').trim() : '';
  const date = order.estimatedCompletionAt;
  const projection = pricing && pricing.pairs >= 0 && pricing.pairs <= 50 ? publicPricing(pricing, order.items) : null;
  const money = (value: number) => `Rp${value.toLocaleString('id-ID')}`;
  const breakdown = projection?.calculationMatches
    ? projection.breakdown.map(line => line.kind === 'PER_PAIR'
      ? `${line.quantity} pasang × ${money(line.priceIdr)}/pasang = ${money(line.totalIdr)}`
      : `Paket ${line.pairs} pasang: ${line.quantity} × ${money(line.priceIdr)} = ${money(line.totalIdr)}`).join('\n• ') || 'Tidak ada biaya paket.'
    : 'Rincian paket tidak tersedia untuk harga tersimpan.';
  return {
    layanan_tarif: [...services, ...(tariff && !services.some(service => service.toLocaleLowerCase('id-ID') === tariff.toLocaleLowerCase('id-ID')) ? [tariff] : [])].join(' / ') || 'Belum tersedia',
    estimasi_total: pricing ? `${money(pricing.totalIdr)} (${projection?.stage === 'ESTIMATE' || !projection ? 'estimasi, belum final' : 'total final tersimpan'})` : 'Belum tersedia',
    rincian_harga: projection ? breakdown : 'Rincian harga tidak tersedia untuk pesanan lama.',
    estimasi_selesai: date instanceof Date && Number.isFinite(date.getTime()) ? `${new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'long', year: 'numeric' }).format(date)} WIB` : 'Belum tersedia',
  };
}
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
export const broadcastPayload = z.object({ kind: z.literal('SERVICE_BROADCAST'), campaignId: z.uuid(), customerId: z.string().min(1).max(30), message: z.string().trim().min(1).max(4000) }).strict();
export const deliveryPayload = z.object({ message: z.string().min(1).max(12000), trackingHash: z.string().regex(/^[a-f0-9]{64}$/), balanceMarker: z.string().regex(/^\[SALDO_[a-f0-9-]{36}\]$/).optional() }).strict();
export function trackingLink(origin: string, token: string, approval = '', itemId = '') {
  z.string().regex(/^(?:[a-f0-9]{64}|[A-Za-z0-9_-]{22})$/).parse(token);
  const base = new URL(origin);
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/' || (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))) throw new Error('PUBLIC_ORIGIN_INVALID');
  const url = new URL(`/track/${token}`, base);
  if (approval) { z.string().regex(/^[a-f0-9]{64}$/).parse(approval); url.hash = new URLSearchParams({ approval, item: itemId }).toString(); }
  return url.href;
}
export const previewValues: Values = { sapaan: 'Kak', nama_pelanggan: 'Dina (contoh)', total_sepatu: '2', detail_sepatu: '• Sepatu Contoh Biru\n• Sepatu Contoh Putih', nomor_pesanan: 'CONTOH-001', sepatu: 'Sepatu Contoh Biru', url_tracking: '[tautan privat pelanggan — contoh, tidak aktif]', sisa_pembayaran: 'Rp50.000', layanan_tarif: 'Cuci / Tarif contoh', estimasi_total: 'Rp90.000 (estimasi, belum final)', rincian_harga: '2 × Rp45.000 = Rp90.000', estimasi_selesai: '15 November 2026 WIB', metode_penyerahan: 'Janjian', lokasi_penyerahan: 'Lokasi contoh', catatan_penyerahan: 'Catatan contoh' };
