export type TrackingStage = { id: string; anchor: string; name: string; visible: boolean };
export const defaultTrackingStages: TrackingStage[] = ['RECEIVED', 'QUEUED', 'WASHING', 'DRYING', 'READY_FOR_PICKUP'].map((anchor, index) => ({ id: `builtin.${anchor}`, anchor, name: ['Sepatu Diterima', 'Pemeriksaan Selesai', 'Dalam Proses Pencucian', 'Dalam Proses Pengeringan', 'Selesai Dikerjakan'][index]!, visible: true }));
export type Page<T> = { data: T[]; page: { nextCursor: string | null } };
export type AuditLog = { id: string; actorUserId: string | null; actorUser?: { name: string } | null; action: string; entityType?: string | null; entityId: string | null; metadata?: Record<string, unknown> | null; createdAt: string };
const auditActions: Record<string, string> = {
  CUSTOMER_DELETED: 'Pelanggan dihapus permanen', ORDER_DELETED: 'Pesanan dihapus permanen', RATEPLAN_DELETED: 'Tarif dihapus permanen', USER_DELETED: 'Pengguna dihapus permanen',
  API_ACTIVITY: 'Permintaan API', HTTP_REQUEST: 'Permintaan API', API_ERROR: 'Permintaan API gagal',
  WA_TEMPLATE_UPDATED: 'Template WhatsApp diperbarui', SETTINGS_UPDATED: 'Pengaturan diperbarui', LOGIN_SUCCEEDED: 'Login berhasil', LOGIN_FAILED: 'Login gagal', LOGOUT: 'Keluar akun',
  ORDER_CREATED: 'Pesanan dibuat', ORDER_UPDATED: 'Pesanan diperbarui', CUSTOMER_CREATED: 'Pelanggan ditambahkan', CUSTOMER_UPDATED: 'Pelanggan diperbarui',
  SERVICE_CREATED: 'Layanan ditambahkan', SERVICE_UPDATED: 'Layanan diperbarui', USER_CREATED: 'Pengguna ditambahkan', USER_UPDATED: 'Pengguna diperbarui',
  CONSENT_ISSUED: 'Persetujuan risiko diminta', PHOTO_UPLOADED: 'Foto diunggah', PHOTO_DELETED: 'Foto dihapus',
  PAYMENT: 'Pembayaran dicatat', REFUND: 'Pengembalian dana dicatat',
  WA_STATE_CHANGED: 'Status WhatsApp berubah', WA_CONTROL_FAILED: 'Perintah WhatsApp gagal', WA_SENDING_DISABLED: 'Pengiriman WhatsApp dinonaktifkan',
  NOTIFICATION_ATTEMPT: 'Percobaan pengiriman notifikasi', NOTIFICATION_ATTEMPT_FAILED: 'Percobaan notifikasi gagal', NOTIFICATION_FAILED: 'Notifikasi gagal',
  NOTIFICATION_SKIPPED: 'Notifikasi dilewati', NOTIFICATION_JOB_FAILED: 'Pemrosesan notifikasi gagal', NOTIFICATION_RECOVERY_FAILED: 'Pemulihan notifikasi gagal', NOTIFICATION_PERSIST_FAILED: 'Penyimpanan hasil notifikasi gagal', OUTBOX_DISPATCH_FAILED: 'Antrean notifikasi gagal',
};
export function auditAction(action: string) { return auditActions[action] ?? 'Aktivitas lainnya'; }
export function auditContext(item: AuditLog) {
  const { method, route, status } = item.metadata ?? {};
  const request = [typeof method === 'string' ? method : '', typeof route === 'string' ? route : '', typeof status === 'number' ? `HTTP ${status}` : ''].filter(Boolean).join(' · ');
  const entities: Record<string, string> = { Request: 'Permintaan API', Order: 'Pesanan', OrderItem: 'Sepatu', Customer: 'Pelanggan', User: 'Pengguna', Service: 'Layanan', Settings: 'Pengaturan', NotificationEvent: 'Notifikasi' };
  return request || entities[item.entityType ?? ''] || item.entityType || 'Aktivitas sistem';
}
export type Customer = { salutation?: 'Kak' | 'Pak' | 'Bu'; archivedAt?: string | null; id: string; name: string; whatsapp: string; notes: string | null; notificationConsentAt: string | null };
export type Service = { id: string; name: string; basePriceIdr: number; isActive: boolean };
export type Consent = { id: string; findings?: string | null; customerNote?: string | null; risk: string; quotedPriceIdr: number; expiresAt: string; decision: string | null; expired?: boolean };
export type Photo = { id: string; kind: string; customerVisible?: boolean; path?: string };
export type Item = {
  findings?: string | null; customerNote?: string | null;
  id: string; serviceId: string; serviceName: string; brand: string; model: string; color: string;
  initialNotes?: string; assignedUserId?: string | null; status: string; outcome: string | null;
  quotedPriceIdr: number; finalPriceIdr: number; risk?: string;
  inspection?: { findings?: string | null; customerNote?: string | null; notes: string; risk: string; outcome: string; createdAt: string } | null;
  consents: Consent[]; photos: Photo[];
  history?: { id: string; fromStatus: string | null; toStatus: string; reason: string; createdAt: string }[];
  timeline?: { status: string; at: string }[];
};
export type Payment = { id: string; kind: string; amountIdr: number; method: string; reference: string | null; reason: string; receivedAt: string };
export type RateRule = { kind: 'PACKAGE' | 'PER_PAIR'; minPairs: number; maxPairs: number | null; priceIdr: number };
export type TurnaroundPolicy = 'REGULAR' | 'FAST';
export function turnaroundText(policy?: TurnaroundPolicy) {
  return policy === 'FAST'
    ? 'Estimasi Fast: masuk sampai tepat 17:00:00 WIB selesai besok maksimal 17:00 WIB; lewat 17:00:00 WIB selesai lusa maksimal 17:00 WIB. Hari kalender, termasuk akhir pekan. Bukan hari yang sama atau 24 jam berjalan. Waktu dihitung server saat pesanan tersimpan.'
    : 'Estimasi selesai otomatis: 5 hari kalender, termasuk akhir pekan. Disimpan sebelum 12.00 WIB: hari ini hari ke-1; mulai 12.00 WIB: besok hari ke-1. Tanggal ditentukan server saat pesanan tersimpan.';
}
export type RatePlan = { turnaroundPolicy?: TurnaroundPolicy; id: string; name: string; isActive: boolean; revision: number; rules: RateRule[] };
export type PricingPreview = { totalIdr: number; breakdown: { kind: RateRule['kind']; quantity: number; pairs: number; priceIdr: number; totalIdr: number }[] };
export type Pricing = { turnaroundPolicy?: TurnaroundPolicy; version: 1 | 2; mode?: 'PROMO' | 'NORMAL'; name?: string; rules?: RateRule[]; planId?: string; revision?: number; serviceId: string; stage: 'ESTIMATE' | 'FINAL' | 'LOCKED'; pairs: number; initialTotalIdr: number; totalIdr: number; lockedAt: string | null;
  basis?: 'CANCELLATION' | 'HISTORICAL_AGREEMENT' | 'INSPECTION'; staffVerified?: boolean; originalTotalIdr?: number; originalPairs?: number; excludedPairs?: number; calculationMatches?: boolean; breakdown?: PricingPreview['breakdown'];
};
// Public prices come only from the authoritative snapshot breakdown, never averaged allocations.
export function trackingPrice(order: Order) {
  const pricing = order.pricing;
  if (!pricing) return 'Tarif layanan lama · sesuai rincian biaya tersimpan';
  if (pricing.calculationMatches === false) return 'Alokasi historis tersimpan · lihat pembayaran';
  const lines = pricing.breakdown;
  if (!lines?.length) return pricing.pairs === 0 ? 'Tidak ada pasangan dikenai biaya pencucian' : 'Rincian tarif tersimpan belum tersedia';
  const rupiah = (value: number) => money(value).replace(/\s/g, '');
  const unit = lines[0]!;
  if (lines.every(line => (line.kind === 'PER_PAIR' || line.pairs === 1) && line.priceIdr === unit.priceIdr)) return `${rupiah(unit.priceIdr)}/pasang`;
  return lines.map(line => line.kind === 'PER_PAIR' ? `${rupiah(line.priceIdr)}/pasang × ${line.quantity}` : `${line.quantity} paket ${line.pairs} pasang × ${rupiah(line.priceIdr)}`).join(' + ');
}
// Itemized public tariff lines; uniform single-pair/per-pair tariffs stay inline via trackingPrice.
export function trackingPriceLines(order: Order) {
  const pricing = order.pricing;
  if (!pricing || pricing.calculationMatches === false) return;
  const lines = pricing.breakdown;
  if (!lines?.length) return;
  const unit = lines[0]!;
  if (lines.every(line => (line.kind === 'PER_PAIR' || line.pairs === 1) && line.priceIdr === unit.priceIdr)) return;
  const rupiah = (value: number) => money(value).replace(/\s/g, '');
  return lines.map(line => `${line.kind === 'PER_PAIR' ? `${line.quantity} × tarif per pasang` : `paket ${line.pairs} pasang`} : ${rupiah(line.priceIdr)}`);
}
export function trackingDuration(order: Order) {
  // ponytail: only a saved FAST policy with matching timestamps supports a duration; manual/legacy dates stay date-only.
  if (order.pricing?.turnaroundPolicy !== 'FAST' || !order.createdAt) return '';
  const explicitTime = (value: string) => /T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
  if (!explicitTime(order.createdAt) || !explicitTime(order.estimatedCompletionAt)) return '';
  const created = new Date(order.createdAt), due = new Date(order.estimatedCompletionAt);
  if (!Number.isFinite(created.getTime()) || !Number.isFinite(due.getTime())) return '';
  const wib = new Date(created.getTime() + 7 * 3600000);
  const day = Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate());
  const days = wib.getTime() <= day + 17 * 3600000 ? 1 : 2;
  return due.getTime() === day + days * 86400000 + 10 * 3600000 ? `${days} hari kalender · ${days === 1 ? 'nextday' : 'melewati batas 17:00 WIB'}` : '';
}
export function pricingName(pricing: Pricing) { return pricing.name ?? (pricing.mode === 'PROMO' ? 'Promo' : pricing.mode === 'NORMAL' ? 'Normal' : 'Tarif tersimpan'); }
export function pricingLabel(stage: string) { return stage === 'ESTIMATE' ? 'Estimasi biaya · menunggu pemeriksaan/persetujuan risiko' : stage === 'FINAL' ? 'Total final · hasil verifikasi staf' : 'Harga disetujui dan terkunci'; }
export type Order = { trackingStages?: TrackingStage[]; publicOrigin?: string; statusLabels?: Record<string, string>; archivedAt?: string | null; pricing?: Pricing | null; refundDueIdr?: number; notification?: { status: string; reason?: string; actualOutbound: false };
  id: string; number: string; customerId?: string; customer?: Customer; createdAt?: string; estimatedCompletionAt: string;
  pickupInstructions: string; aggregateStatus: string; totalIdr: number; paidIdr: number; balanceIdr: number;
  paymentStatus: string; itemCount?: number; items: Item[]; payments?: Payment[]; trackingToken?: string;
};
export type Notification = { id: string; provider: string; template: string; recipient: string; status: string; eventKey: string; lastError?: string; createdAt: string; attempts: { id: string; attemptNo: number; status?: string; error?: string | null; response?: unknown; attemptedAt: string }[] };
export function whatsappReason(code?: string) {
  if (code === 'MESSAGE_UNAVAILABLE') return 'Template atau tautan aman belum tersedia. Event ini tidak dikirim ulang.';
  if (code === 'TRACKING_CHANGED') return 'Tautan tracking sudah diganti atau dicabut. Pesan lama tidak dikirim.';
  const reasons: Record<string, string> = {
    NOT_ENABLED: 'Pengiriman belum diaktifkan pemilik. Buka menu WhatsApp untuk aktivasi; hanya event baru yang dapat dikirim.',
    NO_CURRENT_OPT_IN: 'Pelanggan belum menyetujui notifikasi WhatsApp. Minta persetujuan sebelum mengaktifkan notifikasi pelanggan.',
    WORKER_OFFLINE: 'Worker WhatsApp tidak aktif. Minta pengelola menjalankan worker, lalu periksa status.',
    WORKER_UNAVAILABLE: 'Worker tidak dapat diperiksa. Minta pengelola memeriksa layanan, lalu periksa status.',
    INVALID_WORKER_STATUS: 'Status worker tidak dapat diverifikasi. Minta pengelola memeriksa layanan.',
    PROVIDER_NOT_READY: 'WhatsApp belum siap mengirim. Periksa koneksi dan izin pengiriman di menu WhatsApp.',
    NOT_READY: 'WhatsApp belum siap. Tunggu status terhubung sebelum mengaktifkan pengiriman.',
    AUTH_FAILED: 'Penautan akun gagal. Periksa perangkat tertaut di ponsel, lalu coba hubungkan kembali.',
    INITIALIZATION_FAILED: 'Penyiapan WhatsApp gagal. Penyebab belum dipastikan; minta pengelola memeriksa tahap dan kode diagnostik di Audit.',
    BROWSER_PROTOCOL_FAILED: 'Komunikasi aplikasi dengan browser gagal. Minta pengelola memeriksa kompatibilitas browser dan provider melalui Audit.',
    WHATSAPP_PAGE_FAILED: 'Penyiapan halaman WhatsApp gagal. Minta pengelola memeriksa tahap dan kode diagnostik di Audit; sesi tidak perlu dihapus.',
    LOGOUT_FAILED: 'Keluar dari WhatsApp gagal. Periksa perangkat tertaut di ponsel sebelum menghapus sesi lagi.',
    BROWSER_CLOSE_FAILED: 'Browser gagal ditutup. Minta pengelola memeriksa worker sebelum mencoba lagi.',
    SESSION_DELETE_FAILED: 'Sesi gagal dihapus. Minta pengelola memeriksa izin penyimpanan sesi.',
    COMMAND_EXPIRED: 'Perintah kedaluwarsa. Periksa status, lalu ulangi tindakan jika masih diperlukan.',
    AMBIGUOUS_SEND_MANUAL_REVIEW: 'Hasil pengiriman tidak pasti. Periksa riwayat dan WhatsApp toko; jangan langsung kirim ulang.',
    WORKER_RESTART_AMBIGUOUS_SEND: 'Worker dimulai ulang saat pengiriman. Periksa WhatsApp toko; jangan langsung kirim ulang.',
  };
  return reasons[code ?? ''] ?? 'Penyebab belum dapat dipastikan. Periksa diagnostik atau minta bantuan pengelola.';
}
export function orderNotificationFeedback(notification: Order['notification']) {
  switch (notification?.status) {
    case 'PENDING': return 'Notifikasi WhatsApp masuk antrean pengiriman.';
    case 'PROCESSING': return 'WhatsApp sedang diproses; belum ada kepastian diterima pelanggan. Pantau menu WhatsApp.';
    case 'SENT': return 'WhatsApp diajukan ke browser; bukan bukti diterima atau dibaca pelanggan.';
    case 'SKIPPED': return `WhatsApp tidak diantrekan. ${whatsappReason(notification.reason)} Pesan ini tidak dikirim ulang otomatis.`;
    case 'FAILED': return `Notifikasi WhatsApp gagal. ${whatsappReason(notification.reason)} Periksa menu WhatsApp sebelum mengulang.`;
    case 'SIMULATED': return 'Notifikasi hanya simulasi; tidak ada pesan nyata yang dikirim.';
    default: return 'Status notifikasi WhatsApp belum tersedia. Periksa menu WhatsApp; jangan anggap pesan sudah diantrekan atau dikirim.';
  }
}
export const labels: Record<string, string> = {
  PACKING: 'Pengemasan · pemeriksaan mutu',
  RECEIVED: 'Pemeriksaan', WAITING_INSPECTION: 'Pemeriksaan', INSPECTION: 'Pemeriksaan', AWAITING_CONSENT: 'Menunggu persetujuan', QUEUED: 'Pemeriksaan · disetujui', WASHING: 'Pengerjaan', DRYING: 'Pengeringan', FINISHING: 'Pengeringan · finishing', QC: 'Pengeringan · pemeriksaan mutu', REWORK: 'Pengerjaan · ulang', READY_FOR_PICKUP: 'Siap diambil', HANDED_OVER: 'Sudah diambil', RETURN_PENDING: 'Tidak dicuci', RETURNED: 'Tidak dicuci', COMPLETED: 'Selesai', IN_PROGRESS: 'Diproses', APPROVED: 'Disetujui inspeksi', NEEDS_CONSENT: 'Perlu persetujuan risiko', REJECTED: 'Ditolak inspeksi', DECLINED: 'Ditolak pelanggan', APPROVE: 'Setuju', DECLINE: 'Tidak setuju', UNPAID: 'Belum dibayar', PARTIAL: 'Dibayar sebagian', PAID: 'Lunas', REFUNDED: 'Dikembalikan seluruhnya', PENDING: 'Menunggu antrean', PROCESSING: 'Sedang diajukan ke browser', SIMULATED: 'Simulasi berhasil', FAILED: 'Gagal', SKIPPED: 'Dilewati', SENT: 'Diajukan ke browser (belum bukti diterima)', BEFORE: 'Sebelum', INSPECTION_PHOTO: 'Bukti inspeksi privat', AFTER: 'Sesudah', OWNER: 'Pemilik', ADMIN: 'Admin', STAFF: 'Staf', QRIS: 'QRIS', CASH: 'Tunai', TRANSFER: 'Transfer', EWALLET: 'Dompet digital', OTHER: 'Lainnya', PAYMENT: 'Pembayaran', REFUND: 'Pengembalian dana',
};
export const label = (value: string) => labels[value] ?? value;
export const money = (value: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
export const date = (value: string) => { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? '-' : new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed); };
export const localDate = (value: string) => { const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
export const terminal = (item: Item) => ['HANDED_OVER', 'RETURNED'].includes(item.status);
// Display hints only; backend remains authoritative for guards and permissions.
export function nextActions(item: Item, staff: boolean) {
  const actions: Record<string, string[]> = { QUEUED: ['WASHING'], WASHING: ['DRYING'], DRYING: ['PACKING', 'REWORK'], PACKING: ['READY_FOR_PICKUP', 'REWORK'], FINISHING: ['READY_FOR_PICKUP', 'REWORK'], QC: ['READY_FOR_PICKUP', 'REWORK'], REWORK: ['WASHING', 'FINISHING'] };
  return (actions[item.status] ?? []).filter(s => !(staff && s === 'RETURNED'));
}
export function actionLabel(status: string) { return ({ WASHING: 'Mulai pengerjaan', DRYING: 'Mulai pengeringan', PACKING: 'Mulai pengemasan dan QC', QC: 'Periksa mutu / pengerjaan ulang', REWORK: 'Ulangi pengerjaan' } as Record<string, string>)[status] ?? label(status); }
export function itemFee(item: Item) { return !item.outcome || item.status === 'AWAITING_CONSENT' ? 'Harga belum dikonfirmasi' : `Biaya diterima ${money(item.finalPriceIdr)}`; }
export function statusName(map: Record<string, string> | undefined, context: string, code: string, fallback = label(code)) { return map?.[`${context}.${code}`] ?? fallback; }
export function trackingUrl(token: string, approvalToken = '', itemId = '', origin = '') {
  if (!origin) return '';
  const url = new URL(`/track/${token}`, origin);
  if (approvalToken) url.hash = new URLSearchParams({ approval: approvalToken, item: itemId }).toString();
  return url.href;
}
export async function photoInput(file: File) {
  if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 10 * 1024 * 1024 || !file.size) throw new Error('Foto wajib PNG/JPEG, ukuran maksimum 10 MiB.');
  const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('Foto tidak dapat dibaca.')); reader.readAsDataURL(file); });
  return { mime: file.type, base64 };
}

export const completionDate = (value: string) => { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? '-' : `${new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(parsed)} WIB`; };
