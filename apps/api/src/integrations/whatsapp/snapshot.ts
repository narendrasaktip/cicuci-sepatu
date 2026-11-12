import { z } from 'zod';

const snapshot = z.object({
  workerId: z.string().min(1), updatedAt: z.number().finite(),
  state: z.enum(['stopped', 'starting', 'qr', 'authenticated', 'ready', 'disconnected', 'error']),
  ready: z.boolean(), realSendEnabled: z.boolean(), activation: z.string().nullable(),
  qr: z.string().optional(), qrExpiresAt: z.number().optional(),
}).passthrough();

// One atomic read binds a signed snapshot to the current worker lease. No control side effects.
export async function readWorkerSnapshot(
  read: () => Promise<[string | null, string | null]>,
  verify: (payload: string, signature: string) => Promise<boolean>,
  now?: number,
) {
  const [raw, owner] = await read();
  if (!raw || !owner) return;
  const envelope = z.object({ payload: z.string(), signature: z.string() }).parse(JSON.parse(raw));
  if (!await verify(envelope.payload, envelope.signature)) throw new Error('INVALID_WORKER_STATUS');
  const state = snapshot.parse(JSON.parse(envelope.payload));
  now ??= Date.now();
  if (state.workerId !== owner || state.updatedAt < now - 12000 || state.updatedAt > now) return;
  if (state.ready !== (state.state === 'ready') || state.realSendEnabled !== (!!state.activation && state.ready)) throw new Error('INVALID_WORKER_STATUS');
  return state;
}
