import { inflateSync } from 'node:zlib';
import sharp from 'sharp';
import { audit, type Tx } from '../repositories/orders.js';
import { ApiError, check, ownedItem, type Actor } from './orders.js';
function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
export function validateImage(base64: string, mime: 'image/png' | 'image/jpeg') {
  const content = Buffer.from(base64, 'base64');
  check(content.toString('base64') === base64 && content.length > 0 && content.length <= 10 * 1024 * 1024, 'UPLOAD_INVALID', 400);
  if (mime === 'image/png') {
    check(content.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), 'UPLOAD_INVALID', 400);
    let pos = 8; let width = 0; let height = 0; let ended = false; const chunks: Buffer[] = [];
    while (pos + 12 <= content.length) {
      const length = content.readUInt32BE(pos); const type = content.toString('ascii', pos + 4, pos + 8);
      check(pos + length + 12 <= content.length, 'UPLOAD_INVALID', 400);
      check(crc32(content.subarray(pos + 4, pos + 8 + length)) === content.readUInt32BE(pos + 8 + length), 'UPLOAD_INVALID', 400);
      if (pos === 8) { check(type === 'IHDR' && length === 13, 'UPLOAD_INVALID', 400); width = content.readUInt32BE(pos + 8); height = content.readUInt32BE(pos + 12); }
      if (type === 'IDAT') chunks.push(content.subarray(pos + 8, pos + 8 + length));
      pos += length + 12;
      if (type === 'IEND') { check(length === 0 && pos === content.length, 'UPLOAD_INVALID', 400); ended = true; break; }
    }
    check(ended && width > 0 && height > 0 && width * height <= 16000000 && chunks.length, 'UPLOAD_INVALID', 400);
    try { check(inflateSync(Buffer.concat(chunks), { maxOutputLength: 128 * 1024 * 1024 }).length > 0, 'UPLOAD_INVALID', 400); } catch { check(false, 'UPLOAD_INVALID', 400); }
  } else {
    check(content[0] === 255 && content[1] === 216 && content.at(-2) === 255 && content.at(-1) === 217, 'UPLOAD_INVALID', 400);
    let pos = 2; let sized = false; let scanned = false;
    while (pos + 4 < content.length) {
      check(content[pos] === 255, 'UPLOAD_INVALID', 400); const marker = content[pos + 1]; const length = content.readUInt16BE(pos + 2);
      check(length >= 2 && pos + 2 + length <= content.length, 'UPLOAD_INVALID', 400);
      if (marker === 192 || marker === 194) { check(length >= 8, 'UPLOAD_INVALID', 400); const h = content.readUInt16BE(pos + 5); const w = content.readUInt16BE(pos + 7); check(w > 0 && h > 0 && w * h <= 16000000, 'UPLOAD_INVALID', 400); sized = true; }
      if (marker === 218) { scanned = true; break; } pos += 2 + length;
    }
    check(sized && scanned, 'UPLOAD_INVALID', 400);
  }
  return content;
}
export async function optimizeImage(content: Buffer) {
  try {
    // ponytail: fixed evidence-friendly quality; no byte-size guarantee or repeated lossy passes.
    return await sharp(content, { limitInputPixels: 16000000, failOn: 'warning' })
      .rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 }).toBuffer(); // Metadata stripped by default; never keep the original on failure.
  } catch { throw new ApiError(400, 'UPLOAD_INVALID'); }
}
export async function uploadPhoto(tx: Tx, id: string, input: { kind: 'BEFORE' | 'INSPECTION' | 'AFTER'; customerVisible: boolean; mime: 'image/png' | 'image/jpeg'; base64: string }, actor: Actor) {
  const original = validateImage(input.base64, input.mime); const item = await ownedItem(tx, id, actor);
  check(!['HANDED_OVER', 'RETURNED'].includes(item.status), 'ITEM_CLOSED');
  check(item.photos.length < 20, 'PHOTO_LIMIT'); check(input.kind !== 'INSPECTION' || !input.customerVisible, 'PRIVATE_INSPECTION', 400);
  const content = await optimizeImage(original);
  const photo = await tx.photo.create({ data: { itemId: id, kind: input.kind, mime: 'image/webp', customerVisible: input.customerVisible, content }, select: { id: true, kind: true, mime: true, customerVisible: true } });
  await audit(tx, actor.id, 'PHOTO_UPLOADED', photo.id); return photo;
}
export async function deletePhoto(tx: Tx, id: string, actor: Actor) {
  const photo = await tx.photo.findUnique({ where: { id }, select: { itemId: true, kind: true } }); check(photo, 'NOT_FOUND', 404);
  const item = await ownedItem(tx, photo.itemId, actor);
  check(!['READY_FOR_PICKUP', 'HANDED_OVER', 'RETURNED'].includes(item.status), 'PHOTO_LOCKED');
  check(!(photo.kind === 'INSPECTION' && item.inspection) && !(photo.kind === 'BEFORE' && item.inspection), 'EVIDENCE_LOCKED');
  await tx.photo.delete({ where: { id } }); await audit(tx, actor.id, 'PHOTO_DELETED', id); return { deleted: true };
}
