export type User = { id: string; name: string; email: string; role: 'OWNER' | 'ADMIN' | 'STAFF'; isActive?: boolean };
let csrfToken = '';
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const messages: Record<string, string> = {
  UNAUTHENTICATED: 'Sesi berakhir atau kredensial tidak valid. Silakan masuk kembali.',
  FORBIDDEN: 'Tindakan tidak diizinkan untuk akun atau penugasan ini.',
  NOT_FOUND: 'Data atau tautan tidak ditemukan; mungkin sudah dicabut.',
  VALIDATION_ERROR: 'Isian tidak valid. Periksa format dan batas isian.',
  CONFLICT: 'Data berubah atau tindakan tidak memenuhi aturan. Muat ulang lalu periksa kembali.',
  RATE_LIMITED: 'Terlalu banyak permintaan. Tunggu sebelum mencoba kembali.',
  ARCHIVED: 'Data tidak tersedia untuk perubahan.',
  CURRENT_ACCOUNT: 'Akun sendiri tidak boleh dihapus, dinonaktifkan, atau diturunkan perannya.',
  CUSTOMER_HAS_ORDERS: 'Pelanggan masih memiliki pesanan. Hapus pesanan yang memenuhi syarat terlebih dahulu; tidak ada penghapusan berantai.',
  ORDER_HAS_PAYMENTS: 'Pesanan memiliki catatan pembayaran atau pengembalian dana. Tidak dapat dihapus; ledger wajib dipertahankan meskipun saldo nol.',
  NOTIFICATION_IN_PROGRESS: 'Notifikasi masih antre atau sedang diproses/diklaim. Penghapusan ditolak untuk mencegah pengiriman bersamaan.',
  USER_HAS_HISTORY: 'Pengguna dirujuk penugasan atau riwayat operasional. Tidak dapat dihapus; riwayat wajib dipertahankan.',
  DELETE_DEPENDENCY: 'Penghapusan ditolak karena ketergantungan data. Riwayat notifikasi, bukti pengiriman dan audit tidak dihapus.',
  LAST_OWNER: 'Minimal satu Owner aktif harus tetap tersedia.',
};
export async function api<T>(path: string, method = 'GET', body?: unknown, publicRequest = false, key = crypto.randomUUID()): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    if (!publicRequest) { headers['X-CSRF-Token'] = csrfToken; headers['Idempotency-Key'] = key; }
  }
  let response: Response;
  try { response = await fetch(`/api/v1${path}`, { method, headers, credentials: publicRequest ? 'omit' : 'same-origin', body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) }); }
  catch { throw new Error('Koneksi terputus. Periksa jaringan; muat ulang data sebelum mengulang tindakan.'); }
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string; details?: unknown } };
    const code = result.error?.code ?? `HTTP_${response.status}`;
    if (response.status === 401 && path !== '/auth/login') window.dispatchEvent(new Event('session-expired'));
    throw new ApiError(response.status, code, `${messages[code] ?? (response.status === 410 ? 'Persetujuan kedaluwarsa. Minta tautan baru kepada toko.' : result.error?.message ?? 'Permintaan gagal.')} (${code})`);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}
export async function currentUser(): Promise<User> {
  const result = await api<{ user: User; csrfToken: string }>('/auth/me'); csrfToken = result.csrfToken; return result.user;
}
export async function login(email: string, password: string) {
  await api('/auth/login', 'POST', { email, password }); return currentUser();
}
export async function logout() { await api('/auth/logout', 'POST'); csrfToken = ''; }
