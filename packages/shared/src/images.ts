// Checks for photo uploads. Pure functions so they run (and are tested) outside the app.

/** Decodes base64 (optionally a data: URI) into bytes. atob exists in Hermes, browsers and Node. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/^data:[^,]*,/, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const HEIF_BRANDS = ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1', 'avif'];

/**
 * True if the bytes start like a JPEG, PNG, WebP or HEIC/HEIF image. Guards against uploading an
 * error body (Expo Go once stored "File not found" as a photo) or a video with the same container.
 */
export function looksLikeImage(bytes: Uint8Array): boolean {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  return (
    (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) || // JPEG
    (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') ||
    (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') ||
    (ascii(4, 8) === 'ftyp' && HEIF_BRANDS.includes(ascii(8, 12)))
  );
}

/**
 * Random v4-style UUID for storage file names. Pure JS (no native module, so it works in Expo Go);
 * names only need to be unique, not unguessable, because the bucket is private.
 */
export function photoFileId(random: () => number = Math.random): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
