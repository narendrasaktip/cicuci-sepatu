import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
export const randomToken = () => randomBytes(32).toString('hex');
// 128-bit opaque capability: short enough to share, infeasible to enumerate.
export const randomTrackingToken = () => randomBytes(16).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export function equalToken(actual: string, expected: string) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function sessionCookie(header: string | undefined): string | undefined {
  return header?.split(';').map(part => part.trim()).find(part => part.startsWith('cicuci_session='))?.slice(15);
}
