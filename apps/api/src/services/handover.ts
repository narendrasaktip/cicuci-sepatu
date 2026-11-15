import { z } from 'zod';

const handoverFields = { method: z.enum(['STORE', 'PICKUP', 'MEETUP', 'COURIER']), location: z.string().trim().max(4000) };
const locationRequired = { message: 'Lokasi wajib diisi', path: ['location'] };
export const preferenceInput = z.object(handoverFields).strict().refine(v => v.method === 'STORE' || !!v.location, locationRequired);
export const handoverInput = z.object({ ...handoverFields, note: z.string().trim().max(4000) }).strict().refine(v => v.method === 'STORE' || !!v.location, locationRequired);

export function handoverPreference(handover: z.infer<typeof preferenceInput>) {
  return { preferredHandoverMethod: handover.method, preferredHandoverLocation: handover.method === 'STORE' ? null : handover.location };
}
