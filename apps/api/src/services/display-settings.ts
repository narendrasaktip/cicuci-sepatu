import { z } from 'zod';
import type { Tx } from '../repositories/orders.js';

const stages = {
  RECEIVED: 'Pemeriksaan', INSPECTION: 'Pemeriksaan', AWAITING_CONSENT: 'Menunggu persetujuan', QUEUED: 'Pemeriksaan · disetujui',
  WASHING: 'Pengerjaan', DRYING: 'Pengeringan', PACKING: 'Pengemasan · pemeriksaan mutu', FINISHING: 'Pengeringan · finishing', QC: 'Pengeringan · pemeriksaan mutu', REWORK: 'Pengerjaan · ulang',
  READY_FOR_PICKUP: 'Siap diambil', HANDED_OVER: 'Sudah diambil', RETURN_PENDING: 'Tidak dicuci', RETURNED: 'Tidak dicuci',
};
const title = (value: string) => value.replace(/\p{L}[\p{L}\p{M}]*/gu, word => word[0]!.toLocaleUpperCase('id-ID') + word.slice(1));
const publicStages = { ...Object.fromEntries(Object.entries(stages).map(([key, value]) => [key, title(value)])), QUEUED: 'Pemeriksaan Selesai', AWAITING_CONSENT: 'Menunggu Persetujuan Client' };
const contextual = (context: string, values: Record<string, string>) => Object.fromEntries(Object.entries(values).map(([code, value]) => [`${context}.${code}`, value]));
export const defaultStatusLabels: Record<string, string> = {
  ...contextual('admin', { ...stages, WAITING_INSPECTION: 'Pemeriksaan', COMPLETED: 'Selesai', IN_PROGRESS: 'Diproses' }),
  ...contextual('order', { ...publicStages, WAITING_INSPECTION: 'Pemeriksaan', COMPLETED: 'Selesai', IN_PROGRESS: 'Diproses' }),
  ...contextual('shoe', { ...publicStages, RECEIVED: 'Waiting List', READY_FOR_PICKUP: 'Selesai Dikerjakan', RETURN_PENDING: 'Tidak Dicuci', RETURNED: 'Tidak Dicuci' }),
  ...contextual('history', { ...publicStages, RECEIVED: 'Sepatu Diterima', INSPECTION: 'Pemeriksaan Sepatu', WASHING: 'Dalam Proses Pencucian', DRYING: 'Dalam Proses Pengeringan', READY_FOR_PICKUP: 'Selesai Dikerjakan', RETURN_PENDING: 'Tidak Dicuci', RETURNED: 'Tidak Dicuci' }),
};
// eslint-disable-next-line no-control-regex
const displayText = z.string().trim().min(1).max(80).refine(value => !/[<>\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value), 'Nama harus teks biasa.');
export const statusLabelsInput = z.object(Object.fromEntries(Object.keys(defaultStatusLabels).map(key => [key, displayText.optional()]))).strict();
export const stageAnchors = ['RECEIVED', 'QUEUED', 'WASHING', 'DRYING', 'READY_FOR_PICKUP'] as const;
export const defaultTrackingStages = stageAnchors.map((anchor, index) => ({
  id: `builtin.${anchor}`, anchor, name: ['Sepatu Diterima', 'Pemeriksaan Selesai', 'Dalam Proses Pencucian', 'Dalam Proses Pengeringan', 'Selesai Dikerjakan'][index]!, visible: true,
}));
export const trackingStagesInput = z.array(z.object({
  id: z.string().max(80).regex(/^(builtin\.(RECEIVED|QUEUED|WASHING|DRYING|READY_FOR_PICKUP)|custom\.[a-zA-Z0-9_-]{1,64})$/),
  anchor: z.enum(stageAnchors), name: displayText, visible: z.boolean(),
}).strict().refine(stage => !stage.id.startsWith('builtin.') || stage.id === `builtin.${stage.anchor}`, 'Tahap bawaan tidak dapat dipindahkan ke acuan lain.')).max(20).refine(stages => new Set(stages.map(stage => stage.id)).size === stages.length, 'ID tahap duplikat.');
export type TrackingStage = z.infer<typeof trackingStagesInput>[number];
export const publicOriginInput = z.string().trim().min(1).max(300).transform((value, ctx) => {
  try {
    const url = new URL(value);
    const hostname = url.hostname;
    const validHost = hostname === '[::1]' || (hostname.length <= 253 && hostname.split('.').every(part => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(part)));
    if (!/^https?:\/\/[^/?#]+\/?$/i.test(value) || !validHost || url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname)))) throw new Error('invalid');
    return url.origin;
  } catch { ctx.addIssue({ code: 'custom', message: 'Gunakan origin HTTPS tanpa path, kredensial, query atau fragment; HTTP hanya loopback.' }); return z.NEVER; }
});
export const displayInput = z.object({ statusLabels: statusLabelsInput.optional(), publicOrigin: publicOriginInput.optional(), trackingStages: trackingStagesInput.optional() }).strict();
export type DisplaySettings = { statusLabels: Record<string, string>; publicOrigin: string; trackingStages: TrackingStage[] };
export function displaySettings(value: unknown, fallback = 'http://127.0.0.1:5173'): DisplaySettings {
  const saved = displayInput.parse(value ?? {});
  return { trackingStages: saved.trackingStages ?? structuredClone(defaultTrackingStages), statusLabels: { ...defaultStatusLabels, ...saved.statusLabels } as Record<string, string>, publicOrigin: saved.publicOrigin ?? publicOriginInput.parse(fallback) };
}
export function publicLabels(value: DisplaySettings) {
  return Object.fromEntries(Object.entries(value.statusLabels).filter(([key]) => /^(order|shoe|history)\./.test(key)));
}
export function publicDisplay(value: DisplaySettings) {
  return { statusLabels: publicLabels(value), trackingStages: value.trackingStages.filter(stage => stage.visible).map(({ id, anchor, name, visible }) => ({ id, anchor, name, visible })) };
}
// Raw column access keeps the running pre-migration Prisma client/worker compatible; deploy migration before API activation.
export async function readDisplaySettings(tx: Tx, fallback?: string) {
  const rows = await tx.$queryRaw<{ displaySettings: unknown }[]>`SELECT displaySettings FROM StoreSettings WHERE id = 1`;
  const raw = rows[0]?.displaySettings;
  return displaySettings(typeof raw === 'string' ? JSON.parse(raw) : raw, fallback);
}
export async function writeDisplaySettings(tx: Tx, value: DisplaySettings) {
  await tx.$executeRaw`UPDATE StoreSettings SET displaySettings = ${JSON.stringify(value)} WHERE id = 1`;
}
