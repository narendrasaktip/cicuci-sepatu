// Serialized into the browser; no account data or media leave this boundary.
export function installMediaCompatibility() {
  type Media = Record<string, unknown> & { toJSON?: () => Record<string, unknown> };
  const root = globalThis as unknown as { WWebJS: { processMediaData: ((...args: unknown[]) => Promise<Media>) & { cicuciSerializedMedia?: boolean } } };
  const original = root.WWebJS.processMediaData;
  if (original.cicuciSerializedMedia) return;
  // ponytail: whatsapp-web.js 1.34.7 spreads model storage into Msg; remove when upstream serializes media safely.
  const wrapped = async function (this: unknown, ...args: unknown[]) {
    const media = await original.apply(this, args);
    if (typeof media.toJSON !== 'function') return media;
    return { ...media.toJSON(), clientUrl: media.clientUrl, deprecatedMms3Url: media.deprecatedMms3Url, uploadhash: media.uploadhash, streamingSidecar: media.streamingSidecar, mediaHandle: media.mediaHandle };
  };
  wrapped.cicuciSerializedMedia = true;
  root.WWebJS.processMediaData = wrapped;
}

export const mediaCompatibilityScript = () => `((__name) => (${installMediaCompatibility.toString()})())((fn) => fn)`;
